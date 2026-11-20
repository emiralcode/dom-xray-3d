// Right panel: details of the selected DOM node, network resource or domain.
import { DOM_CATEGORIES, RES_TYPES, esc, fileName, fmtBytes, fmtMs, fmtNum } from '../util.js';
import { ancestry, nodeLabel } from '../model.js';

const kv = (rows) => `<div class="kv">${rows.filter(Boolean).map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('')}</div>`;
const badge = (text, color) => `<span class="badge" style="background:${color}22;color:${color};box-shadow:inset 0 0 0 1px ${color}55">${esc(text)}</span>`;
const partyPill = (third) => (third ? '<span class="pill third">3rd party</span>' : '<span class="pill first">1st party</span>');

export function cssPath(model, idx) {
  return ancestry(model, idx).map((i) => {
    const n = model.nodes[i];
    if (n.i && /^[A-Za-z][\w-]*$/.test(n.i)) return `${n.t}#${n.i}`;
    const parent = n.p >= 0 ? model.children[n.p] : [];
    const same = parent.filter((c) => model.nodes[c].t === n.t);
    return same.length > 1 ? `${n.t}:nth-of-type(${same.indexOf(i) + 1})` : n.t;
  }).join(' > ');
}

export function renderNode(el, model, idx, h) {
  const n = model.nodes[idx];
  const cat = DOM_CATEGORIES[n.cat];
  const path = ancestry(model, idx);
  const crumbs = path.length > 7 ? [path[0], -1, ...path.slice(-6)] : path;
  const kids = [...model.children[idx]].sort((a, b) => model.desc[b] - model.desc[a]);
  const maxKid = Math.max(1, ...kids.map((k) => model.desc[k] + 1));
  const share = ((model.desc[idx] + 1) / model.nodes.length) * 100;
  const [x, y, w, hh] = n.r;

  el.innerHTML = `
    <div class="ins-head">
      ${badge(n.t, cat.color)}
      <div><h3>${esc(nodeLabel(n, true))}</h3><p>${cat.label}${n.s ? ' · shadow DOM' : ''}${n.h ? ' · <span class="lv-warn">hidden</span>' : ''}</p></div>
    </div>
    <div class="crumbs">${crumbs.map((i, k) => (i === -1 ? '<span class="sep">… ›</span>' : `<button data-node="${i}" class="${i === idx ? 'cur' : ''}">${esc(nodeLabel(model.nodes[i]))}</button>${k < crumbs.length - 1 ? '<span class="sep">›</span>' : ''}`)).join('')}</div>
    ${kv([
      ['Depth', `${n.d}`],
      ['Descendants', `${fmtNum(model.desc[idx])} <span class="muted">(${share < 0.1 ? share.toFixed(2) : share.toFixed(1)}% of page)</span>`],
      ['Direct children', fmtNum(kids.length)],
      ['Subtree depth', `${model.height[idx]} levels`],
      ['Size', `${w} × ${hh} px`],
      ['Position', `x ${x}, y ${y}`],
      n.x ? ['Text', `${fmtNum(n.x)} characters`] : null,
      n.a ? ['Attributes', `${n.a}`] : null,
      n.nw ? ['Natural size', `${n.nw[0]} × ${n.nw[1]} px`] : null,
      n.u ? ['Source', `<a href="${esc(n.u)}" target="_blank" rel="noopener noreferrer">${esc(n.u.slice(0, 120))}</a>`] : null,
    ])}
    <div class="btn-row">
      <button class="ghost-btn" data-act="focus">Focus <kbd>F</kbd></button>
      ${n.p >= 0 ? '<button class="ghost-btn" data-act="up">Parent <kbd>U</kbd></button>' : ''}
      ${kids.length ? '<button class="ghost-btn" data-act="subtree">Highlight subtree</button>' : ''}
      <button class="ghost-btn" data-act="copy">Copy CSS path</button>
      ${n.u && model.urlIndex.has(n.u) ? '<button class="ghost-btn" data-act="res">Go to network request</button>' : ''}
    </div>
    ${kids.length ? `
      <div class="section"><h4>Children <span>${kids.length}</span></h4>
        <div class="bars">${kids.slice(0, 14).map((k) => {
          const c = model.nodes[k];
          return `<div class="bar-row" data-node="${k}" style="grid-template-columns:120px 1fr 44px"><span class="bar-name">${esc(nodeLabel(c))}</span><div class="bar-track"><i style="width:${((model.desc[k] + 1) / maxKid) * 100}%;background:${DOM_CATEGORIES[c.cat].color}"></i></div><span class="bar-num">${fmtNum(model.desc[k] + 1)}</span></div>`;
        }).join('')}${kids.length > 14 ? `<div class="small muted" style="padding:4px 0">+${kids.length - 14} more</div>` : ''}</div>
      </div>` : ''}
  `;
  el.querySelectorAll('[data-node]').forEach((b) => b.addEventListener('click', () => h.selectNode(+b.dataset.node, true)));
  el.querySelector('[data-act="focus"]')?.addEventListener('click', h.focus);
  el.querySelector('[data-act="up"]')?.addEventListener('click', () => h.selectNode(n.p, true));
  el.querySelector('[data-act="subtree"]')?.addEventListener('click', () => h.highlightSubtree(idx));
  el.querySelector('[data-act="res"]')?.addEventListener('click', () => h.selectResource(model.urlIndex.get(n.u).idx));
  el.querySelector('[data-act="copy"]')?.addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(cssPath(model, idx));
      e.target.textContent = 'Copied ✓';
    } catch {
      e.target.textContent = 'Copy failed';
    }
  });
}

