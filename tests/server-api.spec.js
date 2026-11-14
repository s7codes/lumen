import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DATA_FILE, E2E_SERVER_ENV, resolveListenAddress, resolveServerOptions, TEST_DATA_FILE } from '../server/config.js';
import {
  CLIENT_STORAGE_KEY,
  MAX_STORED_PROJECTS,
  PROJECTS_STORAGE_KEY,
  TRANSPORT_LABELS,
} from '../src/api/client.js';
import { SESSION_STORAGE_KEY, SESSION_TOKEN_STORAGE_KEY } from '../src/lib/auth.js';
import { buildQuote } from '../src/lib/quote.js';
import { createRoomState, importFromWallStudio, ROOM_STORAGE_KEY, serializeRoomState } from '../src/lib/room-3d.js';
import { layoutFromPreset, serializeLayout, WALL_STORAGE_KEY } from '../src/lib/wall-studio.js';
import { collectRuntimeErrors, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

// The same options the Playwright web server resolves: the isolated test store.
const SERVER = resolveServerOptions(new URL('../', import.meta.url), { ...process.env, ...E2E_SERVER_ENV });
const PROJECTS_KEY = `lumen:${PROJECTS_STORAGE_KEY}`;
const CLIENT_KEY = `lumen:${CLIENT_STORAGE_KEY}`;
const SESSION_KEY = `lumen:${SESSION_STORAGE_KEY}`;
const TOKEN_KEY = `lumen:${SESSION_TOKEN_STORAGE_KEY}`;
const WALL_KEY = `lumen:${WALL_STORAGE_KEY}`;
const BAG_KEY = 'lumen:lumen_bag_v1';
const GUEST = { name: 'Studio Guest', email: 'guest@lumen.com' };
// Test value for the local API under test; the server only length-checks it.
const TEST_PASSWORD = 'nordic-test-0042';
const WALL = serializeLayout(layoutFromPreset('nordic-reading-wall'));
// The planner the UI saves from: the default composition on the north wall.
const ROOM = serializeRoomState(importFromWallStudio(createRoomState()).state);
const ROOM_KEY = `lumen:${ROOM_STORAGE_KEY}`;
const BAG = [{ id: 'modular-cube-36', finish: 'oak', qty: 2 }];
const QUOTE_BODY = {
  quote: { currency: 'USD', promo: null, includeDriver: true, items: BAG },
  project: { reference: 'Nordic Residence - Living Wall', preparedFor: 'Studio Halvorsen Arkitekter' },
};

function namespace() {
  return `e2e-${randomUUID().replaceAll('-', '')}`;
}

/** Raw JSON client for one namespace: every body is sent exactly as given. */
function cloud(request, ns = namespace()) {
  const headers = { 'Content-Type': 'application/json', 'X-Lumen-Client': ns };
  const body = (data) => (typeof data === 'string' ? data : JSON.stringify(data));
  return {
    ns,
    get: (path) => request.get(path, { headers: { 'X-Lumen-Client': ns } }),
    post: (path, data, extra = {}) => request.post(path, { headers: { ...headers, ...extra }, data: body(data) }),
    put: (path, data) => request.put(path, { headers, data: body(data) }),
    delete: (path) => request.delete(path, { headers: { 'X-Lumen-Client': ns } }),
  };
}

async function expectError(response, status, code) {
  expect(response.status()).toBe(status);
  expect(response.headers()['content-type']).toBe('application/json; charset=utf-8');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  const payload = await response.json();
  expect(payload.error.code).toBe(code);
  expect(typeof payload.error.message).toBe('string');
  return payload.error;
}

async function expectAlive(request) {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
}

async function seed(page, entries) {
  await page.evaluate((pairs) => {
    for (const [key, value] of pairs) localStorage.setItem(key, value);
  }, entries);
}

function readJson(page, key) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);
}

function lastToast(page) {
  return page.getByTestId('toast-message').last();
}

