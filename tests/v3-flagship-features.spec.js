import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { E2E_SERVER_ENV, resolveServerOptions } from '../server/config.js';
import { accountNamespace } from '../server/store.js';
import { CLIENT_STORAGE_KEY, LIBRARY_LABELS, PROJECTS_STORAGE_KEY } from '../src/api/client.js';
import { getProduct } from '../src/data/products.js';
import { SESSION_TOKEN_STORAGE_KEY } from '../src/lib/auth.js';
import { formatInt } from '../src/lib/format.js';
import { projectIdFor } from '../src/lib/project-library.js';
import { createRoomState } from '../src/lib/room-3d.js';
import { computeEnvironmentalPhysics, formatEnvironmentalPhysics } from '../src/lib/room-physics.js';
import { createLayout, DEFAULT_WALL, layoutFromPreset, serializeLayout, WALL_STORAGE_KEY } from '../src/lib/wall-studio.js';
import {
  collectRuntimeErrors,
  horizontalOverflow,
  installCspRecorder,
  readCspViolations,
} from './support/runtime-guards.js';

const SERVER = resolveServerOptions(new URL('../', import.meta.url), { ...process.env, ...E2E_SERVER_ENV });
const PROJECTS_KEY = `lumen:${PROJECTS_STORAGE_KEY}`;
const CLIENT_KEY = `lumen:${CLIENT_STORAGE_KEY}`;
const TOKEN_KEY = `lumen:${SESSION_TOKEN_STORAGE_KEY}`;
const WALL_KEY = `lumen:${WALL_STORAGE_KEY}`;
// Test value for the local API under test; the server only length-checks it.
const TEST_PASSWORD = 'nordic-test-0042';
const WALL = serializeLayout(layoutFromPreset('nordic-reading-wall'));
const FRAME = 'acoustic-art-frame-50x70';
const LIGHTBAR = 'linear-lightbar-60';
const SHELF = 'floating-shelf-110';

// Account libraries are keyed by address, so every test signs in as its own architect.
function uniqueEmail(tag) {
  return `${tag}-${randomUUID().slice(0, 8)}@lumen-e2e.com`;
}

function guestNamespace() {
  return `e2e-${randomUUID().replaceAll('-', '')}`;
}

async function seed(page, entries) {
  await page.evaluate((pairs) => {
    for (const [key, value] of pairs) localStorage.setItem(key, value);
  }, entries);
}

function readJson(page, key) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);
}

function isApiCall(method, path) {
  return (request) => request.method() === method && new URL(request.url()).pathname === path;
}

async function readStore() {
  return JSON.parse(await readFile(SERVER.file, 'utf-8'));
}

