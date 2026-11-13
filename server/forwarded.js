import { isPrivateAddress, normalizeAddress } from './rate-limit.js';

/**
 * The origin a browser addressed, resolved through trusted reverse-proxy hops.
 *
 * Behind Caddy the TLS session ends at the proxy: the app sees plain HTTP from
 * a private Docker bridge address, while the browser's own scheme travels in
 * X-Forwarded-Proto and, when a proxy rewrites Host, its host in
 * X-Forwarded-Host. Both are read exactly like X-Forwarded-For in
 * rate-limit.js: only with `trustHops` set and a socket peer on loopback or a
 * private network (RFC 1918, CGNAT, link-local, unique-local), and walked from
 * the right one entry per trusted hop, so a value a client prepended is never
 * read. Any other peer keeps the scheme of its own socket. Pure: reads only
 * `req.socket` and `req.headers`.
 */

const MAX_HOST_CHARS = 255;
const MAX_ORIGIN_CHARS = 512;
// A host is a name or a bracketed IPv6 literal with an optional port: no @ / ? # % or \ can appear.
const HOST_CHARS = /^[A-Za-z0-9._~\-[\]:]+$/;

/** One X-Forwarded-Proto entry: http or https in any case, anything else null. */
function protoEntry(entry) {
  const text = entry.trim().toLowerCase();
  return text === 'https' || text === 'http' ? text : null;
}

/** One Host or X-Forwarded-Host entry, trimmed, or null when it could carry more than a host. */
function hostEntry(entry) {
  const text = entry.trim();
  return text.length > 0 && text.length <= MAX_HOST_CHARS && HOST_CHARS.test(text) ? text : null;
}

/**
 * The left-most entry of a comma-separated forwarding header that the trusted
 * chain vouches for: one entry per hop from the right. A malformed entry ends
 * the walk, so nothing behind it is read.
 */
function walkTrusted(header, trustHops, parse) {
  if (typeof header !== 'string') return null;
  const entries = header.split(',');
  let value = null;
  for (let hop = 1; hop <= trustHops && hop <= entries.length; hop += 1) {
    const candidate = parse(entries[entries.length - hop]);
    if (candidate === null) break;
    value = candidate;
  }
  return value;
}

/** `host[:port]` as a browser serializes it for `scheme` (lower case, default port dropped), or null. */
function canonicalHost(host, scheme) {
  if (host === null) return null;
  try {
    const url = new URL(`${scheme}://${host}`);
    return url.host !== '' && url.pathname === '/' && url.username === '' && url.password === '' ? url.host : null;
  } catch {
    return null;
  }
}

function forwardedView(req, trustHops) {
  const headers = req?.headers ?? {};
  const peer = normalizeAddress(req?.socket?.remoteAddress);
  const trusted = trustHops > 0 && peer !== null && isPrivateAddress(peer);
  const proto = trusted ? walkTrusted(headers['x-forwarded-proto'], trustHops, protoEntry) : null;
  const forwardedHost = trusted ? walkTrusted(headers['x-forwarded-host'], trustHops, hostEntry) : null;
  const tls = req?.socket?.encrypted === true;
  return {
    scheme: proto ?? (tls ? 'https' : 'http'),
    // A TLS socket or a trusted hop's X-Forwarded-Proto: the browser's scheme is known, not assumed.
    established: proto !== null || tls,
    host: forwardedHost ?? (typeof headers.host === 'string' ? hostEntry(headers.host) : null),
    forwarded: proto !== null || forwardedHost !== null,
  };
}

/**
 * `{ scheme, host, origin, secure, established, forwarded }` for one request:
 * the origin the browser sent it to (`https://lumen.s7codes.dev` behind
 * Caddy), whether that is HTTPS, whether the scheme is known for certain, and
 * whether a trusted hop's forwarding headers decided it. `host` and `origin`
 * are null when no valid host arrived.
 */
export function resolveRequestOrigin(req, trustHops = 0) {
  const view = forwardedView(req, trustHops);
  const host = canonicalHost(view.host, view.scheme);
  return {
    scheme: view.scheme,
    host,
    origin: host === null ? null : `${view.scheme}://${host}`,
    secure: view.scheme === 'https',
    established: view.established,
    forwarded: view.forwarded,
  };
}

