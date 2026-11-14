import { expect, test } from '@playwright/test';
import { getProduct } from '../src/data/products.js';
import { computeBusTopology } from '../src/lib/bus-topology.js';
import { DIM_RANGE, dimFactor } from '../src/lib/dimming.js';
import { formatInt, formatWatts } from '../src/lib/format.js';
import {
  computeFloorLuxField,
  computeWallLuxField,
  floorPointLux,
  luminousSources,
  wallPointLux,
} from '../src/lib/illuminance-field.js';
import { applyLightingSceneToLayout, applyLightingSceneToRoom, matchLightingScene } from '../src/lib/lighting-scenes.js';
import {
  createRoomState,
  roomFromWallLayout,
  ROOM_STORAGE_KEY,
  sanitizeRoomState,
  serializeRoomState,
  updateRoomItem,
} from '../src/lib/room-3d.js';
import { computeEnvironmentalPhysics, formatEnvironmentalPhysics } from '../src/lib/room-physics.js';
import { buildScene } from '../src/lib/room-scene.js';
import { decodeSceneParam, encodeSceneParam } from '../src/lib/scene-codec.js';
import {
  createLayout,
  sanitizeLayout,
  serializeLayout,
  summarizeWall,
  updateItem,
  updateModules,
  WALL_STORAGE_KEY,
} from '../src/lib/wall-studio.js';
import { collectRuntimeErrors, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const WALL_KEY = `lumen:${WALL_STORAGE_KEY}`;
const ROOM_KEY = `lumen:${ROOM_STORAGE_KEY}`;

// Task parts (shelf, lightbar), accent parts (frame, sideboard, sconce) and a passive DALI-2 hub.
const ITEMS = [
  { uid: 'm1', productId: 'floating-shelf-110', finish: 'walnut', xCm: 40, yCm: 150, led: true, locked: false },
  { uid: 'm2', productId: 'acoustic-art-frame-50x70', finish: 'oak', xCm: 200, yCm: 60, led: true, locked: false },
  { uid: 'm3', productId: 'linear-lightbar-60', finish: 'obsidian', xCm: 40, yCm: 200, led: true, locked: false },
  { uid: 'm4', productId: 'compact-sideboard-75', finish: 'walnut', xCm: 30, yCm: 20, led: true, locked: false },
  { uid: 'm5', productId: 'power-hub-dali', finish: 'obsidian', xCm: 200, yCm: 200, led: false, locked: false },
  { uid: 'm6', productId: 'wall-sconce-80', finish: 'chalk', xCm: 170, yCm: 110, led: true, locked: false },
];
const WALL = createLayout({ widthCm: 300, heightCm: 250, surface: 'ambient' }, ITEMS);
const ROOM = createRoomState(
  { widthCm: 320, depthCm: 280, heightCm: 250, furniture: 'none', lighting: 'night' },
  ITEMS.map(({ locked, ...item }) => item),
);

// Expected arc levels per uid, m1..m6, and the surface each scene leaves behind.
const SCENES = {
  morning: { levels: [100, 65, 100, 65, 100, 65], surface: 'daylight', lighting: 'daylight' },
  evening: { levels: [45, 85, 45, 85, 100, 85], surface: 'ambient', lighting: 'night' },
  night: { levels: [20, 40, 20, 40, 100, 40], surface: 'ambient', lighting: 'night' },
  full: { levels: [100, 100, 100, 100, 100, 100], surface: null, lighting: null },
};

async function seed(page, key, value) {
  await page.goto('/');
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(value)]);
}

async function openRoom(page, state = ROOM) {
  await seed(page, ROOM_KEY, serializeRoomState(state));
  await page.goto('/room-3d');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
}

function roomModule(page, uid) {
  return page.locator(`[data-testid="room-module"][data-uid="${uid}"]`);
}