function isApiCall(method, path) {
  return (request) => request.method() === method && new URL(request.url()).pathname === path;
}

async function readStore() {
  return JSON.parse(await readFile(SERVER.file, 'utf-8'));
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('lumen cloud http api', () => {
  test('health reports the release version from the same origin with hardened headers', async ({ request }) => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'));
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: pkg.version, storage: 'server' });
    expect(pkg.version).toBe('8.5.0');
    expect(SERVER.file.replaceAll('\\', '/').endsWith(TEST_DATA_FILE)).toBe(true);
    // The container contract: a store on the mounted volume, an explicit file winning over the
    // directory, every bind address from HOST and PORT, and loopback defaults everywhere else.
    const root = new URL('../', import.meta.url);
    const repo = fileURLToPath(root);
    const fileFor = (env) => resolveServerOptions(root, env).file;
    expect(fileFor({ LUMEN_DATA_DIR: '/data' })).toBe(resolve('/data', 'lumen-cloud.json'));
    expect(fileFor({ LUMEN_DATA_DIR: '/data', LUMEN_TEST_RESET: '1' })).toBe(resolve('/data', 'lumen-cloud.test.json'));
    expect(fileFor({ LUMEN_DATA_DIR: '/data', LUMEN_STORE_FILE: '/data/store.json' })).toBe(resolve('/data/store.json'));
    expect(fileFor({ LUMEN_DATA_DIR: '/data', LUMEN_DATA_FILE: 'server/.data/custom.json' })).toBe(resolve(repo, 'server/.data/custom.json'));
    expect(fileFor({ LUMEN_DATA_DIR: '/data', LUMEN_STORAGE: 'memory' })).toBeNull();
    expect(fileFor({})).toBe(resolve(repo, DEFAULT_DATA_FILE));
    // A shell that exports a store path never moves the E2E server off its test store.
    expect(fileFor({ LUMEN_DATA_DIR: '/data', LUMEN_STORE_FILE: '/data/store.json', ...E2E_SERVER_ENV })).toBe(resolve(repo, TEST_DATA_FILE));
    expect(resolveListenAddress({})).toEqual({ host: '127.0.0.1', port: 8787 });
    expect(resolveListenAddress({ HOST: '0.0.0.0', PORT: '4173' })).toEqual({ host: '0.0.0.0', port: 4173 });
    expect(resolveListenAddress({ HOST: ' ', PORT: '0' })).toEqual({ host: '127.0.0.1', port: 0 });
    for (const port of ['70000', '41 73', '-1', 'http']) expect(() => resolveListenAddress({ PORT: port }), port).toThrow(/PORT must be a TCP port/);
    const headers = response.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['content-type']).toBe('application/json; charset=utf-8');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['access-control-allow-origin']).toBeUndefined();
  });

  test('room save, account delete and checkout travel over /api and persist on the server', async ({ page, request }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await seed(page, [
      [SESSION_KEY, JSON.stringify(GUEST)],
      [ROOM_KEY, JSON.stringify(ROOM)],
      [BAG_KEY, JSON.stringify(BAG)],
    ]);

    await page.goto('/room-3d');
    const save = page.getByTestId('save-room-to-cloud');
    const [saveCall] = await Promise.all([page.waitForRequest(isApiCall('POST', '/api/projects')), save.click()]);
    const ns = saveCall.headers()['x-lumen-client'];
    expect(ns).toMatch(/^[a-f0-9]{32}$/);
    expect(ns).toBe(await readJson(page, CLIENT_KEY));
    expect(saveCall.postDataJSON()).toMatchObject({ kind: 'room', name: 'Room', data: { format: 'lumen.room3d' } });
    expect((await saveCall.response()).status()).toBe(201);
    await expect(save).toHaveAttribute('data-state', 'saved');
    await expect(lastToast(page)).toHaveText('Room saved to Lumen Cloud. Revision 01.');
    await expect(save).toHaveAttribute('data-state', 'idle', { timeout: 5000 });

    await page.getByTestId('project-name-input').fill('North Elevation');
    await save.click();
    await expect(lastToast(page)).toHaveText('North Elevation saved to Lumen Cloud. Revision 01.');

    const api = cloud(request, ns);
    const listed = await (await api.get('/api/projects')).json();
    expect(listed.projects.map((project) => [project.id, project.revision])).toEqual([
      ['room-north-elevation', 1],
      ['room', 1],
    ]);
    // The response is sent only after the atomic write, so the file already holds it.
    expect((await readStore()).namespaces[ns].projects).toHaveLength(2);

    await page.goto('/account');
    const fact = page.getByTestId('account-fact-transport');
    await expect(fact).toHaveText(TRANSPORT_LABELS.http);
    await expect(fact).toHaveAttribute('data-mode', 'http');
    await expect(page.getByTestId('account-fact-sync')).toHaveText('Up to date');
    const north = page.locator('[data-project-id="room-north-elevation"]');
    const [deleteCall] = await Promise.all([
      page.waitForRequest(isApiCall('DELETE', '/api/projects/room-north-elevation')),
      north.getByTestId('delete-saved-project').click(),
    ]);
    expect((await deleteCall.response()).status()).toBe(200);
    await expect(north).toHaveCount(0);
    await expect(lastToast(page)).toHaveText('North Elevation deleted from Lumen Cloud.');
    expect((await (await api.get('/api/projects')).json()).projects.map((project) => project.id)).toEqual(['room']);
    expect((await readJson(page, PROJECTS_KEY)).map((project) => project.id)).toEqual(['room']);

    await page.goto('/checkout');
    await page.getByTestId('project-reference').fill(QUOTE_BODY.project.reference);
    await page.getByTestId('project-client').fill(QUOTE_BODY.project.preparedFor);
    const [quoteCall] = await Promise.all([
      page.waitForRequest(isApiCall('POST', '/api/quotes')),
      page.getByTestId('submit-requisition').click(),
    ]);
    const sent = quoteCall.postDataJSON();
    expect(sent.quote).toMatchObject({ currency: 'USD', promo: null, includeDriver: true, items: BAG });
    expect(sent.quote.grossMinor).toBe(buildQuote({ items: BAG, currencyCode: 'USD' }).totals.gross);
    expect((await quoteCall.response()).status()).toBe(201);
    await expect(page.getByTestId('requisition-confirmed')).toBeVisible();
    const ref = await page.getByTestId('requisition-ref').textContent();
    expect(ref).toMatch(/^LMN-R-[0-9A-F]{8}$/);

    const quotes = (await (await api.get('/api/quotes')).json()).quotes;
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ ref, reference: QUOTE_BODY.project.reference, status: 'Pending review' });
    expect(quotes[0].origin).toBeUndefined();
    expect((await readStore()).namespaces[ns].quotes[0]).toMatchObject({ ref, origin: 'api' });

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('every browser profile is its own namespace and never sees another library', async ({ browser, request }) => {
    const profiles = await Promise.all([browser.newContext(), browser.newContext()]);
    const namespaces = [];
    for (const [i, context] of profiles.entries()) {
      const page = await context.newPage();
      await page.goto('/');
      await seed(page, [[ROOM_KEY, JSON.stringify(ROOM)]]);
      await page.goto('/room-3d');
      await page.getByTestId('project-name-input').fill(`Profile ${i + 1}`);
      const [call] = await Promise.all([
        page.waitForRequest(isApiCall('POST', '/api/projects')),
        page.getByTestId('save-room-to-cloud').click(),
      ]);
      namespaces.push(call.headers()['x-lumen-client']);
      await expect(page.getByTestId('save-room-to-cloud')).toHaveAttribute('data-state', 'saved');
    }
    expect(namespaces[0]).not.toBe(namespaces[1]);
    for (const [i, ns] of namespaces.entries()) {
      const { projects } = await (await cloud(request, ns).get('/api/projects')).json();
      expect(projects.map((project) => project.name)).toEqual([`Profile ${i + 1}`]);
    }
    await Promise.all(profiles.map((context) => context.close()));
  });
});

