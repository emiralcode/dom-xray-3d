// Uygulama denetleyicisi: analiz akışı, seçim, arama, filtreler, zaman çizelgesi, kısayollar.
import * as THREE from 'three';
import { Engine } from './scene/engine.js';
import { City } from './scene/city.js';
import { Network } from './scene/network.js';
import { buildModel, compileSelector, ancestry, nodeLabel } from './model.js';
import { renderReport } from './ui/report.js';
import { renderNode, renderResource, renderSite } from './ui/inspector.js';
import { demoResult } from './demo.js';
import { DOM_CATEGORIES, RES_TYPES, esc, fileName, fmtBytes, fmtMs, fmtNum } from './util.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const engine = new Engine($('#viewport'));
const city = new City(engine);
const network = new Network(engine);

const app = {
  model: null,
  demo: true,
  selected: null,
  hover: null,
  es: null,
  bounds: null,
  hiddenCats: new Set(),
  hiddenTypes: new Set(),
  toggles: { dom: true, net: true, labels: true, hidden: true, rotate: false, bloom: true },
};

city.onLabelClick = (i) => !app.demo && select({ kind: 'node', idx: i }, true);
network.onLabelClick = (i) => !app.demo && select({ kind: 'site', idx: i }, true);

/* ------------------------------- Sahne yükle ------------------------------- */

function loadModel(model, { demo = false } = {}) {
  app.model = model;
  app.demo = demo;
  app.selected = null;
  app.hover = null;
  const cb = city.build(model);
  const nb = network.build(model, cb);
  app.bounds = { city: cb, net: nb };
  engine.setWorldScale(Math.max(cb.size, nb.radius));
  city.setState({ hiddenCats: app.hiddenCats, showHidden: app.toggles.hidden, match: null, selected: -1, hover: -1, path: null });
  network.setState({ hiddenTypes: app.hiddenTypes, selected: null, hover: null });
  city.setLabelsVisible(!demo && app.toggles.labels);
  network.setLabelsVisible(!demo && app.toggles.labels);
  resetCamera(!demo);
  engine.pulseScan(Math.max(cb.size, nb.radius) * 1.1, demo ? 3 : 2.6, demo ? 0.7 : 1.2);
}

function resetCamera(animate = true) {
  if (!app.bounds) return;
  const { city: cb, net: nb } = app.bounds;
  const radius = Math.max(cb.size * 0.75, nb.radius * 0.95);
  const target = new THREE.Vector3(0, cb.height * 0.5 + nb.core.y * 0.15, 0);
  const pos = target.clone().add(new THREE.Vector3(1, 0.72, 1.15).normalize().multiplyScalar(radius * 1.75));
  if (animate) engine.flyTo(target, pos, 1.6);
  else {
    engine.camera.position.copy(pos);
    engine.controls.target.copy(target);
  }
}

// Karşılama arka planı
loadModel(buildModel(demoResult()), { demo: true });
engine.controls.autoRotate = true;

/* --------------------------------- Analiz --------------------------------- */

const STEP_PCT = { queue: 4, launch: 10, navigate: 22, load: 40, settle: 55, scroll: 68, dom: 80, screenshot: 88, network: 94, done: 100, cache: 100 };
let loaderTimer = null;

function startAnalysis(input) {
  const url = String(input || '').trim();
  if (!url) { toast('Lütfen bir URL girin.'); $('#url-input').focus(); return; }
  stopAnalysis();
  const fresh = $('#fresh').checked;
  $('#url-input').value = url;
  $('#loader').hidden = false;
  $('#hero').hidden = true;
  $('#loader-title').textContent = 'Röntgen çekiliyor…';
  $('#loader-url').textContent = url;
  $('#loader-steps').innerHTML = '';
  $('#loader-progress').style.width = '2%';
  $('#analyze-btn').disabled = true;
  const t0 = performance.now();
  loaderTimer = setInterval(() => ($('#loader-time').textContent = `${((performance.now() - t0) / 1000).toFixed(1)} s`), 100);

  const es = (app.es = new EventSource(`/api/analyze?url=${encodeURIComponent(url)}${fresh ? '&fresh=1' : ''}`));
  es.addEventListener('progress', (e) => {
    const { step, message } = JSON.parse(e.data);
    const steps = $('#loader-steps');
    steps.querySelectorAll('li:not(.done)').forEach((li) => li.classList.add('done'));
    const li = document.createElement('li');
    li.textContent = message;
    if (step === 'done' || step === 'cache') li.classList.add('done');
    steps.appendChild(li);
    while (steps.children.length > 6) steps.firstChild.remove();
    $('#loader-progress').style.width = `${STEP_PCT[step] ?? 50}%`;
  });
  es.addEventListener('result', (e) => {
    stopAnalysis();
    try {
      onResult(JSON.parse(e.data));
    } catch (err) {
      console.error(err);
      toast('Sonuç işlenemedi: ' + err.message);
    }
  });
  es.addEventListener('failure', (e) => {
    const { message } = JSON.parse(e.data);
    const li = document.createElement('li');
    li.className = 'err';
    li.textContent = message;
    $('#loader-steps').appendChild(li);
    stopAnalysis(false);
    $('#loader-title').textContent = 'Analiz başarısız';
    setTimeout(() => { $('#loader').hidden = true; if (app.demo) $('#hero').hidden = false; }, 2200);
    toast(message);
  });
  es.onerror = () => {
    if (app.es !== es) return;
    stopAnalysis();
    toast('Sunucu bağlantısı koptu.');
  };
}