export function renderResource(el, model, idx, h) {
  const r = model.resources[idx];
  const t = RES_TYPES[r.type] || RES_TYPES.other;
  const chain = [];
  for (let i = r.parent, guard = 0; i >= 0 && guard < 30; i = model.resources[i].parent, guard++) chain.push(i);
  const loaded = model.resources.filter((x) => x.parent === idx).sort((a, b) => b.bytes - a.bytes);
  const domNode = model.nodes.findIndex((n) => n.u === r.url);

  el.innerHTML = `
    <div class="ins-head">
      ${badge(t.label, t.color)}
      <div><h3>${esc(fileName(r.url))}</h3><p>${esc(r.host)} ${partyPill(r.thirdParty)} ${r.failed ? `<span class="pill fail">${esc(r.failed)}</span>` : ''}</p></div>
    </div>
    <div class="url-box">${esc(r.url)}</div>
    ${kv([
      ['Transfer', `<b>${fmtBytes(r.transfer)}</b>`],
      ['Decoded size', fmtBytes(r.size)],
      r.size && r.transfer && r.size > r.transfer * 1.15 ? ['Compression', `${Math.round((1 - r.transfer / r.size) * 100)}% saved`] : null,
      ['Status', r.status ? `${r.status}` : r.failed ? '<span class="lv-bad">failed</span>' : '—'],
      ['MIME', esc(r.mime || '—')],
      ['Protocol', esc(r.protocol || '—')],
      ['Start', `+${fmtMs(r.start)}`],
      ['Duration', fmtMs(r.duration)],
      ['Method', esc(r.method || 'GET')],
      r.cached ? ['Cache', 'yes'] : null,
      r.redirects ? ['Redirects', `${r.redirects}`] : null,
      ['Site', esc(r.site)],
    ])}
    <div class="btn-row">
      <button class="ghost-btn" data-act="focus">Focus <kbd>F</kbd></button>
      <button class="ghost-btn" data-act="site">Inspect domain</button>
      ${domNode >= 0 ? '<button class="ghost-btn" data-act="dom">Go to DOM element</button>' : ''}
      <a class="ghost-btn" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">Open in new tab ↗</a>
    </div>
    <div class="section"><h4>Loaded by <span>initiator</span></h4>
      <div class="rows">
        ${chain.length ? chain.map((i) => resRow(model.resources[i])).join('') : '<div class="small muted">Loaded directly by the HTML document.</div>'}
        <div class="row"><i style="background:#9fc2ff"></i><span class="r-name">◉ ${esc(model.raw.site)} (document)</span><span></span><span></span></div>
      </div>
    </div>
    ${loaded.length ? `<div class="section"><h4>Resources it loaded <span>${loaded.length}</span></h4><div class="rows">${loaded.slice(0, 12).map(resRow).join('')}</div></div>` : ''}
  `;
  el.querySelectorAll('[data-res]').forEach((b) => b.addEventListener('click', () => h.selectResource(+b.dataset.res, true)));
  el.querySelector('[data-act="focus"]').addEventListener('click', h.focus);
  el.querySelector('[data-act="site"]').addEventListener('click', () => h.selectSite(model.sites.findIndex((s) => s.name === r.site), true));
  el.querySelector('[data-act="dom"]')?.addEventListener('click', () => h.selectNode(domNode, true));
}

