// SSRF protection: prevents the target URL (and every request the page makes)
// from reaching private networks, localhost or cloud metadata endpoints.
import dns from 'node:dns/promises';
import net from 'node:net';

export const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === '1';

const V4_BLOCKS = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
];

const v4ToInt = (ip) => ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;

function isPrivateV4(ip) {
  const n = v4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

function isPrivateV6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower);
}

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  if (net.isIPv6(ip)) return isPrivateV6(ip);
  return true;
}

const hostCache = new Map(); // hostname -> { ok, at }
const HOST_TTL = 5 * 60 * 1000;

export async function isHostAllowed(hostname) {
  if (ALLOW_PRIVATE) return true;
  const host = hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (net.isIP(host)) return !isPrivateIp(host);

  const cached = hostCache.get(host);
  if (cached && Date.now() - cached.at < HOST_TTL) return cached.ok;
  let ok = false;
  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    ok = addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    ok = false;
  }
  hostCache.set(host, { ok, at: Date.now() });
  if (hostCache.size > 5000) hostCache.clear();
  return ok;
}

export class UrlError extends Error {}

/** Normalizes user input and runs it through the security checks. */
export async function validateTargetUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new UrlError('URL cannot be empty.');
  if (raw.length > 2048) throw new UrlError('URL is too long.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlError('Invalid URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new UrlError('Only http/https is supported.');
  if (url.username || url.password) throw new UrlError('URLs containing credentials are not accepted.');
  if (!(await isHostAllowed(url.hostname))) {
    throw new UrlError('Access to this address is not allowed (private network or unresolvable domain).');
  }
  url.hash = '';
  return url.toString();
}
