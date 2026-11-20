// Turns the raw analysis result from the server into a model ready for visualization.
import { clamp, tagCategory } from './util.js';

export function buildModel(result) {
  const nodes = result.dom.nodes;
  const n = nodes.length;
  const children = Array.from({ length: n }, () => []);
  const desc = new Uint32Array(n); // number of elements in the subtree (excluding itself)
  const height = new Uint16Array(n); // depth of the subtree

  for (let i = 0; i < n; i++) {
    const node = nodes[i];
    node.cat = tagCategory(node.t);
    if (node.p >= 0) children[node.p].push(i);
  }
  // In DFS order a parent always precedes its children → we can accumulate in reverse.
  for (let i = n - 1; i > 0; i--) {
    const p = nodes[i].p;
    if (p >= 0) {
      desc[p] += desc[i] + 1;
      if (height[i] + 1 > height[p]) height[p] = height[i] + 1;
    }
  }

  // Tag distribution
  const tagCounts = new Map();
  const catCounts = {};
  for (const node of nodes) {
    tagCounts.set(node.t, (tagCounts.get(node.t) || 0) + 1);
    catCounts[node.cat] = (catCounts[node.cat] || 0) + 1;
  }
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  // Deepest path
  let deepest = 0;
  for (let i = 0; i < n; i++) if (nodes[i].d > nodes[deepest].d) deepest = i;

  // Network resources
  const resources = result.resources.map((r, i) => ({ ...r, idx: i, bytes: r.transfer || r.size || 0 }));
  const byType = {};
  const sites = new Map();
  let totalBytes = 0;
  let thirdPartyCount = 0;
  let thirdPartyBytes = 0;
  for (const r of resources) {
    const t = (byType[r.type] ||= { count: 0, bytes: 0 });
    t.count++;
    t.bytes += r.bytes;
    totalBytes += r.bytes;
    if (r.thirdParty) { thirdPartyCount++; thirdPartyBytes += r.bytes; }
    let s = sites.get(r.site);
    if (!s) {
      s = { name: r.site, thirdParty: r.thirdParty, resources: [], bytes: 0, hosts: new Set(), byType: {} };
      sites.set(r.site, s);
    }
    s.resources.push(r);
    s.bytes += r.bytes;
    s.hosts.add(r.host);
    s.byType[r.type] = (s.byType[r.type] || 0) + r.bytes;
  }
  const urlIndex = new Map(resources.map((r) => [r.url, r]));
  for (const r of resources) {
    const parent = r.initiator ? urlIndex.get(r.initiator) : null;
    r.parent = parent && parent !== r ? parent.idx : -1;
  }

  const model = {
    raw: result,
    nodes,
    children,
    desc,
    height,
    tagCounts,
    topTags,
    catCounts,
    deepest,
    resources,
    byType,
    sites: [...sites.values()].sort((a, b) => b.bytes - a.bytes),
    totalBytes,
    thirdPartyCount,
    thirdPartyBytes,
    urlIndex,
  };
  model.score = computeScore(model);
  return model;
}

/* --------------------------------- Score --------------------------------- */

const METRICS = [
  { key: 'dom', label: 'DOM element count', good: 800, bad: 3000, weight: 18, fmt: 'num',
    hint: 'Lighthouse considers under 800 good and over 1,400 excessive.' },
  { key: 'depth', label: 'Max nesting depth', good: 14, bad: 32, weight: 10, fmt: 'num',
    hint: 'Deep nesting slows down style calculation and layout.' },
  { key: 'bytes', label: 'Total transfer', good: 1.0e6, bad: 6e6, weight: 20, fmt: 'bytes',
    hint: 'Total data the page downloads over the network.' },
  { key: 'js', label: 'JavaScript', good: 300e3, bad: 1.6e6, weight: 22, fmt: 'bytes',
    hint: 'Script payload that has to be downloaded, parsed and executed.' },
  { key: 'requests', label: 'Request count', good: 50, bad: 200, weight: 14, fmt: 'num',
    hint: 'Every request adds connection and prioritization overhead.' },
  { key: 'third', label: 'Third-party request share', good: 0.2, bad: 0.7, weight: 10, fmt: 'pct',
    hint: 'Requests to ad, analytics and other external domains.' },
  { key: 'divs', label: '"Div soup" ratio', good: 0.35, bad: 0.7, weight: 6, fmt: 'pct',
    hint: 'Share of divs used instead of semantic elements.' },
];

function computeScore(m) {
  const values = {
    dom: m.raw.dom.totalElements,
    depth: m.raw.dom.maxDepth,
    bytes: m.totalBytes,
    js: m.byType.script?.bytes || 0,
    requests: m.resources.length,
    third: m.resources.length ? m.thirdPartyCount / m.resources.length : 0,
    divs: m.nodes.length ? (m.tagCounts.get('div') || 0) / m.nodes.length : 0,
  };
  let total = 0;
  let weights = 0;
  const items = METRICS.map((def) => {
    const v = values[def.key];
    const s = clamp(1 - (v - def.good) / (def.bad - def.good), 0, 1);
    total += s * def.weight;
    weights += def.weight;
    return { ...def, value: v, score: s, level: s > 0.75 ? 'good' : s > 0.35 ? 'warn' : 'bad' };
  });
  const score = Math.round((total / weights) * 100);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 45 ? 'D' : score >= 30 ? 'E' : 'F';
  const verdict =
    score >= 85 ? 'Spotless — a lean, well-organized structure.'
    : score >= 65 ? 'Not bad — a few bloated areas.'
    : score >= 45 ? 'Bloated — serious optimization opportunities.'
    : 'Obese — very heavy DOM and network load.';
  return { score, grade, verdict, items };
}

/* ----------------------------- Selector matching ----------------------------- */

/** Compiles simple selectors such as "div", ".card", "#app", "a.btn.primary", "img, video". */
export function compileSelector(input) {
  const groups = String(input).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const tag = s.match(/^[a-z][a-z0-9-]*/i)?.[0]?.toLowerCase() || null;
    const id = s.match(/#([\w-]+)/)?.[1] || null;
    const classes = [...s.matchAll(/\.([\w-]+)/g)].map((x) => x[1]);
    const text = s.startsWith('"') || s.startsWith("'") ? s.replace(/^["']|["']$/g, '').toLowerCase() : null;
    return { tag, id, classes, text };
  });
  if (!groups.length) return null;
  return (node) => groups.some((g) => {
    if (g.text) return (node.c || '').toLowerCase().includes(g.text) || (node.i || '').toLowerCase().includes(g.text);
    if (g.tag && node.t !== g.tag) return false;
    if (g.id && node.i !== g.id) return false;
    if (g.classes.length) {
      const cls = ` ${node.c || ''} `;
      if (!g.classes.every((c) => cls.includes(` ${c} `))) return false;
    }
    return !!(g.tag || g.id || g.classes.length);
  });
}

export function nodeLabel(node, long = false) {
  let s = node.t;
  if (node.i) s += `#${node.i}`;
  if (node.c) {
    const cls = node.c.split(' ').filter(Boolean);
    s += cls.slice(0, long ? 4 : 2).map((c) => `.${c}`).join('');
    if (cls.length > (long ? 4 : 2)) s += '…';
  }
  return s;
}

export function ancestry(model, idx) {
  const path = [];
  for (let i = idx; i >= 0; i = model.nodes[i].p) path.unshift(i);
  return path;
}
