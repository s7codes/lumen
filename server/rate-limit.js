import { isIP } from 'node:net';

/**
 * Lumen Cloud rate limiting: a memory-bounded GCRA limiter and the client
 * address it keys on. Pure apart from the injectable clock; no timers.
 *
 * GCRA (the generic cell rate algorithm) is a token bucket kept as a single
 * number per bucket, the theoretical arrival time (TAT). A tier allows
 * `limit` requests per `windowMs`, refilled continuously: a fresh client may
 * spend the whole budget at once, then one request every windowMs / limit.
 *
 * The bucket table holds at most `maxEntries` entries. A bucket whose TAT has
 * passed is full again and carries no state worth keeping, so a sweep drops
 * those first; past that the least recently used bucket is evicted. A flood of
 * spoofed or rotating addresses therefore costs bounded memory, never a leak.
 */

export const RATE_LIMIT_TIERS = Object.freeze(['auth', 'ai', 'write', 'read']);

const MINUTE_MS = 60_000;

/** Per-client budgets: sign-in and sign-out, Lumen AI and MCP, storage writes, reads. */
export const DEFAULT_RATE_LIMITS = Object.freeze({
  auth: Object.freeze({ limit: 20, windowMs: MINUTE_MS }),
  ai: Object.freeze({ limit: 30, windowMs: MINUTE_MS }),
  write: Object.freeze({ limit: 120, windowMs: MINUTE_MS }),
  read: Object.freeze({ limit: 600, windowMs: MINUTE_MS }),
});

export const DEFAULT_MAX_ENTRIES = 4096;
/**
 * Default budgets are multiplied by this for a caller on the loopback
 * interface: a dev server, `vite preview` under parallel Playwright workers or
 * a probe on the host itself. Behind a proxy, set LUMEN_TRUST_PROXY so real
 * visitors are keyed by their own address instead of the proxy's.
 */
export const LOOPBACK_SCALE = 50;
export const RATE_LIMITED_CODE = 'RATE_LIMITED';
export const RATE_LIMITED_MESSAGE = 'Too many requests. Please slow down and retry shortly.';
export const MAX_PROXY_HOPS = 8;

const MAX_LIMIT = 1_000_000;
const MAX_WINDOW_MS = 24 * 60 * MINUTE_MS;
const MAX_TABLE_ENTRIES = 1_000_000;
// A full sweep is O(n); at capacity it runs at most once a second, LRU eviction covers the rest.
const SWEEP_INTERVAL_MS = 1000;
// Float slack for comparisons: a request this close to its slot is on time.
const EPSILON_MS = 1e-3;
const MAX_ADDRESS_CHARS = 64;
const PORT_SUFFIX = /^:\d{1,5}$/;

function isPortSuffix(text) {
  return PORT_SUFFIX.test(text) && Number(text.slice(1)) <= 65_535;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compileTier(name, spec) {
  const limit = spec?.limit;
  const windowMs = spec?.windowMs;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new TypeError(`rateLimit.tiers.${name}.limit must be a whole number from 1 to ${MAX_LIMIT}.`);
  }
  if (!Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > MAX_WINDOW_MS) {
    throw new TypeError(`rateLimit.tiers.${name}.windowMs must be a whole number of milliseconds from 1000 to ${MAX_WINDOW_MS}.`);
  }
  return Object.freeze({ limit, windowMs });
}

/**
 * Creates a limiter. `take(tier, key, scale)` spends one request from the
 * bucket of `key` in `tier` and returns the verdict:
 * `{ allowed, limit, remaining, resetAt, retryAfterMs }`, where `resetAt` is
 * the epoch millisecond at which the bucket is full again.
 */
