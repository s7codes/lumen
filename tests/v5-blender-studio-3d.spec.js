import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createRoomState, mountInRoom, ROOM_STORAGE_KEY, sanitizeRoomState, serializeRoomState } from '../src/lib/room-3d.js';
import {
  AXIS_LOCKS,
  grabOffset,
  intersectRayWithWall,
  liveDimensions,
  nudgeWallPosition,
  solveWallDragPosition,
} from '../src/lib/room-raycast.js';
import { buildScene } from '../src/lib/room-scene.js';
import { roomToWall, wallToRoom } from '../src/lib/room-walls.js';
import {
  defaultStance,
  elevationCamera,
  EYE_HEIGHT_CM,
  eyeIlluminance,
  facingWall,
  furnitureZone,
  lookDirection,
  resolveStance,
  stepWalk,
  turnWalk,
  WALL_BUFFER_CM,
  WALL_LOOK_HEADING,
} from '../src/lib/room-walkthrough.js';
import { holdEngineChunk } from './support/engine-gates.js';
import { collectRuntimeErrors, horizontalOverflow, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const ROOM_KEY = `lumen:${ROOM_STORAGE_KEY}`;
// The boot panel names the engine by the release's major.minor, as read from package.json.
const RELEASE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version;
const ENGINE_LABEL = `LUMEN SPATIAL ENGINE v${RELEASE.split('.').slice(0, 2).join('.')}`;
const ROOM = { widthCm: 320, depthCm: 280, heightCm: 250 };
const EYE = [160, 165, 154];
const SHELF = { xCm: 105, yCm: 146, productId: 'floating-shelf-110' };
// The inside-lens scenarios open on the shelf the orbit scenario mounts, the last one with the sofa too.
const SHELF_ROOM = mountInRoom(createRoomState(), SHELF.productId).state;
const SHELF_SOFA_ROOM = { ...SHELF_ROOM, room: { ...SHELF_ROOM.room, furniture: 'sofa-200' } };

function viewport(page) {
  return page.getByTestId('room-viewport');
}

function gizmo(page) {
  return page.getByTestId('room-transform-gizmo');
}

function roomModule(page, uid) {
  return page.locator(`[data-testid="room-module"][data-uid="${uid}"]`);
}

function walkState(page) {
  return page.getByTestId('room-walkthrough-state');
}

async function openRoom(page) {
  await page.goto('/room-3d');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
}

/**
 * Stores `state` as the room before the planner's first script runs, then
 * opens it. The init script goes once the page is up, so a reload reads back
 * what the planner stored itself.
 */
async function openSeededRoom(page, state) {
  const seed = await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    ROOM_KEY,
    JSON.stringify(serializeRoomState(state)),
  ]);
  await openRoom(page);
  await seed.dispose();
}

async function mount(page, name) {
  await page.getByRole('button', { name: `Mount ${name}`, exact: true }).click();
}

async function rendererOf(page) {
  await expect(viewport(page)).not.toHaveAttribute('data-renderer', 'loading', { timeout: 20_000 });
  return viewport(page).getAttribute('data-renderer');
}

function readStoredRoom(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROOM_KEY);
}

async function numberAttr(locator, name) {
  return Number(await locator.getAttribute(name));
}

/** Waits until the gizmo stops moving on screen: the lens glide has settled. */
async function settleGizmo(page) {
  await expect(gizmo(page)).toHaveAttribute('data-projected', 'true');
  let last = '';
  await expect
    .poll(async () => {
      const now = `${await gizmo(page).getAttribute('data-screen-x')},${await gizmo(page).getAttribute('data-screen-y')}`;
      const stable = now === last;
      last = now;
      return stable;
    }, { intervals: [120, 120, 160, 200, 250] })
    .toBe(true);
}

