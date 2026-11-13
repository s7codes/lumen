import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { test as base, expect } from '@playwright/test';
import { createApp } from '../server/app.js';
import { COMPRESSION_THRESHOLD_BYTES, negotiateEncoding } from '../server/compress.js';
import { createLumenServer } from '../server/http-server.js';
import { createConciergeAgent } from '../server/llm-agent.js';
import {
  createRateLimiter,
  DEFAULT_RATE_LIMITS,
  isLoopbackAddress,
  isPrivateAddress,
  LOOPBACK_SCALE,
  normalizeAddress,
  RATE_LIMITED_MESSAGE,
  rateKeyFor,
  resolveClientAddress,
  resolveRateLimitOptions,
  resolveTrustProxy,
  scaledRateLimits,
} from '../server/rate-limit.js';
import { etagMatches, IMMUTABLE_CACHE_CONTROL, resolveStaticPath } from '../server/static.js';
import { accountNamespace, createMutex, createStore } from '../server/store.js';
import { sanitizeEmail } from '../src/lib/auth.js';
import { buildBlueprintSvg, cleanProjectName, compileBlueprintSheet, escapeXml } from '../src/lib/blueprint-sheet.js';
import { MAX_STORED_PROJECTS, MAX_STORED_QUOTES, sanitizeProjectData, serializeProjectRecord } from '../src/lib/cloud-records.js';
import { evaluateConciergeQuery, sanitizeQuestion, validateConciergeAsk } from '../src/lib/concierge-engine.js';
import { buildBlueprintDxf, dxfText } from '../src/lib/dxf-export.js';
import { exceedsDepth, handleMcpRequest, MCP_MAX_DEPTH } from '../src/lib/mcp-server.js';
import { buildRoomObj, countObjObjects, objToken } from '../src/lib/obj-export.js';
import { isProjectId, projectIdFor, sanitizeProjectName } from '../src/lib/project-library.js';
import { createRoomState, mountInRoom, serializeRoomState } from '../src/lib/room-3d.js';
import { decodeSceneParam, encodeSceneParam, SCENE_MAX_LENGTH } from '../src/lib/scene-codec.js';
import { layoutFromPreset, serializeLayout } from '../src/lib/wall-studio.js';
import { safeJsonParse, sanitizeMultilineText, sanitizeText } from '../src/security/sanitize.js';

/*
 * White-box red-team suite: every defense is attacked through its real entry
 * point. Isolated Lumen Cloud instances (own store, own limiter, ephemeral
 * loopback port) carry the strict policies, so nothing here can throttle or
 * pollute the shared Playwright preview server the rest of the suite uses.
 */

const REPO_DIR = fileURLToPath(new URL('../', import.meta.url));
const DIST_DIR = join(REPO_DIR, 'dist');
const C = String.fromCharCode;

const LAYOUT = layoutFromPreset('nordic-reading-wall');
const WALL = serializeLayout(LAYOUT);
const WALL_DATA = sanitizeProjectData('wall', WALL);
const CREDENTIALS = { email: 'guest@lumen.com', password: 'nordic-test-0042' };
const QUOTE_BODY = {
  quote: { currency: 'USD', promo: null, includeDriver: true, items: [{ id: 'modular-cube-36', finish: 'oak', qty: 2 }] },
  project: { reference: 'Red Team - Concurrency Hammer', preparedFor: 'Studio Halvorsen Arkitekter' },
};
const ROOM = (() => {
  let state = createRoomState();
  for (const [productId, wall] of [
    ['linear-lightbar-60', 'north'],
    ['floating-shelf-110', 'east'],
    ['wall-sconce-80', 'west'],
  ]) {
    state = mountInRoom(state, productId, wall).state;
  }
  return state;
})();

// Names that try to break out of a DXF group, an OBJ comment, an SVG text node or the display order.
const HOSTILE_NAMES = [
  'Loft\r\n0\r\nSECTION\r\n2\r\nENTITIES',
  'Room\nmtllib http://evil.tld/pwn.mtl',
  '  0\nEOF\n999\nowned',
  '%%%%c%%%%d 100%%% ^J^M',
  `Atelier${C(0x202e)}gnp.exe${C(0)}${C(0x85)}${C(0x2066)}`,
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
];

const SILENT = { log() {}, warn() {}, error() {} };
const AGENT = createConciergeAgent({ version: 'redteam', env: { LUMEN_LLM_PROVIDER: 'deterministic' }, logger: SILENT });

/* Byte-level helpers: no escape sequences, so the checks read the same in any editor. */

function isPrintableAscii(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

/** Code units free text must never carry: C0 and C1 controls, bidi overrides and isolates, lone surrogates. */
function hostileUnits(text, { allowNewlines = false } = {}) {
  const found = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const high = code >= 0xd800 && code <= 0xdbff;
    const low = code >= 0xdc00 && code <= 0xdfff;
    const pairedHigh = high && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff;
    const pairedLow = low && i > 0 && text.charCodeAt(i - 1) >= 0xd800 && text.charCodeAt(i - 1) <= 0xdbff;
    if (
      (code < 0x20 && !(allowNewlines && code === 0x0a)) ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      (high && !pairedHigh) ||
      (low && !pairedLow)
    ) {
      found.push(code.toString(16));
    }
  }
  return found;
}

function dxfPairs(text) {
  const lines = text.split('\r\n');
  if (lines.at(-1) === '') lines.pop();
  expect(lines.length % 2).toBe(0);
  const pairs = [];
  const badCodes = [];
  for (let i = 0; i < lines.length; i += 2) {
    if (!/^ *-?\d+$/.test(lines[i])) badCodes.push(lines[i]);
    pairs.push([Number(lines[i].trim()), lines[i + 1]]);
  }
  expect(badCodes).toEqual([]);
  return pairs;
}