export function createRateLimiter({ tiers = DEFAULT_RATE_LIMITS, maxEntries = DEFAULT_MAX_ENTRIES, now = Date.now } = {}) {
  if (!isRecord(tiers)) throw new TypeError('rateLimit.tiers must be an object of { limit, windowMs } budgets.');
  for (const name of Object.keys(tiers)) {
    if (!RATE_LIMIT_TIERS.includes(name)) throw new TypeError(`Unknown rate-limit tier "${name}".`);
  }
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_TABLE_ENTRIES) {
    throw new TypeError(`rateLimit.maxEntries must be a whole number from 1 to ${MAX_TABLE_ENTRIES}.`);
  }
  if (typeof now !== 'function') throw new TypeError('rateLimit.now must be a clock function.');

  const policies = new Map(RATE_LIMIT_TIERS.map((name) => [name, compileTier(name, tiers[name] ?? DEFAULT_RATE_LIMITS[name])]));
  // Times are kept relative to the limiter's creation: small magnitudes keep float steps exact.
  const origin = now();
  // `${tier} ${key}` -> TAT. Map order is insertion order; every hit re-inserts, so the first key is the least recently used.
  const buckets = new Map();
  let sweptAt = -Infinity;

  function sweep(at) {
    sweptAt = at;
    for (const [key, tat] of buckets) {
      if (tat <= at) buckets.delete(key);
    }
  }

  function makeRoom(at) {
    if (buckets.size < maxEntries) return;
    if (at - sweptAt >= SWEEP_INTERVAL_MS) sweep(at);
    while (buckets.size >= maxEntries) buckets.delete(buckets.keys().next().value);
  }

  function verdict(allowed, limit, remaining, fullAt, retryAfterMs) {
    return { allowed, limit, remaining, resetAt: origin + fullAt, retryAfterMs };
  }

  return {
    maxEntries,

    /** Live bucket count; never above `maxEntries`. */
    get size() {
      return buckets.size;
    },

    policy(tier) {
      return policies.get(tier) ?? null;
    },

    take(tier, key, scale = 1) {
      const policy = policies.get(tier);
      if (!policy) throw new TypeError(`Unknown rate-limit tier "${tier}".`);
      const limit = Math.min(MAX_LIMIT * LOOPBACK_SCALE, Math.max(1, Math.floor(policy.limit * (scale > 0 ? scale : 1))));
      const interval = policy.windowMs / limit;
      const at = now() - origin;
      const id = `${tier} ${key}`;
      const stored = buckets.get(id);
      if (stored === undefined) makeRoom(at);
      else buckets.delete(id);

      const tat = Math.max(stored ?? at, at);
      const next = tat + interval;
      const allowAt = next - policy.windowMs;
      if (allowAt - at > EPSILON_MS) {
        // Denied requests spend nothing: the TAT stays, so the wait never grows under a flood.
        buckets.set(id, stored);
        return verdict(false, limit, 0, tat, allowAt - at);
      }
      buckets.set(id, next);
      const remaining = Math.max(0, Math.floor((policy.windowMs - (next - at)) / interval + EPSILON_MS));
      return verdict(true, limit, remaining, next, 0);
    },

    /** Drops every bucket that has refilled; returns the live count. */
    sweep() {
      sweep(now() - origin);
      return buckets.size;
    },

    clear() {
      buckets.clear();
      sweptAt = -Infinity;
    },
  };
}

/** Budgets with `read` set to `max` per minute and the stricter tiers kept in their default proportion. */
export function scaledRateLimits(max) {
  if (!Number.isSafeInteger(max) || max < 1 || max > MAX_LIMIT) {
    throw new TypeError(`The read budget must be a whole number from 1 to ${MAX_LIMIT}.`);
  }
  const factor = max / DEFAULT_RATE_LIMITS.read.limit;
  return Object.freeze(
    Object.fromEntries(
      RATE_LIMIT_TIERS.map((tier) => {
        const base = DEFAULT_RATE_LIMITS[tier];
        return [tier, Object.freeze({ limit: Math.max(1, Math.round(base.limit * factor)), windowMs: base.windowMs })];
      }),
    ),
  );
}