function stopAnalysis(hide = true) {
  app.es?.close();
  app.es = null;
  clearInterval(loaderTimer);
  $('#analyze-btn').disabled = false;
  if (hide) {
    $('#loader').hidden = true;
    if (app.demo) $('#hero').hidden = false;
  }
}

function onResult(data) {
  const model = buildModel(data);
  $('#hero').hidden = true;
  ['#report', '#legend', '#dock'].forEach((s) => ($(s).hidden = false));
  $('#inspector').hidden = true;
  $('#export-btn').disabled = false;
  app.hiddenCats = new Set();
  app.hiddenTypes = new Set();
  clearSearch();
  stopReplay();
  setToggle('rotate', false);
  loadModel(model);
  renderReport($('#report-body'), model, {
    selectResource: (i) => select({ kind: 'resource', idx: i }, true),
    selectSite: (i) => select({ kind: 'site', idx: i }, true),
    search: (q) => { $('#search').value = q; applySearch(); },
  });
  $('#report-body').scrollTop = 0;
  buildLegend(model);
  buildTimeline(model);
  setLayout('city');
  let host = data.finalUrl;
  try { host = new URL(data.finalUrl).host; } catch { /* yok */ }
  document.title = `${host} — DOM X-Ray 3D`;
  const u = new URL(location.href);
  u.searchParams.set('url', data.url);
  history.replaceState(null, '', u);
  if (data.dom.truncated) toast(`Büyük DOM: ilk ${fmtNum(data.dom.nodes.length)} öğe gösteriliyor.`, 'info');
}

/* ---------------------------------- Seçim ---------------------------------- */

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let needsPick = false;
let pointer = { x: 0, y: 0, inside: false };
let downAt = null;
const canvas = engine.renderer.domElement;

function pickAt() {
  raycaster.setFromCamera(ndc, engine.camera);
  const ray = raycaster.ray;
  const hits = [app.toggles.dom && city.pick(ray), app.toggles.net && network.pick(ray)].filter(Boolean);
  hits.sort((a, b) => a.distance - b.distance);
  return hits[0] || null;
}

canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  pointer = { x: e.clientX, y: e.clientY, inside: true };
  needsPick = true;
  positionTooltip();
});
canvas.addEventListener('pointerleave', () => { pointer.inside = false; setHover(null); });
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || app.demo) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 5 || e.button !== 0) return;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  select(pickAt(), false);
});
canvas.addEventListener('dblclick', () => { if (app.selected) focusSelection(); });

engine.onFrame(() => {
  if (!needsPick || app.demo || !pointer.inside) return;
  needsPick = false;
  setHover(pickAt());
});

const sameHit = (a, b) => (a && b ? a.kind === b.kind && a.idx === b.idx : a === b);

function setHover(hit) {
  if (sameHit(hit, app.hover)) return;
  app.hover = hit;
  city.setState({ hover: hit?.kind === 'node' ? hit.idx : -1 });
  network.setState({ hover: hit && hit.kind !== 'node' ? hit : null });
  canvas.style.cursor = hit ? 'pointer' : '';
  const tt = $('#tooltip');
  if (!hit) { tt.classList.remove('show'); return; }
  tt.innerHTML = tooltipHtml(hit);
  tt.classList.add('show');
  positionTooltip();
}