function parseSse(text) {
  return text
    .split('\n\n')
    .filter((frame) => frame.trim() && !frame.startsWith(':'))
    .map((frame) => {
      const lines = frame.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
      const data = JSON.parse(lines.filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n'));
      return { event, data };
    });
}

function namespace() {
  return `redteam-${randomUUID().replaceAll('-', '')}`;
}

function rpc(method, params, id = 1) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

/* HTTP helpers for isolated servers */

async function call(origin, path, { method = 'GET', body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(origin + path, init);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: () => JSON.parse(text) };
}

/** node:http without content decoding: the exact bytes and headers on the wire. */
function rawRequest(origin, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(new URL(path, origin), { method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function expectRateLimited(response, { limit, retryAfter }) {
  expect(response.status).toBe(429);
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(response.headers.get('retry-after')).toBe(String(retryAfter));
  expect(response.headers.get('x-ratelimit-limit')).toBe(String(limit));
  expect(response.headers.get('x-ratelimit-remaining')).toBe('0');
  expect(Number(response.headers.get('x-ratelimit-reset'))).toBeGreaterThan(Date.now() / 1000);
  expect(response.json()).toEqual({ error: { code: 'RATE_LIMITED', message: RATE_LIMITED_MESSAGE, retryAfterSec: retryAfter } });
}

const test = base.extend({
  // Factory for isolated Lumen Cloud apps on ephemeral loopback ports; all are closed after the test.
  // eslint-disable-next-line no-empty-pattern
  cloud: async ({}, use) => {
    const servers = [];
    await use(async ({ file = null, maxPendingWrites, store: given, ...options } = {}) => {
      const store = given ?? createStore({ file, ...(maxPendingWrites ? { maxPendingWrites } : {}) });
      const warnings = [];
      const logger = { log() {}, warn: (message) => warnings.push(String(message)), error: (...args) => warnings.push(args.map(String).join(' ')) };
      const handler = createApp({ store, version: 'redteam', agent: AGENT, env: {}, logger, ...options });
      const server = createServer(handler);
      servers.push(server);
      return { origin: await listen(server), handler, store, warnings };
    });
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
  },
});

/* 1. Rate limiter, 429 headers, LRU bounds and proxy-aware client addresses */

test.describe('memory-bounded rate limiting and reverse-proxy client addresses', () => {
  test('auth, AI and stream budgets answer 429 with Retry-After and X-RateLimit headers', async ({ cloud }) => {
    const app = await cloud({ rateLimit: { tiers: { auth: { limit: 3, windowMs: 60_000 }, ai: { limit: 2, windowMs: 60_000 } } } });
    const opened = [];
    for (let i = 0; i < 3; i += 1) opened.push(await call(app.origin, '/api/auth/session', { method: 'POST', body: CREDENTIALS }));
    expect(opened.map((response) => response.status)).toEqual([201, 201, 201]);
    expect(opened.map((response) => response.headers.get('x-ratelimit-limit'))).toEqual(['3', '3', '3']);
    expect(opened.map((response) => response.headers.get('x-ratelimit-remaining'))).toEqual(['2', '1', '0']);
    const reset = Number(opened[2].headers.get('x-ratelimit-reset'));
    expect(reset).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) + 55);
    expect(reset).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000) + 61);

    // 3 per minute refills one every 20 s; sign-out spends the same budget.
    const { token } = opened[0].json();
    await expectRateLimited(await call(app.origin, '/api/auth/session', { method: 'POST', body: CREDENTIALS }), { limit: 3, retryAfter: 20 });
    await expectRateLimited(await call(app.origin, '/api/auth/session', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }), {
      limit: 3,
      retryAfter: 20,
    });

    // Reads keep their own budget; the health probe is never limited.
    const read = await call(app.origin, '/api/auth/session', { headers: { Authorization: `Bearer ${token}` } });
    expect(read.status).toBe(200);
    expect(read.headers.get('x-ratelimit-limit')).toBe(String(DEFAULT_RATE_LIMITS.read.limit));
    const health = await call(app.origin, '/api/health');
    expect(health.status).toBe(200);
    expect(health.headers.get('x-ratelimit-limit')).toBeNull();

    // MCP and the SSE stream share the AI budget: two calls, then 429 as JSON before any stream opens.
    const ping = await call(app.origin, '/api/mcp', { method: 'POST', body: rpc('ping') });
    expect(ping.status).toBe(200);
    expect(ping.headers.get('x-ratelimit-remaining')).toBe('1');
    const stream = await call(app.origin, '/api/concierge/stream', { method: 'POST', body: { question: 'What does the Linear Lightbar 60 draw?' } });
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(stream.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(parseSse(stream.text).at(-1).event).toBe('complete');
    await expectRateLimited(await call(app.origin, '/api/mcp', { method: 'POST', body: rpc('ping') }), { limit: 2, retryAfter: 30 });
    await expectRateLimited(await call(app.origin, '/api/concierge/stream', { method: 'POST', body: { question: 'Hello' } }), { limit: 2, retryAfter: 30 });
    await expectRateLimited(await call(app.origin, '/api/concierge/ask', { method: 'POST', body: { question: 'Hello' } }), { limit: 2, retryAfter: 30 });
  });

  test('the bucket refills on a deterministic clock and a flood of denials never extends the wait', () => {
    let now = 0;
    const limiter = createRateLimiter({ tiers: { write: { limit: 4, windowMs: 60_000 } }, now: () => now });
    expect([1, 2, 3, 4].map(() => limiter.take('write', '203.0.113.7').remaining)).toEqual([3, 2, 1, 0]);
    const denied = limiter.take('write', '203.0.113.7');
    expect(denied).toMatchObject({ allowed: false, limit: 4, remaining: 0, retryAfterMs: 15_000, resetAt: 60_000 });
    for (let i = 0; i < 100; i += 1) expect(limiter.take('write', '203.0.113.7').retryAfterMs).toBe(15_000);

    now = 14_999;
    expect(limiter.take('write', '203.0.113.7')).toMatchObject({ allowed: false, retryAfterMs: 1 });
    now = 15_000;
    expect(limiter.take('write', '203.0.113.7')).toMatchObject({ allowed: true, remaining: 0 });
    now = 15_000 + 60_000;
    expect(limiter.take('write', '203.0.113.7')).toMatchObject({ allowed: true, remaining: 3, resetAt: now + 15_000 });

    // Another client and another tier never share the bucket.
    expect(limiter.take('write', '203.0.113.8').remaining).toBe(3);
    expect(limiter.take('read', '203.0.113.7').remaining).toBe(DEFAULT_RATE_LIMITS.read.limit - 1);
    expect(limiter.take('auth', '203.0.113.7', LOOPBACK_SCALE).limit).toBe(DEFAULT_RATE_LIMITS.auth.limit * LOOPBACK_SCALE);
    expect(() => limiter.take('admin', '203.0.113.7')).toThrow(/Unknown rate-limit tier/);
    expect(() => createRateLimiter({ tiers: { read: { limit: 0, windowMs: 60_000 } } })).toThrow(/limit/);
    expect(() => createRateLimiter({ maxEntries: 0 })).toThrow(/maxEntries/);
  });

  test('5,000 spoofed addresses never grow the bucket table past maxEntries', async ({ cloud }) => {
    let now = 1_000;
    const limiter = createRateLimiter({ maxEntries: 1024, now: () => now });
    const address = (i) => normalizeAddress(`198.18.${i >> 8}.${i & 255}`);
    let peak = 0;
    for (let i = 0; i < 5000; i += 1) {
      limiter.take('read', rateKeyFor(address(i)));
      peak = Math.max(peak, limiter.size);
    }
    expect(peak).toBe(1024);
    expect(limiter.size).toBe(1024);
    // LRU: the newest address kept its spent bucket, the oldest was evicted and starts fresh.
    expect(limiter.take('read', rateKeyFor(address(4999))).remaining).toBe(DEFAULT_RATE_LIMITS.read.limit - 2);
    expect(limiter.take('read', rateKeyFor(address(0))).remaining).toBe(DEFAULT_RATE_LIMITS.read.limit - 1);
    expect(limiter.size).toBe(1024);
    // Once every bucket has refilled, a sweep frees the whole table.
    now += DEFAULT_RATE_LIMITS.read.windowMs;
    expect(limiter.sweep()).toBe(0);

    // Over HTTP behind a trusted proxy: 1,000 forwarded addresses against a 128-entry table.
    const app = await cloud({ trustProxy: true, rateLimit: { maxEntries: 128 } });
    const statuses = [];
    for (let batch = 0; batch < 20; batch += 1) {
      const round = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          call(app.origin, '/api/no-such-endpoint', { headers: { 'X-Forwarded-For': `198.51.${batch}.${i + 1}` } }).then((response) => response.status),
        ),
      );
      statuses.push(...round);
      expect(app.handler.limiter.size).toBeLessThanOrEqual(128);
    }
    expect(new Set(statuses)).toEqual(new Set([404]));
    expect(app.handler.limiter.size).toBe(128);
  });

  test('trustProxy reads the proxy-appended address and ignores X-Forwarded-For when off', async ({ cloud }) => {
    const req = (peer, headers = {}) => ({ socket: { remoteAddress: peer }, headers });
    const chain = { 'x-forwarded-for': '198.51.100.1, 203.0.113.7' };
    expect(resolveClientAddress(req('127.0.0.1', chain), 0)).toEqual({ address: '127.0.0.1', peer: '127.0.0.1', forwarded: true, trusted: false });
    expect(resolveClientAddress(req('127.0.0.1', chain), 1).address).toBe('203.0.113.7');
    expect(resolveClientAddress(req('::ffff:127.0.0.1', chain), 2).address).toBe('198.51.100.1');
    expect(resolveClientAddress(req('127.0.0.1', chain), 5).address).toBe('198.51.100.1');
    expect(resolveClientAddress(req('10.0.0.2', { 'x-forwarded-for': '203.0.113.7, not-an-address' }), 1)).toMatchObject({ address: '10.0.0.2', trusted: false });
    expect(resolveClientAddress(req('8.8.8.8', chain), 1)).toMatchObject({ address: '8.8.8.8', trusted: false });
    expect(resolveClientAddress(req('::ffff:10.0.0.2', { 'x-real-ip': '198.51.100.4' }), 1).address).toBe('198.51.100.4');
    expect(resolveClientAddress(req('10.0.0.2', { 'x-real-ip': '198.51.100.4, 198.51.100.5' }), 1).address).toBe('10.0.0.2');
    expect(resolveClientAddress(req(undefined), 1).address).toBe('unknown');

    expect(normalizeAddress('[2001:db8::1]:443')).toBe('2001:db8:0:0:0:0:0:1');
    expect(normalizeAddress('203.0.113.9:8080')).toBe('203.0.113.9');
    expect(normalizeAddress('::ffff:7f00:1')).toBe('127.0.0.1');
    for (const junk of ['', 'localhost', '01.2.3.4', '999.1.1.1', '1.2.3.4:99999', '[::1', 'a'.repeat(80)]) expect(normalizeAddress(junk)).toBeNull();
    // An IPv6 client is keyed by its /64, so rotating through one allocation buys no fresh buckets.
    const v6 = (text) => rateKeyFor(normalizeAddress(text));
    expect(v6('2001:db8:0:0:1::1')).toBe(v6('2001:db8::ffff:0:0:9'));
    expect(v6('2001:db8:0:1::1')).not.toBe(v6('2001:db8::1'));
    expect(['127.0.0.1', '::1', '::ffff:127.0.0.9'].every((text) => isLoopbackAddress(normalizeAddress(text)))).toBe(true);
    expect(['10.1.2.3', '172.16.0.1', '192.168.1.1', '100.64.0.1', 'fd00::1', 'fe80::1'].every((text) => isPrivateAddress(normalizeAddress(text)))).toBe(true);
    expect(['172.32.0.1', '8.8.8.8', '2001:db8::1'].some((text) => isPrivateAddress(normalizeAddress(text)))).toBe(false);
    expect([resolveTrustProxy(true), resolveTrustProxy('1'), resolveTrustProxy('2'), resolveTrustProxy('off'), resolveTrustProxy(undefined, {})]).toEqual([1, 1, 2, 0, 0]);
    expect(resolveTrustProxy(undefined, { LUMEN_TRUST_PROXY: '1' })).toBe(1);
    expect(() => resolveTrustProxy('9')).toThrow(/hop count/);
    expect(() => resolveTrustProxy('maybe')).toThrow(/hop count/);

    const signIn = (origin, forwardedFor) => call(origin, '/api/auth/session', { method: 'POST', headers: { 'X-Forwarded-For': forwardedFor }, body: CREDENTIALS });
    const policy = { tiers: { auth: { limit: 2, windowMs: 60_000 } } };

    // Behind a trusted proxy a prepended address cannot buy a fresh bucket; a different client can.
    const proxied = await cloud({ trustProxy: true, rateLimit: policy });
    expect((await signIn(proxied.origin, '203.0.113.7')).status).toBe(201);
    expect((await signIn(proxied.origin, '203.0.113.7')).status).toBe(201);
    expect((await signIn(proxied.origin, '198.51.100.1, 203.0.113.7')).status).toBe(429);
    expect((await signIn(proxied.origin, '203.0.113.8')).status).toBe(201);
    expect(proxied.warnings).toEqual([]);

    // Without trustProxy every caller is the socket peer, whatever the header claims, and the operator is told why.
    const direct = await cloud({ rateLimit: policy });
    expect((await signIn(direct.origin, '203.0.113.7')).status).toBe(201);
    expect((await signIn(direct.origin, '203.0.113.8')).status).toBe(201);
    expect((await signIn(direct.origin, '203.0.113.99')).status).toBe(429);
    expect(direct.warnings).toEqual([expect.stringContaining('LUMEN_TRUST_PROXY is not set')]);
  });

  test('loopback callers get the generous default budget while explicit policies stay strict', async ({ cloud, request }) => {
    const generous = String(DEFAULT_RATE_LIMITS.read.limit * LOOPBACK_SCALE);
    expect(resolveRateLimitOptions(undefined, {})).toMatchObject({ tiers: DEFAULT_RATE_LIMITS, loopbackScale: LOOPBACK_SCALE });
    expect(resolveRateLimitOptions(undefined, { LUMEN_RATE_LIMIT_MAX: '1200' }).tiers).toEqual(scaledRateLimits(1200));
    expect(scaledRateLimits(1200)).toEqual({
      auth: { limit: 40, windowMs: 60_000 },
      ai: { limit: 60, windowMs: 60_000 },
      write: { limit: 240, windowMs: 60_000 },
      read: { limit: 1200, windowMs: 60_000 },
    });
    for (const off of ['off', '0', 'false']) expect(resolveRateLimitOptions(undefined, { LUMEN_RATE_LIMIT_MAX: off })).toBeNull();
    expect(resolveRateLimitOptions(false)).toBeNull();
    expect(() => resolveRateLimitOptions(undefined, { LUMEN_RATE_LIMIT_MAX: 'lots' })).toThrow(/LUMEN_RATE_LIMIT_MAX/);
    const explicit = resolveRateLimitOptions({ tiers: { auth: { limit: 5, windowMs: 60_000 } } });
    expect(explicit).toMatchObject({ loopbackScale: 1, tiers: { ...DEFAULT_RATE_LIMITS, auth: { limit: 5, windowMs: 60_000 } } });

    const loose = await cloud({});
    const read = await call(loose.origin, '/api/projects', { headers: { 'X-Lumen-Client': namespace() } });
    expect(read.headers.get('x-ratelimit-limit')).toBe(generous);
    const strict = await cloud({ rateLimit: {} });
    expect((await call(strict.origin, '/api/projects', { headers: { 'X-Lumen-Client': namespace() } })).headers.get('x-ratelimit-limit')).toBe(
      String(DEFAULT_RATE_LIMITS.read.limit),
    );
    const disabled = await cloud({ rateLimit: false });
    expect(disabled.handler.limiter).toBeNull();
    expect((await call(disabled.origin, '/api/projects', { headers: { 'X-Lumen-Client': namespace() } })).headers.get('x-ratelimit-limit')).toBeNull();

    // The shared preview server every other spec talks to runs the default policy on loopback.
    const shared = await request.get('/api/projects', { headers: { 'X-Lumen-Client': namespace() } });
    expect(shared.status()).toBe(200);
    expect(shared.headers()['x-ratelimit-limit']).toBe(generous);
  });
});

