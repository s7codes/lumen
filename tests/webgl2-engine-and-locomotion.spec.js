import { expect, test } from '@playwright/test';
import { PRODUCTS } from '../src/data/products.js';
import { applyLightingSceneToRoom } from '../src/lib/lighting-scenes.js';
import {
  contactShadowMap,
  finishMaterial,
  PBR_MATERIAL_KEYS,
  PBR_MATERIALS,
  synthesizeMaterial,
} from '../src/lib/pbr-materials.js';
import {
  clearanceCallouts,
  createRoomState,
  DEFAULT_ROOM,
  furnitureLayout,
  mountInRoom,
  ROOM_STORAGE_KEY,
  ROOM_WALLS,
  sanitizeRoom,
  sanitizeRoomState,
  updateRoomItem,
  windowWallOf,
} from '../src/lib/room-3d.js';
import { buildScene } from '../src/lib/room-scene.js';
import {
  coastWalk,
  defaultStance,
  furnitureZone,
  placeWalk,
  rampWalkVelocity,
  RUN_SPEED,
  stepContinuousWalk,
  stepWalk,
  WALK_ACCEL_TAU_S,
  WALK_DECEL_TAU_S,
  WALK_SPEED,
  WALL_BUFFER_CM,
  walkIntent,
  walkKey,
  walkTargetVelocity,
} from '../src/lib/room-walkthrough.js';
import { decodeSceneParam, encodeSceneParam } from '../src/lib/scene-codec.js';
import { formatSolarHour, sanitizeSolarHour, solarState } from '../src/lib/solar-path.js';
import { collectRuntimeErrors, installCspRecorder, readCspViolations, storeDisplayMode } from './support/runtime-guards.js';

const ROOM_KEY = `lumen:${ROOM_STORAGE_KEY}`;
const SHELF = 'floating-shelf-110';
const FRAME = 'acoustic-art-frame-50x70';
const SIDEBOARD = 'compact-sideboard-75';
const PENDANT = 'linear-pendant-150';
const STOP = Object.freeze({ forward: 0, strafe: 0, turn: 0 });
const rounded = (vector) => vector.map((c) => Number(c.toFixed(4)) + 0).join(' ');

function viewport(page) {
  return page.getByTestId('room-viewport');
}

function walkState(page) {
  return page.getByTestId('room-walkthrough-state');
}

function roomModule(page, uid) {
  return page.locator(`[data-testid="room-module"][data-uid="${uid}"]`);
}

async function openRoom(page) {
  await page.goto('/room-3d');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
}

async function rendererOf(page) {
  await expect(viewport(page)).not.toHaveAttribute('data-renderer', 'loading', { timeout: 20_000 });
  return viewport(page).getAttribute('data-renderer');
}

function readStoredRoom(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROOM_KEY);
}