function tooltipHtml(hit) {
  const m = app.model;
  if (hit.kind === 'node') {
    const n = m.nodes[hit.idx];
    return `<div class="tt-title"><i style="background:${DOM_CATEGORIES[n.cat].color}"></i>${esc(nodeLabel(n, true))}</div>
      <div class="tt-sub">${fmtNum(m.desc[hit.idx])} alt öğe · derinlik ${n.d} · ${n.r[2]}×${n.r[3]}px${n.h ? ' · gizli' : ''}</div>`;
  }
  if (hit.kind === 'resource') {
    const r = m.resources[hit.idx];
    return `<div class="tt-title"><i style="background:${RES_TYPES[r.type]?.color}"></i>${esc(fileName(r.url))}</div>
      <div class="tt-sub">${RES_TYPES[r.type]?.label} · ${fmtBytes(r.bytes)} · ${esc(r.host)}${r.duration != null ? ` · ${fmtMs(r.duration)}` : ''}</div>`;
  }
  const s = m.sites[hit.idx];
  return `<div class="tt-title"><i style="background:${s.thirdParty ? '#ffb340' : '#8fb8ff'}"></i>${esc(s.name)}</div>
    <div class="tt-sub">${s.thirdParty ? '3. parti' : 'Ana site'} · ${s.resources.length} istek · ${fmtBytes(s.bytes)}</div>`;
}

function positionTooltip() {
  const tt = $('#tooltip');
  if (!tt.classList.contains('show')) return;
  const w = tt.offsetWidth, h = tt.offsetHeight;
  let x = pointer.x + 16, y = pointer.y + 16;
  if (x + w > innerWidth - 8) x = pointer.x - w - 12;
  if (y + h > innerHeight - 8) y = pointer.y - h - 12;
  tt.style.left = `${x}px`;
  tt.style.top = `${y}px`;
}

const inspectorHandlers = {
  selectNode: (i, fly) => select({ kind: 'node', idx: i }, fly),
  selectResource: (i, fly) => select({ kind: 'resource', idx: i }, fly),
  selectSite: (i, fly) => i >= 0 && select({ kind: 'site', idx: i }, fly),
  focus: () => focusSelection(),
  highlightSubtree: (i) => highlightSubtree(i),
};

function select(hit, fly = false) {
  const m = app.model;
  if (!m || app.demo) return;
  app.selected = hit;
  const body = $('#inspector-body');
  if (!hit) {
    city.setState({ selected: -1, path: null });
    network.setState({ selected: null });
    network.setChain(null);
    $('#inspector').hidden = true;
    return;
  }
  if (hit.kind === 'node') {
    if (!app.toggles.dom) setToggle('dom', true);
    city.setState({ selected: hit.idx, path: new Set(ancestry(m, hit.idx)) });
    network.setState({ selected: null });
    network.setChain(null);
    renderNode(body, m, hit.idx, inspectorHandlers);
  } else {
    if (!app.toggles.net) setToggle('net', true);
    const domIdx = hit.kind === 'resource' ? m.nodes.findIndex((n) => n.u && n.u === m.resources[hit.idx].url) : -1;
    city.setState({ selected: domIdx, path: null });
    network.setState({ selected: hit });
    network.setChain(hit.kind === 'resource' ? hit.idx : null);
    if (hit.kind === 'resource') renderResource(body, m, hit.idx, inspectorHandlers);
    else renderSite(body, m, hit.idx, inspectorHandlers);
  }
  $('#inspector').hidden = false;
  body.scrollTop = 0;
  if (fly) focusSelection();
}

function focusSelection() {
  const s = app.selected;
  if (!s) return;
  if (s.kind === 'node') {
    const { center, radius } = city.nodeBox(s.idx);
    engine.focus(center, radius);
  } else {
    const { center, radius } = network.focusOf(s);
    engine.focus(center, radius);
  }
}

/* --------------------------------- Arama --------------------------------- */

let searchTimer = null;
function applySearch() {
  const m = app.model;
  const q = $('#search').value.trim();
  if (!m || app.demo) return;
  if (!q) { city.setState({ match: null }); $('#search-count').textContent = ''; return; }
  const fn = compileSelector(q);
  if (!fn) return;
  const match = new Uint8Array(m.nodes.length);
  let count = 0;
  m.nodes.forEach((n, i) => { if (fn(n)) { match[i] = 1; count++; } });
  city.setState({ match });
  $('#search-count').textContent = `${fmtNum(count)} eşleşme`;
  return { match, count };
}

function highlightSubtree(idx) {
  const m = app.model;
  const match = new Uint8Array(m.nodes.length);
  for (let i = idx; i <= idx + m.desc[idx]; i++) match[i] = 1;
  $('#search').value = '';
  $('#search-count').textContent = `alt ağaç: ${fmtNum(m.desc[idx] + 1)}`;
  city.setState({ match });
}