/** Whether a request reached the app over HTTPS: its own TLS socket, or a trusted hop's X-Forwarded-Proto. */
export function isSecureRequest(req, trustHops = 0) {
  return forwardedView(req, trustHops).scheme === 'https';
}

/**
 * Whether an Origin header names the origin `req` was sent to. With the scheme
 * established, scheme and host must both match, so the plain-HTTP twin of an
 * HTTPS deployment is another origin. Over plain HTTP with no trusted
 * forwarding the browser's scheme cannot be known (an untrusted hop may have
 * ended TLS), so the host alone decides, as before v8.1. `null`, a path,
 * credentials and any scheme but http and https never match.
 */
export function originMatches(originHeader, req, trustHops = 0) {
  if (typeof originHeader !== 'string' || originHeader.length === 0 || originHeader.length > MAX_ORIGIN_CHARS) return false;
  let url;
  try {
    url = new URL(originHeader);
  } catch {
    return false;
  }
  const scheme = url.protocol.slice(0, -1);
  if (scheme !== 'http' && scheme !== 'https') return false;
  if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') return false;
  const view = forwardedView(req, trustHops);
  if (view.established && scheme !== view.scheme) return false;
  const host = canonicalHost(view.host, scheme);
  return host !== null && host === url.host;
}

/**
 * Hostnames the server answers for whatever the environment says: loopback for
 * local runs, health checks and E2E, and the production domains. DOMAIN and
 * LUMEN_ALLOWED_HOSTS add to these (resolveAllowedHosts).
 */
export const DEFAULT_ALLOWED_HOSTS = Object.freeze(['localhost', '127.0.0.1', '[::1]', 'lumen.s7codes.dev', 's7codes.dev']);

/**
 * The hostname of one Host value: lower case, the optional `:port` and one
 * trailing root dot dropped, IPv6 literals kept in brackets. Null when the
 * value is missing or could carry more than a host (a path, credentials, a
 * port out of range, non-ASCII), so it can never be matched loosely.
 */
export function hostnameOf(value) {
  const host = typeof value === 'string' ? hostEntry(value) : null;
  if (host === null) return null;
  try {
    const url = new URL(`http://${host}`);
    if (url.hostname === '' || url.pathname !== '/' || url.username !== '' || url.password !== '') return null;
    const name = url.hostname.endsWith('.') ? url.hostname.slice(0, -1) : url.hostname;
    return name === '' ? null : name;
  } catch {
    return null;
  }
}

/**
 * The Host allowlist: DEFAULT_ALLOWED_HOSTS, the host in DOMAIN (the one Caddy
 * serves), and `allowedHosts` (an array or a comma-separated string), which
 * reads LUMEN_ALLOWED_HOSTS when undefined. Entries may carry a port; entries
 * that are not a hostname are dropped.
 */
export function resolveAllowedHosts(allowedHosts, env = process.env) {
  const extra = allowedHosts === undefined ? env?.LUMEN_ALLOWED_HOSTS : allowedHosts;
  const listed = Array.isArray(extra) ? extra : typeof extra === 'string' ? extra.split(',') : [];
  const hosts = new Set(DEFAULT_ALLOWED_HOSTS);
  for (const entry of [...listed, typeof env?.DOMAIN === 'string' ? env.DOMAIN : '']) {
    const name = typeof entry === 'string' && entry.trim() !== '' ? hostnameOf(entry) : null;
    if (name !== null) hosts.add(name);
  }
  return hosts;
}

/**
 * DNS-rebinding guard: how the request's own Host header stands against
 * `allowed`. A rebinding page reaches this server under the attacker's name,
 * and the browser sends that name as Host, so only names this deployment
 * serves are answered. Returns 'ok', 'unknown' (a valid host that is not
 * listed) or 'malformed' (missing or not a host). The raw Host is
 * checked, never X-Forwarded-Host: a script on a rebound origin is same-origin
 * there and may set any header a proxy would.
 */
export function checkHost(req, allowed) {
  const name = hostnameOf(req?.headers?.host);
  if (name === null) return 'malformed';
  return allowed.has(name) ? 'ok' : 'unknown';
}