/* 2. Serialized ACID store under concurrent load */

test.describe('mutex-serialized store under concurrent load', () => {
  test('30 concurrent project saves and 30 concurrent quotes hold the 12 and 24 caps exactly', async ({ cloud }, testInfo) => {
    const file = testInfo.outputPath('race', 'lumen-cloud.json');
    const app = await cloud({ file, rateLimit: false });
    const session = await call(app.origin, '/api/auth/session', { method: 'POST', body: CREDENTIALS });
    expect(session.status).toBe(201);
    const auth = { Authorization: `Bearer ${session.json().token}` };

    const [saved, submitted] = await Promise.all([
      Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          call(app.origin, '/api/projects', { method: 'POST', headers: auth, body: { kind: 'wall', name: `Race Wall ${i + 1}`, data: WALL } }),
        ),
      ),
      Promise.all(Array.from({ length: 30 }, () => call(app.origin, '/api/quotes', { method: 'POST', headers: auth, body: QUOTE_BODY }))),
    ]);

    expect([...saved, ...submitted].filter((response) => response.status >= 500)).toEqual([]);
    expect(saved.filter((response) => response.status === 201)).toHaveLength(MAX_STORED_PROJECTS);
    const refused = saved.filter((response) => response.status === 409);
    expect(refused).toHaveLength(30 - MAX_STORED_PROJECTS);
    expect(new Set(refused.map((response) => response.json().error.code))).toEqual(new Set(['quota']));
    expect(submitted.every((response) => response.status === 201)).toBe(true);
    expect(new Set(submitted.map((response) => response.json().quote.ref)).size).toBe(30);

    const projects = (await call(app.origin, '/api/projects', { headers: auth })).json().projects;
    const quotes = (await call(app.origin, '/api/quotes', { headers: auth })).json().quotes;
    expect(projects).toHaveLength(MAX_STORED_PROJECTS);
    expect(quotes).toHaveLength(MAX_STORED_QUOTES);

    // On disk: one complete JSON document, no temp file left behind, and a fresh process revives the same library.
    const account = accountNamespace(CREDENTIALS.email);
    const snapshot = JSON.parse(readFileSync(file, 'utf8'));
    expect(snapshot).toMatchObject({ format: 'lumen.cloud', version: 1 });
    expect(snapshot.namespaces[account].projects).toHaveLength(MAX_STORED_PROJECTS);
    expect(snapshot.namespaces[account].quotes).toHaveLength(MAX_STORED_QUOTES);
    expect(readdirSync(dirname(file)).filter((name) => name !== 'lumen-cloud.json')).toEqual([]);
    const revived = createStore({ file }).read(account);
    expect(revived.projects.map((project) => project.id).sort()).toEqual(projects.map((project) => project.id).sort());
    expect(revived.quotes.map((quote) => quote.ref)).toEqual(quotes.map((quote) => quote.ref));
  });

  test('50 concurrent transactions and claims serialize with no lost update, and a full queue answers 503 busy', async ({ cloud }, testInfo) => {
    const store = createStore({ file: testInfo.outputPath('serial', 'lumen-cloud.json') });
    const record = (i) =>
      serializeProjectRecord({
        id: projectIdFor('wall', `Serial ${i}`),
        kind: 'wall',
        name: `Serial ${i}`,
        revision: 1,
        savedAt: new Date(Date.UTC(2026, 10, 13, 9, 0, i)).toISOString(),
        data: WALL_DATA,
      });

    // Every transaction sees its predecessor's commit: lengths 1 to 12 in arrival order, then 38 quota refusals.
    const library = namespace();
    const outcomes = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        store.transact(library, (draft) => {
          if (draft.projects.length >= MAX_STORED_PROJECTS) throw Object.assign(new Error('quota'), { code: 'quota' });
          draft.projects = [record(i), ...draft.projects];
          return draft.projects.length;
        }),
      ),
    );
    expect(outcomes.slice(0, MAX_STORED_PROJECTS).map((outcome) => outcome.value)).toEqual(Array.from({ length: MAX_STORED_PROJECTS }, (_, i) => i + 1));
    expect(outcomes.slice(MAX_STORED_PROJECTS).every((outcome) => outcome.status === 'rejected' && outcome.reason.code === 'quota')).toBe(true);
    expect(store.read(library).projects).toHaveLength(MAX_STORED_PROJECTS);

    // 20 guest libraries are claimed into one account while 20 writes land on it: nothing is lost either way.
    const account = accountNamespace('claims@lumen.com');
    const guests = Array.from({ length: 20 }, () => namespace());
    for (const [g, guest] of guests.entries()) {
      await store.transact(guest, (draft) => {
        draft.projects = [record(100 + g)];
      });
    }
    const moveAll = (into, from) => {
      into.projects = [...from.projects, ...into.projects];
      from.projects = [];
      return { changed: true };
    };
    await Promise.all(
      guests.flatMap((guest, g) => [
        store.claim(guest, account, moveAll),
        store.transact(account, (draft) => {
          draft.projects = [record(200 + g), ...draft.projects];
        }),
      ]),
    );
    expect(store.read(account).projects).toHaveLength(40);
    expect(guests.every((guest) => store.read(guest).projects.length === 0)).toBe(true);

    // A mutator that returns a promise is refused before it can commit a half-built draft.
    await expect(
      store.transact(library, async (draft) => {
        draft.projects = [];
      }),
    ).rejects.toThrow(/synchronous/);
    expect(store.read(library).projects).toHaveLength(MAX_STORED_PROJECTS);

    // FIFO even when a critical section yields: no section starts before the previous one ends.
    const mutex = createMutex();
    const order = [];
    await Promise.all(
      [3, 1, 2].map((yields, i) =>
        mutex.run(async () => {
          order.push(`start ${i}`);
          for (let k = 0; k < yields; k += 1) await null;
          order.push(`end ${i}`);
        }),
      ),
    );
    expect(order).toEqual(['start 0', 'end 0', 'start 1', 'end 1', 'start 2', 'end 2']);

    // Backpressure: past maxPendingWrites a write is refused at once instead of queueing without bound.
    const tight = createStore({ file: null, maxPendingWrites: 8 });
    const flood = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        tight.transact('redteam-busy-0123456789', (draft) => {
          draft.projects = [...draft.projects, i];
        }),
      ),
    );
    expect(flood.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(8);
    expect(flood.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason.code)).toEqual(Array(12).fill('LUMEN_BUSY'));
    await tight.flush();
    expect(tight.pendingWrites).toBe(0);
    await expect(tight.transact('redteam-busy-0123456789', () => 'accepted again')).resolves.toBe('accepted again');

    // Over HTTP a full queue is 503 busy with Retry-After, never a 500.
    const full = createStore({ file: null });
    const busyStore = { ...full, transact: () => Promise.reject(Object.assign(new Error('queue full'), { code: 'LUMEN_BUSY' })) };
    const app = await cloud({ store: busyStore, rateLimit: false });
    const busy = await call(app.origin, '/api/projects', { method: 'POST', headers: { 'X-Lumen-Client': namespace() }, body: { kind: 'wall', name: 'Busy', data: WALL } });
    expect(busy.status).toBe(503);
    expect(busy.headers.get('retry-after')).toBe('1');
    expect(busy.json().error.code).toBe('busy');
  });
});

