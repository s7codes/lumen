import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { PROJECTS_STORAGE_KEY } from '../src/api/client.js';
import { getProduct } from '../src/data/products.js';
import { SESSION_STORAGE_KEY } from '../src/lib/auth.js';
import { ACTIVE_NAMES_STORAGE_KEY } from '../src/lib/project-library.js';
import { computeBusTopology } from '../src/lib/bus-topology.js';
import { computeFloorLuxField } from '../src/lib/illuminance-field.js';
import { buildRoomObj, countObjObjects } from '../src/lib/obj-export.js';
import {
  createRoomState,
  findRoomConflicts,
  mountInRoom,
  ROOM_STORAGE_KEY,
  ROOM_WALLS,
  sanitizeRoomState,
  serializeRoomState,
  unrolledRoom,
  updateRoomItem,
  WALL_HEADING,
  wallCounts,
} from '../src/lib/room-3d.js';
import { buildScene, cameraFrame, cameraFromPosition, cameraPosition, LIGHTING_RIGS } from '../src/lib/room-scene.js';
import { boxToRoom, wallToRoom } from '../src/lib/room-walls.js';
import { decodeSceneParam, encodeSceneParam } from '../src/lib/scene-codec.js';
import {
  collectRuntimeErrors,
  horizontalOverflow,
  installCspRecorder,
  readCspViolations,
  storeDisplayMode,
  VIEWPORT_WIDTHS,
} from './support/runtime-guards.js';

const ROOT = new URL('../', import.meta.url);
const ROOM_KEY = `lumen:${ROOM_STORAGE_KEY}`;
const PROJECTS_KEY = `lumen:${PROJECTS_STORAGE_KEY}`;
const SESSION_KEY = `lumen:${SESSION_STORAGE_KEY}`;
const NAMES_KEY = `lumen:${ACTIVE_NAMES_STORAGE_KEY}`;
const GUEST = { name: 'Studio Guest', email: 'guest@lumen.com' };

/** A 360 x 300 x 250 cm room with one or two parts on every wall, mounted through the engine. */
function fourWallRoom() {
  let state = createRoomState({ widthCm: 360, depthCm: 300, heightCm: 250, furniture: 'none', lighting: 'night' });
  const plan = [
    ['north', 'floating-shelf-110'],
    ['north', 'corner-floor-column-140'],
    ['east', 'modular-cube-36'],
    ['south', 'linear-lightbar-60'],
    ['west', 'acoustic-art-frame-50x70'],
  ];
  for (const [wall, productId] of plan) state = mountInRoom(state, productId, wall).state;
  return updateRoomItem(state, 'm4', { dimPct: 55 });
}

async function seed(page, entries) {
  await page.evaluate((pairs) => {
    for (const [key, value] of pairs) localStorage.setItem(key, value);
  }, entries);
}

function readJson(page, key) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);
}

function viewport(page) {
  return page.getByTestId('room-viewport');
}

function roomModule(page, uid) {
  return page.locator(`[data-testid="room-module"][data-uid="${uid}"]`);
}

async function openRoom(page) {
  await page.goto('/room-3d');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
}

async function mount(page, name) {
  await page.getByRole('button', { name: `Mount ${name}`, exact: true }).click();
}

async function expectCounts(page, counts) {
  for (const wall of ROOM_WALLS) {
    await expect(page.getByTestId(`wall-count-${wall}`), wall).toHaveText(String(counts[wall] ?? 0));
    await expect(page.getByTestId(`wall-tab-${wall}`), wall).toHaveAttribute('data-count', String(counts[wall] ?? 0));
  }
}