async function readLevels(page, testId) {
  return page.getByTestId(testId).evaluateAll((nodes) => nodes.map((node) => Number(node.dataset.dimPct)));
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('dali-2 dimming model', () => {
  test('legacy records, storage and share links without dimPct read as 100 and serialize unchanged', () => {
    // The level is held only below 100, so undimmed records keep their exact pre-dimming shape.
    const legacy = sanitizeLayout(serializeLayout(WALL));
    expect(legacy.items.every((item) => !('dimPct' in item) && dimFactor(item) === 1)).toBe(true);
    expect(legacy).toEqual(sanitizeLayout(serializeLayout(WALL)));
    expect(serializeLayout(legacy)).toEqual(serializeLayout(WALL));
    const room = sanitizeRoomState(serializeRoomState(ROOM));
    expect(room.items.every((item) => !('dimPct' in item) && dimFactor(item) === 1)).toBe(true);
    expect(serializeRoomState(room)).toEqual(serializeRoomState(ROOM));
    expect(updateItem(legacy, 'm1', { dimPct: 100 })).toBe(legacy);
    expect(updateItem(updateItem(legacy, 'm1', { dimPct: 40 }), 'm1', { dimPct: 100 }).items[0]).toEqual(legacy.items[0]);

    // A passive part never holds a level; out-of-range levels clamp to 10..100.
    const tampered = sanitizeLayout({
      ...serializeLayout(WALL),
      items: serializeLayout(WALL).items.map((item, i) => ({ ...item, dimPct: [3, 250, 47.6, 'x', 30, -5][i] })),
    });
    expect(tampered.items.map((item) => item.dimPct ?? 100)).toEqual([10, 100, 48, 100, 100, 10]);

    // Undimmed scenes encode byte for byte as before; dimmed modules append a 7th element.
    const bare = { ...WALL, items: WALL.items.map(({ dimPct, ...item }) => item) };
    expect(encodeSceneParam('wall', legacy, 'Wall')).toBe(encodeSceneParam('wall', bare, 'Wall'));
    const b64 = (payload) => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const w = [300, 250, 0, 0, 'ambient'];
    const six = decodeSceneParam('wall', b64({ v: 1, k: 'w', n: 'A', w, i: [['floating-shelf-110', 'oak', 40, 150, 1, 0]] }));
    expect(six.state.items[0].dimPct ?? 100).toBe(100);
    const seven = decodeSceneParam(
      'wall',
      b64({ v: 1, k: 'w', n: 'A', w, i: [['floating-shelf-110', 'oak', 40, 150, 1, 0, 4], ['linear-lightbar-60', 'oak', 40, 60, 1, 0, 400]] }),
    );
    expect(seven.state.items.map((item) => item.dimPct ?? 100)).toEqual([10, 100]);
    expect(decodeSceneParam('wall', b64({ v: 1, k: 'w', w, i: [['floating-shelf-110', 'oak', 40, 150, 1, 0, '50']] }))).toBeNull();
    expect(decodeSceneParam('wall', b64({ v: 1, k: 'w', w, i: [['floating-shelf-110', 'oak', 40, 150, 1, 0, 50, 1]] }))).toBeNull();
  });

  test('50% exactly halves direct photometry, flux, active draw and 3D output while driver sizing holds', () => {
    const half = updateItem(WALL, 'm1', { dimPct: 50 });
    expect(half.items[0].dimPct).toBe(50);
    expect(updateItem(WALL, 'm5', { dimPct: 50 })).toBe(WALL);

    const shelfOnly = createLayout(WALL.wall, [ITEMS[0]]);
    const shelfHalf = updateItem(shelfOnly, 'm1', { dimPct: 50 });
    const full = luminousSources(shelfOnly.items);
    const dimmed = luminousSources(shelfHalf.items);
    expect(dimmed).toHaveLength(full.length);
    dimmed.forEach((source, i) => expect(source.cd).toBeCloseTo(full[i].cd / 2, 9));
    for (const [x, y] of [[95, 100], [60, 20], [140, 140]]) {
      expect(wallPointLux(dimmed, x, y)).toBeCloseTo(wallPointLux(full, x, y) / 2, 9);
      expect(floorPointLux(dimmed, x, y)).toBeCloseTo(floorPointLux(full, x, y) / 2, 9);
    }
    const wallField = computeWallLuxField(shelfHalf, { ambient: false });
    const wallBase = computeWallLuxField(shelfOnly, { ambient: false });
    wallField.direct.forEach((lux, k) => expect(Math.abs(lux - wallBase.direct[k] / 2)).toBeLessThanOrEqual(0.1));
    const floorField = computeFloorLuxField(shelfHalf, { ambient: false });
    const floorBase = computeFloorLuxField(shelfOnly, { ambient: false });
    floorField.direct.forEach((lux, k) => expect(Math.abs(lux - floorBase.direct[k] / 2)).toBeLessThanOrEqual(0.1));

    const base = summarizeWall(WALL);
    const summary = summarizeWall(half);
    expect(summary.lumens).toBe(base.lumens - 1150 / 2);
    expect(summary.activeW).toBe(base.activeW - 8);
    expect(summary.loadW).toBe(base.loadW);
    expect(summary.psu).toEqual(base.psu);
    expect(summary.dimmed).toBe(1);

    expect(computeEnvironmentalPhysics(half).fluxLm).toBe(computeEnvironmentalPhysics(WALL).fluxLm - 575);
    const busBase = computeBusTopology(WALL);
    const bus = computeBusTopology(half);
    expect(bus.ratedWatts).toBe(busBase.ratedWatts);
    expect(bus.activeWatts).toBe(busBase.activeWatts - 8);
    expect(bus.currentA).toBeLessThan(busBase.currentA);
    expect(bus.voltageDropV).toBeLessThan(busBase.voltageDropV);
    expect(bus.nodes.find((node) => node.uid === 'm1')).toMatchObject({ watts: 8, ratedWatts: 16, dimPct: 50 });

    const sceneBase = buildScene({ state: ROOM });
    const sceneHalf = buildScene({ state: updateRoomItem(ROOM, 'm1', { dimPct: 50 }) });
    const shelf = (scene) => scene.modules.find((module) => module.uid === 'm1');
    expect(shelf(sceneHalf).dimPct).toBe(50);
    expect(shelf(sceneHalf).emitters[0].intensity).toBeCloseTo(shelf(sceneBase).emitters[0].intensity / 2, 3);
    expect(shelf(sceneHalf).lights[0].intensity).toBeCloseTo(shelf(sceneBase).lights[0].intensity / 2, 2);
    const otherLights = (scene) => scene.lights.filter((light) => light.uid !== 'm1').map((light) => light.intensity);
    expect(otherLights(sceneHalf)).toEqual(otherLights(sceneBase));
  });

  test('scenes assign task and accent levels, set the surface and leave passive parts alone', () => {
    for (const [id, expected] of Object.entries(SCENES)) {
      const wall = applyLightingSceneToLayout(updateModules(WALL, ['m1', 'm2'], { dimPct: 30 }), id);
      expect(wall.items.map((item) => item.dimPct ?? 100), id).toEqual(expected.levels);
      expect(wall.items.filter((item) => getProduct(item.productId).watts > 0).every((item) => item.led)).toBe(true);
      expect(wall.items[4].led).toBe(false);
      expect(wall.wall.surface).toBe(expected.surface ?? 'ambient');
      expect(matchLightingScene(wall.items, wall.wall.surface)).toBe(id);

      const room = applyLightingSceneToRoom(ROOM, id);
      expect(room.items.map((item) => item.dimPct ?? 100), id).toEqual(expected.levels);
      expect(room.room.lighting).toBe(expected.lighting ?? 'night');
    }
    expect(applyLightingSceneToLayout(WALL, 'sunrise')).toBe(WALL);
  });
});

test.describe('dimming in the planners', () => {
  test('room planner: the inspector slider dims flux, floor lux, bus current and the WebGL lights', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openRoom(page);
    await page.getByTestId('camera-settings-toggle').click();
    await page.getByTestId('toggle-floor-lux-grid').click();
    await page.keyboard.press('Escape');
    const base = summarizeWall(ROOM);
    const shelfLights = page.locator('[data-testid="room-light"][data-uid="m1"]');
    const baseLight = Number(await shelfLights.first().getAttribute('data-intensity'));
    const baseEmissive = Number(await roomModule(page, 'm1').getAttribute('data-emissive'));

    await page.locator('[data-testid="room-module-list"] [data-uid="m1"]').click();
    const slider = page.getByTestId('module-dim-slider');
    await expect(slider).toHaveValue('100');
    await slider.fill('50');
    const dimmed = updateRoomItem(ROOM, 'm1', { dimPct: 50 });
    const summary = summarizeWall(dimmed);

    await expect(roomModule(page, 'm1')).toHaveAttribute('data-dim-pct', '50');
    await expect(page.getByTestId('room-flux')).toHaveAttribute('data-lm', String(summary.lumens));
    expect(summary.lumens).toBeLessThan(base.lumens);
    await expect(page.getByTestId('room-load')).toHaveText(`${base.loadW} W`);
    await expect(page.getByTestId('room-psu')).toHaveText(base.psu.label);

    const field = computeFloorLuxField(dimmed);
    await expect(page.getByTestId('room-floor-lux')).toHaveAttribute('data-peak-lux', String(field.peakLux));
    await expect(page.getByTestId('room-floor-lux')).toHaveAttribute('data-avg-lux', String(field.avgLux));
    expect(field.avgLux).toBeLessThan(computeFloorLuxField(ROOM).avgLux);

    const bus = computeBusTopology(dimmed);
    await expect(page.getByTestId('bus-run-telemetry')).toHaveAttribute('data-current-a', String(bus.currentA));
    expect(bus.currentA).toBeLessThan(computeBusTopology(ROOM).currentA);

    await expect(roomModule(page, 'm1')).toHaveAttribute('data-emissive', String(Number((baseEmissive / 2).toFixed(3))));
    expect(Number(await shelfLights.first().getAttribute('data-intensity'))).toBeCloseTo(baseLight / 2, 2);

    await page.keyboard.press('Control+z');
    await expect(roomModule(page, 'm1')).toHaveAttribute('data-dim-pct', '100');
    await expect(page.getByTestId('room-flux')).toHaveAttribute('data-lm', String(base.lumens));
    await expect(roomModule(page, 'm1')).toHaveAttribute('data-emissive', String(baseEmissive));

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});

test.describe('dali-2 scene presets', () => {
  test('room planner: each scene sets levels and the lighting rig in one undoable step', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openRoom(page);
    const bar = page.getByTestId('lighting-scene-bar');
    const viewport = page.locator('[data-lighting]').first();
    await expect(bar).toHaveAttribute('data-active-scene', 'full');
    await expect(page.getByTestId('room-undo')).toBeDisabled();

    await page.getByTestId('scene-preset-morning').click();
    await expect.poll(() => readLevels(page, 'room-module')).toEqual(SCENES.morning.levels);
    await expect(viewport).toHaveAttribute('data-lighting', 'daylight');
    await expect(page.getByTestId('room-notice')).toHaveText('Recalled Morning Focus: task 100% / accent 65%.');

    await page.keyboard.press('Control+z');
    await expect.poll(() => readLevels(page, 'room-module')).toEqual(SCENES.full.levels);
    await expect(viewport).toHaveAttribute('data-lighting', 'night');
    await expect(page.getByTestId('room-undo')).toBeDisabled();
    await page.keyboard.press('Control+y');
    await expect.poll(() => readLevels(page, 'room-module')).toEqual(SCENES.morning.levels);

    for (const id of ['evening', 'night', 'full']) {
      await page.getByTestId(`scene-preset-${id}`).click();
      await expect.poll(() => readLevels(page, 'room-module'), { message: id }).toEqual(SCENES[id].levels);
      await expect(viewport).toHaveAttribute('data-lighting', SCENES[id].lighting ?? 'night');
      await expect(bar).toHaveAttribute('data-active-scene', id);
    }
    await page.getByTestId('room-undo').click();
    await expect.poll(() => readLevels(page, 'room-module')).toEqual(SCENES.night.levels);
    await expect(page.getByTestId('room-flux')).toHaveAttribute(
      'data-lm',
      String(summarizeWall(applyLightingSceneToRoom(ROOM, 'night')).lumens),
    );

    // The camera is a view, not an edit: an undo keeps it.
    await page.getByTestId('camera-preset-front').click();
    await page.keyboard.press('Control+z');
    await expect.poll(() => readLevels(page, 'room-module')).toEqual(SCENES.evening.levels);
    await expect(page.getByTestId('camera-preset-front')).toHaveAttribute('aria-pressed', 'true');

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});

test.describe('dimmed share links', () => {
  test('wall and room ?scene= links carry custom levels intact', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const wall = updateModules(updateItem(WALL, 'm1', { dimPct: 35 }), ['m2', 'm6'], { dimPct: 70 });
    const wallParam = encodeSceneParam('wall', wall, 'Dimmed Wall');
    const decoded = decodeSceneParam('wall', wallParam);
    expect(decoded.state.items.map((item) => item.dimPct ?? 100)).toEqual([35, 70, 100, 100, 100, 70]);
    expect(decoded.name).toBe('Dimmed Wall');

    // A legacy wall link lands in the 3D Room Planner on the north wall, levels intact.
    await page.goto(`/studio-2d?scene=${wallParam}`);
    await expect(page).toHaveURL((url) => url.pathname === '/room-3d');
    await expect(page.getByTestId('toast-message').last()).toHaveText('Loaded shared scene: Dimmed Wall.');
    await expect.poll(() => readLevels(page, 'room-module')).toEqual([35, 70, 100, 100, 100, 70]);
    const adapted = roomFromWallLayout(createRoomState(), wall);
    await expect(page.getByTestId('room-flux')).toHaveAttribute('data-lm', String(summarizeWall(adapted).lumens));

    await page.getByTestId('copy-share-link').click();
    await expect(page.getByTestId('copy-share-link')).toHaveAttribute('data-share-url', /\/room-3d\?scene=[A-Za-z0-9_-]+$/);
    const url = await page.getByTestId('copy-share-link').getAttribute('data-share-url');
    const again = decodeSceneParam('room', new URL(url).searchParams.get('scene'));
    expect(again.state.items.map((item) => item.dimPct ?? 100)).toEqual([35, 70, 100, 100, 100, 70]);

    const room = updateRoomItem(updateRoomItem(ROOM, 'm3', { dimPct: 25 }), 'm4', { dimPct: 60 });
    const roomParam = encodeSceneParam('room', room, 'Dimmed Room');
    expect(decodeSceneParam('room', roomParam).state.items.map((item) => item.dimPct ?? 100)).toEqual([100, 100, 25, 60, 100, 100]);
    await page.goto(`/room-3d?scene=${roomParam}`);
    await expect(page.getByTestId('toast-message').last()).toHaveText('Loaded shared scene: Dimmed Room.');
    await expect.poll(() => readLevels(page, 'room-module')).toEqual([100, 100, 25, 60, 100, 100]);
    await expect(page.getByTestId('room-flux')).toHaveAttribute('data-lm', String(summarizeWall(room).lumens));
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROOM_KEY);
    expect(stored.items.map((item) => item.dimPct ?? 100)).toEqual([100, 100, 25, 60, 100, 100]);

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});