/* 3. MCP JSON-RPC 2.0 and SSE adversarial fuzzing */

test.describe('MCP JSON-RPC and SSE stream fuzzing', () => {
  test('oversized batches, deep nesting, prototype keys and non-finite numbers are refused cleanly', async ({ request }) => {
    const raw = (text, headers = {}) => request.post('/api/mcp', { headers: { 'Content-Type': 'application/json', ...headers }, data: Buffer.from(text) });

    const batch = await raw(JSON.stringify(Array.from({ length: 50 }, (_, i) => rpc('ping', undefined, i + 1))));
    expect(batch.status()).toBe(400);
    expect(await batch.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: expect.stringContaining('batches are not supported') } });

    const nested = (levels) => `{"jsonrpc":"2.0","id":5,"method":"ping","params":${'{"a":'.repeat(levels)}1${'}'.repeat(levels)}}`;
    const deep = await raw(nested(MCP_MAX_DEPTH));
    expect(deep.status()).toBe(400);
    expect(await deep.json()).toEqual({ jsonrpc: '2.0', id: 5, error: { code: -32600, message: `Invalid Request: the message nests deeper than ${MCP_MAX_DEPTH} levels.` } });
    const atLimit = await raw(nested(MCP_MAX_DEPTH - 1));
    expect(atLimit.status()).toBe(200);
    expect(await atLimit.json()).toEqual({ jsonrpc: '2.0', id: 5, result: {} });

    // Prototype keys are dropped at the boundary: a forged jsonrpc field never reaches the validator, nor the prototype.
    const forged = await raw('{"__proto__":{"jsonrpc":"2.0"},"id":6,"method":"ping"}');
    expect((await forged.json()).error.code).toBe(-32600);
    expect((await (await raw('{"id":7,"method":"ping"}')).json()).error.code).toBe(-32600);
    const polluted = await raw(
      '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"inspect_workspace","arguments":{"__proto__":{"admin":true},"constructor":{"prototype":{"target":"wall"}},"target":"cart"}}}',
    );
    const pollutedBody = await polluted.json();
    expect(pollutedBody.result.structuredContent.target).toBe('cart');
    expect(JSON.stringify(pollutedBody)).not.toContain('admin');

    // NaN is not JSON; 1e309 parses to Infinity and fails the finite-number check like every other bad coordinate.
    const nan = await raw('{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"mutate_3d_room","arguments":{"dimensions":{"widthCm":NaN}}}}');
    expect(nan.status()).toBe(400);
    expect((await nan.json()).error.code).toBe(-32700);
    const infinite = await raw('{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"mutate_3d_room","arguments":{"mount":{"productId":"floating-shelf-110","xCm":1e309}}}}');
    expect(await infinite.json()).toEqual({ jsonrpc: '2.0', id: 10, error: { code: -32602, message: 'arguments.mount.xCm must be a number.' } });
    for (const [name, args] of [
      ['mutate_3d_room', { dimensions: { widthCm: -1e9 } }],
      ['mutate_3d_room', { dimensions: { depthCm: 1e9 } }],
      ['mutate_3d_room', { mount: { productId: 'floating-shelf-110', xCm: -1 } }],
      ['mutate_3d_room', { mount: { productId: 'floating-shelf-110', yCm: 'NaN' } }],
      ['mutate_3d_room', { mount: { productId: 'floating-shelf-110', wall: 'ceiling' } }],
      ['mutate_3d_room', { mounts: [] }],
      ['mutate_3d_room', { scalePreset: '__proto__' }],
      ['mutate_3d_room', { removeUid: 'm1; drop' }],
      ['mutate_2d_wall', { dimensions: { heightCm: 0 } }],
      ['mutate_2d_wall', { mount: { productId: 'floating-shelf-110', dimPct: 101 } }],
      ['manage_cart_bag', { add: { productId: 'linear-lightbar-60', qty: -3 } }],
      ['manage_cart_bag', { add: { productId: 'constructor' } }],
      ['simulate_physics_and_bus', { source: 'modules', modules: Array.from({ length: 13 }, () => ({ productId: 'linear-lightbar-60' })) }],
      ['evaluate_room_physics', {}],
    ]) {
      const response = await request.post('/api/mcp', { data: rpc('tools/call', { name, arguments: args }, 11) });
      expect(response.status(), `${name} ${JSON.stringify(args)}`).toBe(200);
      expect((await response.json()).error.code, `${name} ${JSON.stringify(args)}`).toBe(-32602);
    }

    // A browser call from another origin is refused on both agent endpoints.
    const evil = { Origin: 'https://evil.example' };
    expect((await request.post('/api/mcp', { headers: evil, data: rpc('ping') })).status()).toBe(403);
    const evilStream = await request.post('/api/concierge/stream', { headers: evil, data: { question: 'Hello' } });
    expect(evilStream.status()).toBe(403);
    expect((await evilStream.json()).error.code).toBe('forbidden_origin');

    // In process: a fault inside a method answers -32603 and reaches the host's logger instead of throwing.
    const faults = [];
    const exploding = {
      get roomDraft() {
        throw new Error('workspace getter exploded');
      },
    };
    const internal = handleMcpRequest(rpc('tools/call', { name: 'inspect_workspace', arguments: {} }, 12), { workspace: exploding, onError: (error) => faults.push(error.message) });
    expect(internal).toEqual({ jsonrpc: '2.0', id: 12, error: { code: -32603, message: 'Internal error: the request could not be completed.' } });
    expect(faults).toEqual(['workspace getter exploded']);
    expect(exceedsDepth({ list: Array.from({ length: 10_000 }, () => [1]) })).toBe(false);
    expect(exceedsDepth(JSON.parse(`${'['.repeat(13)}${']'.repeat(13)}`))).toBe(true);
  });

  test('hostile prompts and corrupted workspace graphs never break the SSE stream', async ({ request }) => {
    const question = `${C(0)}${C(7)}${C(27)}[2J${C(0x202e)}evil${C(0x2066)}${C(0x85)}${C(0xd800)} Audit my live 3D room and RT60`;
    const response = await request.post('/api/concierge/stream', { data: { question, workspaceContext: { route: '/room-3d', roomDraft: serializeRoomState(ROOM) } } });
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(headers['x-accel-buffering']).toBe('no');
    expect(headers['cache-control'].split(/,\s*/)).toEqual(expect.arrayContaining(['no-cache', 'no-store', 'no-transform']));
    expect(headers['content-encoding']).toBeUndefined();
    const frames = parseSse(await response.text());
    expect(frames.at(-1).event).toBe('complete');
    const { reply } = frames.at(-1).data;
    expect(reply.question).toContain('Audit my live 3D room and RT60');
    expect(hostileUnits(reply.question)).toEqual([]);
    expect(hostileUnits(reply.answer, { allowNewlines: true })).toEqual([]);

    const room = serializeRoomState(ROOM);
    const corrupted = [
      { roomDraft: { ...room, items: 7 } },
      { roomDraft: { format: 'lumen.room3d', version: 1 } },
      { roomDraft: { ...room, items: [{ uid: 'm1', productId: '__proto__', wall: 'north', finish: 'oak', xCm: 0, yCm: 0 }] } },
      { wallDraft: { format: 'lumen.wall', version: 1, wall: WALL.wall } },
      { wallDraft: { ...WALL, items: 'zz' } },
      { bagItems: [null, 5, 'x'] },
      { bagItems: Array.from({ length: 65 }, () => ({ id: 'linear-lightbar-60', finish: 'obsidian', qty: 1 })) },
      { route: 'javascript:alert(1)' },
      { route: '//evil.example/steal' },
      { currency: 'BTC' },
      [],
      'graph',
    ];
    for (const workspaceContext of corrupted) {
      const refused = await request.post('/api/concierge/stream', { data: { question: 'Audit my room', workspaceContext } });
      const label = JSON.stringify(workspaceContext).slice(0, 80);
      expect(refused.status(), label).toBe(400);
      expect(refused.headers()['content-type'], label).toBe('application/json; charset=utf-8');
      expect((await refused.json()).error.code, label).toBe('invalid');
    }
    const tooDeep = await request.post('/api/concierge/stream', {
      headers: { 'Content-Type': 'application/json' },
      data: Buffer.from(`{"question":"Audit my room","workspaceContext":${'{"a":'.repeat(40)}1${'}'.repeat(40)}}`),
    });
    expect(tooDeep.status()).toBe(400);
    expect((await tooDeep.json()).error.code).toBe('invalid');
  });
});