/** Two animation frames: anything a frame would have done has happened. */
function settleFrames(page) {
  return page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/**
 * Samples the walk mirror every animation frame until `key` has moved by
 * `travel` cm in `sign` direction, returning every reading. The end is the
 * distance, not a clock: a loaded runner draws fewer frames, and the engine
 * clamps each frame's dt, so the walk slows there but never stalls. The
 * 20 s ceiling only keeps a broken walk from hanging the page.
 */
function sampleWalk(page, key, sign, travel) {
  return page.evaluate(
    ([field, direction, distance]) =>
      new Promise((resolve) => {
        const el = document.querySelector('[data-testid="room-walkthrough-state"]');
        const start = Number(el.dataset[field]);
        // The starting reading leads the samples: the engine's own frame may run
        // before the first sampling frame and move the walk on already.
        const seen = [{ value: start, speed: Number(el.dataset.speedCms ?? 0) }];
        const t0 = performance.now();
        const tick = () => {
          const value = Number(el.dataset[field]);
          seen.push({ value, speed: Number(el.dataset.speedCms ?? 0) });
          if ((value - start) * direction >= distance || performance.now() - t0 > 20_000) resolve(seen);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [key, sign, travel],
  );
}

/** Mean absolute step between neighbouring texels, across (v) and along (u), and across each wrap seam. */
function texelSteps(buffer, width, height) {
  const at = (i, j) => buffer[(j * width + i) * 4];
  let alongU = 0;
  let acrossV = 0;
  let wrapU = 0;
  let wrapV = 0;
  for (let j = 0; j < height; j += 1) for (let i = 0; i < width - 1; i += 1) alongU += Math.abs(at(i + 1, j) - at(i, j));
  for (let j = 0; j < height - 1; j += 1) for (let i = 0; i < width; i += 1) acrossV += Math.abs(at(i, j + 1) - at(i, j));
  for (let j = 0; j < height; j += 1) wrapU += Math.abs(at(0, j) - at(width - 1, j));
  for (let i = 0; i < width; i += 1) wrapV += Math.abs(at(i, 0) - at(i, height - 1));
  return {
    alongU: alongU / (height * (width - 1)),
    acrossV: acrossV / ((height - 1) * width),
    wrapU: wrapU / height,
    wrapV: wrapV / width,
  };
}

function channelMean(buffer, channel) {
  let sum = 0;
  for (let i = channel; i < buffer.length; i += 4) sum += buffer[i];
  return sum / (buffer.length / 4);
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('continuous 60-240 Hz locomotion', () => {
  test('held keys ramp to an architectural walking pace, frame-rate independent, slide along furniture and coast to rest', () => {
    expect(walkKey('W')).toBe('w');
    expect(walkKey('ArrowUp')).toBe('arrowup');
    expect(walkKey('g')).toBeNull();
    expect(walkKey('constructor')).toBeNull();
    expect(walkIntent(['w'])).toEqual({ forward: 1, strafe: 0, turn: 0 });
    expect(walkIntent(['w', 's'])).toEqual(STOP);
    const diagonal = walkIntent(['w', 'd']);
    expect(Math.hypot(diagonal.forward, diagonal.strafe)).toBeCloseTo(1, 10);

    // A natural walking pace: 145 cm/s ahead, 120 cm/s sideways, 78 deg/s turning, 215 cm/s with Shift.
    expect(WALK_SPEED).toEqual({ forward: 145, strafe: 120, turn: 78 });
    expect(walkTargetVelocity(walkIntent(['w']))).toEqual({ forward: 145, strafe: 0, turn: 0 });
    expect(walkTargetVelocity(walkIntent(['d', 'e']))).toEqual({ forward: 0, strafe: 120, turn: 78 });
    expect(walkTargetVelocity(walkIntent(['arrowup']), true).forward).toBe(RUN_SPEED.forward);
    expect(RUN_SPEED.forward).toBe(215);

    // One time constant reaches 1 - 1/e: 0.11 s speeding up, 0.09 s slowing down.
    const target = walkTargetVelocity(walkIntent(['w']));
    expect(rampWalkVelocity(STOP, target, WALK_ACCEL_TAU_S).forward).toBeCloseTo(145 * (1 - Math.exp(-1)), 6);
    expect(rampWalkVelocity({ ...STOP, forward: 145 }, STOP, WALK_DECEL_TAU_S).forward).toBeCloseTo(145 * Math.exp(-1), 6);

    // 240 Hz and 60 Hz trace the same ramp and nearly the same path.
    const room = createRoomState().room;
    const walkFor = (hz, seconds) => {
      let pose = defaultStance(room);
      let velocity = STOP;
      const dt = 1 / hz;
      for (let i = 0; i < Math.round(seconds * hz); i += 1) {
        velocity = rampWalkVelocity(velocity, target, dt);
        pose = stepContinuousWalk(pose, room, velocity, dt);
      }
      return { pose, velocity };
    };
    const fast = walkFor(240, 0.8);
    const slow = walkFor(60, 0.8);
    expect(fast.velocity.forward).toBeCloseTo(slow.velocity.forward, 6);
    expect(Math.abs(fast.pose.zCm - slow.pose.zCm)).toBeLessThan(1.6);
    const covered = 145 * (0.8 - WALK_ACCEL_TAU_S * (1 - Math.exp(-0.8 / WALK_ACCEL_TAU_S)));
    expect(Math.abs(defaultStance(room).zCm - fast.pose.zCm - covered)).toBeLessThan(1);
    expect(fast.pose.xCm).toBe(defaultStance(room).xCm);

    // The 32 cm wall buffer holds.
    let pose = { xCm: 160, zCm: 60, headingDeg: 0, pitchDeg: 0 };
    for (let i = 0; i < 120; i += 1) pose = stepContinuousWalk(pose, room, { ...STOP, forward: 145 }, 1 / 60);
    expect(pose.zCm).toBe(WALL_BUFFER_CM);

    // Walking north-east into the sofa footprint stops on its edge and slides along it.
    const sofa = { ...room, furniture: 'sofa-200' };
    const zone = furnitureZone(sofa);
    pose = { xCm: 150, zCm: 200, headingDeg: 45, pitchDeg: 0 };
    for (let i = 0; i < 70; i += 1) pose = stepContinuousWalk(pose, sofa, { ...STOP, forward: 145 }, 1 / 60);
    expect(pose.zCm).toBe(zone.z1);
    expect(pose.xCm).toBeGreaterThan(210);
    expect(pose.xCm).toBeLessThan(zone.x1);

    // Turning integrates unfolded; the commit folds and rounds to 0.1 deg.
    const turned = stepContinuousWalk({ xCm: 160, zCm: 200, headingDeg: 170, pitchDeg: 0 }, room, { ...STOP, turn: 78 }, 0.5);
    expect(turned.headingDeg).toBeCloseTo(209, 6);
    expect(placeWalk(turned, room, {}).headingDeg).toBe(-151);
    expect(placeWalk(defaultStance(room), room, { xCm: 400, zCm: 'x' })).toMatchObject({ xCm: 288, zCm: 218.4 });

    // A released walk coasts v x tau further, and never through a wall.
    const rest = coastWalk({ xCm: 160, zCm: 150, headingDeg: 0, pitchDeg: 0 }, room, { vx: 0, vz: -145, vh: 0 });
    expect(rest.zCm).toBeCloseTo(150 - 145 * WALK_DECEL_TAU_S, 6);
    expect(coastWalk({ xCm: 160, zCm: 40, headingDeg: 0, pitchDeg: 0 }, room, { vx: 0, vz: -145, vh: 0 }).zCm).toBe(WALL_BUFFER_CM);

    // The tapped stride is untouched.
    expect(stepWalk(defaultStance(room), room, { forward: 1 }).zCm).toBe(193.4);
  });

  test('inside the room a tap steps exactly 25 cm, a held key walks every frame without OS repeat stalls and commits once', async ({
    page,
  }) => {
    // Three timed walks: room for a loaded runner that draws few frames per second.
    test.slow();
    const errors = collectRuntimeErrors(page);
    await openRoom(page);
    test.skip((await rendererOf(page)) === 'unavailable', 'Continuous walking runs in the WebGL frame loop.');
    await page.getByTestId('camera-mode-walkthrough').click();
    const state = walkState(page);
    await expect(state).toHaveAttribute('data-lens-live', 'inside');
    await expect(state).toHaveAttribute('data-z-cm', '218');
    await viewport(page).focus();

    // press() is a keydown and a keyup with no frame held in between: one exact stride each.
    await page.keyboard.press('w');
    await expect(state).toHaveAttribute('data-z-cm', '193');
    await page.keyboard.press('ArrowUp');
    await expect(state).toHaveAttribute('data-z-cm', '168');
    await expect(state).not.toHaveAttribute('data-locomotion');

    // Keydowns flagged as OS key repeat never step on their own while the rig drives the walk.
    await viewport(page).evaluate((el) => {
      for (let i = 0; i < 6; i += 1) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', repeat: true, bubbles: true }));
    });
    await settleFrames(page);
    await expect(state).toHaveAttribute('data-z-cm', '168');

    // Holding W: Playwright sends one keydown and no repeats, yet the walk keeps going frame by frame.
    await page.keyboard.down('w');
    await expect(state).toHaveAttribute('data-locomotion', 'continuous');
    const forward = await sampleWalk(page, 'zCm', -1, 50);
    await page.keyboard.up('w');
    const zs = forward.map((sample) => sample.value);
    expect(zs[0] - zs.at(-1)).toBeGreaterThanOrEqual(50);
    expect(new Set(zs).size).toBeGreaterThan(4);
    for (let i = 1; i < zs.length; i += 1) {
      expect(zs[i], `frame ${i}`).toBeLessThanOrEqual(zs[i - 1]);
      expect(zs[i - 1] - zs[i], `frame ${i}`).toBeLessThan(12);
    }

    // Letting go commits once, where the walk came to rest; React's readout agrees with the mirror.
    await expect(state).not.toHaveAttribute('data-locomotion');
    const z = Number(await state.getAttribute('data-z-cm'));
    expect(z).toBeLessThanOrEqual(168 - 50);
    await expect(state).toHaveAttribute('data-x-cm', '160');
    await expect(page.getByTestId('room-lens-readout')).toContainText(`X 160 Z ${z}`);

    // Shift strides out past the walking pace; backing off south has the room for it.
    await page.keyboard.down('Shift');
    await page.keyboard.down('s');
    await expect(state).toHaveAttribute('data-locomotion', 'continuous');
    const back = await sampleWalk(page, 'zCm', 1, 70);
    await page.keyboard.up('s');
    await page.keyboard.up('Shift');
    expect(Math.max(...back.map((sample) => sample.speed))).toBeGreaterThan(WALK_SPEED.forward + 20);
    await expect(state).not.toHaveAttribute('data-locomotion');

    // A held turn swings the gaze smoothly past the 15 deg tap.
    await page.keyboard.down('e');
    await expect(state).toHaveAttribute('data-locomotion', 'continuous');
    await expect.poll(async () => Number(await state.getAttribute('data-heading-deg'))).toBeGreaterThan(40);
    await page.keyboard.up('e');
    await expect(state).not.toHaveAttribute('data-locomotion');
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});

test.describe('parametric CAD sub-assemblies and volumetric light', () => {
  test('every catalogue part builds a multi-part CAD assembly and lit parts throw beams that follow DALI-2 levels', () => {
    let state = createRoomState({ widthCm: 640, depthCm: 520, heightCm: 300 });
    for (const productId of [SHELF, FRAME, SIDEBOARD, PENDANT]) state = mountInRoom(state, productId).state;
    const scene = buildScene({ state });
    expect(JSON.stringify(scene)).toBe(JSON.stringify(buildScene({ state })));
    const byProduct = Object.fromEntries(scene.modules.map((module) => [module.productId, module]));
    const kinds = (productId) => byProduct[productId].subparts.map((part) => part.kind);

    const total = scene.modules.reduce((sum, module) => sum + module.subparts.length, 0);
    expect(total).toBeGreaterThan(40);
    expect(scene.stats.submeshes).toBe(total);

    // Shelf: slab, cleat, LED channel and curated objects on top.
    expect(kinds(SHELF)).toEqual(expect.arrayContaining(['slab', 'cleat', 'channel', 'object']));
    // Frame: a mitred timber frame round nine fluted felt slats with shadow gaps.
    const slats = byProduct[FRAME].subparts.filter((part) => part.kind === 'slat');
    expect(slats).toHaveLength(9);
    expect(slats.every((slat) => slat.material === 'felt-acoustic')).toBe(true);
    expect(kinds(FRAME).filter((kind) => kind === 'rail' || kind === 'stile')).toHaveLength(4);
    // Sideboard: twin doors with a 6 mm reveal, twin steel pulls, a shadow-line plinth.
    expect(kinds(SIDEBOARD).filter((kind) => kind === 'door')).toHaveLength(2);
    expect(kinds(SIDEBOARD).filter((kind) => kind === 'handle')).toHaveLength(2);
    expect(byProduct[SIDEBOARD].subparts.find((part) => part.kind === 'reveal').size[0]).toBeCloseTo(0.006, 6);
    expect(kinds(SIDEBOARD)).toContain('plinth');
    // Pendant: a louvred beam on twin cables plus the feed, up to a ceiling canopy.
    expect(kinds(PENDANT).filter((kind) => kind === 'cable')).toHaveLength(3);
    expect(kinds(PENDANT)).toEqual(expect.arrayContaining(['beam', 'louver', 'canopy']));

    // The bounding primitive stays for picking, collisions and every existing reader.
    expect(byProduct[SHELF]).toMatchObject({ geometry: 'box', size: [1.1, 0.08, 0.25] });
    for (const module of scene.modules) {
      for (const part of module.subparts) {
        expect(['box', 'cylinder']).toContain(part.geometry);
        expect(PBR_MATERIALS[part.material], part.id).toBeTruthy();
        expect(part.size.every((c) => c > 0), part.id).toBe(true);
        expect(part.rotation).toHaveLength(3);
        expect(part.position.every(Number.isFinite), part.id).toBe(true);
      }
    }

    // All twelve parts on four walls carry their own assemblies and contact shadows.
    let all = createRoomState({ widthCm: 900, depthCm: 900, heightCm: 320 });
    PRODUCTS.forEach((product, i) => {
      all = mountInRoom(all, product.id, ROOM_WALLS[i % 4]).state;
    });
    const allScene = buildScene({ state: all });
    expect(allScene.modules).toHaveLength(12);
    for (const module of allScene.modules) {
      expect(module.subparts.length, module.productId).toBeGreaterThanOrEqual(6);
      expect(module.aoShadow.opacity, module.productId).toBeGreaterThan(0);
    }
    expect(allScene.modules.find((module) => module.productId === 'corner-floor-column-140').aoFloor).not.toBeNull();

    // Beams: a wash, a halo, a graze and a pyramid; dimming scales them, the channel switches them.
    expect(scene.stats.volumetrics).toBe(4);
    const wash = byProduct[SHELF].volumetrics[0];
    expect(wash).toMatchObject({ kind: 'fan', geometry: 'plane', color: '#ffa757' });
    expect(byProduct[PENDANT].volumetrics[0]).toMatchObject({ kind: 'pyramid', geometry: 'plane' });
    expect(byProduct[FRAME].volumetrics[0]).toMatchObject({ kind: 'halo', symmetric: true });
    const uid = byProduct[SHELF].uid;
    const half = buildScene({ state: updateRoomItem(state, uid, { dimPct: 50 }) });
    expect(half.modules.find((module) => module.uid === uid).volumetrics[0].opacity).toBeCloseTo(wash.opacity / 2, 3);
    const off = buildScene({ state: updateRoomItem(state, uid, { led: false }) });
    expect(off.modules.find((module) => module.uid === uid).volumetrics).toEqual([]);
    expect(off.stats.volumetrics).toBe(3);
    // Night Gallery drops task light to 20%; Morning Focus moves to daylight, where beams read thinner.
    const night = buildScene({ state: applyLightingSceneToRoom(state, 'night') });
    expect(night.modules.find((module) => module.uid === uid).volumetrics[0].opacity).toBeCloseTo(wash.opacity * 0.2, 3);
    const morning = buildScene({ state: applyLightingSceneToRoom(state, 'morning') });
    expect(morning.modules.find((module) => module.uid === uid).volumetrics[0].opacity).toBeCloseTo(wash.opacity * 0.3, 3);

    // Reference furniture keeps its collision parts and gains its detail.
    const furnished = buildScene({ state: createRoomState({ ...DEFAULT_ROOM, furniture: 'sofa-200' }) });
    expect(furnished.furniture.map((part) => part.part)).toEqual(furnitureLayout({ ...DEFAULT_ROOM, furniture: 'sofa-200' }).parts.map((p) => p.id));
    const plinth = furnished.furniture.find((part) => part.part === 'plinth');
    expect(plinth.body).toBe(false);
    expect(plinth.subparts.filter((part) => part.kind === 'leg')).toHaveLength(6);
    expect(plinth.subparts[0]).toMatchObject({ geometry: 'cylinder' });
    expect(plinth.subparts[0].radius).toBeGreaterThan(plinth.subparts[0].radiusBottom);
    expect(furnished.furniture.find((part) => part.part === 'arm-left').subparts.map((p) => p.kind)).toContain('bolster');
    expect(furnished.furnitureAo).toMatchObject({ opacity: 0.55 });
    const bed = buildScene({ state: createRoomState({ ...DEFAULT_ROOM, furniture: 'bed-160' }) });
    expect(bed.furniture.find((part) => part.part === 'frame').subparts.map((p) => p.kind)).toContain('headboard');
    const desk = buildScene({ state: createRoomState({ ...DEFAULT_ROOM, furniture: 'desk-140' }) });
    expect(desk.furniture.find((part) => part.part === 'top').subparts.map((p) => p.kind)).toEqual(
      expect.arrayContaining(['monitor', 'lamp', 'object']),
    );
  });

  test('the viewport draws the assemblies, beams track the dimmer and the channel, and Specs shows engine telemetry', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await storeDisplayMode(page, 'technical');
    await openRoom(page);
    for (const name of ['Floating Shelf 110', 'Acoustic Art Frame 50x70', 'Compact Sideboard 75', 'Linear Suspension Pendant 150']) {
      await page.getByRole('button', { name: `Mount ${name}`, exact: true }).click();
    }
    await expect(page.getByTestId('room-module')).toHaveCount(4);
    await expect.poll(async () => (await readStoredRoom(page)).items.length).toBe(4);
    const stored = sanitizeRoomState(await readStoredRoom(page));
    const scene = buildScene({ state: stored });
    expect(scene.stats.submeshes).toBeGreaterThan(40);

    const graph = page.getByTestId('room-scene-graph');
    await expect(graph).toHaveAttribute('data-submeshes', String(scene.stats.submeshes));
    await expect(graph).toHaveAttribute('data-volumetrics', String(scene.stats.volumetrics));
    for (const module of scene.modules) {
      await expect(roomModule(page, module.uid), module.productId).toHaveAttribute('data-subparts', String(module.subparts.length));
    }
    const telemetry = page.getByTestId('room-polygons');
    await expect(telemetry).toHaveText(
      `${scene.stats.meshes} meshes / ${scene.stats.submeshes} CAD sub-parts / ${scene.stats.volumetrics} volumetric beams / ${scene.stats.lights} lights`,
    );

    // Dimming the shelf to 50% halves its beam in the air. Mounting left the pendant
    // selected, so Escape clears it and the outliner picks the shelf.
    const shelf = roomModule(page, 'm1');
    const fullBeam = Number(await shelf.getAttribute('data-beam-opacity'));
    expect(fullBeam).toBeGreaterThan(0);
    await viewport(page).focus();
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="room-module-list"] [data-uid="m1"]').click();
    await page.getByTestId('module-dim-slider').fill('50');
    await expect(shelf).toHaveAttribute('data-dim-pct', '50');
    await expect.poll(async () => Number(await shelf.getAttribute('data-beam-opacity'))).toBeCloseTo(fullBeam / 2, 3);

    // Switching its 24V channel off takes the beam out of the air altogether.
    await page.getByTestId('room-led-channel').click();
    await expect(shelf).toHaveAttribute('data-volumetrics', '0');
    await expect(graph).toHaveAttribute('data-volumetrics', String(scene.stats.volumetrics - 1));
    if ((await rendererOf(page)) !== 'unavailable') await expect(graph).toHaveAttribute('data-renderer', 'webgl2');
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});

test.describe('procedural PBR synthesizer', () => {
  test('synthesises deterministic, tileable albedo, bump, normal and roughness maps for wood, metal, felt and parquet', () => {
    expect(PBR_MATERIAL_KEYS).toEqual([
      'wood-walnut',
      'wood-oak',
      'metal-obsidian',
      'metal-steel',
      'felt-acoustic',
      'matte-chalk',
      'floor-parquet',
      'wall-plaster',
    ]);
    expect(synthesizeMaterial('__proto__')).toBeNull();
    expect(synthesizeMaterial('constructor')).toBeNull();
    expect(['walnut', 'oak', 'obsidian', 'chalk', 'constructor'].map(finishMaterial)).toEqual([
      'wood-walnut',
      'wood-oak',
      'metal-obsidian',
      'matte-chalk',
      'matte-chalk',
    ]);
    expect(PBR_MATERIALS['wood-walnut']).toMatchObject({ roughness: 0.58, bumpScale: 0.008 });
    expect(PBR_MATERIALS['metal-obsidian']).toMatchObject({ roughness: 0.32, metalness: 0.38, bumpScale: 0.004 });
    expect(PBR_MATERIALS['felt-acoustic']).toMatchObject({ roughness: 0.92, bumpScale: 0.012 });

    for (const key of PBR_MATERIAL_KEYS) {
      const a = synthesizeMaterial(key);
      const b = synthesizeMaterial(key);
      for (const map of ['albedoMap', 'bumpMap', 'normalMap', 'roughnessMap']) {
        expect(a[map]).toBeInstanceOf(Uint8Array);
        expect(a[map].length, `${key} ${map}`).toBe(a.width * a.height * 4);
        expect(Buffer.compare(Buffer.from(a[map]), Buffer.from(b[map])), `${key} ${map}`).toBe(0);
      }
      // Tangent-space normals lean straight out on average.
      expect(Math.abs(channelMean(a.normalMap, 0) - 127.5), key).toBeLessThan(3);
      expect(Math.abs(channelMean(a.normalMap, 1) - 127.5), key).toBeLessThan(3);
      expect(channelMean(a.normalMap, 2), key).toBeGreaterThan(235);
      // Roughness sits in green, where three.js reads it, around the family's value.
      expect(channelMean(a.roughnessMap, 1) / 255, key).toBeCloseTo(PBR_MATERIALS[key].roughness, 1);
      // Tileable: crossing a wrap seam is no harsher than stepping between interior texels.
      if (key !== 'floor-parquet') {
        const steps = texelSteps(a.bumpMap, a.width, a.height);
        expect(steps.wrapU / Math.max(steps.alongU, 0.05), `${key} u seam`).toBeLessThan(3);
        expect(steps.wrapV / Math.max(steps.acrossV, 0.05), `${key} v seam`).toBeLessThan(3);
      }
    }

    // Grain and brushing run along u; felt and plaster fibre is isotropic.
    const anisotropy = (key) => {
      const m = synthesizeMaterial(key);
      const steps = texelSteps(m.bumpMap, m.width, m.height);
      return steps.acrossV / steps.alongU;
    };
    expect(anisotropy('wood-walnut')).toBeGreaterThan(4);
    expect(anisotropy('wood-oak')).toBeGreaterThan(4);
    expect(anisotropy('metal-steel')).toBeGreaterThan(8);
    expect(anisotropy('felt-acoustic')).toBeGreaterThan(0.7);
    expect(anisotropy('felt-acoustic')).toBeLessThan(1.4);
    expect(anisotropy('wall-plaster')).toBeLessThan(1.4);

    // Parquet: a dark seam opens every 18 cm plank (32 texel rows), lighter timber between.
    const floor = synthesizeMaterial('floor-parquet');
    const row = (j) => {
      let sum = 0;
      for (let i = 0; i < floor.width; i += 1) sum += floor.albedoMap[(j * floor.width + i) * 4];
      return sum / floor.width;
    };
    for (const seam of [0, 32, 64, 96]) expect(row(seam), `seam ${seam}`).toBeLessThan(row(seam + 16) * 0.75);

    // Contact occlusion is dense under the object and gone at the plane's edge.
    const ao = contactShadowMap(64);
    expect(ao.data[(32 * 64 + 32) * 4]).toBe(255);
    expect(ao.data[0]).toBe(0);
    expect(ao.data[(32 * 64) * 4]).toBe(0);
  });
});

test.describe('solar path and orientable floor reference', () => {
  test('the sun, the window and the furniture placement are pure, sanitized and leave older rooms byte for byte', () => {
    const golden = solarState(17.5);
    expect(golden).toMatchObject({ hour: 17.5, label: '17:30', kelvin: 2900, up: true });
    expect(golden.azimuthDeg).toBeGreaterThan(250);
    expect(golden.azimuthDeg).toBeLessThan(280);
    expect(golden.elevationDeg).toBeGreaterThan(20);
    expect(golden.elevationDeg).toBeLessThan(35);
    expect(golden.direction[0]).toBeLessThan(-0.8);
    expect(Math.hypot(...golden.direction)).toBeCloseTo(1, 10);
    expect(solarState(13)).toMatchObject({ kelvin: 6000, azimuthDeg: 180, strength: 1 });
    expect(solarState(20).kelvin).toBe(2200);
    expect(solarState(7).azimuthDeg).toBeLessThan(90);
    expect(solarState(21)).toMatchObject({ up: false, strength: 0 });
    expect([3, 30, 17.4, '17', Number.NaN].map(sanitizeSolarHour)).toEqual([6, 21, 17.5, 14.5, 14.5]);
    expect(formatSolarHour(6.25)).toBe('06:15');

    // Defaults stay off the record, so older rooms store and compare exactly as before.
    expect(createRoomState().room).toEqual(DEFAULT_ROOM);
    expect(Object.keys(sanitizeRoom({ ...DEFAULT_ROOM, solarHour: 14.5, furnitureWall: 'north', furnitureOffsetCm: 0 }))).toEqual(
      Object.keys(DEFAULT_ROOM),
    );
    const placed = { ...DEFAULT_ROOM, furniture: 'bed-160', solarHour: 17.5, windowWall: 'east', furnitureWall: 'east', furnitureOffsetCm: 40 };
    expect(sanitizeRoom(placed)).toEqual(placed);
    // Hostile or impossible values are dropped or clamped, never stored.
    expect(
      sanitizeRoom({ ...DEFAULT_ROOM, furniture: 'sofa-200', windowWall: 'north', furnitureWall: '__proto__', solarHour: Infinity, furnitureOffsetCm: 1e9 }),
    ).toEqual({ ...DEFAULT_ROOM, furniture: 'sofa-200', furnitureOffsetCm: 60 });
    expect(sanitizeRoom({ ...DEFAULT_ROOM, furnitureWall: 'east', furnitureOffsetCm: 30 })).toEqual(DEFAULT_ROOM);
    expect(windowWallOf(DEFAULT_ROOM)).toBe('none');
    expect(windowWallOf({ ...DEFAULT_ROOM, lighting: 'daylight' })).toBe('west');

    // The sofa turned onto the east wall: bounds, the walk zone and the walkway turn with it.
    const north = { ...DEFAULT_ROOM, furniture: 'sofa-200' };
    const east = { ...north, furnitureWall: 'east' };
    expect(furnitureLayout(north).bounds).toEqual({ x0: 60, x1: 260, y0: 0, y1: 78, z0: 6, z1: 98 });
    expect(furnitureLayout(east).bounds).toEqual({ x0: 222, x1: 314, y0: 0, y1: 78, z0: 40, z1: 240 });
    expect(furnitureZone(east)).toEqual({ x0: 202, x1: 334, z0: 20, z1: 260 });
    let walk = { xCm: 100, zCm: 140, headingDeg: 90, pitchDeg: 0 };
    for (let i = 0; i < 10; i += 1) walk = stepWalk(walk, east, { forward: 1 });
    expect(walk.xCm).toBe(202);
    expect(clearanceCallouts(createRoomState(east)).find((callout) => callout.id === 'walkway')).toMatchObject({
      valueCm: 222,
      from: [222, 0, 254],
      to: [0, 0, 254],
    });

    // Share links carry the new keys; links without them encode as they always have.
    const plain = encodeSceneParam('room', createRoomState(), 'Plain');
    const payload = JSON.parse(Buffer.from(plain.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    expect(Object.keys(payload)).toEqual(['v', 'k', 'n', 'w', 'c', 'i']);
    const placedState = createRoomState({ ...east, solarHour: 17.5, windowWall: 'south' });
    expect(decodeSceneParam('room', encodeSceneParam('room', placedState, 'Placed')).state.room).toEqual(placedState.room);
    const forged = { ...payload, x: ['__proto__', 1, 2] };
    const forgedParam = Buffer.from(JSON.stringify(forged)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeSceneParam('room', forgedParam)).toBeNull();

    // Daylight: the key light follows the sun and the west window throws patches and shafts.
    const day = buildScene({ state: createRoomState({ ...DEFAULT_ROOM, lighting: 'daylight', solarHour: 17.5 }) });
    expect(day.window).toMatchObject({ wall: 'west', sunlit: true });
    expect(day.window.patches.length).toBeGreaterThan(0);
    expect(day.window.shafts).toHaveLength(6);
    expect(day.rig.sun).toMatchObject({ fixed: true, color: golden.color });
    expect(day.rig.sun.from.join(' ')).toBe(rounded(golden.direction));
    expect(day.stats.volumetrics).toBe(6);
    // An east window sees no direct sun at golden hour, but it does at dawn.
    const eastWindow = (hour) =>
      buildScene({ state: createRoomState({ ...DEFAULT_ROOM, lighting: 'daylight', solarHour: hour, windowWall: 'east' }) }).window;
    expect(eastWindow(17.5)).toMatchObject({ sunlit: false, patches: [], shafts: [] });
    expect(eastWindow(7).sunlit).toBe(true);
    // Night keeps its own rig and, by default, no window.
    const dark = buildScene({ state: createRoomState() });
    expect(dark.window).toBeNull();
    expect(dark.rig.sun.fixed).toBeUndefined();
  });

  test('Sun & Aperture moves the sun to golden hour and the bed turns onto the east wall with its walk zone', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openRoom(page);
    const graph = page.getByTestId('room-scene-graph');
    await page.getByRole('radio', { name: 'Daylight Studio' }).check();
    await expect(graph).toHaveAttribute('data-window-wall', 'west');

    // The solar time slider: 14:30 by default, Golden Hour at 17:30.
    const sun = page.getByTestId('room-solar-controls');
    await sun.getByRole('button', { name: /Sun & Aperture/ }).click();
    const slider = page.getByTestId('room-solar-hour');
    await expect(slider).toHaveValue('14.5');
    await slider.fill('17.5');
    const golden = solarState(17.5);
    await expect(graph).toHaveAttribute('data-solar-hour', '17.5');
    await expect(graph).toHaveAttribute('data-sun-kelvin', '2900');
    await expect(graph).toHaveAttribute('data-sun-azimuth', String(golden.azimuthDeg));
    await expect(graph).toHaveAttribute('data-sun-direction', rounded(golden.direction));
    await expect(graph).toHaveAttribute('data-sunlit', 'true');
    await expect(page.getByTestId('room-solar-hour-value')).toHaveText('17:30');
    await expect(page.getByTestId('room-solar-golden')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('room-solar-readout')).toContainText('2900K');
    await expect.poll(async () => (await readStoredRoom(page)).room.solarHour).toBe(17.5);

    // The Noon pill swings the sun due south in crisp white; the window wall is a choice too.
    await page.getByTestId('room-solar-noon').click();
    await expect(graph).toHaveAttribute('data-sun-azimuth', '180');
    await expect(graph).toHaveAttribute('data-sun-kelvin', '6000');
    await expect(graph).toHaveAttribute('data-sun-direction', rounded(solarState(13).direction));
    await page.getByRole('radio', { name: 'South' }).check();
    await expect(graph).toHaveAttribute('data-window-wall', 'south');
    await page.getByTestId('room-solar-golden').click();
    await expect(graph).toHaveAttribute('data-sun-kelvin', '2900');

    // The bed onto the east wall: its bounds in the scene graph match the engine.
    await page.getByRole('radio', { name: 'Low Platform Bed 160cm' }).check();
    await page.getByTestId('furniture-placement').getByRole('button', { name: /Placement/ }).click();
    await page.getByTestId('furniture-wall-select').selectOption('east');
    await expect.poll(async () => (await readStoredRoom(page)).room.furnitureWall).toBe('east');
    const stored = sanitizeRoomState(await readStoredRoom(page));
    const layout = furnitureLayout(stored.room);
    const marker = page.getByTestId('room-furniture-placement');
    await expect(marker).toHaveAttribute('data-wall', 'east');
    await expect(marker).toHaveAttribute('data-bounds', [layout.bounds.x0, layout.bounds.x1, layout.bounds.z0, layout.bounds.z1].join(' '));
    expect(layout.bounds.x1).toBe(stored.room.widthCm - 6);

    // At eye level, walking east from the opening stance stops on the turned footprint.
    const zone = furnitureZone(stored.room);
    await page.getByTestId('camera-mode-walkthrough').click();
    await page.getByTestId('wall-tab-east').click();
    await page.getByTestId('walk-reset').click();
    const state = walkState(page);
    await expect(state).toHaveAttribute('data-heading-deg', '90');
    for (let i = 0; i < 4; i += 1) await page.getByTestId('walk-forward').click();
    await expect(state).toHaveAttribute('data-x-cm', String(Math.round(zone.x0)));

    // Rotate 90 deg moves it on to the south wall; the offset slides it along.
    await page.getByTestId('furniture-rotate').click();
    await expect(marker).toHaveAttribute('data-wall', 'south');
    await page.getByTestId('furniture-offset').fill('30');
    await expect(marker).toHaveAttribute('data-offset-cm', '30');
    await expect.poll(async () => (await readStoredRoom(page)).room).toMatchObject({ furnitureWall: 'south', furnitureOffsetCm: 30 });
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});
