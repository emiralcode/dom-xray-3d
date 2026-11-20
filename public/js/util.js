// Biçimlendirme, renk paleti ve küçük yardımcılar.

export const DOM_CATEGORIES = {
  layout: { label: 'Yerleşim (div, section…)', color: '#4c8dff' },
  text: { label: 'Metin (p, span, a, h1…)', color: '#36e2c0' },
  media: { label: 'Medya (img, svg, video)', color: '#ff5fd2' },
  interactive: { label: 'Etkileşim (button, input)', color: '#ffb340' },
  script: { label: 'Script / stil / meta', color: '#ff4d5e' },
  embed: { label: 'Gömülü (iframe, embed)', color: '#ffe14d' },
  custom: { label: 'Web bileşeni (custom-el)', color: '#a78bff' },
};

export const RES_TYPES = {
  document: { label: 'Doküman', color: '#e9f1ff' },
  script: { label: 'Script', color: '#ff4d5e' },
  stylesheet: { label: 'CSS', color: '#4c8dff' },
  image: { label: 'Görsel', color: '#ff5fd2' },
  font: { label: 'Font', color: '#a78bff' },
  xhr: { label: 'API / XHR', color: '#36e2c0' },
  media: { label: 'Medya', color: '#ffb340' },
  websocket: { label: 'WebSocket', color: '#7cff6b' },
  other: { label: 'Diğer', color: '#8a94a6' },
};

const LAYOUT = new Set('div section article main header footer nav aside ul ol li dl dt dd table thead tbody tfoot tr td th caption colgroup col figure figcaption details summary fieldset legend address hgroup search menu center body html dialog'.split(' '));
const TEXT = new Set('p span a h1 h2 h3 h4 h5 h6 strong em b i u s small mark code pre blockquote q cite abbr time br hr sup sub label kbd samp var del ins wbr bdi bdo ruby rt rp data font dfn'.split(' '));
const MEDIA = new Set('img picture svg video audio canvas source track map area g path circle rect line polyline polygon ellipse use defs symbol lineargradient radialgradient stop clippath mask text tspan image pattern filter title desc foreignobject femorph feoffset feflood fecomposite fegaussianblur feblend fecolormatrix femerge femergenode'.split(' '));
const INTERACTIVE = new Set('button input select option optgroup textarea form output progress meter datalist'.split(' '));
const SCRIPT = new Set('script style noscript template link meta base slot'.split(' '));
const EMBED = new Set('iframe embed object frame frameset portal'.split(' '));

export function tagCategory(tag) {
  if (LAYOUT.has(tag)) return 'layout';
  if (TEXT.has(tag)) return 'text';
  if (MEDIA.has(tag)) return 'media';
  if (INTERACTIVE.has(tag)) return 'interactive';
  if (SCRIPT.has(tag)) return 'script';
  if (EMBED.has(tag)) return 'embed';
  if (tag.includes('-')) return 'custom';
  return 'layout';
}

export function fmtBytes(b) {
  if (b == null || Number.isNaN(b)) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export const fmtNum = (n) => (n == null ? '—' : n.toLocaleString('tr-TR'));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function shortUrl(u, max = 64) {
  try {
    const url = new URL(u);
    let s = url.host + url.pathname + url.search;
    if (s.length > max) s = `${s.slice(0, max * 0.45)}…${s.slice(-max * 0.5)}`;
    return s;
  } catch {
    return u.length > max ? `${u.slice(0, max)}…` : u;
  }
}

export function fileName(u) {
  try {
    const p = new URL(u).pathname.split('/').filter(Boolean).pop();
    return p ? decodeURIComponent(p).slice(0, 48) : new URL(u).host;
  } catch {
    return u.slice(0, 48);
  }
}