/* 4. CAD exporter and share codec injection fuzzing */

test.describe('CAD exporter and share codec injection fuzzing', () => {
  test('DXF and OBJ exports keep hostile names out of the file structure', () => {
    const cleanDxf = dxfPairs(buildBlueprintDxf(compileBlueprintSheet(LAYOUT, { projectName: 'Clean Loft' })));
    const cleanObj = buildRoomObj(ROOM, 'Clean Room');
    for (const name of HOSTILE_NAMES) {
      const dxf = buildBlueprintDxf(compileBlueprintSheet(LAYOUT, { projectName: name }));
      expect(dxf.split('\r\n').every(isPrintableAscii), name).toBe(true);
      const pairs = dxfPairs(dxf);
      // A hostile name may change values, never structure: the group-code sequence is identical.
      expect(pairs.map(([code]) => code), name).toEqual(cleanDxf.map(([code]) => code));
      expect(pairs.filter(([code, value]) => code === 0 && value === 'SECTION')).toHaveLength(3);
      expect(pairs.filter(([code, value]) => code === 0 && value === 'EOF')).toEqual([[0, 'EOF']]);
      expect(pairs.at(-1)).toEqual([0, 'EOF']);
      expect(pairs.filter(([, value]) => value.includes('%%'))).toEqual([]);

      const obj = buildRoomObj(ROOM, name);
      const lines = obj.split('\n');
      expect(lines.length, name).toBe(cleanObj.split('\n').length);
      expect(countObjObjects(obj)).toBe(countObjObjects(cleanObj));
      const stray = lines.filter((line) => !isPrintableAscii(line) || !(line === '' || ['# ', 'o ', 'v ', 'vn ', 'f '].some((directive) => line.startsWith(directive))));
      expect(stray, name).toEqual([]);
      expect(lines.filter((line) => line.startsWith('# Project: '))).toHaveLength(1);
    }
    expect(dxfText('%%%%c%%%%d 100%%% ^J')).toBe('%c%d 100% ^ J');
    expect(dxfText(`Loft${C(13)}${C(10)}0${C(13)}${C(10)}EOF`)).toBe('Loft 0 EOF');
    expect(objToken('Room\nmtllib http://evil.tld/pwn.mtl')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('SVG blueprints escape markup and share links refuse tampered payloads', async ({ page }) => {
    for (const name of [...HOSTILE_NAMES, "' onload='alert(1)", '&lt;/title&gt;&#x3C;script&#x3E;', ']]><script>alert(1)</script>']) {
      const svg = buildBlueprintSvg(compileBlueprintSheet(LAYOUT, { projectName: name }));
      expect(hostileUnits(svg, { allowNewlines: true }), name).toEqual([]);
      const verdict = await page.evaluate((markup) => {
        const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
        const elements = [...doc.querySelectorAll('*')];
        return {
          parseError: doc.querySelector('parsererror') !== null,
          scripts: doc.querySelectorAll('script, foreignObject, iframe, img').length,
          handlers: elements.flatMap((element) => [...element.attributes].map((attribute) => attribute.name)).filter((attr) => attr.toLowerCase().startsWith('on')),
          title: doc.querySelector('title')?.textContent ?? '',
        };
      }, svg);
      expect(verdict, name).toMatchObject({ parseError: false, scripts: 0, handlers: [] });
      // The name survives as inert text, exactly as the sanitizer left it.
      expect(verdict.title.startsWith(`${cleanProjectName(name)} - `), name).toBe(true);
    }
    expect(escapeXml(`<a href="x">'&'</a>${C(0)}${C(0xfffe)}`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');

    // Share links: a hostile name decodes to one sanitized line; tampered payloads decode to nothing.
    const link = encodeSceneParam('wall', LAYOUT, `Loft\r\n0\r\nEOF ${C(0x202e)}`);
    expect(decodeSceneParam('wall', link).name).toBe('Loft 0 EOF');
    const b64 = (text) => Buffer.from(text, 'utf8').toString('base64url');
    const escaped = (ch) => `${C(92)}u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
    const escapedProto = `${escaped('_')}${escaped('_')}proto${escaped('_')}${escaped('_')}`;
    for (const tampered of [
      'A'.repeat(SCENE_MAX_LENGTH + 1),
      '***',
      'A',
      b64('{"__proto__":{"polluted":true},"v":1,"k":"w","w":[400,250,0,1,0],"i":[]}'),
      b64(`{"${escapedProto}":{"polluted":true},"v":1,"k":"w","w":[400,250,0,1,0],"i":[]}`),
      b64('{"constructor":{"prototype":{"polluted":true}},"v":1,"k":"w","w":[400,250,0,1,0],"i":[]}'),
      b64(`${'['.repeat(64)}${']'.repeat(64)}`),
      b64('{"v":1,"k":"w","w":[400,250,0,1,0],"i":[["flux-capacitor-9000",0,0,0,0]]}'),
      b64('{"v":1,"k":"r","w":[400,250,0,1,0],"i":[]}'),
    ]) {
      expect(decodeSceneParam('wall', tampered)).toBeNull();
    }
    expect({}.polluted).toBeUndefined();
  });
});

/* 5. Production HTTP: compression, cache policy, ETag 304, graceful shutdown and ReDoS immunity */

test.describe('production HTTP hardening', () => {
  test('API JSON negotiates Brotli and gzip above 1 KB, in isolation and in the shipped preview stack', async ({ cloud, request, baseURL }) => {
    const app = await cloud({ rateLimit: false });
    const ns = namespace();
    for (const name of ['North Elevation', 'South Elevation', 'Gallery Wall']) {
      const saved = await call(app.origin, '/api/projects', { method: 'POST', headers: { 'X-Lumen-Client': ns }, body: { kind: 'wall', name, data: WALL } });
      expect(saved.status).toBe(201);
    }
    const identity = await rawRequest(app.origin, '/api/projects', { headers: { 'X-Lumen-Client': ns } });
    expect(identity.headers['content-encoding']).toBeUndefined();
    expect(identity.headers.vary).toBe('Accept-Encoding');
    expect(identity.body.length).toBeGreaterThan(COMPRESSION_THRESHOLD_BYTES);
    const listing = JSON.parse(identity.body.toString('utf8'));
    expect(listing.projects).toHaveLength(3);

    for (const [accept, coding] of [
      ['br', 'br'],
      ['gzip', 'gzip'],
      ['gzip, deflate, br', 'br'],
      ['gzip;q=1, br;q=0.5', 'gzip'],
      ['br;q=0, gzip', 'gzip'],
      ['*', 'br'],
      ['identity', undefined],
      ['br;q=0, gzip;q=0', undefined],
    ]) {
      const res = await rawRequest(app.origin, '/api/projects', { headers: { 'X-Lumen-Client': ns, 'Accept-Encoding': accept } });
      expect(res.headers['content-encoding'], accept).toBe(coding);
      expect(res.headers.vary, accept).toBe('Accept-Encoding');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(Number(res.headers['content-length'])).toBe(res.body.length);
      const decoded = coding === 'br' ? brotliDecompressSync(res.body) : coding === 'gzip' ? gunzipSync(res.body) : res.body;
      expect(JSON.parse(decoded.toString('utf8'))).toEqual(listing);
      if (coding) expect(res.body.length).toBeLessThan(identity.body.length);
    }
    const small = await rawRequest(app.origin, '/api/health', { headers: { 'Accept-Encoding': 'br' } });
    expect(small.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(small.body.toString('utf8')).ok).toBe(true);
    expect([negotiateEncoding(undefined), negotiateEncoding(''), negotiateEncoding('deflate'), negotiateEncoding('x-gzip'), negotiateEncoding('br;q=abc, gzip;q=0.1')]).toEqual([
      null,
      null,
      null,
      'gzip',
      'gzip',
    ]);

    // The shipped stack: the same handler inside vite preview, ahead of Vite's own middlewares.
    const shipped = namespace();
    for (const name of ['North Elevation', 'South Elevation', 'Gallery Wall']) {
      const saved = await request.post('/api/projects', { headers: { 'X-Lumen-Client': shipped, 'Content-Type': 'application/json' }, data: JSON.stringify({ kind: 'wall', name, data: WALL }) });
      expect(saved.status()).toBe(201);
    }
    const viaPreview = await rawRequest(baseURL, '/api/projects', { headers: { 'X-Lumen-Client': shipped, 'Accept-Encoding': 'br' } });
    expect(viaPreview.headers['content-encoding']).toBe('br');
    expect(viaPreview.headers.vary).toBe('Accept-Encoding');
    expect(JSON.parse(brotliDecompressSync(viaPreview.body).toString('utf8')).projects).toHaveLength(3);
  });

  test('the production server serves immutable assets and revalidates the SPA shell with a strong ETag', async () => {
    expect(existsSync(join(DIST_DIR, 'index.html')), 'npm run build must run before the suite').toBe(true);
    const store = createStore({ file: null });
    const handler = createApp({ store, version: 'redteam', agent: AGENT, env: {}, logger: SILENT });
    const { server, shutdown } = createLumenServer({ cloud: { handler, store }, staticDir: DIST_DIR, logger: SILENT });
    const origin = await listen(server);
    try {
      const shell = await rawRequest(origin, '/', { headers: { 'Accept-Encoding': 'br' } });
      expect(shell.status).toBe(200);
      expect(shell.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(shell.headers['cache-control']).toBe('no-cache');
      expect(shell.headers['content-encoding']).toBe('br');
      expect(shell.headers.vary).toBe('Accept-Encoding');
      expect(shell.headers['x-content-type-options']).toBe('nosniff');
      expect(shell.headers['x-frame-options']).toBe('DENY');
      const etag = shell.headers.etag;
      expect(etag).toMatch(/^"[\w-]{27}-br"$/);
      const html = brotliDecompressSync(shell.body).toString('utf8');
      expect(html).toBe(readFileSync(join(DIST_DIR, 'index.html'), 'utf8'));

      const revalidated = await rawRequest(origin, '/', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': etag } });
      expect(revalidated.status).toBe(304);
      expect(revalidated.body.length).toBe(0);
      expect(revalidated.headers.etag).toBe(etag);
      expect(revalidated.headers['cache-control']).toBe('no-cache');
      expect((await rawRequest(origin, '/', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': `"stale", W/${etag}` } })).status).toBe(304);
      expect((await rawRequest(origin, '/', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': '"stale"' } })).status).toBe(200);
      // Each coding is its own representation with its own validator.
      const plainShell = await rawRequest(origin, '/');
      expect(plainShell.headers['content-encoding']).toBeUndefined();
      expect(plainShell.headers.etag).toBe(etag.replace(/-br"$/, '"'));
      expect((await rawRequest(origin, '/', { headers: { 'If-None-Match': etag } })).status).toBe(200);

      // Client routes get the same shell and validator; HEAD sends the headers alone.
      const route = await rawRequest(origin, '/room-3d', { headers: { 'Accept-Encoding': 'br' } });
      expect(route.status).toBe(200);
      expect(route.headers.etag).toBe(etag);
      expect(route.headers['cache-control']).toBe('no-cache');
      const head = await rawRequest(origin, '/catalog/linear-lightbar-60', { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.body.length).toBe(0);
      expect(head.headers.etag).toBe(plainShell.headers.etag);

      // Hashed bundles are immutable for a year.
      const scriptPath = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)[1];
      const asset = await rawRequest(origin, scriptPath, { headers: { 'Accept-Encoding': 'gzip' } });
      expect(asset.status).toBe(200);
      expect(asset.headers['cache-control']).toBe(IMMUTABLE_CACHE_CONTROL);
      expect(asset.headers['content-type']).toBe('text/javascript; charset=utf-8');
      expect(asset.headers['content-encoding']).toBe('gzip');
      expect(gunzipSync(asset.body).equals(readFileSync(join(DIST_DIR, scriptPath)))).toBe(true);
      const font = readdirSync(join(DIST_DIR, 'assets')).find((name) => name.endsWith('.woff2'));
      const fontResponse = await rawRequest(origin, `/assets/${font}`, { headers: { 'Accept-Encoding': 'br' } });
      expect(fontResponse.headers['content-type']).toBe('font/woff2');
      expect(fontResponse.headers['cache-control']).toBe(IMMUTABLE_CACHE_CONTROL);
      expect(fontResponse.headers['content-encoding']).toBeUndefined();

      // Missing assets and every traversal shape are a plain 404, never a file outside the build.
      for (const probe of [
        '/assets/RoomCanvas-00000000.js',
        '/missing.png',
        '/..%2f..%2fpackage.json',
        '/%2e%2e/%2e%2e/package.json',
        '/assets/..%5c..%5cpackage.json',
        '/.git/config',
        '/C:%2fWindows%2fwin.ini',
        '/index.html%00.js',
        '/%E0%A4%A',
      ]) {
        const res = await rawRequest(origin, probe);
        expect(res.status, probe).toBe(404);
        expect(res.headers['content-type'], probe).toBe('text/plain; charset=utf-8');
        expect(res.body.toString('utf8'), probe).not.toContain('"name"');
      }
      const post = await rawRequest(origin, '/', { method: 'POST' });
      expect(post.status).toBe(405);
      expect(post.headers.allow).toBe('GET, HEAD');

      // The API keeps its own no-store policy on the same origin.
      const health = await rawRequest(origin, '/api/health');
      expect(health.headers['cache-control']).toBe('no-store');
      expect(JSON.parse(health.body.toString('utf8'))).toEqual({ ok: true, version: 'redteam', storage: 'server' });

      expect(etagMatches('*', '"x"')).toBe(true);
      expect(etagMatches('W/"x"', '"x"')).toBe(true);
      expect(etagMatches('"y", "z"', '"x"')).toBe(false);
      expect(etagMatches(undefined, '"x"')).toBe(false);
      expect(resolveStaticPath(DIST_DIR, '/assets/../../package.json')).toBeNull();
      expect(resolveStaticPath(DIST_DIR, '/assets/index.js')).toBe(join(DIST_DIR, 'assets', 'index.js'));
      expect(resolveStaticPath(DIST_DIR, `/${'a/'.repeat(16)}`)).toBe(join(DIST_DIR, ...Array(16).fill('a')));
      expect(resolveStaticPath(DIST_DIR, `/${'a/'.repeat(17)}`)).toBeNull();
      expect(resolveStaticPath(DIST_DIR, `/${'a'.repeat(1024)}`)).toBeNull();
      expect((await rawRequest(origin, `/${'deep/'.repeat(40)}`)).status).toBe(404);
    } finally {
      await shutdown({ reason: 'test' });
    }
  });

  // eslint-disable-next-line no-empty-pattern
  test('graceful shutdown finishes the in-flight write, refuses new connections and exits 0', async ({}, testInfo) => {
    const dataFile = testInfo.outputPath('shutdown', 'lumen-cloud.json');
    const child = spawn(process.execPath, ['server/index.js'], {
      cwd: REPO_DIR,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '0',
        LUMEN_DATA_FILE: dataFile,
        LUMEN_STORAGE: '',
        LUMEN_STATIC_DIR: 'off',
        LUMEN_TEST_RESET: '',
        LUMEN_LLM_PROVIDER: 'deterministic',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '';
    const listeners = new Set();
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        output += chunk;
        for (const listener of listeners) listener();
      });
    }
    const closed = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
    // Readiness comes from the server's own log lines, never from a timer.
    const waitFor = (pattern) =>
      new Promise((resolve, reject) => {
        const check = () => {
          const match = pattern.exec(output);
          if (!match) return;
          listeners.delete(check);
          resolve(match);
        };
        listeners.add(check);
        closed.then(() => {
          listeners.delete(check);
          reject(new Error(`server exited before ${pattern}:\n${output}`));
        });
        check();
      });

    try {
      const [, port] = await waitFor(/on http:\/\/127\.0\.0\.1:(\d+) /);
      const origin = `http://127.0.0.1:${port}`;
      const ns = namespace();
      const payload = JSON.stringify({ kind: 'wall', name: 'Drained Wall', data: WALL });

      // Expect: 100-continue makes the server dispatch the request before any body byte is sent, so the
      // write is provably in flight when the signal lands.
      let finish;
      const continued = new Promise((resolve) => {
        finish = resolve;
      });
      const held = new Promise((resolve, reject) => {
        const req = httpRequest(
          `${origin}/api/projects`,
          {
            method: 'POST',
            agent: false,
            headers: { 'Content-Type': 'application/json', 'X-Lumen-Client': ns, 'Transfer-Encoding': 'chunked', Expect: '100-continue' },
          },
          (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, connection: res.headers.connection, body: Buffer.concat(chunks).toString('utf8') }));
          },
        );
        req.on('error', reject);
        req.on('continue', () => {
          req.write(payload.slice(0, 40));
          finish(() => req.end(payload.slice(40)));
        });
      });
      const complete = await continued;

      if (process.platform === 'win32') child.send('shutdown');
      else child.kill('SIGTERM');
      await waitFor(/draining 1 open request\(s\), refusing new connections/);
      const refused = await rawRequest(origin, '/api/health').then(
        (response) => `answered ${response.status}`,
        (error) => error.code,
      );
      expect(refused).toBe('ECONNREFUSED');

      complete();
      const response = await held;
      expect(response.status).toBe(201);
      expect(response.connection).toBe('close');
      expect(JSON.parse(response.body).project.name).toBe('Drained Wall');
      expect(await closed).toEqual({ code: 0, signal: null });
      expect(output).toContain('drained; every write is on disk');
      expect(JSON.parse(readFileSync(dataFile, 'utf8')).namespaces[ns].projects.map((project) => project.name)).toEqual(['Drained Wall']);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  });

  test('pathological 50 KB inputs stay linear in every validator and parser', async ({ cloud }) => {
    const size = 50 * 1024;
    const fill = (unit) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
    const cases = [
      ['sanitizeEmail local part', () => sanitizeEmail(`${fill('a')}@`)],
      ['sanitizeEmail dotted domain', () => sanitizeEmail(`a@${fill('a.')}!`)],
      ['sanitizeText whitespace', () => sanitizeText(fill(' \t'), { maxLength: size })],
      ['sanitizeText bidi and surrogates', () => sanitizeText(fill(`${C(0x202e)}${C(0xd800)}a`), { maxLength: size })],
      ['sanitizeMultilineText breaks', () => sanitizeMultilineText(fill('\n \n'), { maxLength: size })],
      ['safeJsonParse nesting', () => safeJsonParse(fill('['), { maxLength: size + 1 })],
      ['isProjectId segments', () => isProjectId(`wall${fill('-a')}!`)],
      ['sanitizeProjectName', () => sanitizeProjectName(fill('- '), 'wall')],
      ['dxfText percent and caret runs', () => dxfText(fill('%^'), size)],
      ['objToken', () => objToken(fill('_-'))],
      ['escapeXml', () => escapeXml(fill('<&"'))],
      ['negotiateEncoding q-value', () => negotiateEncoding(`br;q=0.${fill('9')}`)],
      ['negotiateEncoding list', () => negotiateEncoding(fill('gzip;q=0.5,'))],
      ['resolveClientAddress chain', () => resolveClientAddress({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': fill('203.0.113.7, ') } }, 8)],
      ['normalizeAddress', () => normalizeAddress(fill(':'))],
      ['etagMatches', () => etagMatches(fill('"a", '), '"b"')],
      ['resolveStaticPath', () => resolveStaticPath(DIST_DIR, `/${fill('a/')}`)],
      ['validateConciergeAsk', () => validateConciergeAsk({ question: fill('can t ') })],
      ['evaluateConciergeQuery at its cap', () => evaluateConciergeQuery(sanitizeQuestion(fill("what's the can't won't 3-d ")))],
      ['decodeSceneParam', () => decodeSceneParam('wall', fill('A'))],
      ['exceedsDepth wide', () => exceedsDepth({ list: Array.from({ length: size / 8 }, () => [1]) })],
    ];
    const slow = [];
    for (const [label, run] of cases) {
      // The best of five runs: a scheduler hiccup can slow one run, a super-linear pattern slows all of them.
      const samples = [];
      for (let i = 0; i < 5; i += 1) {
        const started = performance.now();
        run();
        samples.push(performance.now() - started);
      }
      const best = Math.min(...samples);
      if (best >= 50) slow.push(`${label}: ${best.toFixed(1)} ms`);
    }
    expect(slow).toEqual([]);

    // Over HTTP the same inputs are plain 400s.
    const app = await cloud({ rateLimit: false });
    const email = await call(app.origin, '/api/auth/session', { method: 'POST', body: { email: `a@${fill('a.')}!`, password: CREDENTIALS.password } });
    expect(email.status).toBe(400);
    expect(email.json().error.code).toBe('invalid');
    const ask = await call(app.origin, '/api/concierge/ask', { method: 'POST', body: { question: fill('can t ') } });
    expect(ask.status).toBe(400);
    expect(ask.json().error.message).toMatch(/question is limited/);
  });
});
