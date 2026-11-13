import { expect, test } from '@playwright/test';
import { PRODUCTS } from '../src/data/products.js';
import { applyLightingSceneToRoom } from '../src/lib/lighting-scenes.js';
import {
  contactShadowMap,
  cornerShadeMap,
  finishMaterial,
  iblTier,
  PBR_MATERIAL_KEYS,
  PBR_MATERIALS,
  STUDIO_ENVIRONMENT,
  studioEnvironmentMap,
  studioEnvironmentTexel,
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
  sanitizeWindowWalls,
  serializeRoomState,
  toggleWindowPatch,
  updateRoom,
  updateRoomItem,
  windowWallOf,
  windowWallsOf,
} from '../src/lib/room-3d.js';
import {
  BEVEL,
  buildScene,
  FURNITURE_DETAILS,
  MOONLIGHT,
  NIGHT_GLAZING,
  PORTAL_LIGHT,
  SKYLIGHT,
  SUN_GOBO,
  WINDOW_FRAME,
} from '../src/lib/room-scene.js';
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
        expect(['box', 'cylinder', 'lathe']).toContain(part.geometry);
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
    // An east window sees no direct sun at golden hour, but it does at dawn. Away from the sun it
    // still faces the open sky, so it lets a skylight portal in instead of going dark.
    const eastWindow = (hour) =>
      buildScene({ state: createRoomState({ ...DEFAULT_ROOM, lighting: 'daylight', solarHour: hour, windowWall: 'east' }) }).window;
    expect(eastWindow(17.5)).toMatchObject({ sunlit: false, skylit: true, light: 'sky' });
    expect(eastWindow(17.5).patches).toHaveLength(6);
    expect(eastWindow(17.5).shafts).toHaveLength(6);
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
    // Window walls toggle: South joins the daylight west window, and unticking West leaves South alone.
    await page.getByRole('checkbox', { name: 'South' }).check();
    await expect(graph).toHaveAttribute('data-window-walls', 'west south');
    await page.getByRole('checkbox', { name: 'West' }).uncheck();
    await expect(graph).toHaveAttribute('data-window-wall', 'south');
    await expect(graph).toHaveAttribute('data-window-count', '1');
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