function clearSearch() {
  $('#search').value = '';
  $('#search-count').textContent = '';
  city.setState({ match: null });
}

$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applySearch, 140);
});
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const res = applySearch();
    if (res?.count) {
      // En büyük eşleşmeyi seç
      let best = -1;
      res.match.forEach((v, i) => { if (v && (best < 0 || app.model.desc[i] > app.model.desc[best])) best = i; });
      select({ kind: 'node', idx: best }, true);
    }
  }
  if (e.key === 'Escape') { clearSearch(); e.target.blur(); }
});

/* --------------------------------- Lejant --------------------------------- */

function buildLegend(model) {
  const dom = $('#legend-dom');
  dom.innerHTML = Object.entries(DOM_CATEGORIES)
    .filter(([k]) => model.catCounts[k])
    .map(([k, v]) => `<button class="chip" data-cat="${k}" title="${esc(v.label)}"><i style="background:${v.color};color:${v.color}"></i>${esc(v.label.split(' (')[0])}<small>${fmtNum(model.catCounts[k])}</small></button>`)
    .join('');
  dom.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.cat;
    app.hiddenCats.has(k) ? app.hiddenCats.delete(k) : app.hiddenCats.add(k);
    b.classList.toggle('off', app.hiddenCats.has(k));
    city.setState({ hiddenCats: new Set(app.hiddenCats) });
  }));

  const net = $('#legend-net');
  net.innerHTML = Object.entries(RES_TYPES)
    .filter(([k]) => model.byType[k])
    .map(([k, v]) => `<button class="chip" data-type="${k}" title="${fmtBytes(model.byType[k].bytes)}"><i style="background:${v.color};color:${v.color}"></i>${esc(v.label)}<small>${model.byType[k].count}</small></button>`)
    .join('');
  net.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.type;
    app.hiddenTypes.has(k) ? app.hiddenTypes.delete(k) : app.hiddenTypes.add(k);
    b.classList.toggle('off', app.hiddenTypes.has(k));
    network.setState({ hiddenTypes: new Set(app.hiddenTypes) });
  }));
}

/* ----------------------------- Zaman çizelgesi ----------------------------- */

let tlMax = 1000;
let replay = null;

function buildTimeline(model) {
  tlMax = Math.max(1000, ...model.resources.map((r) => r.start + (r.duration || 0)));
  $('#timeline').value = 1000;
  $('#timeline-label').textContent = 'tümü';
  network.setReplay(null);
  requestAnimationFrame(() => drawWaterfall(model));
}

function drawWaterfall(model) {
  const cv = $('#waterfall');
  const dpr = Math.min(devicePixelRatio, 2);
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const rs = model.resources;
  const rowH = Math.max(0.6, (H - 4) / Math.max(rs.length, 1));
  rs.forEach((r, i) => {
    const x = (r.start / tlMax) * W;
    const w = Math.max(1.5, ((r.duration || 20) / tlMax) * W);
    ctx.fillStyle = RES_TYPES[r.type]?.color || '#888';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, 2 + i * rowH, w, Math.max(rowH - 0.2, 0.8));
  });
  // DCL / load işaretleri
  const p = model.raw.perf || {};
  ctx.globalAlpha = 0.7;
  for (const [v, c] of [[p.domContentLoaded, '#36e2c0'], [p.load, '#ff5fd2']]) {
    if (!v) continue;
    ctx.fillStyle = c;
    ctx.fillRect((v / tlMax) * W, 0, 1, H);
  }
}

function setTimelineValue(v) {
  $('#timeline').value = v;
  if (v >= 1000) {
    network.setReplay(null);
    $('#timeline-label').textContent = 'tümü';
  } else {
    const t = (v / 1000) * tlMax;
    network.setReplay(t);
    $('#timeline-label').textContent = `+${fmtMs(t)}`;
  }
}

$('#timeline').addEventListener('input', (e) => { stopReplay(); setTimelineValue(+e.target.value); });

function toggleReplay() {
  if (replay) { stopReplay(); return; }
  if (!app.toggles.net) setToggle('net', true);
  const duration = Math.min(12, Math.max(5, tlMax / 1000));
  replay = { t: 0, duration };
  $('#replay-btn').innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
}
function stopReplay() {
  replay = null;
  $('#replay-btn').innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5Z"/></svg>';
}
engine.onFrame((dt) => {
  if (!replay) return;
  replay.t += dt / replay.duration;
  if (replay.t >= 1) { stopReplay(); setTimelineValue(1000); return; }
  setTimelineValue(Math.floor(replay.t * 999));
});
$('#replay-btn').addEventListener('click', toggleReplay);
window.addEventListener('resize', () => app.model && !app.demo && drawWaterfall(app.model));

