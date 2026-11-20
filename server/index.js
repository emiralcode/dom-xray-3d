import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, closeBrowser, getBrowser } from './analyzer.js';
import { ALLOW_PRIVATE, UrlError, validateTargetUrl } from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
// Serve Three.js straight from node_modules (no build step needed).
app.use('/vendor/three/build', express.static(path.join(ROOT, 'node_modules/three/build'), { maxAge: '7d' }));
app.use('/vendor/three/addons', express.static(path.join(ROOT, 'node_modules/three/examples/jsm'), { maxAge: '7d' }));

/* ------------------------------- Rate limiting ------------------------------- */
const RATE_WINDOW = 60_000;
const RATE_MAX = Number(process.env.RATE_MAX || 12);
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_MAX;
}

/* ---------------------------------- Cache ---------------------------------- */
const CACHE_TTL = 10 * 60_000;
const cache = new Map();
function cacheGet(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;
  cache.delete(url);
  return null;
}
function cacheSet(url, data) {
  cache.set(url, { at: Date.now(), data });
  while (cache.size > 20) cache.delete(cache.keys().next().value);
}

/* ----------------------------- API: SSE analysis ----------------------------- */
app.get('/api/analyze', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const controller = new AbortController();
  let finished = false;
  res.on('close', () => { if (!finished) controller.abort(); });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

  const t = Date.now();
  try {
    if (rateLimited(req.ip)) throw new UrlError('Too many requests. Please try again in a minute.');
    const url = await validateTargetUrl(req.query.url);
    const fresh = req.query.fresh === '1';
    let data = fresh ? null : cacheGet(url);
    if (data) {
      send('progress', { step: 'cache', message: 'Loaded from cache' });
    } else {
      data = await analyze(url, (step, message) => send('progress', { step, message, elapsed: Date.now() - t }), controller.signal);
      data.durationMs = Date.now() - t;
      cacheSet(url, data);
    }
    send('result', data);
  } catch (err) {
    const message = err instanceof UrlError ? err.message : friendlyError(err);
    if (!(err instanceof UrlError)) console.error('[analyze]', err?.message);
    send('failure', { message });
  } finally {
    finished = true;
    clearInterval(heartbeat);
    res.end();
  }
});

function friendlyError(err) {
  const m = String(err?.message || err);
  if (/ERR_NAME_NOT_RESOLVED/.test(m)) return 'Could not resolve the domain name.';
  if (/Timeout|timeout/.test(m)) return 'The page did not load in time (timeout).';
  if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET/.test(m)) return 'Could not connect to the server.';
  if (/ERR_CERT/.test(m)) return 'The site has an invalid SSL certificate.';
  if (/ERR_BLOCKED_BY_CLIENT/.test(m)) return 'The request was blocked by the security policy.';
  if (/Could not launch Chromium/.test(m)) return m;
  if (/closed|Cancelled/.test(m)) return 'Analysis cancelled.';
  return `Analysis failed: ${m.split('\n')[0].slice(0, 200)}`;
}

app.get('/api/health', (_req, res) => res.json({ ok: true, allowPrivate: ALLOW_PRIVATE }));

const server = app.listen(PORT, () => {
  console.log(`\n  ◉ DOM X-Ray 3D running → http://localhost:${PORT}\n`);
  if (ALLOW_PRIVATE) console.log('  ⚠ ALLOW_PRIVATE=1: access to private network addresses is enabled.\n');
  getBrowser().catch((e) => console.error(e.message)); // warm up the browser
});

const shutdown = async () => {
  server.close();
  await closeBrowser();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