test.describe('lumen cloud api hardening', () => {
  test('oversized, mistyped, malformed and unscoped bodies get clean JSON errors', async ({ request, baseURL }) => {
    const api = cloud(request);
    const padding = 'x'.repeat(70 * 1024);
    await expectError(await api.post('/api/projects', { kind: 'wall', name: 'Big', data: WALL, padding }), 413, 'payload_too_large');
    await expectError(await api.post('/api/quotes', { ...QUOTE_BODY, padding }), 413, 'payload_too_large');

    // Chunked upload with no Content-Length: the cap applies while streaming.
    const chunked = await new Promise((resolve, reject) => {
      const req = httpRequest(new URL('/api/projects', baseURL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Lumen-Client': api.ns, 'Transfer-Encoding': 'chunked' },
      });
      req.on('response', (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on('error', reject);
      for (let i = 0; i < 18; i += 1) req.write(`${'y'.repeat(4096)}`);
      req.end();
    });
    expect(chunked).toEqual({ status: 413, body: { error: expect.objectContaining({ code: 'payload_too_large' }) } });

    await expectError(await api.post('/api/projects', '{"kind":"wall","data":'), 400, 'invalid');
    await expectError(await api.post('/api/projects', '[1,2,3]'), 400, 'invalid');
    await expectError(await api.post('/api/projects', ''), 400, 'invalid');
    await expectError(
      await api.post('/api/projects', JSON.stringify({ kind: 'wall', data: WALL }), { 'Content-Type': 'text/plain' }),
      415,
      'unsupported_media_type',
    );
    await expectError(
      await request.post('/api/projects', { headers: { 'Content-Type': 'application/json' }, data: '{}' }),
      400,
      'invalid',
    );
    await expectError(await request.get('/api/projects', { headers: { 'X-Lumen-Client': '../../etc' } }), 400, 'invalid');
    await expectError(await request.get('/api/does-not-exist'), 404, 'not_found');
    const wrongMethod = await request.patch('/api/projects', { headers: { 'X-Lumen-Client': api.ns } });
    await expectError(wrongMethod, 405, 'method_not_allowed');
    expect(wrongMethod.headers().allow).toBe('GET, POST, PUT');
    await expectError(await api.delete('/api/projects/__proto__'), 400, 'invalid');
    await expectError(await api.delete('/api/projects/%3Cimg%20src%3Dx%3E'), 400, 'invalid');
    await expectError(await api.delete('/api/projects/%E0%A4%A'), 400, 'invalid');
    await expectAlive(request);
  });

  test('prototype keys are stripped before validation and never reach the server prototype', async ({ request }) => {
    const api = cloud(request);
    const wall = JSON.stringify(WALL);
    await expectError(await api.post('/api/projects', `{"__proto__":{"kind":"wall","name":"Polluted","data":${wall}}}`), 400, 'invalid');
    await expectError(await api.post('/api/projects', '{"constructor":{"prototype":{"kind":"wall","data":{}}}}'), 400, 'invalid');
    await expectError(await api.post('/api/quotes', `{"__proto__":${JSON.stringify(QUOTE_BODY)}}`), 400, 'invalid');

    const saved = await api.post(
      '/api/projects',
      `{"kind":"wall","name":"Clean","data":${wall},"__proto__":{"polluted":"yes","kind":"room"},"constructor":{"prototype":{"polluted":"yes"}}}`,
    );
    expect(saved.status()).toBe(201);
    const { project } = await saved.json();
    expect(project).toMatchObject({ id: 'wall-clean', kind: 'wall' });
    expect(JSON.stringify(project)).not.toContain('polluted');

    // Had either payload polluted Object.prototype, a body without kind would now pass.
    await expectError(await api.post('/api/projects', JSON.stringify({ name: 'No kind', data: WALL })), 400, 'invalid');
    await expectError(await cloud(request).post('/api/projects', '{}'), 400, 'invalid');
    await expectAlive(request);
  });

  test('unknown products, stale prices and a 13th project are refused without side effects', async ({ request }) => {
    const api = cloud(request);
    const forged = { ...WALL, items: [{ ...WALL.items[0], productId: 'flux-capacitor-9000' }, ...WALL.items.slice(1)] };
    const projectError = await expectError(await api.post('/api/projects', { kind: 'wall', name: 'Forged', data: forged }), 400, 'invalid');
    expect(projectError.message).toContain('unknown modules');
    await expectError(await api.post('/api/projects', { kind: 'wall', data: { ...WALL, items: [] } }), 400, 'invalid');
    await expectError(await api.post('/api/projects', { kind: 'garage', data: WALL }), 400, 'invalid');

    const forgedQuote = { ...QUOTE_BODY, quote: { ...QUOTE_BODY.quote, items: [{ id: 'flux-capacitor-9000', finish: 'oak', qty: 1 }] } };
    await expectError(await api.post('/api/quotes', forgedQuote), 400, 'invalid');
    const badQty = { ...QUOTE_BODY, quote: { ...QUOTE_BODY.quote, items: [{ ...BAG[0], qty: 1000 }] } };
    await expectError(await api.post('/api/quotes', badQty), 400, 'invalid');
    await expectError(await api.post('/api/quotes', { ...QUOTE_BODY, project: { reference: 'x', preparedFor: '' } }), 400, 'invalid');
    await expectError(await api.post('/api/quotes', { ...QUOTE_BODY, quote: { ...QUOTE_BODY.quote, promo: 'FREE100' } }), 400, 'invalid');
    await expectError(await api.post('/api/quotes', { ...QUOTE_BODY, quote: { ...QUOTE_BODY.quote, grossMinor: 1 } }), 409, 'stale');
    expect((await (await api.get('/api/quotes')).json()).quotes).toEqual([]);

    const priced = await api.post('/api/quotes', { ...QUOTE_BODY, quote: { ...QUOTE_BODY.quote, promo: 'trade15' } });
    expect(priced.status()).toBe(201);
    const expected = buildQuote({ items: BAG, currencyCode: 'USD', promo: { code: 'TRADE15', pct: 15 } });
    expect((await priced.json()).quote).toMatchObject({ grossMinor: expected.totals.gross, lines: expected.lines.length });

    for (let i = 1; i <= MAX_STORED_PROJECTS; i += 1) {
      const response = await api.put('/api/projects', { kind: 'wall', name: `Plan ${i}`, data: WALL });
      expect(response.status()).toBe(201);
    }
    const overflow = await expectError(await api.post('/api/projects', { kind: 'wall', name: 'Plan 13', data: WALL }), 409, 'quota');
    expect(overflow.message).toBe(`Lumen Cloud holds ${MAX_STORED_PROJECTS} projects. Delete one from your account to save a new name.`);
    const revised = await api.post('/api/projects', { kind: 'wall', name: 'Plan 3', data: WALL });
    expect(revised.status()).toBe(200);
    expect((await revised.json()).project).toMatchObject({ id: 'wall-plan-3', revision: 2 });
    const { projects } = await (await api.get('/api/projects')).json();
    expect(projects).toHaveLength(MAX_STORED_PROJECTS);
    expect(projects[0].id).toBe('wall-plan-3');

    const removed = await (await api.delete('/api/projects/wall-plan-3')).json();
    expect(removed.projects).toHaveLength(MAX_STORED_PROJECTS - 1);
    expect((await api.delete('/api/projects/wall-plan-3')).status()).toBe(200);
    await expectAlive(request);
  });

  test('sync replaces device projects but never rewrites a server-issued requisition', async ({ request }) => {
    const api = cloud(request);
    const issued = (await (await api.post('/api/quotes', QUOTE_BODY)).json()).quote;
    const tampered = { ...issued, grossMinor: 1, reference: 'Rewritten on a device' };
    const imported = { ...issued, ref: 'LMN-R-0A1B2C3D', submittedAt: '2026-10-01T09:00:00.000Z' };
    const legacy = { kind: 'wall', revision: 3, savedAt: '2026-10-02T08:00:00.000Z', data: WALL };

    const synced = await (await api.post('/api/sync', { mode: 'replace', projects: [legacy, { kind: '__proto__' }], quotes: [tampered, imported] })).json();
    expect(synced.projects.map((project) => [project.id, project.name, project.revision])).toEqual([['wall', 'Wall A', 3]]);
    expect(synced.quotes.map((quote) => [quote.ref, quote.grossMinor])).toEqual([
      [issued.ref, issued.grossMinor],
      ['LMN-R-0A1B2C3D', issued.grossMinor],
    ]);
    await expectError(await api.post('/api/sync', { mode: 'overwrite', projects: [] }), 400, 'invalid');
    await expectError(await api.post('/api/sync', {}), 400, 'invalid');

    // The test-only reset endpoint clears exactly one namespace.
    expect(await (await api.post('/api/test/reset', {})).json()).toEqual({ ok: true, reset: true });
    expect((await (await api.get('/api/projects')).json()).projects).toEqual([]);
  });

  test('sessions are signed, verifiable and revoked on sign out', async ({ page, request }) => {
    const opened = await request.post('/api/auth/session', {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ email: '  Guest@Lumen.com ', password: TEST_PASSWORD }),
    });
    expect(opened.status()).toBe(201);
    const text = await opened.text();
    expect(text).not.toContain(TEST_PASSWORD);
    const session = JSON.parse(text);
    expect(session.user).toEqual(GUEST);
    expect(session.token).toMatch(/^lmn1\.[\w-]+\.[\w-]{43}$/);

    const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
    expect((await request.get('/api/auth/session', bearer(session.token))).status()).toBe(200);
    const forged = `${session.token.slice(0, -2)}${session.token.endsWith('AA') ? 'BB' : 'AA'}`;
    await expectError(await request.get('/api/auth/session', bearer(forged)), 401, 'unauthorized');
    const refused = await expectError(
      await request.post('/api/auth/session', { headers: { 'Content-Type': 'application/json' }, data: '{"email":"guest@lumen","password":"short"}' }),
      400,
      'invalid',
    );
    expect(Object.keys(refused.fields).sort()).toEqual(['email', 'password']);
    expect((await request.delete('/api/auth/session', bearer(session.token))).status()).toBe(204);
    await expectError(await request.get('/api/auth/session', bearer(session.token)), 401, 'unauthorized');

    // Through the UI: the modal opens a server session and Sign Out revokes it.
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await page.getByRole('banner').getByRole('button', { name: 'Sign In' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sign in' });
    await dialog.getByLabel('Email').fill(GUEST.email);
    await dialog.getByLabel('Password').fill(TEST_PASSWORD);
    const [signInCall] = await Promise.all([
      page.waitForRequest(isApiCall('POST', '/api/auth/session')),
      dialog.getByRole('button', { name: 'Sign In' }).click(),
    ]);
    expect((await signInCall.response()).status()).toBe(201);
    await expect(dialog).toBeHidden();
    expect(await readJson(page, SESSION_KEY)).toEqual(GUEST);
    const token = await readJson(page, TOKEN_KEY);
    expect((await request.get('/api/auth/session', bearer(token))).status()).toBe(200);

    await page.getByRole('banner').getByRole('link', { name: 'Account' }).click();
    const [signOutCall] = await Promise.all([
      page.waitForRequest(isApiCall('DELETE', '/api/auth/session')),
      page.getByTestId('sign-out').click(),
    ]);
    expect((await signOutCall.response()).status()).toBe(204);
    expect(await readJson(page, TOKEN_KEY)).toBeNull();
    await expectError(await request.get('/api/auth/session', bearer(token)), 401, 'unauthorized');
    expect(errors).toEqual([]);
  });
});

test.describe('offline fallback', () => {
  test('with /api unreachable, projects fall back to the device and sync once the API returns', async ({ page, request }) => {
    const errors = collectRuntimeErrors(page);
    const blocked = [];
    await page.route('**/api/**', (route) => {
      blocked.push(new URL(route.request().url()).pathname);
      return route.abort();
    });
    await page.goto('/');
    await seed(page, [
      [SESSION_KEY, JSON.stringify(GUEST)],
      [ROOM_KEY, JSON.stringify(ROOM)],
      [BAG_KEY, JSON.stringify(BAG)],
    ]);

    await page.goto('/room-3d');
    const save = page.getByTestId('save-room-to-cloud');
    await save.click();
    await expect(save).toHaveAttribute('data-state', 'saved');
    await expect(lastToast(page)).toHaveText(
      'Room saved on this device. Revision 01. Lumen Cloud syncs it when the API is reachable.',
    );
    expect(blocked).toContain('/api/projects');
    expect(await readJson(page, PROJECTS_KEY)).toHaveLength(1);

    await page.goto('/account');
    await expect(page.getByTestId('account-fact-transport')).toHaveText(TRANSPORT_LABELS.local);
    await expect(page.getByTestId('account-fact-sync')).toHaveText('Device copy');
    await expect(page.getByTestId('saved-project')).toHaveCount(1);

    await page.goto('/checkout');
    await page.getByTestId('project-reference').fill(QUOTE_BODY.project.reference);
    await page.getByTestId('project-client').fill(QUOTE_BODY.project.preparedFor);
    const submit = page.getByTestId('submit-requisition');
    await submit.click();
    await expect(lastToast(page)).toHaveText(
      'Lumen Cloud is unreachable, so the requisition was not submitted. The quote sheet is unchanged.',
    );
    await expect(submit).toBeEnabled();
    await expect(page.getByTestId('requisition-confirmed')).toHaveCount(0);

    // Back online: the first call pushes the device library before reading.
    await page.unroute('**/api/**');
    const ns = await readJson(page, CLIENT_KEY);
    const [syncCall] = await Promise.all([page.waitForRequest(isApiCall('POST', '/api/sync')), page.goto('/account')]);
    expect(syncCall.postDataJSON()).toMatchObject({ mode: 'replace', projects: [{ id: 'room', revision: 1 }] });
    await expect(page.getByTestId('account-fact-transport')).toHaveText(TRANSPORT_LABELS.http);
    await expect(page.getByTestId('account-fact-sync')).toHaveText('Up to date');
    const { projects } = await (await cloud(request, ns).get('/api/projects')).json();
    expect(projects.map((project) => project.id)).toEqual(['room']);

    // Aborted requests log a network line; nothing may surface as an uncaught error or rejection.
    expect(errors.filter((line) => !line.includes('Failed to load resource'))).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('a static host without the API degrades to device storage and a device-only session', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Lumen</title>' }),
    );
    await page.goto('/');
    await page.getByRole('banner').getByRole('button', { name: 'Sign In' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sign in' });
    await dialog.getByLabel('Email').fill(GUEST.email);
    await dialog.getByLabel('Password').fill(TEST_PASSWORD);
    await dialog.getByRole('button', { name: 'Sign In' }).click();
    await expect(dialog).toBeHidden();
    await expect(lastToast(page)).toHaveText('Signed in as guest@lumen.com on this device. Lumen Cloud is unreachable.');
    expect(await readJson(page, SESSION_KEY)).toEqual(GUEST);
    expect(await readJson(page, TOKEN_KEY)).toBeNull();

    await page.getByRole('banner').getByRole('link', { name: 'Account' }).click();
    await expect(page.getByTestId('account-fact-transport')).toHaveText(TRANSPORT_LABELS.local);
    await expect(page.getByTestId('saved-projects-empty')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