/* ------------------------------ Düzen & ayarlar ------------------------------ */

function setLayout(name) {
  city.setLayout(name);
  $$('[data-layout]').forEach((b) => b.classList.toggle('active', b.dataset.layout === name));
}
$$('[data-layout]').forEach((b) => b.addEventListener('click', () => setLayout(b.dataset.layout)));

function setToggle(key, value) {
  app.toggles[key] = value;
  $(`[data-tgl="${key}"]`)?.classList.toggle('on', value);
  switch (key) {
    case 'dom': city.setVisible(value); break;
    case 'net': network.setVisible(value); break;
    case 'labels': city.setLabelsVisible(value); network.setLabelsVisible(value); break;
    case 'hidden': city.setState({ showHidden: value }); break;
    case 'rotate': engine.controls.autoRotate = value; break;
    case 'bloom': engine.setBloom(value); break;
  }
}
$$('[data-tgl]').forEach((b) => b.addEventListener('click', () => setToggle(b.dataset.tgl, !app.toggles[b.dataset.tgl])));

$('#deepest-btn').addEventListener('click', () => app.model && select({ kind: 'node', idx: app.model.deepest }, true));
$('#scan-btn').addEventListener('click', () => app.bounds && engine.pulseScan(Math.max(app.bounds.city.size, app.bounds.net.radius) * 1.1, 2.4, 1.2));
$('#reset-btn').addEventListener('click', () => resetCamera(true));
$('#inspector-close').addEventListener('click', () => select(null));
$('[data-toggle="report"]').addEventListener('click', () => {
  const c = $('#report').classList.toggle('collapsed');
  document.body.classList.toggle('report-collapsed', c);
  setTimeout(() => app.model && !app.demo && drawWaterfall(app.model), 400);
});
$('#help-btn').addEventListener('click', () => $('#help').showModal());
$('#cancel-btn').addEventListener('click', () => { stopAnalysis(); toast('Analiz iptal edildi.', 'info'); });

$('#url-form').addEventListener('submit', (e) => { e.preventDefault(); startAnalysis($('#url-input').value); });
$$('.examples [data-url]').forEach((b) => b.addEventListener('click', () => startAnalysis(b.dataset.url)));

/* ------------------------------ Dışa / içe aktar ------------------------------ */

$('#export-btn').addEventListener('click', () => {
  if (!app.model || app.demo) return;
  const raw = app.model.raw;
  let host = 'site';
  try { host = new URL(raw.finalUrl).host; } catch { /* yok */ }
  const blob = new Blob([JSON.stringify(raw)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `domxray-${host}-${raw.analyzedAt.slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data?.dom?.nodes || !Array.isArray(data.resources)) throw new Error('Geçersiz biçim');
    onResult(data);
    toast(`${file.name} içe aktarıldı.`, 'info');
  } catch (err) {
    toast(`Dosya okunamadı: ${err.message}`);
  }
});

/* -------------------------------- Kısayollar -------------------------------- */

window.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
  if (e.key === 'Escape') {
    if (document.querySelector('.lightbox')) { document.querySelector('.lightbox').remove(); return; }
    if (typing) return;
    if (app.selected) select(null);
    else clearSearch();
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || app.demo) return;
  const k = e.key.toLowerCase();
  if (k === 'f') focusSelection();
  else if (k === 'r') resetCamera(true);
  else if (k === 'l') setLayout(city.layoutName === 'city' ? 'layers' : 'city');
  else if (k === 's') $('#scan-btn').click();
  else if (k === 'p') toggleReplay();
  else if (k === 'u' && app.selected?.kind === 'node') {
    const p = app.model.nodes[app.selected.idx].p;
    if (p >= 0) select({ kind: 'node', idx: p }, true);
  } else if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  else return;
});

/* ---------------------------------- Toast ---------------------------------- */

let toastTimer = null;
function toast(msg, kind = 'error') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show ${kind === 'info' ? 'info' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 4200);
}

/* ---------------------------------- Başlat ---------------------------------- */

const initial = new URLSearchParams(location.search).get('url');
if (initial) startAnalysis(initial);
else $('#url-input').focus();

// Hata ayıklama için
window.__xray = { app, engine, city, network };