function resRow(r) {
  return `<div class="row click" data-res="${r.idx}" title="${esc(r.url)}"><i style="background:${RES_TYPES[r.type]?.color}"></i><span class="r-name">${esc(fileName(r.url))}</span><span class="r-num">${esc(r.host.replace(/^www\./, '').slice(0, 16))}</span><span class="r-num strong">${fmtBytes(r.bytes)}</span></div>`;
}

export function renderSite(el, model, idx, h) {
  const s = model.sites[idx];
  const types = Object.entries(s.byType).sort((a, b) => b[1] - a[1]);
  const total = s.bytes || 1;
  const top = [...s.resources].sort((a, b) => b.bytes - a.bytes);
  const isCore = s.name === model.raw.site;
  el.innerHTML = `
    <div class="ins-head">
      ${badge(isCore ? 'core' : 'domain', isCore ? '#8fb8ff' : '#ffb340')}
      <div><h3>${esc(s.name)}</h3><p>${partyPill(s.thirdParty)} · ${s.hosts.size} ${s.hosts.size === 1 ? 'host' : 'hosts'}</p></div>
    </div>
    ${kv([
      ['Requests', fmtNum(s.resources.length)],
      ['Total transfer', `<b>${fmtBytes(s.bytes)}</b>`],
      ['Share of page', `${((s.bytes / (model.totalBytes || 1)) * 100).toFixed(1)}%`],
      ['Hosts', [...s.hosts].slice(0, 6).map(esc).join('<br>') + (s.hosts.size > 6 ? `<br>+${s.hosts.size - 6}` : '')],
    ])}
    <div class="section"><h4>Type breakdown</h4>
      <div class="stack">${types.map(([t, b]) => `<i style="width:${(b / total) * 100}%;background:${RES_TYPES[t]?.color}"></i>`).join('')}</div>
      <div class="rows">${types.map(([t, b]) => `<div class="row"><i style="background:${RES_TYPES[t]?.color}"></i><span class="r-name">${RES_TYPES[t]?.label}</span><span class="r-num">${s.resources.filter((r) => r.type === t).length}</span><span class="r-num strong">${fmtBytes(b)}</span></div>`).join('')}</div>
    </div>
    <div class="btn-row"><button class="ghost-btn" data-act="focus">Focus <kbd>F</kbd></button></div>
    <div class="section"><h4>Resources <span>${s.resources.length}</span></h4><div class="rows">${top.slice(0, 20).map(resRow).join('')}${top.length > 20 ? `<div class="small muted" style="padding:4px 6px">+${top.length - 20} more</div>` : ''}</div></div>
  `;
  el.querySelectorAll('[data-res]').forEach((b) => b.addEventListener('click', () => h.selectResource(+b.dataset.res, true)));
  el.querySelector('[data-act="focus"]').addEventListener('click', h.focus);
}