/**
 * Normalizes the `rateLimit` option of createApp:
 * - `false` disables the limiter;
 * - `undefined` or `true` uses the defaults, generous on loopback, with the
 *   read budget from `LUMEN_RATE_LIMIT_MAX` when set (`off` or `0` disables);
 * - an object `{ tiers, maxEntries, loopbackScale, now }` is an explicit
 *   policy: tiers it leaves out keep their defaults, and loopback callers get
 *   no extra headroom unless `loopbackScale` asks for it.
 * Returns null when disabled, otherwise `{ tiers, maxEntries, loopbackScale, now }`.
 */
export function resolveRateLimitOptions(option, env = process.env) {
  if (option === false) return null;
  if (option === undefined || option === true) {
    const raw = typeof env?.LUMEN_RATE_LIMIT_MAX === 'string' ? env.LUMEN_RATE_LIMIT_MAX.trim().toLowerCase() : '';
    if (raw === 'off' || raw === 'false' || raw === '0') return null;
    if (raw !== '' && !/^\d{1,7}$/.test(raw)) {
      throw new TypeError('LUMEN_RATE_LIMIT_MAX must be a read budget per minute (for example 1200), or off.');
    }
    return {
      tiers: raw === '' ? DEFAULT_RATE_LIMITS : scaledRateLimits(Number(raw)),
      maxEntries: DEFAULT_MAX_ENTRIES,
      loopbackScale: LOOPBACK_SCALE,
      now: Date.now,
    };
  }
  if (!isRecord(option)) throw new TypeError('rateLimit must be false, true or an options object.');
  const loopbackScale = option.loopbackScale ?? 1;
  if (!Number.isSafeInteger(loopbackScale) || loopbackScale < 1 || loopbackScale > LOOPBACK_SCALE * 20) {
    throw new TypeError('rateLimit.loopbackScale must be a whole number of 1 or more.');
  }
  return {
    tiers: { ...DEFAULT_RATE_LIMITS, ...(option.tiers ?? {}) },
    maxEntries: option.maxEntries ?? DEFAULT_MAX_ENTRIES,
    loopbackScale,
    now: option.now ?? Date.now,
  };
}

/**
 * Normalizes `trustProxy`: how many reverse-proxy hops stand in front of the
 * server. `true` or `'1'` is one (Caddy or Nginx on the host), `false`, `0` or
 * unset is none. Reads `LUMEN_TRUST_PROXY` when the option is undefined.
 */
export function resolveTrustProxy(option, env = process.env) {
  const raw = option === undefined ? env?.LUMEN_TRUST_PROXY : option;
  if (raw === undefined || raw === null || raw === false) return 0;
  if (raw === true) return 1;
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 && raw <= MAX_PROXY_HOPS) return raw;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (text === '' || text === 'false' || text === 'no' || text === 'off') return 0;
    if (text === 'true' || text === 'yes' || text === 'on') return 1;
    if (/^\d$/.test(text) && Number(text) <= MAX_PROXY_HOPS) return Number(text);
  }
  throw new TypeError(`trustProxy (LUMEN_TRUST_PROXY) must be true, false or a hop count from 0 to ${MAX_PROXY_HOPS}.`);
}

/* Client addresses */

/** The eight 16-bit groups of an IPv6 address `isIP` has already accepted. */
function ipv6Groups(address) {
  let text = address;
  let v4 = null;
  const lastColon = text.lastIndexOf(':');
  if (text.slice(lastColon + 1).includes('.')) {
    v4 = text.slice(lastColon + 1).split('.').map(Number);
    text = `${text.slice(0, lastColon + 1)}0:0`;
  }
  const [head, tail] = text.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : 8 - headParts.length - tailParts.length;
  const groups = [...headParts, ...Array.from({ length: fill }, () => '0'), ...tailParts].map((part) => Number.parseInt(part, 16));
  if (v4) {
    groups[6] = (v4[0] << 8) | v4[1];
    groups[7] = (v4[2] << 8) | v4[3];
  }
  return groups;
}

