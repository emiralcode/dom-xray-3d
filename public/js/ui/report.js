// Left panel: score, metrics, stats, resource breakdown, tags, technology hints.
import { DOM_CATEGORIES, RES_TYPES, esc, fileName, fmtBytes, fmtMs, fmtNum } from '../util.js';

const fmtMetric = (m) => (m.fmt === 'bytes' ? fmtBytes(m.value) : m.fmt === 'pct' ? `${Math.round(m.value * 100)}%` : fmtNum(m.value));

function scoreRing(score, grade) {
  const R = 36;
  const C = 2 * Math.PI * R;
  const color = score >= 75 ? 'var(--good)' : score >= 45 ? 'var(--warn)' : 'var(--bad)';
  return `
    <div class="ring">
      <svg viewBox="0 0 84 84" width="84" height="84">
        <circle cx="42" cy="42" r="${R}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="7"/>
        <circle cx="42" cy="42" r="${R}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"
          stroke-dasharray="${C}" stroke-dashoffset="${C}" style="transition:stroke-dashoffset 1.4s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 0 6px ${color})" data-offset="${C * (1 - score / 100)}"/>
      </svg>
      <div class="ring-val"><div><b style="color:${color}">${grade}</b><small>${score}/100</small></div></div>
    </div>`;
}