async function centreOf(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Presses a gizmo handle, moves the pointer in steps, and hands back control before release. */
async function pressAndMove(page, from, dx, dy) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('ray to wall-plane solver', () => {
  test('intersects a world ray with the interior plane of each of the four walls', () => {
    const north = intersectRayWithWall(EYE, [0.2, -0.1, -1], 'north', ROOM);
    expect(north).toMatchObject({ wall: 'north', t: 154, point: [190.8, 149.6, 0], uCm: 190.8, vCm: 149.6, inside: true });

    // East runs north to south, so u is the room Z.
    const east = intersectRayWithWall(EYE, [1, 0.1, 0.3], 'east', ROOM);
    expect(east).toMatchObject({ t: 160, point: [320, 181, 202], uCm: 202, vCm: 181, inside: true });

    // South runs east to west: u grows as X falls.
    const south = intersectRayWithWall(EYE, [-0.4, 0, 1], 'south', ROOM);
    expect(south).toMatchObject({ t: 126, point: [109.6, 165, 280], uCm: 210.4, vCm: 165 });

    // West runs south to north: u grows as Z falls.
    const west = intersectRayWithWall(EYE, [-1, -0.2, -0.5], 'west', ROOM);
    expect(west).toMatchObject({ t: 160, point: [0, 133, 74], uCm: 206, vCm: 133 });

    // Parallel, pointing away, unknown wall or broken input: no hit.
    expect(intersectRayWithWall(EYE, [1, 0, 0], 'north', ROOM)).toBeNull();
    expect(intersectRayWithWall(EYE, [0, 0, 1], 'north', ROOM)).toBeNull();
    expect(intersectRayWithWall(EYE, [0, 0, -1], 'ceiling', ROOM)).toBeNull();
    expect(intersectRayWithWall([0, NaN, 0], [0, 0, -1], 'north', ROOM)).toBeNull();
    expect(intersectRayWithWall(EYE, [0, 0, -1], 'north', { widthCm: 0, depthCm: 280, heightCm: 250 })).toBeNull();

    // A hit past the wall end is still on the plane but outside the wall.
    expect(intersectRayWithWall(EYE, [2, 0, -1], 'north', ROOM)).toMatchObject({ uCm: 468, inside: false });

    // An offset plane sits in front of the wall: the drag runs on a module's front face.
    expect(intersectRayWithWall(EYE, [0.2, -0.1, -1], 'north', ROOM, 25)).toMatchObject({ t: 129, uCm: 185.8, point: [185.8, 152.1, 25] });

    // Round trip: any point on any wall, seen from the eye, reads back as the same wall coordinates.
    for (const wall of ['north', 'east', 'south', 'west']) {
      for (const [u, v] of [
        [20, 30],
        [140, 120],
        [250, 230],
      ]) {
        const target = wallToRoom(ROOM, wall, [u, v, 0]);
        const dir = target.map((c, i) => c - EYE[i]);
        const hit = intersectRayWithWall(EYE, dir, wall, ROOM);
        expect(hit.uCm, `${wall} u`).toBeCloseTo(u, 6);
        expect(hit.vCm, `${wall} v`).toBeCloseTo(v, 6);
        expect(roomToWall(ROOM, wall, hit.point)[2]).toBeCloseTo(0, 6);
      }
    }
  });

  test('solves drag positions with snap, axis locks, grab offset and boundary clamping', () => {
    const base = { item: SHELF, wallSpanCm: 320, wallHeightCm: 250 };
    const drag = { ...base, hitUCm: 152.6, hitVCm: 171.2, grabOffsetUCm: 40, grabOffsetVCm: 3 };
    expect(AXIS_LOCKS).toEqual(['free', 'x', 'y']);

    // 5 cm grid snap versus 1 cm free.
    expect(solveWallDragPosition({ ...drag, snapCm: 5 })).toMatchObject({ xCm: 115, yCm: 170, moved: true, snapCm: 5 });
    expect(solveWallDragPosition({ ...drag, snapCm: 1 })).toMatchObject({ xCm: 113, yCm: 168, snapCm: 1 });

    // Axis locks hold the other coordinate where it was.
    expect(solveWallDragPosition({ ...drag, axisLock: 'x' })).toMatchObject({ xCm: 115, yCm: 146, axisLock: 'x' });
    expect(solveWallDragPosition({ ...drag, axisLock: 'y' })).toMatchObject({ xCm: 105, yCm: 170, axisLock: 'y' });
    expect(solveWallDragPosition({ ...drag, axisLock: '__proto__' }).axisLock).toBe('free');

    // The grab offset comes off first, so picking a module up never moves it.
    const grab = grabOffset({ uCm: 160.4, vCm: 150.2 }, SHELF);
    expect(grab).toEqual({ grabOffsetUCm: 55.4, grabOffsetVCm: 4.2 });
    expect(solveWallDragPosition({ ...base, hitUCm: 160.4, hitVCm: 150.2, ...grab, snapCm: 1 })).toMatchObject({
      xCm: 105,
      yCm: 146,
      moved: false,
    });

    // Clamped to [0, span - w] x [0, height - h], even off the snap grid.
    expect(solveWallDragPosition({ ...base, hitUCm: 900, hitVCm: -50 })).toMatchObject({
      xCm: 210,
      yCm: 0,
      clampedX: true,
      clampedY: true,
    });
    expect(solveWallDragPosition({ ...base, hitUCm: -40, hitVCm: 400 })).toMatchObject({ xCm: 0, yCm: 242 });

    // Same-wall neighbours flag a collision; the position itself is never refused.
    const neighbour = { xCm: 100, yCm: 160, w: 60, h: 10 };
    expect(solveWallDragPosition({ ...base, hitUCm: 120, hitVCm: 158, obstacles: [neighbour] }).collides).toBe(true);
    expect(solveWallDragPosition({ ...base, hitUCm: 120, hitVCm: 120, obstacles: [neighbour] }).collides).toBe(false);

    // Keyboard and nudge steps land on the next snap line.
    const step = (item, dx, dy, snapCm = 5) => nudgeWallPosition({ ...base, item, dxSteps: dx, dySteps: dy, snapCm });
    expect(step({ ...SHELF, xCm: 103 }, 1, 0)).toMatchObject({ xCm: 105, yCm: 146 });
    expect(step(SHELF, 1, 0)).toMatchObject({ xCm: 110 });
    expect(step(SHELF, -1, 0)).toMatchObject({ xCm: 100 });
    expect(step(SHELF, 0, 1)).toMatchObject({ yCm: 150 });
    expect(step(SHELF, 0, -1, 1)).toMatchObject({ yCm: 145 });
    expect(step({ ...SHELF, xCm: 210 }, 1, 0)).toMatchObject({ xCm: 210, moved: false });

    expect(liveDimensions({ item: SHELF, wallSpanCm: 320, wallHeightCm: 250 })).toEqual({
      floorCm: 146,
      leftCm: 105,
      rightCm: 105,
      ceilingCm: 96,
    });
  });

  test('the envelope carries baseboards, corner creases and a ceiling without touching the floor trim', () => {
    const scene = buildScene({ state: createRoomState() });
    const { envelope } = scene;
    expect(envelope.baseboards.map((board) => board.wall)).toEqual(['north', 'east', 'south', 'west']);
    for (const board of envelope.baseboards) {
      expect(board.size[1]).toBeCloseTo(0.08, 6);
      expect(board.position[1]).toBeCloseTo(0.04, 6);
    }
    expect(envelope.creases).toHaveLength(4);
    expect(envelope.ceiling.position).toEqual([1.6, 2.5, 1.4]);
    expect(envelope.ceiling.rotation[0]).toBeCloseTo(Math.PI / 2, 10);
    expect(scene.trim).toHaveLength(8);
    expect(scene.planks.length).toBeGreaterThan(0);
    expect(scene.scaleTicks.length).toBeGreaterThan(0);
  });
});

test.describe('inside-room observer engine', () => {
  test('stands at 165 cm, faces each wall, walks inside the wall buffer and around the floor reference', () => {
    const room = createRoomState().room;
    const stance = defaultStance(room);
    // Centred across the north wall, backed up to 78 percent of the depth.
    expect(stance).toEqual({ xCm: 160, zCm: 218.4, headingDeg: 0, pitchDeg: 0 });
    expect(EYE_HEIGHT_CM).toBe(165);

    for (const [wall, heading] of Object.entries(WALL_LOOK_HEADING)) {
      expect(facingWall({ ...stance, headingDeg: heading }, room), wall).toBe(wall);
    }
    const east = lookDirection(90, 0);
    expect(east[0]).toBeCloseTo(1, 10);
    expect(east[1]).toBeCloseTo(0, 10);
    expect(east[2]).toBeCloseTo(0, 10);

    // Eight steps north stop 32 cm short of the wall.
    let walk = stance;
    for (let i = 0; i < 8; i += 1) walk = stepWalk(walk, room, { forward: 1 });
    expect(walk.zCm).toBe(WALL_BUFFER_CM);
    walk = turnWalk(walk, -90);
    for (let i = 0; i < 9; i += 1) walk = stepWalk(walk, room, { forward: 1 });
    expect(walk).toMatchObject({ xCm: WALL_BUFFER_CM, zCm: WALL_BUFFER_CM, headingDeg: -90 });
    expect(turnWalk({ headingDeg: 170 }, 15).headingDeg).toBe(-175);

    // The sofa footprint stops the walk at its edge.
    const sofa = { ...room, furniture: 'sofa-200' };
    expect(furnitureZone(sofa)).toEqual({ x0: 40, x1: 280, z0: -14, z1: 118 });
    walk = defaultStance(sofa);
    for (let i = 0; i < 6; i += 1) walk = stepWalk(walk, sofa, { forward: 1 });
    expect(walk).toMatchObject({ xCm: 160, zCm: 118 });
    // A stance inside the bed is pushed out to the nearest free floor.
    expect(resolveStance({ xCm: 160, zCm: 150, headingDeg: 0, pitchDeg: 0 }, { ...room, furniture: 'bed-160' })).toMatchObject({
      xCm: 160,
      zCm: 232,
    });

    // Wall Elevation sits dead-on and level with the middle of the wall.
    const lens = elevationCamera(room, 'east', 1.6);
    expect(lens.target).toEqual([320, 125, 140]);
    expect(lens.position[1]).toBe(125);
    expect(lens.position[2]).toBe(140);
    expect(lens.position[0]).toBeLessThan(0);

    // Eye illuminance: the inter-reflected floor plus any direct light ahead of the eye.
    const empty = createRoomState();
    expect(eyeIlluminance(empty, stance)).toBe(0);
    const lit = mountInRoom(empty, 'floating-shelf-110').state;
    expect(eyeIlluminance(lit, stance)).toBeGreaterThan(0);
    expect(eyeIlluminance(lit, stance)).toBe(eyeIlluminance(lit, { ...stance }));
  });
});

test.describe('direct 3D manipulation on the wall', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('the transform gizmo and laser dimensions follow the selected module and its wall coordinates', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openRoom(page);
    await expect(gizmo(page)).toHaveCount(0);
    await expect(page.getByTestId('room-live-dimensions')).toHaveCount(0);

    await mount(page, 'Floating Shelf 110');
    await expect(gizmo(page)).toHaveAttribute('data-module-uid', 'm1');
    await expect(gizmo(page)).toHaveAttribute('data-wall', 'north');
    await expect(gizmo(page)).toHaveAttribute('data-x-cm', '105');
    await expect(gizmo(page)).toHaveAttribute('data-y-cm', '146');
    await expect(gizmo(page)).toHaveAttribute('data-axis-lock', 'free');
    for (const handle of ['gizmo-axis-x', 'gizmo-axis-y', 'gizmo-axis-xy']) {
      await expect(page.getByTestId(handle)).toHaveCount(1);
    }

    const dims = page.getByTestId('room-live-dimensions');
    await expect(dims).toHaveAttribute('data-floor-cm', '146');
    await expect(dims).toHaveAttribute('data-left-cm', '105');
    await expect(dims).toHaveAttribute('data-right-cm', '105');
    await expect(dims).toHaveAttribute('data-ceiling-cm', '96');
    await expect(dims.locator('[data-dim="floor"]')).toHaveText('Y: 146 cm');
    await expect(dims.locator('[data-dim="left"]')).toHaveText('X: 105 cm');
    await expect(dims.locator('[data-dim="right"]')).toHaveText('R: 105 cm');
    await expect(dims.locator('[data-dim="ceiling"]')).toHaveText('C: 96 cm');

    // Gizmo lock lives in the inspector's Transform section.
    await page.getByRole('radio', { name: 'Lock Y Vertical' }).check();
    await expect(page.getByTestId('gizmo-lock-mode')).toHaveAttribute('data-value', 'y');
    await expect(gizmo(page)).toHaveAttribute('data-axis-lock', 'y');
    await page.getByRole('radio', { name: 'Free XY' }).check();

    // The nudge pad steps one snap line and commits; a typed X moves the gizmo too.
    await page.getByTestId('gizmo-nudge-right').click();
    await expect(gizmo(page)).toHaveAttribute('data-x-cm', '110');
    await expect(dims).toHaveAttribute('data-right-cm', '100');
    await page.getByTestId('room-module-x').fill('40');
    await page.getByTestId('room-module-x').press('Enter');
    await expect(gizmo(page)).toHaveAttribute('data-x-cm', '40');
    await expect(dims.locator('[data-dim="left"]')).toHaveText('X: 40 cm');

    if ((await rendererOf(page)) !== 'unavailable') {
      await settleGizmo(page);
      await expect(dims).toHaveAttribute('data-projected', 'true');
    }
    expect(errors).toEqual([]);
  });

  test('gizmo handles drag the module across the wall live and Ctrl+Z undoes each drag in one step', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openRoom(page);
    test.skip((await rendererOf(page)) === 'unavailable', 'Pointer drags need a WebGL context.');
    await mount(page, 'Floating Shelf 110');
    // Dead-on elevation: the X arrow points right on screen, the Y arrow up.
    await page.getByTestId('camera-mode-elevation').click();
    await expect(viewport(page)).toHaveAttribute('data-camera-mode', 'elevation');
    await settleGizmo(page);

    const node = roomModule(page, 'm1');
    const worldBefore = await node.getAttribute('data-world');

    // X handle: slides along the wall only, snapped to 5 cm, live before release.
    await pressAndMove(page, await centreOf(page.getByTestId('gizmo-axis-x')), 90, -30);
    await expect(gizmo(page)).toHaveAttribute('data-dragging', 'true');
    await expect.poll(() => numberAttr(gizmo(page), 'data-x-cm')).toBeGreaterThan(125);
    await expect(gizmo(page)).toHaveAttribute('data-y-cm', '146');
    await expect.poll(() => numberAttr(node, 'data-x-cm')).toBeGreaterThan(125);
    expect(await node.getAttribute('data-world')).not.toBe(worldBefore);
    const liveX = await numberAttr(gizmo(page), 'data-x-cm');
    await expect(page.getByTestId('room-live-dimensions')).toHaveAttribute('data-left-cm', String(liveX));
    await page.mouse.up();
    await expect(gizmo(page)).not.toHaveAttribute('data-dragging');

    const movedX = await numberAttr(gizmo(page), 'data-x-cm');
    expect(movedX % 5).toBe(0);
    await expect(page.getByTestId('room-notice')).toHaveText(`Moved Floating Shelf 110 to X ${movedX} / Y 146 cm.`);
    await expect.poll(async () => (await readStoredRoom(page)).items[0]).toMatchObject({ xCm: movedX, yCm: 146 });
    const scene = buildScene({ state: sanitizeRoomState(await readStoredRoom(page)) });
    await expect(node).toHaveAttribute('data-world', scene.modules[0].position.join(' '));

    // One Ctrl+Z puts the whole drag back.
    await page.keyboard.press('Control+z');
    await expect(node).toHaveAttribute('data-x-cm', '105');
    await expect(node).toHaveAttribute('data-world', worldBefore);
    await expect(page.getByTestId('room-redo')).toBeEnabled();

    // Y handle: raises the module, X stays.
    await settleGizmo(page);
    await pressAndMove(page, await centreOf(page.getByTestId('gizmo-axis-y')), 40, -70);
    await expect.poll(() => numberAttr(gizmo(page), 'data-y-cm')).toBeGreaterThan(165);
    await expect(gizmo(page)).toHaveAttribute('data-x-cm', '105');
    await page.mouse.up();
    const raisedY = await numberAttr(node, 'data-y-cm');
    expect(raisedY % 5).toBe(0);
    await expect(page.getByTestId('room-live-dimensions')).toHaveAttribute('data-ceiling-cm', String(250 - 8 - raisedY));

    // XY plane: both coordinates follow the pointer.
    await settleGizmo(page);
    await pressAndMove(page, await centreOf(page.getByTestId('gizmo-axis-xy')), -80, 60);
    await expect.poll(() => numberAttr(gizmo(page), 'data-x-cm')).toBeLessThan(100);
    await expect.poll(() => numberAttr(gizmo(page), 'data-y-cm')).toBeLessThan(raisedY);
    await page.mouse.up();
    const history = await page.evaluate(() => document.querySelector('[data-testid="room-undo"]').disabled);
    expect(history).toBe(false);

    // Each drag was one history step.
    await page.keyboard.press('Control+z');
    await expect(node).toHaveAttribute('data-y-cm', String(raisedY));
    await expect(node).toHaveAttribute('data-x-cm', '105');
    await page.keyboard.press('Control+z');
    await expect(node).toHaveAttribute('data-y-cm', '146');
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('dragging the selected mesh moves it on its wall, clicks still select and keyboard G grabs', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openRoom(page);
    test.skip((await rendererOf(page)) === 'unavailable', 'Pointer drags need a WebGL context.');
    await mount(page, 'Floating Shelf 110');
    await mount(page, 'Modular Cube 36');
    await expect(gizmo(page)).toHaveAttribute('data-module-uid', 'm2');
    await settleGizmo(page);
    const cube = roomModule(page, 'm2');
    const shelf = roomModule(page, 'm1');
    const before = { x: await numberAttr(cube, 'data-x-cm'), y: await numberAttr(cube, 'data-y-cm') };

    // A press on the mesh itself, where the gizmo origin sits, drags in free XY. Mounting
    // from the dock can scroll the page, so the stage comes back into view first.
    await viewport(page).scrollIntoViewIfNeeded();
    await settleGizmo(page);
    const canvas = await page.getByTestId('room-canvas').boundingBox();
    const grab = {
      x: canvas.x + (await numberAttr(gizmo(page), 'data-screen-x')),
      y: canvas.y + (await numberAttr(gizmo(page), 'data-screen-y')),
    };
    await pressAndMove(page, grab, -110, 70);
    await expect(page.getByRole('region', { name: 'Room viewport' })).toHaveAttribute('data-dragging', 'true');
    await expect.poll(() => numberAttr(cube, 'data-x-cm')).toBeLessThan(before.x);
    await expect.poll(() => numberAttr(cube, 'data-y-cm')).toBeLessThan(before.y);
    await page.mouse.up();
    await expect(page.getByRole('region', { name: 'Room viewport' })).not.toHaveAttribute('data-dragging');
    // Orbit stayed put while the module was in hand, and the selection held.
    await expect(viewport(page)).toHaveAttribute('data-camera-yaw', '-24');
    await expect(gizmo(page)).toHaveAttribute('data-module-uid', 'm2');
    await expect(page.getByTestId('room-notice')).toHaveText(/^Moved Modular Cube 36 to X \d+ \/ Y \d+ cm\.$/);

    // Lock Y: a diagonal mesh drag only changes height.
    await page.getByRole('radio', { name: 'Lock Y Vertical' }).check();
    await settleGizmo(page);
    const lockedX = await numberAttr(cube, 'data-x-cm');
    const lockedY = await numberAttr(cube, 'data-y-cm');
    const again = {
      x: canvas.x + (await numberAttr(gizmo(page), 'data-screen-x')),
      y: canvas.y + (await numberAttr(gizmo(page), 'data-screen-y')),
    };
    await pressAndMove(page, again, 90, -80);
    await expect.poll(() => numberAttr(cube, 'data-y-cm')).toBeGreaterThan(lockedY);
    await page.mouse.up();
    await expect(cube).toHaveAttribute('data-x-cm', String(lockedX));

    // Escape drops the selection; a plain click on a module selects it again.
    await viewport(page).focus();
    await page.keyboard.press('Escape');
    await expect(gizmo(page)).toHaveCount(0);
    await expect(shelf).toHaveAttribute('data-screen-x', /^\d+$/);
    await page.mouse.click(canvas.x + (await numberAttr(shelf, 'data-screen-x')), canvas.y + (await numberAttr(shelf, 'data-screen-y')));
    await expect(gizmo(page)).toHaveAttribute('data-module-uid', 'm1');

    // Keyboard grab: G, two snap steps right, Enter commits; Escape restores.
    await page.getByRole('radio', { name: 'Free XY' }).check();
    await viewport(page).focus();
    await page.keyboard.press('g');
    await expect(gizmo(page)).toHaveAttribute('data-grab', 'true');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(gizmo(page)).toHaveAttribute('data-x-cm', '115');
    await expect(shelf).toHaveAttribute('data-x-cm', '115');
    await page.keyboard.press('Enter');
    await expect(gizmo(page)).not.toHaveAttribute('data-grab');
    await expect(page.getByTestId('room-notice')).toHaveText('Moved Floating Shelf 110 to X 115 / Y 146 cm.');
    await page.keyboard.press('g');
    await page.keyboard.press('ArrowUp');
    await expect(gizmo(page)).toHaveAttribute('data-y-cm', '150');
    await page.keyboard.press('Escape');
    await expect(gizmo(page)).toHaveAttribute('data-y-cm', '146');
    await expect(shelf).toHaveAttribute('data-y-cm', '146');
    await expect(gizmo(page)).toHaveAttribute('data-module-uid', 'm1');

    // 1 cm free mode: G steps by single centimetres.
    const snap = page.getByTestId('room-grid-snap');
    await snap.click();
    await expect(snap).toHaveAttribute('aria-checked', 'false');
    await expect(snap).toContainText('1 cm Free');
    await viewport(page).focus();
    await page.keyboard.press('g');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(shelf).toHaveAttribute('data-x-cm', '114');
    expect(errors).toEqual([]);
  });
});