/**
 * Canonical form of one address from a socket or a forwarding header: an
 * IPv4 dotted quad (IPv4-mapped IPv6 included), or eight lower-case hex
 * groups for IPv6. Ports, brackets and zone ids are dropped. Anything that
 * is not an IP address is null.
 */
export function normalizeAddress(value) {
  if (typeof value !== 'string') return null;
  let text = value.trim();
  if (text.length === 0 || text.length > MAX_ADDRESS_CHARS) return null;
  if (text.startsWith('[')) {
    const close = text.indexOf(']');
    if (close < 0) return null;
    const rest = text.slice(close + 1);
    if (rest !== '' && !isPortSuffix(rest)) return null;
    text = text.slice(1, close);
  } else {
    const colon = text.indexOf(':');
    if (colon !== -1 && colon === text.lastIndexOf(':')) {
      // One colon: an IPv4 address with a port.
      if (!isPortSuffix(text.slice(colon))) return null;
      text = text.slice(0, colon);
    }
  }
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  const family = isIP(text);
  if (family === 4) return text;
  if (family !== 6) return null;
  const groups = ipv6Groups(text.toLowerCase());
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
  }
  return groups.map((group) => group.toString(16)).join(':');
}

function isV4(address) {
  return !address.includes(':');
}

function v4Octets(address) {
  return address.split('.').map(Number);
}

export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  if (isV4(address)) return address.startsWith('127.');
  return address === '0:0:0:0:0:0:0:1';
}

/** Loopback, RFC 1918, shared CGNAT, link-local and unique-local ranges: where a trusted proxy can sit. */
export function isPrivateAddress(address) {
  if (typeof address !== 'string' || address === 'unknown') return false;
  if (isLoopbackAddress(address)) return true;
  if (isV4(address)) {
    const [a, b] = v4Octets(address);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const first = Number.parseInt(address.slice(0, address.indexOf(':')), 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/**
 * Bucket key for an address: IPv4 as is, IPv6 by its /64 network, the
 * smallest block a single subscriber is usually given, so rotating through
 * one allocation never yields fresh buckets.
 */
export function rateKeyFor(address) {
  if (typeof address !== 'string' || address === 'unknown' || isV4(address)) return address || 'unknown';
  return `${address.split(':').slice(0, 4).join(':')}::/64`;
}

/**
 * The client address for one request. Without trusted hops it is the socket
 * peer and forwarding headers are ignored, so a direct caller cannot pick its
 * own bucket. With `trustHops` it walks X-Forwarded-For from the right: each
 * trusted proxy appends the address it saw, so the entry `trustHops` from the
 * end is the left-most address the trusted chain vouches for. Entries further
 * left were written by the client and are never read. X-Real-IP is the
 * fallback when no X-Forwarded-For arrives. Headers are honoured only when the
 * peer itself is on loopback or a private network.
 *
 * Returns `{ address, peer, forwarded, trusted }`.
 */
export function resolveClientAddress(req, trustHops = 0) {
  const peer = normalizeAddress(req?.socket?.remoteAddress) ?? 'unknown';
  const headers = req?.headers ?? {};
  const xff = typeof headers['x-forwarded-for'] === 'string' ? headers['x-forwarded-for'] : '';
  const realIp = typeof headers['x-real-ip'] === 'string' ? headers['x-real-ip'] : '';
  const forwarded = xff.trim() !== '' || realIp.trim() !== '';
  if (trustHops < 1 || !forwarded || !isPrivateAddress(peer)) {
    return { address: peer, peer, forwarded, trusted: false };
  }
  let address = null;
  if (xff.trim() !== '') {
    const entries = xff.split(',');
    for (let hop = 1; hop <= trustHops && hop <= entries.length; hop += 1) {
      const candidate = normalizeAddress(entries[entries.length - hop]);
      if (!candidate) break;
      address = candidate;
    }
  } else {
    address = normalizeAddress(realIp);
  }
  return address ? { address, peer, forwarded, trusted: true } : { address: peer, peer, forwarded, trusted: false };
}
