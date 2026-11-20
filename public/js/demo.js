// Karşılama ekranının arka planı için sentetik (gerçek olmayan) bir site üretir.
export function demoResult() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const nodes = [];

  const add = (t, p, d, r, extra = {}) => {
    nodes.push({ t, p, d, r: r.map(Math.round), ...extra });
    return nodes.length - 1;
  };
  const split = (r, n, vertical, gap = 8) => {
    const [x, y, w, h] = r;
    return Array.from({ length: n }, (_, i) => (vertical
      ? [x + gap, y + (h / n) * i + gap / 2, w - gap * 2, h / n - gap]
      : [x + (w / n) * i + gap / 2, y + gap, w / n - gap, h - gap * 2]));
  };
  const wrapChain = (p, d, r, depth) => {
    for (let k = 0; k < depth; k++) { p = add('div', p, d++, r, { c: `wrapper-${k}` }); }
    return [p, d];
  };
  const card = (p, d, r) => {
    const [c, cd] = wrapChain(p, d, r, 1 + Math.floor(rnd() * 3));
    const parts = split(r, 3, true, 4);
    add('img', c, cd, parts[0]);
    const body = add('div', c, cd, parts[1], { c: 'card-body' });
    add('h3', body, cd + 1, parts[1], { x: 30 });
    add('p', body, cd + 1, parts[1], { x: 120 + rnd() * 300 });
    const f = add('div', c, cd, parts[2]);
    for (const q of split(parts[2], 2, false, 4)) add(pick(['a', 'button', 'span']), f, cd + 1, q, { x: 10 });
  };

  const W = 1440;
  const body = add('body', -1, 0, [0, 0, W, 5200]);
  const header = add('header', body, 1, [0, 0, W, 90]);
  const nav = add('nav', header, 2, [300, 10, 900, 70]);
  const ul = add('ul', nav, 3, [300, 10, 900, 70]);
  for (const r of split([300, 10, 900, 70], 8, false, 6)) add('a', add('li', ul, 4, r), 5, r, { x: 8 });
  const main = add('main', body, 1, [0, 90, W, 4600]);
  for (let s = 0; s < 6; s++) {
    const sr = [40, 90 + s * 760, W - 80, 740];
    const sec = add('section', main, 2, sr);
    const [inner, id] = wrapChain(sec, 3, sr, 1 + Math.floor(rnd() * 4));
    const cols = 2 + Math.floor(rnd() * 3);
    const rows = 1 + Math.floor(rnd() * 3);
    for (const rr of split(sr, rows, true)) for (const cr of split(rr, cols, false)) card(inner, id, cr);
  }
  const footer = add('footer', body, 1, [0, 4690, W, 510]);
  for (const r of split([0, 4690, W, 510], 4, false)) {
    const col = add('div', footer, 2, r);
    for (const q of split(r, 6, true, 4)) add('a', col, 3, q, { x: 12 });
  }

  const sites = [
    ['demo.page', 0, ['document', 'stylesheet', 'script', 'image', 'image', 'image', 'font', 'xhr']],
    ['cdn-static.net', 1, ['script', 'script', 'stylesheet', 'image']],
    ['font-cdn.com', 1, ['font', 'font', 'stylesheet']],
    ['tagmanager.io', 1, ['script', 'script']],
    ['analytics.io', 1, ['script', 'xhr', 'xhr', 'image']],
    ['ads-network.com', 1, ['script', 'script', 'image', 'image', 'xhr', 'iframe']],
    ['img-cdn.org', 1, ['image', 'image', 'image', 'image', 'image']],
    ['video-host.tv', 1, ['media', 'script']],
  ];
  const resources = [];
  let t = 0;
  for (const [site, third, types] of sites) {
    for (const type of types) {
      const n = type === 'image' ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const bytes = Math.round((type === 'script' ? 80e3 : type === 'image' ? 40e3 : type === 'media' ? 400e3 : 12e3) * (0.2 + rnd() * 2));
        resources.push({
          url: `https://${site}/${type}/${resources.length}`, host: site, site, thirdParty: !!third,
          type: type === 'iframe' ? 'document' : type, transfer: bytes, size: bytes * 2.5, start: (t += rnd() * 90), duration: 80 + rnd() * 500,
          initiator: site === 'analytics.io' || site === 'ads-network.com' ? 'https://tagmanager.io/script/0' : null, status: 200,
        });
      }
    }
  }
  const tm = resources.find((r) => r.site === 'tagmanager.io');
  if (tm) tm.url = 'https://tagmanager.io/script/0';

  return {
    url: 'https://demo.page/', finalUrl: 'https://demo.page/', site: 'demo.page', status: 200,
    viewport: { width: 1440, height: 900 },
    dom: { nodes, maxDepth: Math.max(...nodes.map((n) => n.d)), totalElements: nodes.length, docSize: [1440, 5200], title: 'Demo', htmlBytes: 0, inlineScriptBytes: 0, inlineStyleBytes: 0, counts: {}, tech: [] },
    resources, perf: {},
  };
}