test.describe('inside-room 360 degree lens', () => {
  test('orbit cuts the near wall away; inside, the eye stands at 165 cm with all four walls and the ceiling around it and turns to each wall', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await openRoom(page);
    await rendererOf(page);
    await mount(page, 'Floating Shelf 110');
    await expect(walkState(page)).toHaveAttribute('data-camera-mode', 'orbit');

    // Orbit: the near wall is cut away and there is no ceiling.
    await expect(page.locator('[data-testid="room-wall"][data-wall="south"]')).toHaveAttribute('data-visible', 'false');
    await expect(page.getByTestId('room-ceiling')).toHaveAttribute('data-visible', 'false');
    await expect(page.getByTestId('viewport-compass')).toHaveAttribute('data-azimuth', '24');

    const lens = page.getByTestId('camera-lens-switcher');
    await expect(lens.getByRole('button')).toHaveCount(3);
    await expect(page.getByTestId('camera-mode-orbit')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('camera-mode-walkthrough').click();
    await expect(page.getByTestId('camera-mode-walkthrough')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('camera-mode-walkthrough')).toHaveAccessibleName('Inside Room (165 cm)');
    await expect(viewport(page)).toHaveAttribute('data-camera-mode', 'inside');

    const state = walkState(page);
    await expect(state).toHaveAttribute('data-camera-mode', 'inside');
    await expect(state).toHaveAttribute('data-eye-cm', '165');
    await expect(state).toHaveAttribute('data-x-cm', '160');
    await expect(state).toHaveAttribute('data-z-cm', '218');
    await expect(state).toHaveAttribute('data-heading-deg', '0');
    await expect(state).toHaveAttribute('data-facing-wall', 'north');
    for (const wall of ['north', 'east', 'south', 'west']) {
      await expect(page.locator(`[data-testid="room-wall"][data-wall="${wall}"]`), wall).toHaveAttribute('data-visible', 'true');
    }
    await expect(page.getByTestId('room-ceiling')).toHaveAttribute('data-visible', 'true');
    await expect(page.getByTestId('room-baseboard')).toHaveCount(4);
    // Orbit presets give way to the walk pad.
    await expect(page.getByTestId('camera-preset-front')).toHaveCount(0);
    await expect(page.getByTestId('walk-controls')).toBeVisible();

    // Eye illuminance matches the engine for the stored room and the stance.
    const stance = { xCm: 160, zCm: 218.4, headingDeg: 0, pitchDeg: 0 };
    const stored = sanitizeRoomState(await readStoredRoom(page));
    await expect(state).toHaveAttribute('data-eye-lux', String(eyeIlluminance(stored, stance)));
    expect(Number(await state.getAttribute('data-eye-lux'))).toBeGreaterThan(0);

    // Wall tabs swing the gaze round to face each wall dead-on.
    for (const [wall, heading] of [
      ['east', 90],
      ['south', 180],
      ['west', -90],
      ['north', 0],
    ]) {
      await page.getByTestId(`wall-tab-${wall}`).click();
      await expect(state, wall).toHaveAttribute('data-heading-deg', String(heading));
      await expect(state, wall).toHaveAttribute('data-facing-wall', wall);
      await expect(page.getByTestId('viewport-compass'), wall).toHaveAttribute('data-azimuth', String(heading));
    }

    // The two scenarios below open on this same stored room.
    const seeded = serializeRoomState(SHELF_ROOM);
    const kept = await readStoredRoom(page);
    expect({ room: kept.room, items: kept.items }).toEqual({ room: seeded.room, items: seeded.items });
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('inside, the walk pad and keys step within the wall buffer, the sofa stops the walk and a drag turns the head', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await openSeededRoom(page, SHELF_ROOM);
    const renderer = await rendererOf(page);
    await expect(page.getByTestId('room-module')).toHaveCount(1);
    await page.getByTestId('camera-mode-walkthrough').click();
    const state = walkState(page);
    await expect(state).toHaveAttribute('data-camera-mode', 'inside');
    await expect(state).toHaveAttribute('data-heading-deg', '0');

    // Step buttons walk; the wall buffer holds the eye 32 cm off the north wall.
    for (let i = 0; i < 8; i += 1) await page.getByTestId('walk-forward').click();
    await expect(state).toHaveAttribute('data-z-cm', '32');
    await page.getByTestId('turn-right').click();
    await expect(state).toHaveAttribute('data-heading-deg', '15');
    await page.getByTestId('walk-reset').click();
    await expect(state).toHaveAttribute('data-z-cm', '218');
    await expect(state).toHaveAttribute('data-heading-deg', '0');

    // Keys walk too: S steps back, D strafes right, Q turns left.
    await viewport(page).focus();
    await page.keyboard.press('s');
    await expect(state).toHaveAttribute('data-z-cm', '243');
    await page.keyboard.press('d');
    await expect(state).toHaveAttribute('data-x-cm', '185');
    await page.keyboard.press('q');
    await expect(state).toHaveAttribute('data-heading-deg', '-15');
    await page.keyboard.press('Home');
    await expect(state).toHaveAttribute('data-x-cm', '160');

    // The sofa stops the walk at its footprint.
    await page.getByRole('radio', { name: 'Modular Sofa 200cm' }).check();
    for (let i = 0; i < 6; i += 1) await page.getByTestId('walk-forward').click();
    await expect(state).toHaveAttribute('data-z-cm', '118');

    // A drag across the stage turns the head; the turn commits on release.
    if (renderer !== 'unavailable') {
      const box = await viewport(page).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height * 0.3, { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => Number(await state.getAttribute('data-heading-deg'))).toBeGreaterThan(30);
    }
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('from inside, Wall Elevation looks dead-on at the active wall from outside the opposite one and Orbit brings the presets back', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await openSeededRoom(page, SHELF_SOFA_ROOM);
    await rendererOf(page);
    await expect(viewport(page)).toHaveAttribute('data-furniture', 'sofa-200');
    await page.getByTestId('camera-mode-walkthrough').click();
    await expect(walkState(page)).toHaveAttribute('data-camera-mode', 'inside');

    // Wall Elevation then looks dead-on at the active wall from outside the opposite one.
    await page.getByTestId('wall-tab-north').click();
    await page.getByTestId('camera-mode-elevation').click();
    await expect(page.locator('[data-testid="room-wall"][data-wall="south"]')).toHaveAttribute('data-visible', 'false');
    await expect(page.locator('[data-testid="room-wall"][data-wall="north"]')).toHaveAttribute('data-visible', 'true');
    await expect(page.getByTestId('room-lens-readout')).toHaveText('Wall Elevation / North Wall');
    await page.getByTestId('camera-mode-orbit').click();
    await expect(page.getByTestId('camera-preset-front')).toBeVisible();
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('the outliner groups modules by wall and Focus in 3D turns the view to a module', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    let state = createRoomState();
    for (const [wall, productId] of [
      ['north', 'floating-shelf-110'],
      ['east', 'modular-cube-36'],
      ['west', 'acoustic-art-frame-50x70'],
    ]) {
      state = mountInRoom(state, productId, wall).state;
    }
    await page.goto('/');
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [ROOM_KEY, JSON.stringify(serializeRoomState(state))]);
    await openRoom(page);

    const outliner = page.getByTestId('room-module-list');
    await expect(outliner.getByTestId('outliner-north')).toHaveAttribute('data-count', '1');
    await expect(outliner.getByTestId('outliner-east')).toHaveAttribute('data-count', '1');
    await expect(outliner.getByTestId('outliner-south')).toHaveAttribute('data-count', '0');
    await expect(outliner.getByTestId('outliner-north')).toHaveAttribute('data-active', 'true');
    await expect(outliner.getByTestId('outliner-west').locator('[data-uid="m3"]')).toContainText('Acoustic Art Frame');

    await outliner.locator('[data-focus-uid="m3"]').click();
    await expect(viewport(page)).toHaveAttribute('data-active-wall', 'west');
    await expect(page.getByTestId('wall-tab-west')).toHaveAttribute('aria-pressed', 'true');
    await expect(gizmo(page)).toHaveAttribute('data-module-uid', 'm3');
    await expect(gizmo(page)).toHaveAttribute('data-wall', 'west');

    // The compass faces walls too, and EYE stands inside.
    await page.getByTestId('compass-east').click();
    await expect(viewport(page)).toHaveAttribute('data-active-wall', 'east');
    await page.getByTestId('compass-eye').click();
    await expect(viewport(page)).toHaveAttribute('data-camera-mode', 'inside');
    await expect(walkState(page)).toHaveAttribute('data-heading-deg', '90');
    await page.getByTestId('compass-iso').click();
    await expect(viewport(page)).toHaveAttribute('data-camera-mode', 'orbit');
    await expect(viewport(page)).toHaveAttribute('data-preset', 'corner');
    expect(errors).toEqual([]);
  });
});

test.describe('studio boot, zen viewport and skip link', () => {
  test('the engine boot clears itself, never takes the pointer and replays on request', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    // A held engine never reports ready, so the boot and every replay stay up until Enter Studio
    // Now or the release: no step races the overlay's wall-clock hold.
    const releaseEngine = await holdEngineChunk(page);
    await openRoom(page);
    const boot = page.getByTestId('studio-boot-overlay');
    await expect(boot).toHaveCount(1);
    await expect(boot).toHaveAttribute('data-state', 'booting');
    await expect(boot).toHaveAttribute('data-run', '0');
    await page.getByTestId('skip-studio-boot').click();
    await expect(boot).toHaveAttribute('data-state', 'done');
    expect(await boot.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    await expect(boot).toBeHidden();

    const replay = page.getByTestId('replay-studio-boot');
    await replay.click();
    await expect(boot).toHaveAttribute('data-run', '1');
    await expect(boot).toHaveAttribute('data-state', 'booting');
    await expect(boot).toBeVisible();
    await page.getByTestId('skip-studio-boot').click();
    await expect(boot).toHaveAttribute('data-state', 'done');

    await replay.click();
    await expect(boot).toHaveAttribute('data-run', '2');
    await expect(boot).toHaveAttribute('data-state', 'booting');
    await expect(boot).toContainText(ENGINE_LABEL);
    await expect(boot).toContainText('01 / WebGL2 Shader Pipeline');
    await expect(boot).toContainText('02 / 4-Wall Raycast & Gizmo Solver');
    await expect(boot).toContainText('03 / 24V Photometric Kernel');
    // The stage under it stays live while it plays, and it clears on its own once the engine is ready.
    await page.getByTestId('camera-settings-toggle').click();
    await expect(page.getByTestId('camera-settings-toggle')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(boot).toHaveAttribute('data-state', 'booting');
    releaseEngine();
    await expect(boot).toHaveAttribute('data-state', 'done', { timeout: 20_000 });

    // Under reduced motion it never plays at all.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(boot).toHaveAttribute('data-state', 'done');
    expect(errors).toEqual([]);
  });

  test('zen collapses both docks so the viewport takes the full width, and restores them', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRoom(page);
    const stage = page.getByRole('region', { name: 'Room viewport' });
    const controls = page.locator('.room3d-layout__controls');
    const inspector = page.locator('.room3d-layout__inspector');
    const docked = (await stage.boundingBox()).width;
    expect(docked).toBeLessThan(1440 - 500);

    const zen = page.getByTestId('toggle-zen-viewport');
    await expect(zen).toHaveAttribute('aria-pressed', 'false');
    await zen.click();
    await expect(zen).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.room3d-workstation')).toHaveAttribute('data-zen', 'true');
    await expect(controls).toHaveAttribute('inert', '');
    await expect(controls).toBeHidden();
    await expect(inspector).toBeHidden();
    await expect.poll(async () => (await stage.boundingBox()).width).toBeGreaterThan(1440 - 40);
    // The 3D tools stay in reach in zen.
    await expect(page.getByTestId('active-wall-switcher')).toBeVisible();
    await expect(page.getByTestId('camera-settings-toggle')).toBeVisible();

    await zen.click();
    await expect(controls).toBeVisible();
    await expect(page.getByTestId('room-palette')).toBeVisible();
    await expect.poll(async () => (await stage.boundingBox()).width).toBeLessThan(docked + 2);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test('a keyboard skip link jumps past the navbar to the main landmark', async ({ page }) => {
    await openRoom(page);
    await page.keyboard.press('Tab');
    const skip = page.getByTestId('skip-to-main');
    await expect(skip).toBeFocused();
    await expect(skip).toHaveText('Skip to main content');
    await expect(skip).toHaveAttribute('href', '#main-content');
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main-content')).toBeFocused();
    await expect(page.getByRole('main')).toHaveAttribute('id', 'main-content');
  });
});