test.describe('multi-window architecture and luminous night glazing', () => {
  test('two or three glazed walls store, toggle, share and build as windows while one-window rooms keep their v7.0 record', () => {
    // Canonical, distinct, glazed walls only; garbage never reads as "no windows".
    expect(sanitizeWindowWalls(['south', 'west', 'west', 'north'])).toEqual(['west', 'south']);
    expect(sanitizeWindowWalls([])).toEqual([]);
    expect(sanitizeWindowWalls(['north', '__proto__'])).toBeNull();
    expect(sanitizeWindowWalls('west')).toBeNull();

    // Two or more stay a list; one or none fold back onto windowWall, the v7.0 shape.
    const pair = sanitizeRoom({ ...DEFAULT_ROOM, windowWalls: ['east', 'west'] });
    expect(pair).toEqual({ ...DEFAULT_ROOM, windowWalls: ['west', 'east'] });
    expect(sanitizeRoom({ ...DEFAULT_ROOM, windowWalls: ['south'] })).toEqual({ ...DEFAULT_ROOM, windowWall: 'south' });
    expect(sanitizeRoom({ ...DEFAULT_ROOM, windowWalls: [] })).toEqual({ ...DEFAULT_ROOM, windowWall: 'none' });
    expect(sanitizeRoom({ ...DEFAULT_ROOM, windowWall: 'east', windowWalls: ['west', 'south'] })).toEqual({
      ...DEFAULT_ROOM,
      windowWalls: ['west', 'south'],
    });
    expect(windowWallOf(pair)).toBe('west');
    expect(windowWallsOf(pair)).toEqual(['west', 'east']);
    expect(windowWallsOf(DEFAULT_ROOM)).toEqual([]);
    expect(windowWallsOf({ ...DEFAULT_ROOM, lighting: 'daylight' })).toEqual(['west']);

    // Toggling: West then East gives two, South a third, None clears them all.
    let state = createRoomState();
    state = updateRoom(state, toggleWindowPatch(state.room, 'west'));
    expect(state.room.windowWall).toBe('west');
    state = updateRoom(state, toggleWindowPatch(state.room, 'east'));
    expect(state.room).toEqual({ ...DEFAULT_ROOM, windowWalls: ['west', 'east'] });
    expect(updateRoom(state, toggleWindowPatch(state.room, 'nowhere'))).toBe(state);
    expect(updateRoom(state, { windowWalls: ['east', 'west'] })).toBe(state);
    const three = updateRoom(state, toggleWindowPatch(state.room, 'south'));
    expect(windowWallsOf(three.room)).toEqual(['west', 'east', 'south']);
    expect(updateRoom(three, toggleWindowPatch(three.room, 'none')).room).toEqual({ ...DEFAULT_ROOM, windowWall: 'none' });
    // A legacy single-window patch replaces the list instead of losing to it.
    expect(updateRoom(three, { windowWall: 'south' }).room).toEqual({ ...DEFAULT_ROOM, windowWall: 'south' });
    // Persisted and restored without sharing the list.
    const stored = serializeRoomState(three);
    expect(stored.room.windowWalls).not.toBe(three.room.windowWalls);
    expect(sanitizeRoomState(JSON.parse(JSON.stringify(stored))).room).toEqual(three.room);

    // Share links: the list rides in the window slot, so `x` keeps four slots.
    const param = encodeSceneParam('room', three, 'Gallery');
    const payload = JSON.parse(Buffer.from(param.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    expect(payload.x).toEqual([null, 'west+east+south', null, null]);
    expect(decodeSceneParam('room', param).state.room).toEqual(three.room);
    const single = encodeSceneParam('room', createRoomState({ ...DEFAULT_ROOM, windowWall: 'east' }), 'One');
    expect(JSON.parse(Buffer.from(single.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).x).toEqual([
      null,
      'east',
      null,
      null,
    ]);
    const forged = { ...payload, x: [null, 'north+__proto__', null, null] };
    const forgedParam = Buffer.from(JSON.stringify(forged)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeSceneParam('room', forgedParam).state.room).toEqual(DEFAULT_ROOM);

    // Each glazed wall builds its own window; scene.window stays the first for older readers.
    const scene = buildScene({ state });
    expect(scene.windows.map((win) => win.wall)).toEqual(['west', 'east']);
    expect(scene.window).toBe(scene.windows[0]);
    expect(buildScene({ state: three }).windows).toHaveLength(3);
    expect(buildScene({ state: createRoomState() }).windows).toEqual([]);
  });

  test('night glazing holds a luminous twilight sky with moonlight, and the joinery reads proud of the glass', () => {
    const night = buildScene({ state: createRoomState({ ...DEFAULT_ROOM, windowWalls: ['west', 'east'] }) });
    for (const win of night.windows) {
      expect(win.glazing).toMatchObject({ color: NIGHT_GLAZING.color, base: '#1a273b' });
      expect(win.glazing.color).toBe('#2d4263');
      expect(win.glazing.intensity).toBeGreaterThanOrEqual(0.7);
      expect(win).toMatchObject({ sunlit: false, moonlit: true });
      // Cool moonlight on the floor and faint shafts in the air, one per pane.
      expect(win.patches).toHaveLength(6);
      expect(win.patches.every((patch) => patch.light === 'moon' && patch.color === '#8fa8c8' && patch.opacity === 0.14)).toBe(true);
      expect(win.shafts).toHaveLength(6);
      expect(win.shafts.every((shaft) => shaft.opacity === MOONLIGHT.shaftOpacity && shaft.opacity < 0.1)).toBe(true);
    }
    expect(night.stats.volumetrics).toBe(12);
    // Moonlight falls into the room from the window it comes through.
    const [west, east] = night.windows;
    expect(Math.min(...west.patches.flatMap((patch) => patch.points.map((p) => p[0])))).toBeGreaterThan(0.3);
    expect(Math.max(...east.patches.flatMap((patch) => patch.points.map((p) => p[0])))).toBeLessThan(3.2 - 0.3);

    // A plaster reveal, a deep oak sill and brushed steel bars, 1.5 to 4.5 cm proud of the glass.
    const look = (kind) => west.members.filter((member) => member.kind === kind);
    expect(look('jamb').every((member) => member.material === 'wall-plaster' && member.color === '#7a736a')).toBe(true);
    expect(look('sill')).toEqual([expect.objectContaining({ material: 'wood-oak', color: '#b89c74' })]);
    expect(look('sill')[0].size[2]).toBeGreaterThanOrEqual(0.12);
    for (const bar of [...look('mullion'), ...look('transom')]) {
      expect(bar).toMatchObject({ ...WINDOW_FRAME.mullion, material: 'metal-steel', color: '#857e75', roughness: 0.32, metalness: 0.45 });
      expect(bar.size[2]).toBeCloseTo(0.03, 6);
      expect(bar.position[0]).toBeCloseTo(0.03, 6);
    }
    expect(look('mullion')).toHaveLength(2);
    expect(look('transom')).toHaveLength(1);
    // The glass sits behind the reveal face, so the panes read recessed.
    expect(west.glazing.position[0]).toBeLessThan(look('jamb')[0].size[2]);

    // Daylight keeps the sun's sky and its sun patches; no moonlight by day.
    const day = buildScene({ state: createRoomState({ ...DEFAULT_ROOM, lighting: 'daylight', solarHour: 17.5 }) }).window;
    expect(day).toMatchObject({ sunlit: true, moonlit: false });
    expect(day.patches.every((patch) => patch.light === 'sun')).toBe(true);
    expect(day.glazing.base).toBe('#0f1114');
  });

  test('the Window pills toggle two and three windows in the viewport and the night glass glows twilight blue', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openRoom(page);
    const graph = page.getByTestId('room-scene-graph');
    await expect(graph).toHaveAttribute('data-window-count', '0');
    await page.getByTestId('room-solar-controls').getByRole('button', { name: /Sun & Aperture/ }).click();
    const pills = page.getByTestId('room-window-walls');
    await expect(pills.getByRole('button', { name: 'None' })).toHaveAttribute('aria-pressed', 'true');

    await pills.getByRole('checkbox', { name: 'West' }).check();
    await pills.getByRole('checkbox', { name: 'East' }).check();
    await expect(graph).toHaveAttribute('data-window-walls', 'west east');
    await expect(graph).toHaveAttribute('data-window-wall', 'west');
    await expect(page.getByTestId('room-window-count')).toHaveText('2 active windows');
    await expect(pills.getByRole('button', { name: 'None' })).toHaveAttribute('aria-pressed', 'false');
    const windows = graph.locator('[data-testid="room-window"]');
    await expect(windows).toHaveCount(2);
    for (const win of await windows.all()) {
      await expect(win).toHaveAttribute('data-glazing-color', '#2d4263');
      await expect(win).toHaveAttribute('data-moonlit', 'true');
      expect(Number(await win.getAttribute('data-glazing-intensity'))).toBeGreaterThanOrEqual(0.7);
    }
    await expect(graph).toHaveAttribute('data-moon-patches', '12');
    await expect.poll(async () => (await readStoredRoom(page)).room.windowWalls).toEqual(['west', 'east']);

    await pills.getByRole('checkbox', { name: 'South' }).check();
    await expect(page.getByTestId('room-window-count')).toHaveText('3 active windows');
    await expect(windows).toHaveCount(3);
    await expect(page.getByTestId('room-solar-controls')).toContainText('3 windows');

    await pills.getByRole('button', { name: 'None' }).click();
    await expect(graph).toHaveAttribute('data-window-count', '0');
    await expect(windows).toHaveCount(0);
    await expect.poll(async () => (await readStoredRoom(page)).room.windowWall).toBe('none');
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});

test.describe('archviz materials, studio IBL and furniture vignettes', () => {
  test('veneer and parquet are calm, the studio environment and corner falloff are deterministic', () => {
    expect(PBR_MATERIALS['wood-walnut'].contrast).toBeLessThanOrEqual(0.15);
    expect(PBR_MATERIALS['wood-oak'].contrast).toBeLessThanOrEqual(0.15);
    expect(PBR_MATERIALS['floor-parquet'].contrast).toBeLessThanOrEqual(0.15);
    expect(PBR_MATERIALS['floor-parquet'].plankTone).toBeCloseTo(0.09, 6);
    // No zebra: the walnut tone varies far less across the grain than v7.0's 0.34 rings did.
    const walnut = synthesizeMaterial('wood-walnut');
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < walnut.albedoMap.length; i += 4) {
      sum += walnut.albedoMap[i];
      sq += walnut.albedoMap[i] ** 2;
    }
    const n = walnut.albedoMap.length / 4;
    expect(Math.sqrt(sq / n - (sum / n) ** 2)).toBeLessThan(16);

    const env = studioEnvironmentMap();
    // A tiny 64 x 32 studio, lit at 0.42 on every renderer.
    expect(env).toMatchObject({ width: 64, height: 32, intensity: 0.42 });
    expect(STUDIO_ENVIRONMENT).toMatchObject({ width: 64, height: 32, intensity: 0.42 });
    expect(env.data).toHaveLength(env.width * env.height * 4);
    expect(Buffer.compare(Buffer.from(env.data), Buffer.from(studioEnvironmentMap().data))).toBe(0);
    // A bright overhead softbox, strip boxes east and west, a warm horizon, a dark floor.
    const luma = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    expect(luma(studioEnvironmentTexel(0, 85))).toBeGreaterThan(0.9);
    expect(luma(studioEnvironmentTexel(90, 25))).toBeGreaterThan(luma(studioEnvironmentTexel(180, 25)));
    expect(luma(studioEnvironmentTexel(0, 2))).toBeGreaterThan(luma(studioEnvironmentTexel(0, -60)));
    const horizon = studioEnvironmentTexel(0, 2);
    expect(horizon[0]).toBeGreaterThan(horizon[2]);

    // A quality tier: GPUs get the studio IBL, software rasterisers keep the direct rig.
    expect(iblTier('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('studio');
    expect(iblTier('Apple M3')).toBe('studio');
    expect(iblTier('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe('software');
    expect(iblTier('llvmpipe (LLVM 17.0.6, 256 bits)')).toBe('software');
    expect(iblTier('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('software');
    expect(iblTier(undefined)).toBe('studio');

    const corner = cornerShadeMap(64);
    expect(corner.data[0]).toBe(0);
    expect(corner.data[63 * 4]).toBe(0);
    expect(corner.data[32 * 4]).toBeGreaterThan(230);
  });

  test('every floor reference gains a woven rug and its companions while its collision parts and bounds stay exact', () => {
    for (const id of ['bed-160', 'sofa-200', 'desk-140']) {
      const kinds = FURNITURE_DETAILS[id].vignette.map((spec) => spec.kind);
      expect(kinds.filter((kind) => kind === 'rug'), id).toHaveLength(2);
    }
    const sofaRoom = { ...DEFAULT_ROOM, furniture: 'sofa-200' };
    const sofa = buildScene({ state: createRoomState(sofaRoom) });
    // Collision: the same parts, boxes and bounds as before the vignette.
    expect(furnitureLayout(sofaRoom).bounds).toEqual({ x0: 60, x1: 260, y0: 0, y1: 78, z0: 6, z1: 98 });
    expect(sofa.furniture.map((part) => part.part)).toEqual(furnitureLayout(sofaRoom).parts.map((p) => p.id));
    expect(sofa.furniture.map((part) => part.box)).toEqual(furnitureLayout(sofaRoom).parts.map((p) => p.box));
    expect(sofa.furniturePlacement.bounds).toEqual(furnitureLayout(sofaRoom).bounds);

    // The rug: felt, a darker border, 0.6 cm on the floor, never casting a shadow.
    const rugs = sofa.furnitureVignette.parts.filter((part) => part.kind === 'rug');
    expect(rugs.map((part) => [part.material, part.color])).toEqual([
      ['felt-acoustic', '#6e675e'],
      ['felt-acoustic', '#9e9589'],
    ]);
    expect(rugs.every((part) => part.shadow === false)).toBe(true);
    expect(Math.max(...rugs.map((part) => part.position[1] + part.size[1] / 2))).toBeCloseTo(0.006, 3);
    // A coffee table in front with an art book and a ceramic vessel; throw cushions on the seats.
    const sofaKinds = sofa.furnitureVignette.parts.map((part) => part.kind);
    expect(sofaKinds).toEqual(expect.arrayContaining(['coffee-table', 'object']));
    expect(sofa.furnitureVignette.parts.find((part) => part.id.endsWith('table-top')).position[2]).toBeGreaterThan(0.98);
    expect(sofa.furniture.find((part) => part.part === 'seat-left').subparts.map((p) => p.id)).toEqual(
      expect.arrayContaining([expect.stringMatching(/throw-cushion$/)]),
    );
    expect(sofa.stats.submeshes).toBe(
      sofa.furniture.reduce((s, part) => s + part.subparts.length, 0) + sofa.furnitureVignette.parts.length,
    );

    // The bed: oak ledges with reading lamps that glow warm at night only, layered pillows, a piped mattress.
    const bedRoom = { ...DEFAULT_ROOM, furniture: 'bed-160' };
    const bed = buildScene({ state: createRoomState(bedRoom) });
    const shades = bed.furnitureVignette.parts.filter((part) => part.id.endsWith('-shade'));
    expect(bed.furnitureVignette.parts.filter((part) => part.kind === 'ledge')).toHaveLength(2);
    expect(shades).toHaveLength(2);
    expect(shades.every((part) => part.emissive && part.emissiveIntensity > 0)).toBe(true);
    const dayBed = buildScene({ state: createRoomState({ ...bedRoom, lighting: 'daylight' }) });
    expect(dayBed.furnitureVignette.parts.filter((part) => part.emissive)).toEqual([]);
    expect(bed.furniture.find((part) => part.part === 'pillow-left').subparts.length).toBeGreaterThanOrEqual(3);
    expect(bed.furniture.find((part) => part.part === 'mattress').subparts.map((p) => p.kind)).toContain('piping');
    // In a tight room the ledges and their lamps go together; the rug clips to the walls.
    const tight = buildScene({ state: createRoomState({ ...bedRoom, widthCm: 240, depthCm: 200 }) });
    expect(tight.furnitureVignette.parts.map((part) => part.kind)).toEqual(['rug', 'rug']);
    for (const part of tight.furnitureVignette.parts) {
      expect(part.position[0] - part.size[0] / 2).toBeGreaterThanOrEqual(0);
      expect(part.position[0] + part.size[0] / 2).toBeLessThanOrEqual(2.4);
      expect(part.position[2] + part.size[2] / 2).toBeLessThanOrEqual(2);
    }

    // The desk: a task chair tucked in and a glowing lamp diffuser.
    const desk = buildScene({ state: createRoomState({ ...DEFAULT_ROOM, furniture: 'desk-140' }) });
    expect(desk.furnitureVignette.parts.filter((part) => part.kind === 'chair').length).toBeGreaterThanOrEqual(5);
    const diffuser = desk.furniture.find((part) => part.part === 'top').subparts.find((p) => p.id.endsWith('lamp-diffuser'));
    expect(diffuser.emissiveIntensity).toBeGreaterThan(0);

    // The envelope: a shadow-gap cove on every wall and corner depth at every inside corner.
    expect(sofa.envelope.coves.map((cove) => cove.wall)).toEqual(ROOM_WALLS);
    expect(sofa.envelope.coves.every((cove) => cove.parts.map((p) => p.kind).join() === 'shadow-gap,crown')).toBe(true);
    expect(sofa.envelope.cornerShades).toHaveLength(8);
    expect(sofa.envelope.cornerShades.every((shade) => shade.walls.length === 2 && shade.culls.length === 2)).toBe(true);
    expect(JSON.stringify(sofa)).toBe(JSON.stringify(buildScene({ state: createRoomState(sofaRoom) })));
  });

  test('the viewport mirrors the vignette and keeps its draw stats in step with the engine', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openRoom(page);
    await page.getByRole('radio', { name: 'Modular Sofa 200cm' }).check();
    const vignette = page.getByTestId('room-furniture-vignette');
    await expect(vignette).toHaveAttribute('data-kinds', 'rug coffee-table object');
    await expect.poll(async () => (await readStoredRoom(page)).room.furniture).toBe('sofa-200');
    const scene = buildScene({ state: sanitizeRoomState(await readStoredRoom(page)) });
    await expect(vignette).toHaveAttribute('data-parts', String(scene.furnitureVignette.parts.length));
    await expect(page.getByTestId('room-scene-graph')).toHaveAttribute('data-submeshes', String(scene.stats.submeshes));
    await expect(page.getByTestId('room-scene-graph')).toHaveAttribute('data-meshes', String(scene.stats.meshes));
    if ((await rendererOf(page)) !== 'unavailable') {
      // Studio IBL is always on: prefiltered on a GPU, in closed form on a software rasteriser.
      await expect(page.getByTestId('room-scene-graph')).toHaveAttribute('data-ibl', /^(studio|analytic)$/);
    }
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});

// Millwork and metal kinds that take the crisp micro-bevel by default.
const MICRO_KINDS = new Set(['slab', 'carcass', 'door', 'tray', 'rail', 'stile', 'edge', 'fin', 'slat', 'beam', 'body', 'sill', 'frame', 'top', 'leg', 'post']);

test.describe('window light portals and sculpted CAD geometry', () => {
  test('both windows at 14:30 cast six-pane gobos and air shafts: the west one direct sun on a clamped ray, the east one a skylight portal, each with a portal light and hardware', () => {
    const state = createRoomState({ ...DEFAULT_ROOM, lighting: 'daylight', solarHour: 14.5, windowWalls: ['west', 'east'] });
    const scene = buildScene({ state });
    expect(JSON.stringify(scene)).toBe(JSON.stringify(buildScene({ state })));
    const [west, east] = scene.windows;
    expect(west).toMatchObject({ wall: 'west', sunlit: true, skylit: false, moonlit: false, light: 'sun' });
    expect(east).toMatchObject({ wall: 'east', sunlit: false, skylit: true, moonlit: false, light: 'sky' });
    const { widthCm: W, depthCm: D } = DEFAULT_ROOM;
    for (const win of scene.windows) {
      expect(win.patches, win.wall).toHaveLength(6);
      expect(win.shafts, win.wall).toHaveLength(6);
      for (const patch of win.patches) {
        expect(patch.light).toBe(win.light);
        // Every floor vertex carries its gobo coordinates for the penumbra shader, all within the pane.
        expect(patch.uv).toHaveLength(patch.points.length);
        expect(patch.depth).toHaveLength(patch.points.length);
        expect(patch.uv.flat().every((c) => c >= 0 && c <= 1)).toBe(true);
        expect(patch.depth.every((d) => d >= 0 && d <= 1)).toBe(true);
        expect(patch.points.every(([x, , z]) => x >= 0 && x <= W / 100 && z >= 0 && z <= D / 100)).toBe(true);
      }
      // A soft spot from the middle of the glass, aimed straight in at the floor 2.2 m from the wall.
      expect(win.portalLight).toMatchObject({ type: 'spot', source: win.light, penumbra: 1, decay: PORTAL_LIGHT.decay });
      expect(win.portalLight.position[1]).toBeCloseTo((win.y0 + win.y1) / 200, 3);
      expect(win.portalLight.target[1]).toBe(0);
      expect(win.portalLight.target[2]).toBeCloseTo(win.portalLight.position[2], 6);
      // Casing linings, a bevelled oak sill over a shadow line, six sashes and two espagnolette handles.
      const kinds = win.members.map((member) => member.kind);
      expect(kinds.filter((kind) => kind === 'handle')).toHaveLength(4);
      expect(kinds.filter((kind) => kind === 'sash')).toHaveLength(24);
      expect(kinds.filter((kind) => kind === 'lining')).toHaveLength(4);
      expect(win.members.filter((member) => member.kind === 'handle').every((m) => m.material === 'metal-steel' && m.bevel)).toBe(true);
      expect(win.members.find((member) => member.kind === 'sill').bevel).toMatchObject({ segments: BEVEL.micro.segments });
      expect(win.members.find((member) => member.kind === 'shadowline')).toMatchObject({ ...WINDOW_FRAME.shadow, shadow: false });
    }
    expect(west.portalLight.position[0]).toBeCloseTo(0.12, 6);
    expect(west.portalLight.target[0]).toBeCloseTo(PORTAL_LIGHT.reachCm / 100, 6);
    expect(east.portalLight.target[0]).toBeCloseTo((W - PORTAL_LIGHT.reachCm) / 100, 6);

    // Direct sun: the 14:30 sun nearly grazes the west wall, so the ray is held at its architectural
    // minimum inward share against its steepest pitch, and the grid reaches well out across the floor.
    const sun = solarState(14.5);
    expect(-sun.direction[0]).toBeLessThan(SUN_GOBO.inwardMin);
    expect(-west.ray[0] / west.ray[1]).toBeCloseTo(SUN_GOBO.inwardMin / SUN_GOBO.pitchMax, 3);
    const westX = west.patches.flatMap((patch) => patch.points.map((p) => p[0]));
    expect(Math.max(...westX)).toBeGreaterThan(1.3);
    expect(Math.max(...westX) - Math.min(...westX)).toBeGreaterThan(0.7);
    expect(west.patches.every((patch) => patch.color === sun.color && patch.soft === SUN_GOBO.soft)).toBe(true);
    expect(west.patches[0].opacity).toBeCloseTo(SUN_GOBO.patch * sun.strength, 4);
    expect(west.portalLight.intensity).toBeCloseTo(PORTAL_LIGHT.sun * (0.4 + 0.6 * sun.strength), 3);

    // Skylight: steep, softer and cooler, falling more than a metre and a half into the room. Its gobo
    // lands whole, so every patch is its pane's full parallelogram, corner to corner in pane coordinates.
    expect(east.ray[0] / east.ray[1]).toBeCloseTo(SKYLIGHT.inward / SKYLIGHT.pitch, 3);
    for (const patch of east.patches) {
      expect(patch.points).toHaveLength(4);
      expect(patch.uv.map(([u, v]) => `${u} ${v}`).sort()).toEqual(['0 0', '0 1', '1 0', '1 1']);
    }
    const eastX = east.patches.flatMap((patch) => patch.points.map((p) => p[0]));
    expect(Math.min(...eastX)).toBeLessThan(W / 100 - 1.5);
    expect(east.patches.every((patch) => patch.opacity === SKYLIGHT.patchOpacity && patch.soft === SKYLIGHT.soft)).toBe(true);
    expect(east.shafts.every((shaft) => shaft.opacity === SKYLIGHT.shaftOpacity)).toBe(true);
    expect(east.patches[0].color).toBe('#e5ebf3');
    expect(east.portalLight).toMatchObject({ source: 'sky', intensity: PORTAL_LIGHT.sky, color: '#e5ebf3' });

    // Three rig lights plus the two portal lights; twelve shafts in the air.
    expect(scene.stats.lights).toBe(3 + 2);
    expect(scene.stats.volumetrics).toBe(12);
    // After sunset the sky portals dim to half; at night every window is moonlit, portal and all.
    const dusk = buildScene({ state: createRoomState({ ...DEFAULT_ROOM, lighting: 'daylight', solarHour: 21, windowWalls: ['west', 'east'] }) });
    for (const win of dusk.windows) {
      expect(win).toMatchObject({ skylit: true, light: 'sky' });
      expect(win.patches[0].opacity).toBeCloseTo(SKYLIGHT.patchOpacity * SKYLIGHT.twilight, 6);
      expect(win.portalLight.intensity).toBeCloseTo(PORTAL_LIGHT.sky * SKYLIGHT.twilight, 6);
    }
    const night = buildScene({ state: createRoomState({ ...DEFAULT_ROOM, windowWalls: ['west', 'east'] }) });
    expect(night.windows.map((win) => win.portalLight)).toEqual([
      expect.objectContaining({ source: 'moon', intensity: PORTAL_LIGHT.moon, color: MOONLIGHT.color }),
      expect.objectContaining({ source: 'moon', intensity: PORTAL_LIGHT.moon, color: MOONLIGHT.color }),
    ]);
  });

  test('window light lands whole and changes smoothly from 06:00 to 21:00 in compact, shallow and loft rooms, and a sun-facing window never reads darker than the sky', () => {
    const whole = (patch) =>
      patch.points.length === 4 && patch.uv.map(([u, v]) => `${u} ${v}`).sort().join('|') === '0 0|0 1|1 0|1 1';
    for (const dims of [{}, { widthCm: 240, depthCm: 200 }, { widthCm: 640, depthCm: 520, heightCm: 300 }]) {
      let previous = null;
      for (let quarter = 24; quarter <= 84; quarter += 1) {
        const hour = quarter / 4;
        const room = { ...DEFAULT_ROOM, ...dims, lighting: 'daylight', solarHour: hour, windowWalls: ['west', 'east', 'south'] };
        const scene = buildScene({ state: createRoomState(room) });
        const label = `${JSON.stringify(dims)} at ${formatSolarHour(hour)}`;
        const opacity = {};
        for (const win of scene.windows) {
          // Six whole panes on the floor, whatever the room and the hour.
          expect(win.patches.filter(whole), `${win.wall} ${label}`).toHaveLength(6);
          opacity[win.wall] = { light: win.light, value: win.patches[0].opacity, portal: win.portalLight.intensity };
        }
        const sun = Object.values(opacity).filter((o) => o.light === 'sun');
        const sky = Object.values(opacity).filter((o) => o.light === 'sky');
        for (const lit of sun) {
          for (const open of sky) {
            expect(lit.value, label).toBeGreaterThanOrEqual(open.value);
            expect(lit.portal, label).toBeGreaterThanOrEqual(open.portal);
          }
        }
        // No step change through sunrise or sunset: a quarter hour moves any window's light by under 0.1.
        if (previous) {
          for (const wall of Object.keys(opacity)) {
            expect(Math.abs(opacity[wall].value - previous[wall].value), `${wall} ${label}`).toBeLessThan(0.1);
          }
        }
        previous = opacity;
      }
    }
    // Dusk on the default west window keeps a whole gobo at the sky's level instead of a sliver.
    const dusk = buildScene({ state: createRoomState({ ...DEFAULT_ROOM, lighting: 'daylight', solarHour: 20 }) }).window;
    expect(dusk).toMatchObject({ wall: 'west', light: 'sun' });
    expect(dusk.patches.filter(whole)).toHaveLength(6);
    expect(dusk.patches[0].opacity).toBeGreaterThan(SKYLIGHT.patchOpacity * SKYLIGHT.twilight);
    // At night every window of the shallowest room still lands its six moonlit panes whole.
    const night = buildScene({ state: createRoomState({ ...DEFAULT_ROOM, widthCm: 240, depthCm: 200, windowWalls: ['west', 'east', 'south'] }) });
    expect(night.windows.every((win) => win.light === 'moon' && win.patches.filter(whole).length === 6)).toBe(true);
  });

  test('upholstery takes lush fillets, millwork a crisp micro-bevel and vessels turn on a lathe, while collision boxes, part ids and walk bounds stay exact', () => {
    // The bed: a channel-tufted headboard, one draped duvet, a turned-down sheet, a runner and four pillows.
    const bedRoom = { ...DEFAULT_ROOM, furniture: 'bed-160' };
    const bed = buildScene({ state: createRoomState(bedRoom) });
    const layout = furnitureLayout(bedRoom);
    expect(bed.furniture.map((part) => part.part)).toEqual(layout.parts.map((p) => p.id));
    expect(bed.furniture.map((part) => part.box)).toEqual(layout.parts.map((p) => p.box));
    expect(bed.furniturePlacement.bounds).toEqual(layout.bounds);
    expect(layout.bounds).toEqual({ x0: 80, x1: 240, y0: 0, y1: 52, z0: 6, z1: 212 });
    expect(furnitureZone(bedRoom)).toEqual({ x0: 60, x1: 260, z0: -14, z1: 232 });
    const bedParts = bed.furniture.flatMap((part) => part.subparts);
    const soft = bedParts.filter((part) => ['pillow', 'mattress', 'duvet', 'headboard', 'throw'].includes(part.kind));
    expect(soft.length).toBeGreaterThanOrEqual(15);
    for (const part of soft) {
      expect(part.bevel, part.id).toMatchObject({ segments: BEVEL.soft.segments });
      expect(part.bevel.radius, part.id).toBeCloseTo(Math.min(...part.size) * BEVEL.soft.ratio, 4);
    }
    expect(bedParts.filter((part) => part.kind === 'duvet')).toHaveLength(1);
    expect(bedParts.filter((part) => part.kind === 'headboard').length).toBeGreaterThanOrEqual(7);
    const pillows = bedParts.filter((part) => part.kind === 'pillow' && !part.id.endsWith('-flange'));
    expect(pillows).toHaveLength(4);
    // Euro shams lean back onto the headboard; the sleeping pillows raise their back ends onto them.
    expect(pillows.filter((part) => part.id.endsWith('-euro')).every((part) => part.rotation[0] < 0)).toBe(true);
    expect(pillows.filter((part) => part.id.endsWith('-sleeper')).every((part) => part.rotation[0] > 0)).toBe(true);
    expect(bed.furniture.find((part) => part.part === 'frame').subparts[0].bevel.radius).toBeLessThanOrEqual(BEVEL.micro.maxM);
    // Spun-metal bases and turned opal shades on the ledges.
    expect(bed.furnitureVignette.parts.filter((part) => part.kind === 'lamp' && part.geometry === 'lathe')).toHaveLength(4);
    // Drawn detail stays inside the room the way the collision boxes do: in a shallow room, on either
    // wall, and pushed to either end of the wall, every square-set sub-part ends at the wall planes.
    const footprint = (part) => {
      const quarter = Math.abs(Math.sin(part.rotation[1])) > 0.5;
      const [sx, sz] = quarter ? [part.size[2], part.size[0]] : [part.size[0], part.size[2]];
      return [part.position[0] - sx / 2, part.position[0] + sx / 2, part.position[2] - sz / 2, part.position[2] + sz / 2];
    };
    for (const room of [
      { ...bedRoom, widthCm: 240, depthCm: 200 },
      { ...bedRoom, widthCm: 240, depthCm: 200, furnitureWall: 'south' },
      { ...bedRoom, furnitureOffsetCm: -80 },
      { ...bedRoom, furnitureOffsetCm: 80 },
    ]) {
      const placed = buildScene({ state: createRoomState(room) });
      const square = placed.furniture.flatMap((part) => part.subparts).filter((part) => part.geometry === 'box' && !part.rotation[0] && !part.rotation[2]);
      for (const part of square) {
        const [x0, x1, z0, z1] = footprint(part);
        expect(x0 >= -1e-4 && x1 <= room.widthCm / 100 + 1e-4 && z0 >= -1e-4 && z1 <= room.depthCm / 100 + 1e-4, part.id).toBe(true);
      }
    }

    // The sofa: a radiused base, filleted cushions, accent cushions tilted and rolled, bolsters kept round.
    const sofa = buildScene({ state: createRoomState({ ...DEFAULT_ROOM, furniture: 'sofa-200' }) });
    const sofaPart = (id) => sofa.furniture.find((part) => part.part === id);
    expect(sofaPart('base')).toMatchObject({ body: false });
    expect(sofaPart('base').subparts[0].bevel).toEqual({ radius: 0.04, segments: BEVEL.custom.segments });
    const accents = [...sofaPart('seat-left').subparts, ...sofaPart('seat-right').subparts].filter((part) => part.id.endsWith('throw-cushion'));
    expect(accents.map((part) => Math.sign(part.rotation[2]))).toEqual([1, -1]);
    expect(accents.every((part) => part.rotation[0] < 0 && part.bevel)).toBe(true);
    expect(sofaPart('arm-left').subparts.find((part) => part.kind === 'bolster').geometry).toBe('cylinder');
    const bowl = sofa.furnitureVignette.parts.find((part) => part.id.endsWith('-bowl'));
    expect(bowl).toMatchObject({ geometry: 'lathe', kind: 'object', material: 'matte-chalk' });

    // The desk: a lit ultrawide display with an amber plan and a white grid, by day too, and a
    // five-star chair under a curved back.
    const desk = buildScene({ state: createRoomState({ ...DEFAULT_ROOM, lighting: 'daylight', furniture: 'desk-140' }) });
    const top = desk.furniture.find((part) => part.part === 'top');
    expect(top.body).toBe(false);
    expect(top.subparts.find((part) => part.id.endsWith('-top')).bevel).toMatchObject({ segments: BEVEL.micro.segments });
    const glowing = top.subparts.filter((part) => part.emissive);
    expect(glowing.find((part) => part.id.endsWith('monitor-screen'))).toMatchObject({ emissive: '#8ea3b8', emissiveIntensity: 0.55 });
    expect(glowing.filter((part) => part.emissive === '#e8b06a')).toHaveLength(5);
    expect(glowing.filter((part) => part.emissive === '#d7e0ea')).toHaveLength(7);
    expect(top.subparts.find((part) => part.id.endsWith('lamp-boom')).rotation[1]).toBeLessThan(0);
    // The stand rises behind the display: the neck's front face meets the panel's back, clear of the screen.
    const deskPart = (id) => top.subparts.find((part) => part.id.endsWith(id));
    const faces = (part) => [part.position[2] - part.size[2] / 2, part.position[2] + part.size[2] / 2];
    expect(faces(deskPart('monitor-neck'))[1]).toBeCloseTo(faces(deskPart('monitor-panel'))[0], 6);
    expect(faces(deskPart('monitor-neck'))[1]).toBeLessThan(faces(deskPart('monitor-screen'))[0]);
    const chair = desk.furnitureVignette.parts.filter((part) => part.kind === 'chair');
    expect(chair.filter((part) => /chair-leg-\d$/.test(part.id))).toHaveLength(5);
    expect(chair.filter((part) => part.id.includes('chair-wing')).map((part) => Math.sign(part.rotation[1]))).toEqual([-1, 1]);

    // Wall modules: a micro-bevelled slab, monographs with cream page blocks and a turned amphora on the
    // shelf; a celadon vase in the cube; bevelled doors and tray and recessed finger pulls on the sideboard.
    let state = createRoomState({ widthCm: 640, depthCm: 520, heightCm: 300 });
    for (const productId of [SHELF, 'modular-cube-36', SIDEBOARD]) state = mountInRoom(state, productId).state;
    const scene = buildScene({ state });
    const byProduct = Object.fromEntries(scene.modules.map((module) => [module.productId, module]));
    const shelf = byProduct[SHELF];
    expect(shelf).toMatchObject({ geometry: 'box', size: [1.1, 0.08, 0.25] });
    expect(shelf.subparts.find((part) => part.kind === 'slab').bevel).toEqual({ radius: 0.004, segments: 2 });
    expect(shelf.subparts.filter((part) => part.id.endsWith('-pages')).length).toBeGreaterThanOrEqual(6);
    for (const module of [shelf, byProduct['modular-cube-36']]) {
      const vessel = module.subparts.find((part) => part.id.endsWith('-vessel'));
      expect(vessel, module.productId).toMatchObject({ geometry: 'lathe', kind: 'object', radiusBottom: null });
      expect(vessel.profile.length).toBeGreaterThanOrEqual(10);
      expect(vessel.profile.every(([r, y]) => r >= 0 && Number.isFinite(y))).toBe(true);
      const heights = vessel.profile.map(([, y]) => y);
      expect(vessel.size[1]).toBeCloseTo(Math.max(...heights) - Math.min(...heights), 3);
      expect(vessel.size[0]).toBeCloseTo(2 * Math.max(...vessel.profile.map(([r]) => r)), 3);
    }
    const sideboard = byProduct[SIDEBOARD].subparts;
    expect(sideboard.filter((part) => part.kind === 'door').every((part) => part.bevel)).toBe(true);
    expect(sideboard.filter((part) => part.kind === 'tray').every((part) => part.bevel)).toBe(true);
    expect(sideboard.filter((part) => part.kind === 'pull-recess')).toHaveLength(2);
    expect(sideboard.filter((part) => part.kind === 'handle')).toHaveLength(2);
    // Micro-bevels never exceed 4 mm, and trims thinner than 6 mm stay crisp.
    for (const part of scene.modules.flatMap((module) => module.subparts)) {
      if (part.bevel && MICRO_KINDS.has(part.kind)) expect(part.bevel.radius, part.id).toBeLessThanOrEqual(BEVEL.micro.maxM);
      if (Math.min(...part.size) < BEVEL.micro.minSizeM) expect(part.bevel ?? null, part.id).toBeNull();
    }
    expect(scene.stats.submeshes).toBe(scene.modules.reduce((sum, module) => sum + module.subparts.length, 0));
  });

  test('both windows light the floor in the viewport at 14:30, graded ACES filmic at 1.08 with studio IBL on every renderer tier', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await installCspRecorder(page);
    await openRoom(page);
    const graph = page.getByTestId('room-scene-graph');
    await page.getByRole('radio', { name: 'Daylight Studio' }).check();
    await page.getByTestId('room-solar-controls').getByRole('button', { name: /Sun & Aperture/ }).click();
    await expect(page.getByTestId('room-solar-hour')).toHaveValue('14.5');
    await page.getByTestId('room-window-walls').getByRole('checkbox', { name: 'East' }).check();
    await expect(graph).toHaveAttribute('data-window-walls', 'west east');
    await expect(page.getByTestId('room-window-count')).toHaveText('2 active windows');
    const windowOf = (wall) => graph.locator(`[data-testid="room-window"][data-wall="${wall}"]`);
    await expect(windowOf('west')).toHaveAttribute('data-light', 'sun');
    await expect(windowOf('west')).toHaveAttribute('data-sunlit', 'true');
    await expect(windowOf('east')).toHaveAttribute('data-light', 'sky');
    await expect(windowOf('east')).toHaveAttribute('data-skylit', 'true');
    for (const wall of ['west', 'east']) {
      await expect(windowOf(wall)).toHaveAttribute('data-patches', '6');
      await expect(windowOf(wall)).toHaveAttribute('data-shafts', '6');
      await expect(windowOf(wall)).toHaveAttribute('data-handles', '4');
    }
    await expect(windowOf('west')).toHaveAttribute('data-portal-source', 'sun');
    await expect(windowOf('east')).toHaveAttribute('data-portal-source', 'sky');
    await expect(windowOf('east')).toHaveAttribute('data-portal-intensity', String(PORTAL_LIGHT.sky));
    await expect(graph).toHaveAttribute('data-sun-patches', '6');
    await expect(graph).toHaveAttribute('data-sky-patches', '6');
    await expect(graph).toHaveAttribute('data-portal-lights', '2');
    await expect(graph).toHaveAttribute('data-volumetrics', '12');
    await expect.poll(async () => (await readStoredRoom(page)).room.windowWalls).toEqual(['west', 'east']);
    const stored = sanitizeRoomState(await readStoredRoom(page));
    await expect(graph).toHaveAttribute('data-lights', String(buildScene({ state: stored }).stats.lights));

    if ((await rendererOf(page)) !== 'unavailable') {
      // ACES filmic at 1.08 read back off the renderer; the studio at 0.42 on either tier, and MSAA
      // only where a GPU pays for it.
      await expect(graph).toHaveAttribute('data-tone-mapping', 'aces');
      await expect(graph).toHaveAttribute('data-exposure', '1.08');
      await expect(graph).toHaveAttribute('data-env-intensity', '0.42');
      const tier = await graph.getAttribute('data-ibl-tier');
      expect(['studio', 'software']).toContain(tier);
      await expect(graph).toHaveAttribute('data-ibl', tier === 'software' ? 'analytic' : 'studio');
      await expect(graph).toHaveAttribute('data-msaa', tier === 'software' ? 'false' : 'true');
      // Portal lights never change the spot count: a fixed GPU pool, or the ambient fill on software.
      await expect(graph).toHaveAttribute('data-portal-mode', tier === 'software' ? 'fill' : 'spot');
      // The gobo shader and the patched speculars compile cleanly: two more frames, still no errors.
      await settleFrames(page);
    }
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});
