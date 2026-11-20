// Extracts a page's DOM structure and network traffic with headless Chromium (Playwright + CDP).
import { chromium } from 'playwright';
import { ALLOW_PRIVATE, isHostAllowed } from './security.js';

const MAX_NODES = Number(process.env.MAX_NODES || 12000);
const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT || 30000);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 2);
const VIEWPORT = { width: 1440, height: 900 };
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* ----------------------------- Browser pool ----------------------------- */

let browserPromise = null;

async function launchBrowser() {
  const args = ['--disable-dev-shm-usage', '--no-default-browser-check', '--mute-audio'];
  const attempts = [{}, { channel: 'chrome' }, { channel: 'msedge' }];
  let lastErr;
  for (const opt of attempts) {
    try {
      return await chromium.launch({ headless: true, args, ...opt });
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Could not launch Chromium. Run "npm run setup".\n${lastErr?.message || ''}`);
}

export function getBrowser() {
  if (!browserPromise) {
    browserPromise = launchBrowser().then((b) => {
      b.on('disconnected', () => (browserPromise = null));
      return b;
    });
    browserPromise.catch(() => (browserPromise = null));
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  try {
    (await browserPromise).close();
  } catch { /* ignore */ }
}

// Simple semaphore: at most MAX_CONCURRENT analyses at once.
let running = 0;
const waiters = [];
async function acquire(onQueued) {
  if (running < MAX_CONCURRENT) { running++; return; }
  onQueued?.(waiters.length + 1);
  await new Promise((r) => waiters.push(r));
  running++;
}
function release() {
  running--;
  waiters.shift()?.();
}

/* -------------------------------- Helpers -------------------------------- */

const TYPE_MAP = {
  Document: 'document', Script: 'script', Stylesheet: 'stylesheet', Image: 'image',
  Font: 'font', Media: 'media', XHR: 'xhr', Fetch: 'xhr', EventSource: 'xhr',
  WebSocket: 'websocket', Manifest: 'other', Ping: 'other', Prefetch: 'other', Other: 'other',
};

const SLD = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'ac', 'gen', 'web', 'bel', 'k12', 'av', 'biz', 'info', 'tv', 'pol', 'tsk', 'ne', 'or', 'go']);
export function siteOf(hostname) {
  const parts = hostname.split('.');
  if (parts.length <= 2 || /^\d+$/.test(parts.at(-1))) return hostname;
  const tld = parts.at(-1);
  const sld = parts.at(-2);
  if (tld.length === 2 && SLD.has(sld)) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

function initiatorUrl(init) {
  if (!init) return null;
  if (init.url) return init.url;
  let stack = init.stack;
  while (stack) {
    const frame = stack.callFrames?.find((f) => f.url);
    if (frame) return frame.url;
    stack = stack.parent;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, sleep(ms)]);

/* ---------------------------- In-page DOM extractor ---------------------------- */
// This function runs inside the browser (page.evaluate).
function extractDom(maxNodes) {
  const nodes = [];
  const sx = window.scrollX;
  const sy = window.scrollY;
  let truncated = false;
  let maxDepth = 0;
  const SRC_TAGS = new Set(['img', 'script', 'iframe', 'video', 'audio', 'source', 'link', 'embed', 'object']);

  function visit(el, parent, depth, shadow) {
    if (nodes.length >= maxNodes) { truncated = true; return; }
    const tag = el.tagName.toLowerCase();
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const hidden = cs.display === 'none' || cs.visibility === 'hidden' || (r.width === 0 && r.height === 0);
    let text = 0;
    for (const c of el.childNodes) if (c.nodeType === 3) text += c.textContent.trim().length;
    if (tag === 'script' || tag === 'style') text = el.textContent.length;

    const n = {
      t: tag,
      p: parent,
      d: depth,
      r: [Math.round(r.left + sx), Math.round(r.top + sy), Math.round(r.width), Math.round(r.height)],
    };
    if (el.id) n.i = String(el.id).slice(0, 60);
    const cls = typeof el.className === 'string' ? el.className.trim() : el.getAttribute('class') || '';
    if (cls) n.c = cls.replace(/\s+/g, ' ').slice(0, 120);
    if (hidden) n.h = 1;
    if (text) n.x = text;
    if (shadow) n.s = 1;
    if (SRC_TAGS.has(tag)) {
      const src = el.currentSrc || el.src || el.href || el.getAttribute('data-src') || '';
      if (src) n.u = String(src).slice(0, 300);
    }
    if (tag === 'img' && el.naturalWidth) n.nw = [el.naturalWidth, el.naturalHeight];
    if (el.attributes.length) n.a = el.attributes.length;

    const idx = nodes.length;
    nodes.push(n);
    if (depth > maxDepth) maxDepth = depth;

    if (el.shadowRoot) for (const c of el.shadowRoot.children) visit(c, idx, depth + 1, true);
    for (const c of el.children) visit(c, idx, depth + 1, shadow);
  }

  visit(document.body || document.documentElement, -1, 0, false);

  const head = document.head;
  const count = (sel) => document.querySelectorAll(sel).length;
  let inlineScriptBytes = 0;
  let inlineStyleBytes = 0;
  document.querySelectorAll('script:not([src])').forEach((s) => (inlineScriptBytes += s.textContent.length));
  document.querySelectorAll('style').forEach((s) => (inlineStyleBytes += s.textContent.length));

  const tech = [];
  const w = window;
  if (w.React || document.querySelector('[data-reactroot], #__next, #root')) tech.push('React');
  if (w.__NEXT_DATA__ || document.getElementById('__NEXT_DATA__')) tech.push('Next.js');
  if (w.__NUXT__) tech.push('Nuxt');
  if (w.__VUE__ || document.querySelector('[data-v-app]') || w.Vue) tech.push('Vue');
  if (document.querySelector('[ng-version]')) tech.push('Angular');
  if (document.querySelector('[class*="svelte-"]')) tech.push('Svelte');
  if (w.jQuery) tech.push('jQuery');
  if (document.querySelector('meta[name="generator"][content*="WordPress" i]') || document.querySelector('link[href*="wp-content"]')) tech.push('WordPress');
  if (w.Shopify) tech.push('Shopify');
  if (w.gtag || w.dataLayer) tech.push('Google Tag');
  if (document.querySelector('[class*="tw-"], [class~="flex"][class*="px-"]')) tech.push('Tailwind (likely)');

  return {
    nodes,
    truncated,
    maxDepth,
    totalElements: document.getElementsByTagName('*').length,
    docSize: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    title: document.title.slice(0, 200),
    lang: document.documentElement.lang || null,
    htmlBytes: document.documentElement.outerHTML.length,
    inlineScriptBytes,
    inlineStyleBytes,
    head: head
      ? { meta: head.querySelectorAll('meta').length, link: head.querySelectorAll('link').length, script: head.querySelectorAll('script').length, style: head.querySelectorAll('style').length }
      : null,
    counts: { iframes: count('iframe'), images: count('img'), forms: count('form'), shadowHosts: nodes.filter((n) => n.s).length },
    tech,
  };
}

async function collectPerf() {
  const nav = performance.getEntriesByType('navigation')[0];
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  const lcp = await new Promise((resolve) => {
    let last = null;
    try {
      const po = new PerformanceObserver((list) => { const e = list.getEntries(); if (e.length) last = e.at(-1).startTime; });
      po.observe({ type: 'largest-contentful-paint', buffered: true });
      setTimeout(() => { po.disconnect(); resolve(last); }, 120);
    } catch { resolve(null); }
  });
  return {
    ttfb: nav ? Math.round(nav.responseStart) : null,
    domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    load: nav ? Math.round(nav.loadEventEnd) : null,
    fcp: fcp ? Math.round(fcp.startTime) : null,
    lcp: lcp ? Math.round(lcp) : null,
  };
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.9;
    const limit = Math.min(document.documentElement.scrollHeight, 20000);
    const start = performance.now();
    for (let y = 0; y < limit && performance.now() - start < 5000; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
}

/* -------------------------------- Analysis -------------------------------- */

/**
 * @param {string} url  validated target URL
 * @param {(step: string, msg: string) => void} progress
 * @param {AbortSignal} signal
 */
export async function analyze(url, progress = () => {}, signal) {
  await acquire((pos) => progress('queue', `Waiting in queue (#${pos})`));
  let context;
  try {
    if (signal?.aborted) throw new Error('Cancelled');
    progress('launch', 'Preparing headless browser');
    const browser = await getBrowser();
    context = await browser.newContext({
      viewport: VIEWPORT,
      userAgent: USER_AGENT,
      serviceWorkers: 'block',
      locale: 'en-US',
      bypassCSP: false,
    });
    signal?.addEventListener('abort', () => context?.close().catch(() => {}), { once: true });

    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT);

    // Request-level SSRF protection (including redirects and subresources).
    let blocked = 0;
    if (!ALLOW_PRIVATE) {
      await page.route('**/*', async (route) => {
        const u = route.request().url();
        if (u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
        try {
          const { hostname, protocol } = new URL(u);
          if ((protocol === 'http:' || protocol === 'https:') && (await isHostAllowed(hostname))) return route.continue();
        } catch { /* invalid */ }
        blocked++;
        return route.abort('blockedbyclient');
      });
    }

    // Detailed network logging via CDP.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    const reqs = new Map();
    const t0 = { mono: null };

    cdp.on('Network.requestWillBeSent', (e) => {
      if (e.request.url.startsWith('data:')) return;
      if (t0.mono === null) t0.mono = e.timestamp;
      const prev = reqs.get(e.requestId);
      reqs.set(e.requestId, {
        id: e.requestId,
        url: e.request.url,
        method: e.request.method,
        type: TYPE_MAP[e.type] || 'other',
        initiator: initiatorUrl(e.initiator),
        initiatorType: e.initiator?.type,
        start: e.timestamp,
        redirects: prev ? (prev.redirects || 0) + 1 : 0,
        decoded: 0,
      });
    });
    cdp.on('Network.responseReceived', (e) => {
      const r = reqs.get(e.requestId);
      if (!r) return;
      r.status = e.response.status;
      r.mime = e.response.mimeType;
      r.protocol = e.response.protocol;
      r.ip = e.response.remoteIPAddress;
      r.cached = e.response.fromDiskCache || e.response.fromServiceWorker || undefined;
      if (TYPE_MAP[e.type]) r.type = TYPE_MAP[e.type];
    });
    cdp.on('Network.dataReceived', (e) => {
      const r = reqs.get(e.requestId);
      if (r) r.decoded += e.dataLength;
    });
    cdp.on('Network.loadingFinished', (e) => {
      const r = reqs.get(e.requestId);
      if (!r) return;
      r.transfer = e.encodedDataLength;
      r.end = e.timestamp;
    });
    cdp.on('Network.loadingFailed', (e) => {
      const r = reqs.get(e.requestId);
      if (!r) return;
      r.failed = e.blockedReason || e.errorText || 'failed';
      r.end = e.timestamp;
    });
    cdp.on('Network.webSocketCreated', (e) => {
      if (t0.mono === null) return;
      reqs.set(e.requestId, { id: e.requestId, url: e.url, type: 'websocket', initiator: initiatorUrl(e.initiator), start: t0.mono, decoded: 0 });
    });

    progress('navigate', `Loading page: ${url}`);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    if (!response) throw new Error('No response from the page.');

    progress('load', `Response: HTTP ${response.status()} — loading resources`);
    await withTimeout(page.waitForLoadState('load').catch(() => {}), 15000);

    progress('settle', 'Waiting for network traffic to settle');
    await withTimeout(page.waitForLoadState('networkidle').catch(() => {}), 6000);

    progress('scroll', 'Scrolling the page to trigger lazy-loaded content');
    await autoScroll(page).catch(() => {});
    await withTimeout(page.waitForLoadState('networkidle').catch(() => {}), 3000);
    await sleep(400);

    progress('dom', 'Extracting DOM tree and layout metrics');
    const dom = await page.evaluate(extractDom, MAX_NODES);
    const perf = await page.evaluate(collectPerf).catch(() => ({}));

    progress('screenshot', 'Capturing preview screenshot');
    const shot = await page.screenshot({ type: 'jpeg', quality: 62 }).catch(() => null);

    progress('network', `Processing ${reqs.size} network requests`);
    const finalUrl = page.url();
    const mainSite = siteOf(new URL(finalUrl).hostname);
    const brand = mainSite.split('.')[0];
    // The site's own CDNs (e.g. github.com → githubassets.com) count as first-party.
    const isFirstParty = (site) => site === mainSite || (brand.length >= 3 && site.split('.')[0].includes(brand));

    const resources = [];
    for (const r of reqs.values()) {
      let host = '';
      try { host = new URL(r.url).hostname; } catch { /* none */ }
      if (!host) continue;
      resources.push({
        url: r.url.slice(0, 600),
        host,
        site: siteOf(host),
        thirdParty: !isFirstParty(siteOf(host)),
        type: r.type,
        method: r.method,
        status: r.status ?? null,
        mime: r.mime ?? null,
        protocol: r.protocol ?? null,
        transfer: r.transfer ?? 0,
        size: r.decoded || r.transfer || 0,
        start: t0.mono != null ? Math.round((r.start - t0.mono) * 1000) : 0,
        duration: r.end ? Math.round((r.end - r.start) * 1000) : null,
        initiator: r.initiator ? r.initiator.slice(0, 600) : null,
        failed: r.failed ?? undefined,
        cached: r.cached,
        redirects: r.redirects || undefined,
      });
    }
    resources.sort((a, b) => a.start - b.start);

    progress('done', 'Analysis complete');
    return {
      url,
      finalUrl,
      site: mainSite,
      status: response.status(),
      analyzedAt: new Date().toISOString(),
      viewport: VIEWPORT,
      screenshot: shot ? `data:image/jpeg;base64,${shot.toString('base64')}` : null,
      perf,
      blockedRequests: blocked,
      dom,
      resources,
    };
  } finally {
    await context?.close().catch(() => {});
    release();
  }
}