/** Every module node in the scene-graph mirror matches the engine's world placement. */
async function expectSceneMatches(page, state) {
  const scene = buildScene({ state });
  for (const module of scene.modules) {
    const node = roomModule(page, module.uid);
    await expect(node, module.uid).toHaveAttribute('data-wall', module.wall);
    await expect(node, module.uid).toHaveAttribute('data-world', module.position.join(' '));
    await expect(node, module.uid).toHaveAttribute('data-rot-y', module.rotation[1].toFixed(4));
  }
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('multi-wall 3D room architecture', () => {
  test('wall frames, per-wall collisions and the 360-degree camera hold in the engine', () => {
    const state = fourWallRoom();
    expect(state.items.map((item) => item.wall ?? 'north')).toEqual(['north', 'north', 'east', 'south', 'west']);
    expect(wallCounts(state.items)).toEqual({ north: 2, east: 1, south: 1, west: 1 });
    expect(findRoomConflicts(state).size).toBe(0);

    // North stays the legacy frame; the other walls carry their own span and turn.
    const { widthCm: W, depthCm: D } = state.room;
    expect(wallToRoom(state.room, 'north', [10, 20, 5])).toEqual([10, 20, 5]);
    expect(wallToRoom(state.room, 'east', [10, 20, 5])).toEqual([W - 5, 20, 10]);
    expect(wallToRoom(state.room, 'south', [10, 20, 5])).toEqual([W - 10, 20, D - 5]);
    expect(wallToRoom(state.room, 'west', [10, 20, 5])).toEqual([5, 20, D - 10]);

    const scene = buildScene({ state });
    const byUid = Object.fromEntries(scene.modules.map((module) => [module.uid, module]));
    expect(byUid.m1.rotation).toEqual([0, 0, 0]);
    expect(byUid.m3.rotation[1]).toBeCloseTo(-Math.PI / 2, 10);
    expect(byUid.m4.rotation[1]).toBeCloseTo(Math.PI, 10);
    expect(byUid.m5.rotation[1]).toBeCloseTo(Math.PI / 2, 10);
    // Each module sits against its own wall plane, depth pointing into the room.
    const half = (uid) => getProduct(state.items.find((item) => item.uid === uid).productId).dimsCm.d / 200;
    expect(byUid.m1.position[2]).toBeCloseTo(half('m1'), 4);
    expect(byUid.m3.position[0]).toBeCloseTo(W / 100 - half('m3'), 4);
    expect(byUid.m4.position[2]).toBeCloseTo(D / 100 - half('m4'), 4);
    expect(byUid.m5.position[0]).toBeCloseTo(half('m5'), 4);
    // Lights follow the turn: the east cube washes down its own wall, the south bar along the south wall.
    expect(byUid.m3.lights[0].position[0]).toBeGreaterThan(W / 100 - 0.4);
    expect(byUid.m4.lights.every((light) => light.position[2] > D / 100 - 0.2)).toBe(true);
    expect(scene.shell.surfaces.filter((surface) => surface.wall).map((surface) => surface.wall).sort()).toEqual(
      [...ROOM_WALLS].sort(),
    );

    // Two modules meeting in a corner collide in true 3D even though each wall is clear.
    const corner = sanitizeRoomState({
      format: 'lumen.room3d',
      version: 1,
      room: state.room,
      items: [
        { uid: 'm1', productId: 'floating-shelf-110', finish: 'oak', xCm: W - 110, yCm: 120 },
        { uid: 'm2', productId: 'floating-shelf-110', finish: 'oak', xCm: 0, yCm: 120, wall: 'east' },
      ],
    });
    expect([...findRoomConflicts(corner).keys()]).toEqual(['m1', 'm2']);
    const boxes = corner.items.map((item) =>
      boxToRoom(corner.room, item.wall ?? 'north', { x0: item.xCm, x1: item.xCm + 110, y0: 120, y1: 128, z0: 0, z1: 25 }),
    );
    expect(boxes[0].x1).toBe(W);
    expect(boxes[1].z0).toBe(0);
    // Mounting into that corner steps clear of the module on the adjoining wall.
    const placed = mountInRoom(createRoomState(state.room, [corner.items[0]]), 'floating-shelf-110', 'east');
    expect(placed.clear).toBe(true);
    expect(findRoomConflicts(placed.state).size).toBe(0);

    // Yaw is relative to the active wall, so every preset and limit applies on all four walls.
    for (const wall of ROOM_WALLS) {
      const frame = cameraFrame(state.room, 1.6, wall);
      expect(frame.heading).toBe(WALL_HEADING[wall]);
      for (const camera of [{ yaw: -65, pitch: 8, zoom: 0.6 }, { yaw: 0, pitch: 24, zoom: 1 }, { yaw: 65, pitch: 50, zoom: 1.8 }]) {
        const back = cameraFromPosition(frame, cameraPosition(frame, camera));
        expect(back.yaw).toBeCloseTo(camera.yaw, 6);
        expect(back.zoom).toBeCloseTo(camera.zoom, 6);
      }
    }
    const southEye = cameraPosition(cameraFrame(state.room, 1.6, 'south'), { yaw: 0, pitch: 10, zoom: 1 });
    expect(southEye[2]).toBeLessThan(0);
    const eastEye = cameraPosition(cameraFrame(state.room, 1.6, 'east'), { yaw: 0, pitch: 10, zoom: 1 });
    expect(eastEye[0]).toBeLessThan(0);

    // The floor field and the 24V run see every wall.
    const field = computeFloorLuxField(state);
    expect(field.sources).toBeGreaterThan(computeFloorLuxField({ ...state, items: state.items.slice(0, 2) }).sources);
    const unrolled = unrolledRoom(state);
    expect(unrolled.room.widthCm).toBe(2 * (W + D));
    expect(unrolled.items.find((item) => item.uid === 'm3').xCm).toBe(state.items[2].xCm + W);
    expect(computeBusTopology(unrolled).nodes.map((node) => node.uid).sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
  });

  test('wall tabs switch the active wall, mount per wall, reassign, undo and export a multi-wall OBJ', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openRoom(page);

    const switcher = page.getByTestId('active-wall-switcher');
    await expect(switcher.getByRole('button')).toHaveCount(4);
    await expect(switcher.locator('.room3d-walls__label')).toHaveText(['North Wall', 'East Wall', 'South Wall', 'West Wall']);
    await expect(page.getByTestId('wall-tab-north')).toHaveAttribute('aria-pressed', 'true');
    await expect(viewport(page)).toHaveAttribute('data-active-wall', 'north');
    await expect(viewport(page)).toHaveAttribute('data-camera-heading', '0');
    await expectCounts(page, {});

    // Each tab turns the camera to its wall; the relative yaw, pitch and zoom stay put.
    for (const wall of ['south', 'west', 'east']) {
      await page.getByTestId(`wall-tab-${wall}`).click();
      await expect(page.getByTestId(`wall-tab-${wall}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(viewport(page)).toHaveAttribute('data-active-wall', wall);
      await expect(viewport(page)).toHaveAttribute('data-camera-heading', String(WALL_HEADING[wall]));
      await expect(viewport(page)).toHaveAttribute('data-camera-yaw', '-24');
      await expect(page.getByTestId('room-scene-graph')).toHaveAttribute('data-heading', String(WALL_HEADING[wall]));
    }

    await mount(page, 'Modular Cube 36');
    await expect(page.getByTestId('room-notice')).toHaveText(/^Mounted Modular Cube 36 on the East Wall at X \d+ \/ Y \d+ cm\.$/);
    await expect(roomModule(page, 'm1')).toHaveAttribute('data-wall', 'east');
    await expect(page.getByTestId('room-inspector-wall')).toHaveText('East Wall');
    await expect(page.getByTestId('module-wall-select')).toHaveValue('east');
    await expectCounts(page, { east: 1 });

    await page.getByTestId('wall-tab-west').click();
    await mount(page, 'Floating Shelf 110');
    await expect(roomModule(page, 'm2')).toHaveAttribute('data-wall', 'west');
    await page.getByTestId('wall-tab-north').click();
    await mount(page, 'Linear Lightbar 60');
    await expect(page.getByTestId('room-notice')).toHaveText(/^Mounted Linear Lightbar 60 at X \d+ \/ Y \d+ cm\.$/);
    await expect(roomModule(page, 'm3')).toHaveAttribute('data-wall', 'north');
    await expectCounts(page, { north: 1, east: 1, west: 1 });

    // The mirror places each module on its own wall: distinct world positions and turns.
    let stored = await readJson(page, ROOM_KEY);
    expect(stored.items.map((item) => item.wall)).toEqual(['east', 'west', undefined]);
    const state = sanitizeRoomState(stored);
    await expectSceneMatches(page, state);
    const worlds = await page.getByTestId('room-module').evaluateAll((nodes) => nodes.map((node) => node.dataset.world));
    expect(new Set(worlds).size).toBe(3);
    await expect(roomModule(page, 'm1')).toHaveAttribute('data-rot-y', '-1.5708');
    await expect(roomModule(page, 'm2')).toHaveAttribute('data-rot-y', '1.5708');
    await expect(roomModule(page, 'm3')).toHaveAttribute('data-rot-y', '0.0000');

    // Reassign the lightbar to the south wall: it rehangs there and the view follows it.
    await expect(page.getByTestId('room-inspector-name')).toHaveText('Linear Lightbar 60');
    await page.getByTestId('module-wall-select').selectOption('south');
    await expect(roomModule(page, 'm3')).toHaveAttribute('data-wall', 'south');
    await expect(roomModule(page, 'm3')).toHaveAttribute('data-rot-y', '3.1416');
    await expect(viewport(page)).toHaveAttribute('data-active-wall', 'south');
    await expect(page.getByTestId('wall-tab-south')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('room-notice')).toHaveText(/^Moved Linear Lightbar 60 to the South Wall at X \d+ \/ Y \d+ cm\.$/);
    await expect(page.getByTestId('room-inspector-wall')).toHaveText('South Wall');
    await expectCounts(page, { east: 1, south: 1, west: 1 });
    await expect(page.getByTestId('room-conflict-count')).toHaveText('0 conflicts');

    // Left X / Bottom Y edit along the new wall; one undo puts it back on the south wall position.
    const x = page.getByTestId('room-module-x');
    await x.fill('20');
    await x.press('Enter');
    await expect(roomModule(page, 'm3')).toHaveAttribute('data-x-cm', '20');
    await page.getByTestId('room-undo').click();
    await expect(roomModule(page, 'm3')).not.toHaveAttribute('data-x-cm', '20');
    await expect(roomModule(page, 'm3')).toHaveAttribute('data-wall', 'south');
    await page.getByTestId('room-undo').click();
    await expect(roomModule(page, 'm3')).toHaveAttribute('data-wall', 'north');
    await page.getByTestId('room-redo').click();
    await expect(roomModule(page, 'm3')).toHaveAttribute('data-wall', 'south');

    stored = await readJson(page, ROOM_KEY);
    await expectSceneMatches(page, sanitizeRoomState(stored));
    expect(computeBusTopology(unrolledRoom(sanitizeRoomState(stored))).nodes).toHaveLength(3);

    // A 3D .OBJ export carries modules from three walls in the one room frame.
    await page.getByTestId('project-name-input').fill('Four Wall Loft');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-room-obj').click()]);
    const text = await readFile(await download.path(), 'utf-8');
    expect(text).toBe(buildRoomObj(sanitizeRoomState(stored), 'Four Wall Loft'));
    const objects = text.split('\n').filter((line) => line.startsWith('o '));
    expect(objects.filter((name) => /_east$/.test(name))).toHaveLength(1);
    expect(objects.filter((name) => /_west$/.test(name))).toHaveLength(1);
    expect(objects.filter((name) => /_south$/.test(name))).toHaveLength(1);
    expect(countObjObjects(text)).toBe(1 + 3);
    expect(text.split('\n').filter((line) => line.startsWith('f '))).toHaveLength(5 + 6 * 3);
    expect(/^[\n\x20-\x7e]*$/.test(text)).toBe(true);

    // Clear Wall asks once more, then empties only the active wall.
    await page.getByTestId('wall-tab-east').click();
    const clear = page.getByTestId('room-clear-wall');
    await clear.click();
    await expect(clear).toHaveText('Confirm: clear 1');
    await clear.click();
    await expect(page.getByTestId('room-notice')).toHaveText('Cleared 1 module from the East Wall.');
    await expectCounts(page, { south: 1, west: 1 });
    await expect(clear).toBeDisabled();

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('the 2D bridge loads and pushes the active wall only', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const state = fourWallRoom();
    await page.goto('/');
    await seed(page, [[ROOM_KEY, JSON.stringify(serializeRoomState(state))]]);
    await openRoom(page);
    await expectCounts(page, { north: 2, east: 1, south: 1, west: 1 });

    // Push the west wall: its one module becomes a 300 cm (room depth) 2D wall.
    await page.getByTestId('wall-tab-west').click();
    await page.getByTestId('export-to-wall-studio').click();
    await expect(page.getByTestId('room-bridge-status')).toHaveText(
      'Pushed 1 West Wall module to Wall Studio, wall 300 x 250 cm.',
    );
    const wall = await readJson(page, 'lumen:lumen_wall_studio_v1');
    expect(wall.wall.widthCm).toBe(300);
    expect(wall.items.map((item) => item.productId)).toEqual(['acoustic-art-frame-50x70']);
    expect(wall.items[0]).not.toHaveProperty('wall');

    // Load it back onto the east wall: east is replaced, the other walls stay.
    await page.getByTestId('wall-tab-east').click();
    await page.getByTestId('import-from-wall-studio').click();
    await expect(page.getByTestId('room-notice')).toHaveText(
      'Loaded 1 module from Wall Studio onto the East Wall, 300 x 250 cm.',
    );
    await expectCounts(page, { north: 2, east: 1, south: 1, west: 1 });
    const stored = await readJson(page, ROOM_KEY);
    const east = stored.items.filter((item) => item.wall === 'east');
    expect(east.map((item) => item.productId)).toEqual(['acoustic-art-frame-50x70']);
    expect(new Set(stored.items.map((item) => item.uid)).size).toBe(stored.items.length);
    expect(errors).toEqual([]);
  });
});

test.describe('multi-wall persistence and share links', () => {
  test('share links encode north as before and round-trip all four walls', () => {
    const state = fourWallRoom();
    const north = createRoomState(state.room, state.items.filter((item) => !item.wall));
    const legacy = JSON.parse(Buffer.from(encodeSceneParam('room', north, 'North'), 'base64url').toString('utf8'));
    expect(legacy.i.every((tuple) => tuple.length === 5)).toBe(true);

    const param = encodeSceneParam('room', state, 'Four Walls');
    const payload = JSON.parse(Buffer.from(param, 'base64url').toString('utf8'));
    expect(payload.i.map((tuple) => tuple[7] ?? null)).toEqual([null, null, 'e', 's', 'w']);
    expect(payload.i[3][6]).toBe(55);
    const decoded = decodeSceneParam('room', param);
    expect(decoded.state.items).toEqual(state.items);

    // An unknown wall code refuses the whole link.
    const forged = { ...payload, i: payload.i.map((tuple, i) => (i === 2 ? [...tuple.slice(0, 7), 'up'] : tuple)) };
    expect(decodeSceneParam('room', Buffer.from(JSON.stringify(forged)).toString('base64url'))).toBeNull();
    // Stored rooms with an unknown wall fall back to north rather than vanish.
    const lenient = sanitizeRoomState({ ...serializeRoomState(state), items: [{ ...state.items[2], wall: '__proto__' }] });
    expect(lenient.items[0]).not.toHaveProperty('wall');
  });

  test('a four-wall room survives a ?scene= link in a fresh context', async ({ page, browser }) => {
    const errors = collectRuntimeErrors(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const state = fourWallRoom();
    await page.goto('/');
    await seed(page, [
      [ROOM_KEY, JSON.stringify(serializeRoomState(state))],
      [NAMES_KEY, JSON.stringify({ wall: 'Wall A', room: 'Four Wall Loft' })],
    ]);
    await openRoom(page);
    await expectCounts(page, { north: 2, east: 1, south: 1, west: 1 });

    const share = page.getByTestId('copy-share-link');
    await share.click();
    const url = await share.getAttribute('data-share-url');
    expect(url).toMatch(/\/room-3d\?scene=[A-Za-z0-9_-]+$/);

    const context = await browser.newContext();
    const fresh = await context.newPage();
    await installCspRecorder(fresh);
    const freshErrors = collectRuntimeErrors(fresh);
    await fresh.goto(url);
    await expect(fresh.getByTestId('toast-message').last()).toHaveText('Loaded shared scene: Four Wall Loft.');
    await expectCounts(fresh, { north: 2, east: 1, south: 1, west: 1 });
    for (const item of state.items) {
      await expect(roomModule(fresh, item.uid)).toHaveAttribute('data-wall', item.wall ?? 'north');
      await expect(roomModule(fresh, item.uid)).toHaveAttribute('data-x-cm', String(item.xCm));
    }
    await expectSceneMatches(fresh, state);
    await expect
      .poll(() => fresh.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROOM_KEY))
      .toEqual(serializeRoomState(state));
    expect(freshErrors).toEqual([]);
    expect(await readCspViolations(fresh)).toEqual([]);
    await context.close();
    expect(errors).toEqual([]);
  });

  test('Lumen Cloud saves and reopens north, east, south and west modules exactly', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const state = fourWallRoom();
    await page.goto('/');
    await seed(page, [
      [SESSION_KEY, JSON.stringify(GUEST)],
      [ROOM_KEY, JSON.stringify(serializeRoomState(state))],
    ]);
    await openRoom(page);
    const save = page.getByTestId('save-room-to-cloud');
    await save.click();
    await expect(save).toHaveAttribute('data-state', 'saved');
    const [record] = (await readJson(page, PROJECTS_KEY)).filter((entry) => entry.kind === 'room');
    expect(record.data.items).toEqual(serializeRoomState(state).items);

    // Wipe the local draft, then check the saved revision back out from the account.
    await seed(page, [[ROOM_KEY, JSON.stringify(serializeRoomState(createRoomState()))]]);
    await page.goto('/account');
    const card = page.locator('[data-testid="saved-project"][data-project="room"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('360 x 300 x 250 cm, 4 walls');
    await card.getByRole('link', { name: /Open Room Planner/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    await expectCounts(page, { north: 2, east: 1, south: 1, west: 1 });
    await expectSceneMatches(page, state);
    expect((await readJson(page, ROOM_KEY)).items).toEqual(serializeRoomState(state).items);
    expect(errors).toEqual([]);
  });
});

test.describe('human-friendly UX and header polish', () => {
  test('LICENSE and README credit s7codes under MIT', async () => {
    const [license, readme] = await Promise.all(
      ['LICENSE', 'README.md'].map((file) => readFile(new URL(file, ROOT), 'utf-8')),
    );
    expect(license.split('\n')[2]).toBe('Copyright (c) 2026 s7codes');
    expect(readme).toContain('MIT License, Copyright (c) 2026 s7codes');
    expect(readme).not.toContain('Copyright (c) 2026 Lumen Spatial Studio');
  });

  test('navbar reads in sans Title Case, the search pill has no shortcut badge, Visual / Specs switches mode', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const links = nav.getByRole('link');
    await expect(links).toHaveText(['Overview', 'Catalog', '3D Room', 'Wall Studio']);
    const type = await links.first().evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        family: style.fontFamily,
        size: style.fontSize,
        weight: style.fontWeight,
        transform: style.textTransform,
        tracking: Number.parseFloat(style.letterSpacing) / Number.parseFloat(style.fontSize),
      };
    });
    expect(type.family).toContain('Inter Tight');
    expect(type).toMatchObject({ size: '13.5px', weight: '500', transform: 'none' });
    expect(type.tracking).toBeCloseTo(-0.01, 3);
    await expect(nav).not.toContainText('/');

    const trigger = page.getByTestId('command-palette-trigger');
    await expect(trigger).toHaveText('Search');
    await expect(trigger.locator('kbd')).toHaveCount(0);
    expect(await trigger.textContent()).not.toMatch(/ctrl|cmd|\bK\b/i);
    await expect(trigger).toHaveCSS('font-size', '13.5px');
    await expect(trigger).toHaveCSS('text-transform', 'none');
    // The shortcut itself still works from anywhere.
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await page.keyboard.press('Escape');

    const group = page.getByRole('group', { name: 'Display mode' });
    await expect(group.getByRole('button')).toHaveText(['Visual', 'Specs']);
    const visual = group.getByRole('button', { name: /^Visual/ });
    const specs = group.getByRole('button', { name: /^Specs/ });
    await expect(visual).toHaveAttribute('title', 'Visual mode - clean presentation');
    await expect(specs).toHaveAttribute('title', 'Specs mode - dimensions, wiring & engineering data');
    await expect(specs).toHaveCSS('text-transform', 'none');
    await specs.click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'technical');
    await expect(specs).toHaveAttribute('aria-pressed', 'true');
    await visual.click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'architectural');
    for (const pill of [page.getByTestId('sign-in'), page.getByRole('button', { name: 'Cart (0)' })]) {
      await expect(pill).toHaveCSS('font-size', '13.5px');
      await expect(pill).toHaveCSS('text-transform', 'none');
    }
    expect(errors).toEqual([]);
  });

  test('2D and 3D planners lift the wall off a warm surround and keep the night room legible', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/studio-2d');
    await page.getByRole('button', { name: 'Load preset Nordic Reading Wall' }).click();
    const surround = page.locator('.studio-stage__viewport');
    const wall = page.getByTestId('wall-canvas');
    await expect(surround).toHaveCSS('background-color', 'rgb(17, 16, 15)');
    await expect(wall).toHaveCSS('background-color', 'rgb(30, 28, 25)');
    // A crisp 1.5px edge ring in #38342e around the elevation.
    expect(await wall.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('rgb(56, 52, 46) 0px 0px 0px 1.5px');
    await expect(page.locator('.wall__floor')).toHaveCSS('height', '3px');
    await page.getByRole('radio', { name: 'Daylight Elevation' }).check();
    await expect(wall).toHaveCSS('background-color', 'rgb(232, 226, 216)');

    // A clean name tag on hover; modules carry an inner bezel.
    const shelf = page.locator('[data-testid="wall-module"][data-uid="m2"]');
    await shelf.hover();
    await expect(shelf.locator('.wall-module__tag')).toHaveCSS('opacity', '1');
    await expect(shelf.locator('.wall-module__tag')).toContainText('Floating Shelf 110');
    expect(await shelf.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('inset');

    // Sidebars: Title Case sans headings on soft cards; palette rows read size and power plainly.
    const heading = page.locator('.studio-palette .studio-panel__heading').first();
    await expect(heading).toHaveText('Wall Setup');
    await expect(heading).toHaveCSS('font-weight', '600');
    await expect(heading).toHaveCSS('text-transform', 'none');
    const card = page.locator('.studio-palette .studio-panel__section').first();
    await expect(card).toHaveCSS('border-top-left-radius', '12px');
    await expect(card).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.03)');
    const metas = await page.locator('.studio-palette .palette-item__meta').allTextContents();
    expect(metas.length).toBeGreaterThan(0);
    for (const meta of metas) expect(meta).toMatch(/^\d+ x \d+ cm, (\d+ W|passive)$/);
    await expect(page.locator('.studio-palette .palette-item__name').first()).toHaveCSS('font-size', '13px');

    // Toolbar: three clusters; the summary keeps four KPIs above the engineering sub-grid.
    await expect(page.locator('.studio-toolbar__cluster')).toHaveCount(3);
    const summary = page.getByTestId('wall-summary');
    await expect(summary.locator('.studio-summary__kpi dt')).toHaveText(['Modules', '24V Load', 'Luminous Flux', 'Total Price']);
    const engineering = summary.getByRole('group', { name: 'Engineering telemetry' });
    await expect(engineering.getByTestId('wall-psu')).toBeVisible();
    await expect(engineering.getByTestId('bus-run-telemetry')).toBeVisible();
    await expect(engineering.getByTestId('environmental-physics')).toBeVisible();

    await page.goto('/room-3d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    const backdrop = await viewport(page).evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(backdrop).toMatch(/^radial-gradient\(/);
    expect(backdrop).toContain('rgb(29, 27, 24)');
    expect(backdrop).toContain('rgb(10, 10, 9)');
    const roomSummary = page.getByTestId('room-summary');
    const bridge = roomSummary.getByRole('group', { name: 'Engineering telemetry and CAD bridge' });
    await expect(bridge.getByTestId('bus-run-telemetry')).toBeVisible();
    await expect(bridge.getByTestId('environmental-physics')).toBeVisible();
    await expect(bridge.getByTestId('export-room-obj')).toBeEnabled();
    await expect(bridge.getByTestId('import-from-wall-studio')).toBeEnabled();

    // The night rig keeps an emissive floor tone on walls and floor and lifts its fill with nothing lit.
    const night = buildScene({ state: createRoomState() });
    const surface = (scene, id) => scene.shell.surfaces.find((entry) => entry.id === id);
    expect(surface(night, 'back').glow).toBe('#262320');
    expect(surface(night, 'floor').glow).toBe('#1c1a17');
    expect(night.rig.ambient.intensity).toBeGreaterThan(LIGHTING_RIGS.night.ambient.intensity);
    expect(night.trim).toHaveLength(8);
    const day = buildScene({ state: createRoomState({ ...createRoomState().room, lighting: 'daylight' }) });
    expect(surface(day, 'back').color).toBe('#dcd7ce');
    expect(surface(day, 'floor').color).toBe('#b8b0a4');
    expect(errors).toEqual([]);
  });

  test('both planners fit 360px to 1600px with zero horizontal overflow in Visual and Specs', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const state = fourWallRoom();
    await page.goto('/');
    await seed(page, [[ROOM_KEY, JSON.stringify(serializeRoomState(state))]]);
    for (const mode of ['architectural', 'technical']) {
      await storeDisplayMode(page, mode);
      for (const width of VIEWPORT_WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of ['/studio-2d', '/room-3d']) {
          await page.goto(path);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          expect(await horizontalOverflow(page), `${path} ${mode} ${width}px`).toBeLessThanOrEqual(0);
        }
        const tab = page.getByTestId('wall-tab-west');
        const box = await tab.boundingBox();
        expect(box.x + box.width, `${mode} ${width}px wall tab`).toBeLessThanOrEqual(width);
      }
    }
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