export function renderReport(el, model, handlers) {
  const raw = model.raw;
  const { score } = model;
  const dom = raw.dom;
  let host = '';
  try { host = new URL(raw.finalUrl).host; } catch { /* none */ }

  const types = Object.entries(model.byType).sort((a, b) => b[1].bytes - a[1].bytes);
  const totalB = model.totalBytes || 1;
  const heavy = [...model.resources].sort((a, b) => b.bytes - a.bytes).slice(0, 6);
  const third = model.sites.filter((s) => s.thirdParty).slice(0, 6);
  const maxTag = model.topTags[0]?.[1] || 1;
  const p = raw.perf || {};
  const perfCls = (v, good, bad) => (v == null ? '' : v <= good ? 'lv-good' : v >= bad ? 'lv-bad' : 'lv-warn');

  el.innerHTML = `
    <div class="r-site">
      <div class="monogram">${esc((host.replace(/^www\./, '')[0] || '?').toUpperCase())}</div>
      <div>
        <h2>${esc(dom.title || host)}</h2>
        <div class="mono">${esc(raw.finalUrl)}</div>
        <div class="small muted" style="margin-top:3px">HTTP ${raw.status} · took ${fmtMs(raw.durationMs)} · ${new Date(raw.analyzedAt).toLocaleTimeString('en-US')}</div>
      </div>
    </div>

    <div class="score-card">
      ${scoreRing(score.score, score.grade)}
      <div class="score-text"><h3>Bloat score</h3><p>${esc(score.verdict)}</p></div>
    </div>

    <div class="stats">
      <div class="stat"><b>${fmtNum(dom.totalElements)}</b><span>DOM elements</span></div>
      <div class="stat"><b>${dom.maxDepth}</b><span>Depth</span></div>
      <div class="stat"><b>${fmtNum(model.resources.length)}</b><span>Requests</span></div>
      <div class="stat"><b>${fmtBytes(model.totalBytes)}</b><span>Transfer</span></div>
      <div class="stat"><b>${model.sites.length}</b><span>Domains</span></div>
      <div class="stat"><b>${fmtBytes(dom.htmlBytes)}</b><span>HTML</span></div>
    </div>

    <div class="section">
      <h4>Metrics <span>good ↔ bad</span></h4>
      ${score.items.map((m) => `
        <div class="metric" title="${esc(m.hint)} (Good: ≤ ${esc(fmtMetric({ ...m, value: m.good }))}, bad: ≥ ${esc(fmtMetric({ ...m, value: m.bad }))})">
          <span class="m-label">${esc(m.label)}</span>
          <span class="m-val lv-${m.level}">${fmtMetric(m)}</span>
          <div class="m-bar"><i class="bg-${m.level}" style="width:${Math.max(4, Math.round(m.score * 100))}%"></i></div>
        </div>`).join('')}
    </div>

    <div class="section">
      <h4>Performance <span>first load</span></h4>
      <div class="perf">
        <div><b class="${perfCls(p.ttfb, 800, 1800)}">${fmtMs(p.ttfb)}</b><span>TTFB</span></div>
        <div><b class="${perfCls(p.fcp, 1800, 3000)}">${fmtMs(p.fcp)}</b><span>FCP</span></div>
        <div><b class="${perfCls(p.lcp, 2500, 4000)}">${fmtMs(p.lcp)}</b><span>LCP</span></div>
        <div><b>${fmtMs(p.domContentLoaded)}</b><span>DCL</span></div>
        <div><b>${fmtMs(p.load)}</b><span>Load</span></div>
      </div>
    </div>

    <div class="section">
      <h4>Resource types <span>${fmtBytes(model.totalBytes)}</span></h4>
      <div class="stack">${types.map(([t, v]) => `<i style="width:${(v.bytes / totalB) * 100}%;background:${RES_TYPES[t]?.color}" title="${RES_TYPES[t]?.label}: ${fmtBytes(v.bytes)}"></i>`).join('')}</div>
      <div class="rows">
        ${types.map(([t, v]) => `
          <div class="row"><i style="background:${RES_TYPES[t]?.color}"></i><span class="r-name">${RES_TYPES[t]?.label || t}</span><span class="r-num">${v.count}</span><span class="r-num strong">${fmtBytes(v.bytes)}</span></div>`).join('')}
      </div>
    </div>

    <div class="section">
      <h4>Heaviest resources</h4>
      <div class="rows">
        ${heavy.map((r) => `
          <div class="row click" data-res="${r.idx}" title="${esc(r.url)}"><i style="background:${RES_TYPES[r.type]?.color}"></i><span class="r-name">${esc(fileName(r.url))}</span><span class="r-num">${esc(r.host.replace(/^www\./, '').slice(0, 18))}</span><span class="r-num strong">${fmtBytes(r.bytes)}</span></div>`).join('')}
      </div>
    </div>

    ${third.length ? `
    <div class="section">
      <h4>Third-party domains <span>${Math.round((model.thirdPartyBytes / totalB) * 100)}% of bytes</span></h4>
      <div class="rows">
        ${third.map((s) => `
          <div class="row click" data-site="${model.sites.indexOf(s)}"><i style="background:var(--warn)"></i><span class="r-name">${esc(s.name)}</span><span class="r-num">${s.resources.length} req</span><span class="r-num strong">${fmtBytes(s.bytes)}</span></div>`).join('')}
      </div>
    </div>` : ''}

    <div class="section">
      <h4>Most common tags <span>click → highlight</span></h4>
      <div class="bars">
        ${model.topTags.map(([tag, c]) => {
          const cat = model.nodes.find((n) => n.t === tag)?.cat || 'layout';
          return `<div class="bar-row" data-tag="${esc(tag)}"><span class="bar-name">&lt;${esc(tag)}&gt;</span><div class="bar-track"><i style="width:${(c / maxTag) * 100}%;background:${DOM_CATEGORIES[cat].color}"></i></div><span class="bar-num">${fmtNum(c)}</span></div>`;
        }).join('')}
      </div>
    </div>

    ${dom.tech?.length ? `<div class="section"><h4>Technology hints</h4><div class="tech">${dom.tech.map((t) => `<span>${esc(t)}</span>`).join('')}</div></div>` : ''}

    ${raw.screenshot ? `<div class="section"><h4>Page preview <span>${raw.viewport.width}×${raw.viewport.height}</span></h4><img class="shot" src="${raw.screenshot}" alt="Screenshot of the analyzed page" /></div>` : ''}

    ${dom.truncated ? `<div class="note">Very large DOM: the first ${fmtNum(model.nodes.length)} elements are visualized (of ${fmtNum(dom.totalElements)} total).</div>` : ''}
    ${raw.blockedRequests ? `<div class="note">${raw.blockedRequests} requests were blocked by the security policy (private network addresses).</div>` : ''}
    <div class="small muted" style="margin:16px 0 4px">In the document: ${fmtBytes(dom.inlineScriptBytes)} inline JS, ${fmtBytes(dom.inlineStyleBytes)} inline CSS, ${dom.counts.iframes} iframes, ${dom.counts.forms} forms${dom.counts.shadowHosts ? `, ${dom.counts.shadowHosts} shadow DOM elements` : ''}.</div>
  `;

  requestAnimationFrame(() => {
    const c = el.querySelector('.ring circle[data-offset]');
    if (c) c.style.strokeDashoffset = c.dataset.offset;
  });

  el.querySelectorAll('[data-res]').forEach((n) => n.addEventListener('click', () => handlers.selectResource(+n.dataset.res)));
  el.querySelectorAll('[data-site]').forEach((n) => n.addEventListener('click', () => handlers.selectSite(+n.dataset.site)));
  el.querySelectorAll('[data-tag]').forEach((n) => n.addEventListener('click', () => handlers.search(n.dataset.tag)));
  el.querySelector('.shot')?.addEventListener('click', () => {
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `<img src="${raw.screenshot}" alt="Page preview" />`;
    box.addEventListener('click', () => box.remove());
    document.body.appendChild(box);
  });
}