async function signIn(page, email) {
  await page.getByRole('banner').getByRole('button', { name: 'Sign In' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign in' });
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('Password').fill(TEST_PASSWORD);
  const [call] = await Promise.all([
    page.waitForRequest(isApiCall('POST', '/api/auth/session')),
    dialog.getByRole('button', { name: 'Sign In' }).click(),
  ]);
  expect((await call.response()).status()).toBe(201);
  await expect(dialog).toBeHidden();
  return call;
}

async function saveWall(page, name) {
  await page.goto('/studio-2d');
  await page.getByTestId('project-name-input').fill(name);
  const save = page.getByTestId('save-wall-to-cloud');
  const [call] = await Promise.all([page.waitForRequest(isApiCall('POST', '/api/projects')), save.click()]);
  expect((await call.response()).status()).toBe(201);
  await expect(save).toHaveAttribute('data-state', 'saved');
  return call;
}

async function openProfile(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await installCspRecorder(page);
  return { context, page, errors: collectRuntimeErrors(page) };
}

function mounted(productIds) {
  return productIds.map((productId, i) => ({
    uid: `m${i + 1}`,
    productId,
    finish: getProduct(productId).defaultFinish,
    xCm: 0,
    yCm: 0,
    led: getProduct(productId).watts > 0,
    locked: false,
  }));
}

async function readPhysics(page) {
  const cell = page.getByTestId('environmental-physics');
  return cell.evaluate((el) => ({
    lux: Number(el.dataset.lux),
    rt60: Number(el.dataset.rt60),
    delta: Number(el.dataset.delta),
    grade: el.dataset.grade,
  }));
}

/** Asserts the readout against the engine itself, then returns the parsed figures. */
async function expectPhysics(page, subject) {
  const physics = computeEnvironmentalPhysics(subject);
  const lines = formatEnvironmentalPhysics(physics, formatInt);
  const cell = page.getByTestId('environmental-physics');
  await expect(cell.getByTestId('physics-illuminance')).toHaveText(lines.illuminance);
  await expect(cell.getByTestId('physics-rt60')).toHaveText(lines.rt60);
  await expect(cell.getByTestId('physics-damping')).toHaveText(lines.damping);
  expect(await readPhysics(page)).toEqual({
    lux: physics.avgFloorLux,
    rt60: physics.rt60Sec,
    delta: physics.acousticDeltaSec,
    grade: physics.gradeId,
  });
  return physics;
}

async function mount(page, productId) {
  await page.getByRole('button', { name: `Mount ${getProduct(productId).name}`, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('session-bound cloud libraries', () => {
  test('a project saved on one browser profile opens on another signed in with the same address', async ({
    browser,
    request,
  }) => {
    const email = uniqueEmail('halvorsen');
    const a = await openProfile(browser);
    const b = await openProfile(browser);

    // Profile A signs in first, then saves: the save carries the session and lands in the account library.
    await a.page.goto('/');
    await seed(a.page, [[WALL_KEY, JSON.stringify(WALL)]]);
    await signIn(a.page, email);
    const tokenA = await readJson(a.page, TOKEN_KEY);
    expect(tokenA).toMatch(/^lmn1\.[\w-]+\.[\w-]{43}$/);
    const saveA = await saveWall(a.page, 'Halvorsen North Elevation');
    const clientA = saveA.headers()['x-lumen-client'];
    expect(clientA).toMatch(/^[a-f0-9]{32}$/);
    expect(saveA.headers().authorization).toBe(`Bearer ${tokenA}`);
    const north = projectIdFor('wall', 'Halvorsen North Elevation');
    // A's own browser-profile namespace stays empty: nothing was written there.
    const guestA = await request.get('/api/projects', { headers: { 'X-Lumen-Client': clientA } });
    expect((await guestA.json()).projects).toEqual([]);

    // Profile B: a different client id and empty storage. It sketches as a guest first.
    await b.page.goto('/');
    expect(await readJson(b.page, PROJECTS_KEY)).toBeNull();
    expect(await readJson(b.page, TOKEN_KEY)).toBeNull();
    await seed(b.page, [[WALL_KEY, JSON.stringify(WALL)]]);
    const guestSave = await saveWall(b.page, 'Guest Sketch');
    expect(guestSave.headers().authorization).toBeUndefined();
    const clientB = guestSave.headers()['x-lumen-client'];
    expect(clientB).not.toBe(clientA);
    expect(await readJson(b.page, CLIENT_KEY)).toBe(clientB);

    // Signing in claims the guest sketch into the account library.
    await b.page.goto('/');
    const sessionCall = await signIn(b.page, email);
    expect(sessionCall.headers()['x-lumen-client']).toBe(clientB);
    expect(sessionCall.headers().authorization).toBeUndefined();
    expect((await (await sessionCall.response()).json()).library).toEqual({
      scope: 'account',
      claimed: { projects: 1, quotes: 0 },
    });
    await expect(b.page.getByTestId('toast-message').last()).toHaveText(
      `Signed in as ${email}. 1 project from this browser moved into your account library.`,
    );

    const [listCall] = await Promise.all([
      b.page.waitForRequest(isApiCall('GET', '/api/projects')),
      b.page.getByRole('banner').getByRole('link', { name: 'Account' }).click(),
    ]);
    expect(listCall.headers()['x-lumen-client']).toBe(clientB);
    expect(listCall.headers().authorization).toMatch(/^Bearer lmn1\./);
    const cardsB = b.page.getByTestId('saved-project');
    await expect(cardsB).toHaveCount(2);
    await expect(b.page.locator(`[data-project-id="${north}"]`).getByRole('heading', { level: 3 })).toHaveText(
      'Halvorsen North Elevation',
    );
    await expect(b.page.getByTestId('account-fact-library')).toHaveText(LIBRARY_LABELS.account);
    await expect(b.page.getByTestId('account-fact-library')).toHaveAttribute('data-scope', 'account');
    await expect(b.page.getByTestId('account-fact-sync')).toHaveText('Up to date');
    expect((await readJson(b.page, PROJECTS_KEY)).map((project) => project.id).sort()).toEqual(
      [north, projectIdFor('wall', 'Guest Sketch')].sort(),
    );

    // The account record is on disk; B's guest namespace was emptied by the claim.
    const stored = (await readStore()).namespaces[accountNamespace(email)];
    expect(stored.projects.map((project) => project.name).sort()).toEqual(['Guest Sketch', 'Halvorsen North Elevation']);
    expect((await readStore()).namespaces[clientB]).toBeUndefined();

    // And the sketch made on B reaches A on its next read.
    await a.page.goto('/account');
    await expect(a.page.getByTestId('saved-project')).toHaveCount(2);
    await expect(a.page.locator(`[data-project-id="${projectIdFor('wall', 'Guest Sketch')}"]`)).toBeVisible();

    // Signing out of B drops the session; the account library stays on the server.
    await b.page.getByTestId('sign-out').click();
    await expect(b.page.getByTestId('toast-message').last()).toHaveText(
      'Signed out. Your projects stay in your Lumen Cloud account.',
    );
    expect(await readJson(b.page, TOKEN_KEY)).toBeNull();
    expect((await readStore()).namespaces[accountNamespace(email)].projects).toHaveLength(2);

    for (const profile of [a, b]) {
      expect(profile.errors).toEqual([]);
      expect(await readCspViolations(profile.page)).toEqual([]);
      await profile.context.close();
    }
  });

  test('account libraries answer only to a verified session and never to a spoofed client id', async ({ request }) => {
    const email = uniqueEmail('spoof');
    const guest = guestNamespace();
    const json = { 'Content-Type': 'application/json' };
    const saved = await request.post('/api/projects', {
      headers: { ...json, 'X-Lumen-Client': guest },
      data: JSON.stringify({ kind: 'wall', name: 'Plan Before Sign In', data: WALL }),
    });
    expect(saved.status()).toBe(201);

    const opened = await request.post('/api/auth/session', {
      headers: { ...json, 'X-Lumen-Client': guest },
      data: JSON.stringify({ email, password: TEST_PASSWORD }),
    });
    expect(opened.status()).toBe(201);
    const { token, library } = await opened.json();
    expect(library).toEqual({ scope: 'account', claimed: { projects: 1, quotes: 0 } });
    const bearer = { Authorization: `Bearer ${token}` };

    const own = await request.get('/api/projects', { headers: { ...bearer, 'X-Lumen-Client': guestNamespace() } });
    expect((await own.json()).projects.map((project) => project.name)).toEqual(['Plan Before Sign In']);
    expect((await (await request.get('/api/projects', { headers: { 'X-Lumen-Client': guest } })).json()).projects).toEqual([]);

    // The account namespace id is derivable from the address, so it is reserved for sessions.
    const spoofed = await request.get('/api/projects', { headers: { 'X-Lumen-Client': accountNamespace(email) } });
    expect(spoofed.status()).toBe(400);
    expect((await spoofed.json()).error.code).toBe('invalid');

    const forged = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
    const refused = await request.get('/api/projects', { headers: { Authorization: `Bearer ${forged}`, 'X-Lumen-Client': guest } });
    expect(refused.status()).toBe(401);
    expect((await refused.json()).error.code).toBe('unauthorized');

    // Another auth scheme (a staging proxy's Basic auth) leaves the request anonymous.
    const basic = await request.get('/api/projects', {
      headers: { Authorization: 'Basic c3RhZ2luZzpzdGFnaW5n', 'X-Lumen-Client': guest },
    });
    expect(basic.status()).toBe(200);
    expect((await basic.json()).projects).toEqual([]);

    expect((await request.delete('/api/auth/session', { headers: bearer })).status()).toBe(204);
    expect((await request.get('/api/projects', { headers: { ...bearer, 'X-Lumen-Client': guest } })).status()).toBe(401);
  });

  test('a session the server no longer honours drops back to the browser-profile library', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await seed(page, [[WALL_KEY, JSON.stringify(WALL)]]);
    await signIn(page, uniqueEmail('expired'));
    const token = await readJson(page, TOKEN_KEY);
    await page.request.delete('/api/auth/session', { headers: { Authorization: `Bearer ${token}` } });

    // The first save is refused for the revoked token, drops it, and lands in the profile library.
    await page.goto('/studio-2d');
    const save = page.getByTestId('save-wall-to-cloud');
    await save.click();
    await expect(save).toHaveAttribute('data-state', 'saved');
    expect(await readJson(page, TOKEN_KEY)).toBeNull();
    await page.goto('/account');
    await expect(page.getByTestId('account-fact-library')).toHaveText(LIBRARY_LABELS.device);
    await expect(page.getByTestId('saved-project')).toHaveCount(1);
    // The refused call logs a 401 resource line; nothing else may surface.
    expect(errors.filter((line) => !line.includes('401'))).toEqual([]);
  });
});

test.describe('environmental physics', () => {
  test('wall studio: RT60 falls and illuminance rises deterministically as frames and luminous modules mount', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/studio-2d');
    const cell = page.getByTestId('environmental-physics');
    await expect(cell.locator('dt')).toHaveText('Acoustics & Illuminance');

    // An empty 300 x 250 cm wall over a 260 cm reference zone: bare-surface Sabine only.
    const bare = await expectPhysics(page, createLayout(DEFAULT_WALL, []));
    await expect(cell.getByTestId('physics-illuminance')).toHaveText('Illuminance: 0 lx (Ambient Lounge)');
    await expect(cell.getByTestId('physics-rt60')).toHaveText('RT60: 1.56 s');
    await expect(cell.getByTestId('physics-damping')).toHaveText('No added absorption');

    await mount(page, FRAME);
    const framed = await expectPhysics(page, createLayout(DEFAULT_WALL, mounted([FRAME])));
    await expect(cell.getByTestId('physics-rt60')).toHaveText('RT60: 1.44 s');
    await expect(cell.getByTestId('physics-damping')).toHaveText('-0.12 s damping');
    expect(framed.rt60Sec).toBeLessThan(bare.rt60Sec);
    expect(framed.avgFloorLux).toBeGreaterThan(bare.avgFloorLux);

    await mount(page, LIGHTBAR);
    const lit = await expectPhysics(page, createLayout(DEFAULT_WALL, mounted([FRAME, LIGHTBAR])));
    await expect(cell.getByTestId('physics-illuminance')).toHaveText('Illuminance: 89 lx (Ambient Lounge)');
    expect(lit.avgFloorLux).toBeGreaterThan(framed.avgFloorLux);
    // Aluminium absorbs almost exactly like the painted wall it covers.
    expect(lit.rt60Sec).toBe(framed.rt60Sec);

    await mount(page, FRAME);
    const damped = await expectPhysics(page, createLayout(DEFAULT_WALL, mounted([FRAME, LIGHTBAR, FRAME])));
    await expect(cell.getByTestId('physics-rt60')).toHaveText('RT60: 1.34 s');
    expect(damped.rt60Sec).toBeLessThan(lit.rt60Sec);
    expect(damped.avgFloorLux).toBeGreaterThan(lit.avgFloorLux);

    await mount(page, SHELF);
    await mount(page, SHELF);
    const task = await expectPhysics(page, createLayout(DEFAULT_WALL, mounted([FRAME, LIGHTBAR, FRAME, SHELF, SHELF])));
    expect(task.avgFloorLux).toBeGreaterThan(250);
    await expect(cell.getByTestId('physics-illuminance')).toContainText('(Studio Task)');
    await expect(cell).toHaveAttribute('data-grade', 'task');

    // The derivation is technical detail: hidden in Architectural mode, shown in Technical.
    await expect(cell.getByTestId('physics-detail')).toBeHidden();
    await page.getByRole('group', { name: 'Display mode' }).getByRole('button', { name: 'Technical' }).click();
    await expect(cell.getByTestId('physics-detail')).toBeVisible();
    await expect(cell.getByTestId('physics-detail')).toContainText(`m2 sabins`);

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await horizontalOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
    }
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('room planner: the same engine reads room volume, daylight reflectance and the reference sofa', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/room-3d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    const cell = page.getByTestId('room-summary').getByTestId('environmental-physics');

    const bare = await expectPhysics(page, createRoomState());
    await expect(cell.getByTestId('physics-rt60')).toHaveText('RT60: 1.61 s');

    await mount(page, FRAME);
    const framed = await expectPhysics(page, createRoomState(undefined, mounted([FRAME])));
    await expect(cell.getByTestId('physics-rt60')).toHaveText('RT60: 1.49 s');
    await expect(cell.getByTestId('physics-damping')).toHaveText('-0.12 s damping');
    expect(framed.rt60Sec).toBeLessThan(bare.rt60Sec);

    await mount(page, LIGHTBAR);
    const night = await expectPhysics(page, createRoomState(undefined, mounted([FRAME, LIGHTBAR])));
    expect(night.avgFloorLux).toBeGreaterThan(framed.avgFloorLux);

    // Daylight walls reflect more: more lux from the same flux, same reverberation.
    await page.getByRole('radio', { name: 'Daylight Studio' }).check();
    const daylight = await expectPhysics(
      page,
      createRoomState({ ...createRoomState().room, lighting: 'daylight' }, mounted([FRAME, LIGHTBAR])),
    );
    expect(daylight.avgFloorLux).toBeGreaterThan(night.avgFloorLux);
    expect(daylight.rt60Sec).toBe(night.rt60Sec);

    // The upholstered sofa is part of the room baseline, not module damping.
    await page.getByRole('radio', { name: 'Modular Sofa 200cm' }).check();
    const furnished = await expectPhysics(
      page,
      createRoomState({ ...createRoomState().room, lighting: 'daylight', furniture: 'sofa-200' }, mounted([FRAME, LIGHTBAR])),
    );
    expect(furnished.rt60Sec).toBeLessThan(daylight.rt60Sec);
    expect(furnished.baselineRt60Sec).toBeLessThan(daylight.baselineRt60Sec);

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});

test.describe('exploded cad assembly', () => {
  async function layerGeometry(page) {
    return page.getByTestId('exploded-layer').evaluateAll((layers) =>
      layers.map((el) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        // The plates only: balloons hang off each layer and are checked separately.
        const plates = [...el.querySelectorAll('.bp-x__part')].map((part) => part.getBoundingClientRect());
        const box = {
          left: Math.min(...plates.map((r) => r.left)),
          top: Math.min(...plates.map((r) => r.top)),
          right: Math.max(...plates.map((r) => r.right)),
          bottom: Math.max(...plates.map((r) => r.bottom)),
        };
        return {
          layer: el.dataset.layer,
          tx: matrix.e,
          ty: matrix.f,
          dx: Number(el.style.getPropertyValue('--dx')),
          dy: Number(el.style.getPropertyValue('--dy')),
          box: { x0: box.left, y0: box.top, x1: box.right, y1: box.bottom },
        };
      }),
    );
  }

  const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

  test('the spread fader separates four annotated sub-assemblies along the projection axis', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto(`/catalog/${SHELF}`);
    const tab = page.getByTestId('blueprint-tab-exploded');
    await expect(tab).toHaveText('04 Exploded Assembly');
    await tab.click();
    await expect(tab).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('blueprint-view-front')).toHaveAttribute('aria-pressed', 'false');

    const drawing = page.getByTestId('blueprint-svg');
    await expect(drawing).toHaveAttribute('data-view', 'exploded');
    await expect(page.getByTestId('blueprint-title')).toHaveText('Exploded Assembly (Z-Axis Projection)');
    await expect(drawing.getByTestId('blueprint-scale')).toHaveText('1:10 / LMN-SH-110');
    await expect(drawing.getByTestId('exploded-layer')).toHaveCount(4);
    await expect(drawing.getByTestId('exploded-part').locator('text').first()).toHaveText(
      '01 / Wall Anchor & Concealed Steel Cleat',
    );
    const labels = await drawing.getByTestId('exploded-part').evaluateAll((parts) =>
      parts.map((part) => part.querySelector('text').textContent),
    );
    expect(labels).toEqual([
      '01 / Wall Anchor & Concealed Steel Cleat',
      '02 / 24V DC Copper Bus & Connector Core',
      '03 / Primary Structural Body',
      '04 / Optical Diffuser & 2700K LED Array',
    ]);
    await expect(drawing.getByTestId('exploded-part').nth(2)).toContainText('Walnut, W 110 x H 8 x D 25 cm');
    await expect(drawing.getByTestId('exploded-leader')).toHaveCount(2);

    // Default: 65% exploded.
    const slider = page.getByTestId('exploded-spread-slider');
    await expect(slider).toHaveValue('65');
    await expect(page.getByTestId('exploded-spread-value')).toHaveText('65%');
    await expect(drawing).toHaveAttribute('data-spread', '65');

    // 0%: every layer sits at its assembled position.
    await slider.fill('0');
    await expect(drawing).toHaveAttribute('data-spread', '0');
    await expect(page.getByTestId('exploded-spread-value')).toHaveText('0%');
    for (const layer of await layerGeometry(page)) {
      expect(Math.abs(layer.tx), layer.layer).toBeLessThan(0.01);
      expect(Math.abs(layer.ty), layer.layer).toBeLessThan(0.01);
    }

    // Drag the thumb from 0% to 100% with the pointer.
    await slider.scrollIntoViewIfNeeded();
    const track = await slider.boundingBox();
    await page.mouse.move(track.x + 2, track.y + track.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width + 20, track.y + track.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(slider).toHaveValue('100');
    await expect(page.getByTestId('exploded-spread-value')).toHaveText('100%');
    await expect(drawing).toHaveAttribute('data-spread', '100');
    await expect(slider).toHaveAttribute('aria-valuetext', '100% exploded');

    // 100%: each layer travels its full offset along one axis, toward the viewer, and no two overlap.
    const exploded = await layerGeometry(page);
    expect(exploded.map((layer) => layer.layer)).toEqual(['01', '02', '03', '04']);
    for (const layer of exploded) {
      expect(layer.tx, layer.layer).toBeCloseTo(layer.dx, 1);
      expect(layer.ty, layer.layer).toBeCloseTo(layer.dy, 1);
    }
    expect(exploded[0].dx).toBe(0);
    for (let i = 1; i < exploded.length; i += 1) {
      const step = { x: exploded[i].dx - exploded[i - 1].dx, y: exploded[i].dy - exploded[i - 1].dy };
      expect(step.x).toBeLessThan(0);
      expect(step.y).toBeGreaterThan(0);
      // 30 deg cabinet-oblique axis: every step has the same direction.
      expect(step.y / -step.x).toBeCloseTo(Math.tan(Math.PI / 6), 2);
    }
    for (let i = 0; i < exploded.length; i += 1) {
      for (let j = i + 1; j < exploded.length; j += 1) {
        expect(overlaps(exploded[i].box, exploded[j].box), `${exploded[i].layer} x ${exploded[j].layer}`).toBe(false);
      }
    }
    // The alignment leaders stretch with the layers.
    const leaderAt = (el) => el.getBoundingClientRect().width;
    const stretched = await drawing.getByTestId('exploded-leader').first().evaluate(leaderAt);

    // Assemble glides back through intermediate frames rather than jumping.
    const samples = await page.evaluate(async () => {
      const svg = document.querySelector('[data-testid="blueprint-svg"]');
      document.querySelector('[data-testid="exploded-assemble"]').click();
      const seen = [];
      for (let i = 0; i < 12; i += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        seen.push(Number(svg.style.getPropertyValue('--spread')));
      }
      return seen;
    });
    expect(samples.some((value) => value > 0.02 && value < 0.98)).toBe(true);
    await expect(drawing).toHaveAttribute('data-spread', '0');
    await expect(slider).toHaveValue('0');
    const collapsed = await drawing.getByTestId('exploded-leader').first().evaluate(leaderAt);
    expect(collapsed).toBeLessThan(stretched / 2);

    await page.getByTestId('exploded-explode').click();
    await expect(drawing).toHaveAttribute('data-spread', '100');
    await expect(page.getByTestId('exploded-spread-value')).toHaveText('100%');

    // The spread survives a round trip through another view.
    await page.getByTestId('blueprint-view-side').click();
    await expect(drawing).toHaveAttribute('data-view', 'side');
    await page.getByTestId('blueprint-tab-exploded').click();
    await expect(page.getByTestId('exploded-spread-slider')).toHaveValue('100');

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await horizontalOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
    }
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('passive hardware swaps the optic for an anodized cover plate', async ({ page }) => {
    await page.goto('/catalog/track-bus-200');
    await page.getByTestId('blueprint-tab-exploded').click();
    const parts = page.getByTestId('exploded-part');
    await expect(parts).toHaveCount(4);
    await expect(parts.nth(0)).toContainText('01 / Plaster-In Clip & Mounting Rail');
    await expect(parts.nth(3)).toContainText('04 / Anodized Cover Plate');
    await expect(page.getByTestId('exploded-layer').nth(3)).toHaveAttribute('data-tone', 'plate');
  });
});
