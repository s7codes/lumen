import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { getProduct } from '../src/data/products.js';
import { recommendPsu } from '../src/lib/bag.js';
import { BLUEPRINT_SCALE_LABEL, PAPER } from '../src/lib/blueprint-sheet.js';
import { computeBusTopology, DROP_LIMIT_PCT } from '../src/lib/bus-topology.js';
import { DRIVERS } from '../src/lib/drivers.js';
import { BUS_RATED_W, BUS_VOLTAGE, DROP_LIMIT } from '../src/lib/electrical.js';
import { HERO_FRAME, HERO_HOTSPOTS } from '../src/lib/hero-scenes.js';
import { ISO_LUX_LEVELS, WALL_GRID } from '../src/lib/illuminance-field.js';
import { launchHref } from '../src/lib/launch-presets.js';
import { HERO_MEDIA } from '../src/lib/media-manifest.js';
import { beamProfile } from '../src/lib/photometry.js';
import { CAMERA_PITCH, CAMERA_YAW, createRoomState, DEFAULT_ROOM, ROOM_DEPTH, ROOM_HEIGHT, ROOM_SIZE_PRESETS, ROOM_STORAGE_KEY, ROOM_WIDTH } from '../src/lib/room-3d.js';
import { computeEnvironmentalPhysics, MAINTENANCE_FACTOR, OCTAVE_BANDS } from '../src/lib/room-physics.js';
import { buildScene } from '../src/lib/room-scene.js';
import { defaultStance, EYE_HEIGHT_CM, INSIDE_FOV, INSIDE_FOV_DEG, RUN_SPEED, WALK_SPEED } from '../src/lib/room-walkthrough.js';
import { SHOWCASE_3D_ID } from '../src/lib/routes.js';
import { STUDIO_PILLAR_IDS, STUDIO_PILLARS } from '../src/lib/studio-capabilities.js';
import {
  buildXrayBlueprint,
  planeScale,
  projectPoint,
  wallLux,
  xrayLuxSources,
  XRAY_ACOUSTICS,
  XRAY_ASHLAR,
  XRAY_BUS,
  XRAY_CAMERA,
  XRAY_EYE,
  XRAY_FRAME,
  XRAY_LAYOUT,
  XRAY_PHOTOMETRY,
  XRAY_ROOM,
  XRAY_SCENE,
  XRAY_VIEWBOX,
} from '../src/lib/xray-blueprint.js';
import { clampSplit, focusSplit, splitForKey, splitFromPointer, splitMode, splitValueText, viewAt, XRAY_SPLIT, XRAY_VIEWS } from '../src/lib/xray-slider.js';
import { collectFailedResponses, collectRuntimeErrors, decodedWidth, horizontalOverflow, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const PLANNER_CHUNK = /\/assets\/(RoomPlannerPage|RoomCanvas)-[\w-]+\.js$/;
const ROOM_KEY = `lumen:${ROOM_STORAGE_KEY}`;
const HEADINGS = ['01 / Four-Wall Envelope', '02 / 165 cm Eye-Level Walkthrough', '03 / 24V SELV Bus & Acoustic RT60', '04 / Architectural CAD Exports'];
const PRESETS = [
  ['orbit', launchHref({ lens: 'orbit' }), 'Launch 360 Orbit'],
  ['inside', launchHref({ lens: 'inside' }), 'Launch 165 cm Eye Level'],
  ['loft', launchHref({ scale: 'loft', lens: 'inside' }), 'Launch Grand Loft'],
];
// The render's own scene files, read as text (they import three.js), line endings normalised.
const studioSource = (path) => readFileSync(new URL(`../scripts/media/studio/src/${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const HERO_SCENE = studioSource('scenes/hero.js');
const STUDIO_KIT = studioSource('scenes/kit.js');
const ASCII = /^[\x20-\x7e]+$/;
const r1 = (n) => Math.round(n * 10) / 10;

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

/** Largest blur radius of any box-shadow inside the section: the gallery casts none. */
function maxShadowBlur(section) {
  return section.evaluate((root) =>
    Math.max(
      0,
      ...[root, ...root.querySelectorAll('*')].flatMap((el) => {
        const shadow = getComputedStyle(el).boxShadow;
        if (shadow === 'none') return [];
        return shadow.split(/,(?![^(]*\))/).map((layer) => Number.parseFloat((layer.match(/-?\d*\.?\d+px/g) ?? [])[2] ?? '0'));
      }),
    ),
  );
}

/** The overview scrolled to the X-ray stage, revealed, its blueprint drawn and its photograph decoded. */
async function openStage(page, { width = 1440, height = 900, loaded = false } = {}) {
  if (!loaded) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
  }
  const section = page.getByTestId('home-3d-showcase');
  await section.evaluate((el) => el.scrollIntoView());
  const instrument = page.getByTestId('studio-instrument');
  await instrument.scrollIntoViewIfNeeded();
  await expect(instrument).toHaveAttribute('data-reveal-settled', '');
  await expect(page.getByTestId('xray-blueprint')).toHaveAttribute('data-blueprint', 'ready');
  const photo = page.getByTestId('xray-photo');
  await expect.poll(() => decodedWidth(photo), { timeout: 15_000 }).toBeGreaterThan(0);
  return { section, stage: page.getByTestId('xray-stage'), canvas: page.getByTestId('xray-canvas'), handle: page.getByTestId('xray-handle'), photo, svg: page.getByTestId('xray-svg') };
}

/** The photograph's and the blueprint's boxes on screen. */
async function layerBoxes(page) {
  const [photo, svg] = await Promise.all([page.getByTestId('xray-photo').boundingBox(), page.getByTestId('xray-svg').boundingBox()]);
  return { photo, svg };
}

function expectSameBox(a, b, tolerance = 0.5) {
  for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(a[key] - b[key]), key).toBeLessThanOrEqual(tolerance);
}

/** The stage-relative divider position from the clip of the blueprint layer, in percent. */
function clipLeft(page) {
  return page.getByTestId('xray-blueprint').evaluate((el) => Number.parseFloat(getComputedStyle(el).clipPath.match(/inset\(0px 0px 0px ([\d.]+)%\)/)?.[1] ?? 'NaN'));
}

test.describe('3D spatial studio x-ray stage', () => {
  test('every figure on the ledger is the planner engines own figure, in plain ASCII', () => {
    expect(STUDIO_PILLAR_IDS).toEqual(['envelope', 'eye-level', 'bus', 'exports']);
    expect(STUDIO_PILLARS.map((pillar) => `${pillar.index} / ${pillar.title}`)).toEqual(HEADINGS);
    const figures = Object.fromEntries(STUDIO_PILLARS.map((pillar) => [pillar.id, Object.fromEntries(pillar.specs.map((row) => [row.label, row.value]))]));

    // 01: the envelope ranges and the orbit camera of src/lib/room-3d.js.
    expect(figures.envelope).toEqual({
      Width: `${ROOM_WIDTH.min} to ${ROOM_WIDTH.max} cm`,
      Length: `${ROOM_DEPTH.min} to ${ROOM_DEPTH.max} cm`,
      Height: `${ROOM_HEIGHT.min} to ${ROOM_HEIGHT.max} cm`,
      Orbit: `${CAMERA_YAW.max - CAMERA_YAW.min} deg yaw / ${CAMERA_PITCH.min} to ${CAMERA_PITCH.max} deg pitch`,
    });
    // 02: the walkthrough lens and pace of src/lib/room-walkthrough.js, the wall field of illuminance-field.js.
    expect(figures['eye-level']).toEqual({
      'Eye height': `${EYE_HEIGHT_CM} cm`,
      Lens: `${INSIDE_FOV_DEG} deg / ${INSIDE_FOV.min} to ${INSIDE_FOV.max} deg`,
      Pace: `${WALK_SPEED.forward} cm/s walk / ${RUN_SPEED.forward} cm/s run`,
      'Wall lux': `${WALL_GRID.cols} x ${WALL_GRID.rows} point grid`,
    });
    // 03: the bus rating, the boxed drivers, the drop limit and the Sabine octaves.
    const driverWatts = Object.keys(DRIVERS).map((id) => Number(id.replace('driver-', ''))).sort((a, b) => a - b);
    expect(figures.bus).toEqual({
      Bus: `${BUS_VOLTAGE}V DC SELV / ${BUS_RATED_W} W per run`,
      Drivers: `${driverWatts.join(' W and ')} W`,
      'Voltage drop': `${Math.round(DROP_LIMIT * 100)}% limit, hop by hop`,
      Acoustics: `RT60 / ${OCTAVE_BANDS[0]} Hz to ${OCTAVE_BANDS.at(-1) / 1000} kHz / STI`,
    });
    // 04: the ISO A3 sheet at 1:20, the R12 DXF writer, the OBJ writer and the schedule.
    expect(PAPER).toEqual({ widthMm: 420, heightMm: 297 });
    expect(readFileSync(new URL('../src/lib/dxf-export.js', import.meta.url), 'utf8')).toContain("pair(1, 'AC1009')");
    expect(figures.exports).toEqual({
      Elevation: `${BLUEPRINT_SCALE_LABEL} SVG / ISO A3`,
      CAD: 'AutoCAD R12 DXF',
      Model: 'Wavefront OBJ',
      Schedule: 'Bill of materials',
    });

    // The ledger carries no pictures: the stage above holds the only photograph.
    for (const pillar of STUDIO_PILLARS) {
      expect(pillar).not.toHaveProperty('photo');
      for (const text of [pillar.title, pillar.summary, ...pillar.specs.flatMap((row) => [row.label, row.value])]) expect(ASCII.test(text), text).toBe(true);
    }
  });

  test('the blueprint is drawn through the camera the hero was rendered with, from the render and planner parts themselves', () => {
    // The stand of scripts/media/studio/src/scenes/hero.js, and its frame: the 2560 x 1440 hero still.
    const [px, py, pz] = XRAY_CAMERA.position;
    const [lx, ly, lz] = XRAY_CAMERA.look;
    expect(HERO_SCENE).toContain(`archCamera({ position: new THREE.Vector3(${px}, ${py}, ${pz}), look: new THREE.Vector3(${lx}, ${ly}, ${lz}), fovV: ${XRAY_CAMERA.fovV}, aspect: 16 / 9 })`);
    expect(XRAY_CAMERA.aspect).toBe(16 / 9);
    expect(px).toBe(lx);
    expect(XRAY_FRAME).toEqual(HERO_FRAME);
    expect(XRAY_VIEWBOX).toBe(`0 0 ${HERO_FRAME.width} ${HERO_FRAME.height}`);
    expect(HERO_SCENE).toContain(`const W = ${XRAY_ROOM.widthCm / 100};`);
    expect(HERO_SCENE).toContain(`const H = ${XRAY_ROOM.heightCm / 100};`);
    expect(HERO_SCENE).toContain(`room = { widthCm: ${XRAY_ROOM.widthCm}, depthCm: ${XRAY_ROOM.depthCm}, heightCm: ${XRAY_ROOM.heightCm} }`);

    // The hero's fixture hotspots were projected through that camera: the blueprint lands on every one of them.
    for (const spot of HERO_HOTSPOTS) {
      const anchor = XRAY_SCENE.anchors[spot.id];
      expect(HERO_SCENE).toContain(`{ id: '${spot.id}', at: [${anchor.join(', ')}] }`);
      const [u, v] = projectPoint(anchor);
      expect(Math.abs(u / HERO_FRAME.width - spot.x), spot.id).toBeLessThan(1e-4);
      expect(Math.abs(v / HERO_FRAME.height - spot.y), spot.id).toBeLessThan(1e-4);
    }

    // The render's own furniture, track and limestone (hero.js, kit.js).
    const { console: top, plinth, vessel, bowl, track } = XRAY_SCENE;
    expect(HERO_SCENE).toContain(`slab(travertine, ${top.x0}, ${top.x1}, ${top.y0}, ${top.y1}, ${top.z0}, ${top.z1},`);
    expect(HERO_SCENE).toContain(`slab(walnut, ${plinth.x0}, ${plinth.x1}, 0.0, ${plinth.y1}, ${plinth.z0}, ${plinth.z1},`);
    expect(HERO_SCENE).toContain(`vessel(scene, { x: ${vessel.x}, y: ${vessel.y}, z: ${vessel.z}, h: ${vessel.h}, r: ${vessel.r},`);
    expect(HERO_SCENE).toContain(`bowl(scene, { x: ${bowl.x}, y: ${bowl.y}, z: ${bowl.z}, r: ${bowl.r}, h: ${bowl.h},`);
    expect(HERO_SCENE).toContain(`x0: ${track.x0},\n    x1: ${track.x1},\n    z: ${track.z},`);
    for (const head of track.heads) expect(HERO_SCENE).toContain(`{ x: ${head.x}, aim: [${head.aim.join(', ')}] }`);
    expect(STUDIO_KIT).toContain("export function limestoneWall(scene, { x0, x1, y0 = 0, y1, slabW = 1.2, slabH = 0.6, depth = 0.03,");
    expect(STUDIO_KIT).toContain('0.004, 0.004 + depth');
    expect(XRAY_ASHLAR).toEqual({ faceZ: 0.034, slabW: 1.2, slabH: 0.6 });
    expect(STUDIO_KIT).toContain("ceilingTrack(scene, { x0, x1, z, H, heads, group = 'track', lumens = 520, halfDeg = 12, cutCeiling = null })");
    expect(STUDIO_KIT).toContain('light.penumbra = 0.35;');
    expect(STUDIO_KIT).toContain('const bodyLen = 0.11;');

    // The pendant, shelf and column are the planner's own sub-parts for the render's placements (room-scene.js).
    const placements = [
      ['linear-pendant-150', 'obsidian', 385, 122, [4.6, 0.27]],
      ['floating-shelf-110', 'walnut', 548, 152, null],
      ['corner-floor-column-140', 'walnut', 660, 0, null],
    ];
    for (const [productId, finish, xCm, yCm, move] of placements) {
      expect(HERO_SCENE).toContain(`{ productId: '${productId}', finish: '${finish}', xCm: ${xCm}, yCm: ${yCm}`);
      if (move) expect(HERO_SCENE).toContain(`move: [${move.join(', ')}]`);
    }
    const state = createRoomState(
      { ...DEFAULT_ROOM, lighting: 'night', ...XRAY_ROOM },
      placements.map(([productId, finish, xCm, yCm], i) => ({ uid: `m${i}`, led: true, productId, finish, xCm, yCm })),
    );
    const modules = buildScene({ state }).modules;
    const boxOf = (part, dz = 0) => ({
      x0: part.position[0] - part.size[0] / 2,
      x1: part.position[0] + part.size[0] / 2,
      y0: part.position[1] - part.size[1] / 2,
      y1: part.position[1] + part.size[1] / 2,
      z0: part.position[2] + dz - part.size[2] / 2,
      z1: part.position[2] + dz + part.size[2] / 2,
    });
    const expectBox = (actual, expected, label) => {
      for (const key of Object.keys(expected)) expect(Math.abs(actual[key] - expected[key]), `${label} ${key}`).toBeLessThan(1e-3);
    };
    const [pendant, shelf, column] = modules;
    // The render re-hangs the pendant about its own centre, 27 cm off the wall.
    const dz = 0.27 - (pendant.box.z0 + pendant.box.z1) / 200;
    const sub = (module, id) => module.subparts.find((part) => part.id === `${module.uid}-${id}`);
    expectBox(boxOf(sub(pendant, 'beam'), dz), XRAY_SCENE.pendant.beam, 'pendant beam');
    expectBox(boxOf(sub(pendant, 'canopy'), dz), XRAY_SCENE.pendant.canopy, 'pendant canopy');
    expect(pendant.subparts.filter((part) => part.kind === 'louver' && part.id.includes('louver-') && !part.id.includes('recess')).map((part) => r1(part.position[0] * 1e3) / 1e3)).toEqual(
      XRAY_SCENE.pendant.louverX.map((x) => r1(x * 1e3) / 1e3),
    );
    for (const [i, wire] of XRAY_SCENE.pendant.cables.entries()) expectBox(boxOf(sub(pendant, i ? 'cable-right' : 'cable-left'), dz), { x0: wire.x - wire.r, x1: wire.x + wire.r, y0: wire.y0, y1: wire.y1 }, 'wire');
    expectBox(boxOf(sub(shelf, 'slab')), XRAY_SCENE.shelf.slab, 'shelf slab');
    expectBox(boxOf(sub(shelf, 'cleat')), XRAY_SCENE.shelf.cleat, 'shelf cleat');
    const vesselPart = sub(shelf, 'vessel');
    expect(vesselPart.position).toEqual([XRAY_SCENE.shelf.vessel.x, XRAY_SCENE.shelf.vessel.y, XRAY_SCENE.shelf.vessel.z]);
    expect(vesselPart.profile.slice(1, -3)).toEqual(XRAY_SCENE.shelf.vessel.profile);
    for (const id of ['base', 'core', 'cap']) {
      const part = sub(column, id);
      const rod = XRAY_SCENE.column[id];
      expect({ x: part.position[0], z: part.position[2], r: part.radius }).toEqual({ x: rod.x, z: rod.z, r: rod.r });
      expectBox(boxOf(part), { y0: rod.y0, y1: rod.y1 }, `column ${id}`);
    }
    expectBox(boxOf(sub(column, 'slot')), XRAY_SCENE.column.slot, 'column slot');

    // The drawn pendant is its box pushed through the camera: the front face outline is in the path data.
    const drawing = buildXrayBlueprint();
    const fixtures = drawing.layers.find((layer) => layer.id === 'fixtures').d;
    const { beam } = XRAY_SCENE.pendant;
    const corner = (x, y) => projectPoint([x, y, beam.z1]).map((n) => r1(n)).join(' ');
    expect(fixtures).toContain(`M${corner(beam.x0, beam.y0)}L${corner(beam.x1, beam.y0)}L${corner(beam.x1, beam.y1)}L${corner(beam.x0, beam.y1)}Z`);
    // One scale on the limestone: 1 m of wall is the same run of pixels anywhere on its face.
    const metre = planeScale(XRAY_ASHLAR.faceZ);
    expect(projectPoint([4.8, 1, XRAY_ASHLAR.faceZ])[0] - projectPoint([3.6, 1, XRAY_ASHLAR.faceZ])[0]).toBeCloseTo(1.2 * metre, 6);
  });

  test('every annotation on the blueprint is the engines own figure for the photographed room', () => {
    const { room, items } = XRAY_LAYOUT;
    expect(room).toMatchObject(XRAY_ROOM);
    const lit = items.filter((item) => item.led);
    // Every lit part of the photograph burns at 2700K and CRI 97: the photograph's badge.
    for (const item of lit) expect(getProduct(item.productId), item.uid).toMatchObject({ kelvin: 2700, cri: 97 });
    // The heads sit on the track where the render hung them.
    expect(lit.filter((item) => item.productId === 'directional-spot-monopoint').map((item) => (item.xCm + getProduct(item.productId).dimsCm.w / 2) / 100)).toEqual(XRAY_SCENE.track.heads.map((head) => head.x));

    // 24V SELV: the planner's own run, its drop and its driver (bus-topology.js, electrical.js, bag.js).
    const bus = computeBusTopology({ room, items });
    expect(bus.origin.kind).toBe('hub');
    expect(bus.segments.map(({ x1, y1, x2, y2 }) => [x1, y1, x2, y2])).toEqual(XRAY_BUS.segments);
    expect(bus.nodes.map(({ uid, xCm, yCm, label }) => ({ uid, xCm, yCm, label }))).toEqual(XRAY_BUS.nodes);
    expect(bus.totalRunM).toBe(XRAY_BUS.runM);
    expect(bus.voltageDropPct).toBe(XRAY_BUS.dropPct);
    expect(bus.withinSpec).toBe(true);
    expect(bus.activeWatts).toBe(XRAY_BUS.loadW);
    expect(XRAY_BUS.limitPct).toBe(DROP_LIMIT_PCT);
    expect(recommendPsu(XRAY_BUS.loadW)).toMatchObject({ id: 'driver-150', capacityW: XRAY_BUS.driverW });
    const hub = items.find((item) => item.uid === 'hub');
    expect({ xCm: hub.xCm, yCm: hub.yCm, wCm: getProduct(hub.productId).dimsCm.w, hCm: getProduct(hub.productId).dimsCm.h }).toEqual(XRAY_BUS.hub);

    // Acoustics: Sabine per octave and the speech index of this room with its parts (room-physics.js).
    const physics = computeEnvironmentalPhysics({ room, items });
    expect(XRAY_ACOUSTICS.octaves.map((octave) => octave.hz)).toEqual([...OCTAVE_BANDS]);
    for (const octave of XRAY_ACOUSTICS.octaves) expect(octave.rt60, `${octave.hz} Hz`).toBe(physics.octaveRt60[octave.hz]);
    expect(XRAY_ACOUSTICS.rt60Sec).toBe(physics.rt60Sec);
    expect(XRAY_ACOUSTICS.sti).toBe(physics.stiScore);

    // Photometry: the planner's iso-lux levels, maintenance factor and inter-reflected light; the parts' own lumens.
    expect(XRAY_PHOTOMETRY.levels).toEqual([...ISO_LUX_LEVELS]);
    expect(XRAY_PHOTOMETRY.maintenance).toBe(MAINTENANCE_FACTOR);
    expect(XRAY_PHOTOMETRY.reflectedLux).toBe(physics.reflectedLux);
    expect(XRAY_PHOTOMETRY.grazer.lumens).toBe(getProduct('directional-spot-monopoint').lumens);
    expect(XRAY_PHOTOMETRY.pendant.lumens).toBe(getProduct('linear-pendant-150').lumens);
    expect(XRAY_PHOTOMETRY.shelf.lumens).toBe(getProduct('floating-shelf-110').lumens);
    expect(XRAY_PHOTOMETRY.pendant.beamDeg).toBe(Math.round(beamProfile(getProduct('linear-pendant-150')).beamDeg));
    const sources = xrayLuxSources();
    // Where no head, pendant or shelf reaches, the limestone sees only the room's bounce.
    expect(wallLux(sources, 1, 2)).toBe(XRAY_PHOTOMETRY.reflectedLux);
    for (const head of XRAY_SCENE.track.heads) expect(wallLux(sources, head.aim[0], head.aim[1] + 0.12), `${head.x}`).toBeGreaterThan(400);

    // The eye-level datum: the walkthrough's opening stance in this room (room-walkthrough.js).
    expect(defaultStance(XRAY_ROOM, 'north')).toMatchObject({ xCm: XRAY_EYE.xCm, zCm: XRAY_EYE.zCm, headingDeg: 0, pitchDeg: 0 });
    expect(XRAY_EYE.eyeCm).toBe(EYE_HEIGHT_CM);
    expect(XRAY_EYE.fovDeg).toBe(INSIDE_FOV_DEG);

    // What the drawing writes: every note in plain ASCII, the figures above in its type.
    const { labels, layers } = buildXrayBlueprint();
    const text = labels.map((label) => label.text);
    for (const note of text) expect(ASCII.test(note), note).toBe(true);
    expect(text).toEqual(
      expect.arrayContaining([
        `W ${XRAY_ROOM.widthCm} CM`,
        `H ${XRAY_ROOM.heightCm} CM`,
        'DROP 165.5',
        'H 140',
        '+165',
        '+156',
        '24 DEG GRAZER',
        `${XRAY_PHOTOMETRY.pendant.beamDeg} DEG LINEAR WASH`,
        '500 LX',
        '250 LX',
        '100 LX',
        `EYE LEVEL +${EYE_HEIGHT_CM} / FOV ${INSIDE_FOV_DEG} DEG`,
        `DRIVER NODE ${XRAY_BUS.driverW} W DALI-2`,
        `24V SELV / VOLTAGE DROP ${XRAY_BUS.dropPct.toFixed(2)}%`,
      ]),
    );
    for (const level of ISO_LUX_LEVELS) expect(layers.find((layer) => layer.id === `lux-${level}`)?.d.length, `${level} lx`).toBeGreaterThan(200);
    expect(new Set(layers.map((layer) => layer.group))).toEqual(new Set([null, ...STUDIO_PILLAR_IDS]));
    expect(new Set(labels.map((label) => label.group))).toEqual(new Set(STUDIO_PILLAR_IDS));

    // The divider: 52 by default, clamped, stepped by key, spoken as two shares.
    expect(XRAY_SPLIT.initial).toBe(52);
    expect(XRAY_VIEWS.map((view) => [view.id, view.split])).toEqual([
      ['xray', 52],
      ['photo', 92],
      ['cad', 8],
    ]);
    expect([clampSplit(-4), clampSplit(140), clampSplit(Number.NaN)]).toEqual([0, 100, 52]);
    expect(splitFromPointer(600, 100, 1000)).toBe(50);
    expect([splitForKey('ArrowLeft', 52), splitForKey('ArrowRight', 52, true), splitForKey('Home', 52), splitForKey('End', 52), splitForKey('Enter', 52)]).toEqual([51, 62, 0, 100, null]);
    expect([splitMode(8), splitMode(52), splitMode(92)]).toEqual(['cad', 'xray', 'photo']);
    expect(viewAt(92)?.id).toBe('photo');
    expect(splitValueText(52)).toBe('52 percent photograph, 48 percent blueprint');
    expect([focusSplit(92, 44), focusSplit(30, 44), focusSplit(92, -10), focusSplit(92, 80)]).toEqual([44, null, 8, 52]);
  });

  test('the section sits on the paper: one wide 16:9 x-ray stage over a four-column ledger without pictures, a carbon rule, a matte carbon key and no video', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const failed = collectFailedResponses(page);
    const scripts = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
    });
    // The drawing engine is its own chunk: a cold overview at the top of the page has not asked for it.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const BLUEPRINT_CHUNK = /\/assets\/xray-blueprint-[\w-]+\.js$/;
    expect(scripts.filter((path) => BLUEPRINT_CHUNK.test(path))).toEqual([]);
    await expect(page.getByTestId('xray-blueprint')).toHaveAttribute('data-blueprint', 'pending');
    const { section, stage, canvas, photo, svg } = await openStage(page, { loaded: true });
    expect(scripts.filter((path) => BLUEPRINT_CHUNK.test(path))).toHaveLength(1);
    await expect(section).toHaveAttribute('id', SHOWCASE_3D_ID);

    // No theatre left: no film, no canvas, no chamber, no act keys; one photograph in the whole section.
    expect(await section.evaluate((el) => el.querySelectorAll('video, canvas, .theatre, .optical, [data-film], [data-act]').length)).toBe(0);
    expect(await section.evaluate((el) => el.querySelectorAll('img').length)).toBe(1);
    // Warm architectural paper, carbon type: the section is transparent on the paper flow, like Core Modules.
    expect(await section.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    expect(await page.getByTestId('core-modules').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    expect(await page.getByTestId('home-atmosphere').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(250, 249, 246)');
    await expect(section.locator('.section-head .index-label')).toHaveText('03 / 3D Spatial Studio');
    const title = section.getByRole('heading', { level: 2 });
    await expect(title).toHaveText('Step inside a four-walled room before a single hole is drilled.');
    await expect(title).toHaveCSS('color', 'rgb(20, 19, 17)');
    await expect(title).toHaveCSS('font-weight', '380');

    // One stage across the full grid: a hairline frame, square corners, a 16:9 picture plane.
    await expect(stage).toHaveCSS('border-top', '1px solid rgb(20, 19, 17)');
    await expect(stage).toHaveCSS('border-top-left-radius', '0px');
    const canvasBox = await canvas.boundingBox();
    expect(Math.abs(canvasBox.width / canvasBox.height - 16 / 9)).toBeLessThan(0.01);
    // The 2K warm still, with its 1280w and 2560w sources, under a blueprint in the same 2560 x 1440 frame.
    expect(HERO_MEDIA.warm.srcSet).toMatch(/ 1280w, .+ 2560w$/);
    await expect(photo).toHaveAttribute('srcset', /^\/media\/hero\/warm-1280\.webp\?v=[\w.-]+ 1280w, \/media\/hero\/warm-2560\.webp\?v=[\w.-]+ 2560w$/);
    // A 1344 px slot takes the 2560w source (its naturalWidth reads density-corrected, so read the source itself).
    await expect.poll(() => photo.evaluate((el) => el.complete && new URL(el.currentSrc).pathname), { timeout: 15_000 }).toBe('/media/hero/warm-2560.webp');
    await expect(svg).toHaveAttribute('viewBox', XRAY_VIEWBOX);
    await expect(svg).toHaveAttribute('preserveAspectRatio', 'none');
    const { photo: photoBox, svg: svgBox } = await layerBoxes(page);
    expectSameBox(photoBox, svgBox);
    expectSameBox(photoBox, canvasBox, 1);
    const photoBadge = page.getByTestId('xray-badge-photo');
    const cadBadge = page.getByTestId('xray-badge-cad');
    await expect(photoBadge.locator('.xray__badge-long')).toHaveText('OPTICAL // 2700K CRI 97');
    await expect(photoBadge.locator('.xray__badge-long')).toBeVisible();
    await expect(cadBadge.locator('.xray__badge-long')).toHaveText('CAD // 1:20 ELEVATION & 24V BUS');
    await expect(cadBadge.locator('.xray__badge-short')).toBeHidden();
    const sheet = page.getByTestId('xray-title-block');
    await expect(sheet.locator('.xray__sheet-title')).toHaveText('NORTH WALL ELEVATION');
    await expect(page.getByTestId('xray-scale-stamp').locator('span')).toHaveText(['SCALE 1:20', 'ISO A3', 'UNITS: CM']);
    await expect(page.getByTestId('xray-sheet-bus')).toHaveText(`24V SELV${XRAY_BUS.driverW} W DALI-2 / ${XRAY_BUS.loadW} W`);
    await expect(page.getByTestId('xray-sheet-rt60')).toHaveText(`RT60${XRAY_ACOUSTICS.rt60Sec.toFixed(2)} S AT 500 HZ`);
    await expect(page.getByTestId('xray-octaves').locator('.xray__octave')).toHaveCount(OCTAVE_BANDS.length);
    // The notes on the drawing are set in type over it, the full set laid out at this width.
    const labels = page.locator('.xray__label');
    await expect(labels).toHaveCount(buildXrayBlueprint().labels.length);
    for (const [id, note] of [
      ['grazer', '24 DEG GRAZER'],
      ['lux-500', '500 LX'],
      ['hub', `DRIVER NODE ${XRAY_BUS.driverW} W DALI-2`],
      ['datum', 'EYE LEVEL +165 / FOV 78 DEG'],
      ['stone', 'HONED LIMESTONE 1200 x 600'],
    ]) {
      await expect(page.locator(`.xray__label[data-label="${id}"]`)).toHaveText(note);
      await expect(page.locator(`.xray__label[data-label="${id}"]`)).toBeVisible();
    }
    // The phone's copy of the grazer note stays out of a desktop drawing.
    await expect(page.locator('.xray__label[data-label="grazer-phone"]')).toBeHidden();
    // The divider starts just past the middle, with its readout on the handle.
    await expect(page.getByTestId('xray-handle')).toHaveAttribute('aria-valuenow', '52');
    await expect(page.getByTestId('xray-handle').locator('.xray__readout')).toHaveText('52% X-RAY');
    expect(await clipLeft(page)).toBe(52);

    // The ledger hangs from the stage's hairline: four columns of one width, no picture among them.
    const grid = page.getByTestId('studio-pillars');
    expect(await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(4);
    await grid.scrollIntoViewIfNeeded();
    for (const cell of await grid.locator(':scope > li').all()) await expect(cell).toHaveAttribute('data-reveal-settled', '');
    expect(await grid.evaluate((el) => el.querySelectorAll('img, svg, picture').length)).toBe(0);
    const [stageBox, gridBox] = await Promise.all([stage.boundingBox(), grid.boundingBox()]);
    expect(Math.abs(gridBox.x - stageBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(gridBox.width - stageBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(gridBox.y - (stageBox.y + stageBox.height))).toBeLessThanOrEqual(1);
    await expect(grid).toHaveCSS('border-bottom', '1px solid rgb(20, 19, 17)');
    const cards = grid.getByRole('article');
    await expect(cards).toHaveCount(4);
    const boxes = await Promise.all((await cards.all()).map((card) => card.boundingBox()));
    for (const box of boxes) {
      expect(Math.abs(box.y - boxes[0].y)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - boxes[0].width)).toBeLessThanOrEqual(1);
    }
    for (const [i, pillar] of STUDIO_PILLARS.entries()) {
      const card = page.getByTestId(`studio-pillar-${pillar.id}`);
      const heading = card.getByRole('heading', { level: 3 });
      await expect(heading).toHaveText(HEADINGS[i]);
      await expect(heading).toHaveCSS('text-transform', 'uppercase');
      await expect(heading).toHaveCSS('color', 'rgb(20, 19, 17)');
      await expect(heading).toHaveCSS('font-family', /Inter Tight/);
      await expect(card.getByRole('button', { name: HEADINGS[i] })).toHaveAttribute('aria-pressed', 'false');
      await expect(card.locator('.showcase3d__summary')).toHaveText(pillar.summary);
      const rows = await card.locator('.showcase3d__spec').evaluateAll((els) => els.map((el) => [el.querySelector('dt').textContent, el.querySelector('dd').textContent]));
      expect(rows).toEqual(pillar.specs.map((row) => [row.label, row.value]));
      expect(await card.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    }

    // One carbon rule closes the section: the presets on the left, the matte carbon key on the right.
    const foot = page.getByTestId('showcase-launchpad');
    await foot.scrollIntoViewIfNeeded();
    await expect(foot).toHaveAttribute('data-reveal-settled', '');
    await expect(foot).toHaveCSS('border-top', '1px solid rgb(20, 19, 17)');
    const cta = page.getByTestId('launch-3d-studio-cta');
    await expect(cta).toHaveText('Open 3D Room Planner');
    await expect(cta).toHaveAttribute('href', '/room-3d');
    await expect(cta).toHaveCSS('background-color', 'rgb(20, 19, 17)');
    await expect(cta).toHaveCSS('color', 'rgb(250, 249, 246)');
    await expect(cta).toHaveCSS('text-transform', 'uppercase');
    await expect(cta).toHaveCSS('height', '52px');
    await expect(cta).toHaveCSS('border-top-left-radius', '0px');
    await expect(cta.locator('svg')).toBeVisible();
    for (const [id, href, name] of PRESETS) {
      const link = page.getByTestId(`launch-preset-${id}`);
      await expect(link).toHaveAttribute('href', href);
      await expect(link).toHaveAccessibleName(name);
    }
    const [footBox, ctaBox, presetBox] = await Promise.all([foot.boundingBox(), cta.boundingBox(), page.getByTestId('launch-preset-orbit').boundingBox()]);
    expect(presetBox.x).toBeLessThan(ctaBox.x);
    expect(Math.abs(ctaBox.x + ctaBox.width - (footBox.x + footBox.width))).toBeLessThanOrEqual(1);
    expect(await maxShadowBlur(section)).toBe(0);

    // The section hands straight on to Core Modules, on the same paper and the same grid.
    const modules = page.getByTestId('core-modules');
    const [sectionBox, modulesBox, modulesGrid] = await Promise.all([section.boundingBox(), modules.boundingBox(), modules.locator('.modules__grid').boundingBox()]);
    expect(modulesBox.y).toBeGreaterThanOrEqual(sectionBox.y + sectionBox.height - 1);
    expect(Math.abs(modulesGrid.x - stageBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(modulesGrid.width - stageBox.width)).toBeLessThanOrEqual(1);

    // A cold overview never fetched the planner or its WebGL engine.
    await page.waitForLoadState('networkidle');
    expect(scripts.filter((path) => PLANNER_CHUNK.test(path))).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
    expect(failed).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('every fixture line lands on its photographed edge: the blueprint and the 2K photograph register pixel for pixel', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openStage(page);
    const z = XRAY_ASHLAR.faceZ;
    const { pendant, track, shelf, column } = XRAY_SCENE;
    const { beam } = pendant;
    const midY = (beam.y0 + beam.y1) / 2;
    const top = projectPoint([4.6, beam.y1, beam.z1]);
    const headPoint = (head) => {
      const at = [head.x, XRAY_ROOM.heightCm / 100 - 0.03, track.z];
      const d = head.aim.map((c, i) => c - at[i]);
      const length = Math.hypot(...d);
      return projectPoint(at.map((c, i) => c + (d[i] / length) * 0.1));
    };
    // Each pair: a point on a fixture as the blueprint draws it, and a point of what surrounds it.
    const probes = {
      beam: [3.95, 4.3, 4.6, 4.9, 5.25].map((x) => [projectPoint([x, midY, beam.z1]), projectPoint([x, 1.42, z])]),
      beamTop: [[[top[0], top[1] + 8], [top[0], top[1] - 8]]],
      beamEnds: [
        [projectPoint([beam.x0 + 0.03, midY, beam.z1]), projectPoint([beam.x0 - 0.03, midY, beam.z1])],
        [projectPoint([beam.x1 - 0.03, midY, beam.z1]), projectPoint([beam.x1 + 0.03, midY, beam.z1])],
      ],
      heads: track.heads.map((head) => {
        const p = headPoint(head);
        return [p, [p[0] - 45, p[1]]];
      }),
      plinth: [4.2, 4.85, 5.5].map((x) => [projectPoint([x, 0.19, XRAY_SCENE.plinth.z1]), projectPoint([x, 0.42, XRAY_SCENE.console.z1])]),
      shelf: [5.6, 6.03, 6.45].map((x) => [projectPoint([x, 1.56, shelf.slab.z1]), projectPoint([x, 1.3, z])]),
      column: [0.4, 0.7, 1].map((y) => [projectPoint([column.core.x - 0.056, y, 0.12]), projectPoint([column.core.x, y, 0.177])]),
    };
    const joints = {
      vertical: [0.15, 0.3, 0.45].map((y) => projectPoint([1.2, y, z])),
      horizontal: [1, 1.5, 2].map((x) => projectPoint([x, 1.2, z])),
    };
    const pools = track.heads.map((head) => [projectPoint([head.aim[0], head.aim[1] + 0.12, z]), projectPoint([head.aim[0] - 1.6, head.aim[1] + 0.12, z])]);

    const read = await page.evaluate(
      async ({ probes, joints, pools }) => {
        const source = document.querySelector('[data-testid="xray-photo"]');
        const img = new Image();
        img.src = new URL(source.currentSrc).pathname;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const lum = ([u, v], r = 2) => {
          const data = ctx.getImageData(Math.round(u) - r, Math.round(v) - r, 2 * r + 1, 2 * r + 1).data;
          let sum = 0;
          for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          return sum / (data.length / 4);
        };
        const groove = ([u, v], axis) => {
          let best = 255;
          for (let k = -2; k <= 2; k += 1) best = Math.min(best, lum(axis === 'x' ? [u + k, v] : [u, v + k], 0));
          const beside = axis === 'x' ? (lum([u - 12, v], 1) + lum([u + 12, v], 1)) / 2 : (lum([u, v - 12], 1) + lum([u, v + 12], 1)) / 2;
          return [best, beside];
        };
        return {
          size: [img.naturalWidth, img.naturalHeight],
          probes: Object.fromEntries(Object.entries(probes).map(([key, pairs]) => [key, pairs.map(([on, off]) => [lum(on), lum(off)])])),
          vertical: joints.vertical.map((p) => groove(p, 'x')),
          horizontal: joints.horizontal.map((p) => groove(p, 'y')),
          pools: pools.map(([on, off]) => [lum(on), lum(off)]),
        };
      },
      { probes, joints, pools },
    );
    expect(read.size).toEqual([HERO_FRAME.width, HERO_FRAME.height]);
    // The obsidian beam, the heads, the walnut plinth and shelf are dark where the blueprint draws them, the surround is lit.
    for (const key of ['beam', 'beamTop', 'beamEnds', 'heads', 'plinth', 'shelf']) {
      for (const [on, off] of read.probes[key]) {
        expect(on, `${key} on the part`).toBeLessThan(70);
        expect(on, `${key} against its surround`).toBeLessThan(off * 0.55);
      }
    }
    // The column's opal slot burns white between its walnut flanks.
    for (const [flank, slot] of read.probes.column) {
      expect(slot).toBeGreaterThan(230);
      expect(flank).toBeLessThan(slot * 0.5);
    }
    // The 3 mm reveals of the ashlar run exactly where the blueprint draws its joints.
    for (const [groove, stone] of [...read.vertical, ...read.horizontal]) expect(groove, 'joint').toBeLessThan(stone - 15);
    // Each head's pool, inside its 500 lx contour, outshines the limestone a metre and a half along.
    for (const [pool, field] of read.pools) expect(pool).toBeGreaterThan(field + 30);

    // On screen the two layers are one frame: the blueprint can only land where the photograph does.
    const { photo, svg } = await layerBoxes(page);
    expectSameBox(photo, svg);
    expect(Math.abs(photo.width / photo.height - 16 / 9)).toBeLessThan(0.01);
    expect(errors).toEqual([]);
  });

  test('the divider follows the pointer and the keys, glides to the quick views and opens for a chosen capability, without stretching either layer', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const { stage, canvas, handle } = await openStage(page);
    await expect(handle).toHaveAttribute('role', 'slider');
    await expect(handle).toHaveAccessibleName('Compare 2K architectural photograph and 1:20 CAD blueprint');
    await expect(handle).toHaveAttribute('aria-valuemin', '0');
    await expect(handle).toHaveAttribute('aria-valuemax', '100');
    const start = Number(await handle.getAttribute('aria-valuenow'));
    expect(start).toBeGreaterThanOrEqual(50);
    expect(start).toBeLessThanOrEqual(55);
    await expect(handle).toHaveAttribute('aria-valuetext', '52 percent photograph, 48 percent blueprint');
    await expect(stage).toHaveAttribute('data-split', '52');
    await expect(page.getByTestId('xray-view-xray')).toHaveAttribute('aria-pressed', 'true');
    const rest = await layerBoxes(page);
    const box = await canvas.boundingBox();
    const dividerAt = async () => (await page.getByTestId('xray-divider').boundingBox()).x;
    expect(Math.abs((await dividerAt()) - (box.x + box.width * 0.52))).toBeLessThanOrEqual(1);
    const handleBox = await handle.boundingBox();
    expect(Math.abs(handleBox.x + handleBox.width / 2 - (box.x + box.width * 0.52))).toBeLessThanOrEqual(1);

    // A drag anywhere on the stage carries the divider; the clip follows; neither layer moves or stretches.
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3);
    await page.mouse.down();
    await expect(canvas).toHaveAttribute('data-motion', 'drag');
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.5, { steps: 6 });
    await page.mouse.up();
    await expect(canvas).toHaveAttribute('data-motion', 'idle');
    await expect(handle).toHaveAttribute('aria-valuenow', '15');
    expect(Math.abs(Number(await stage.getAttribute('data-split')) - 15)).toBeLessThanOrEqual(0.2);
    await expect(canvas).toHaveAttribute('data-mode', 'cad');
    await expect(handle.locator('.xray__readout')).toHaveText('15% CAD');
    expect(Math.abs((await clipLeft(page)) - 15)).toBeLessThanOrEqual(0.2);
    expect(Math.abs((await dividerAt()) - (box.x + box.width * 0.15))).toBeLessThanOrEqual(1.5);
    const dragged = await layerBoxes(page);
    expectSameBox(dragged.photo, rest.photo);
    expectSameBox(dragged.svg, rest.svg);
    await expect(page.getByTestId('xray-view-xray')).toHaveAttribute('aria-pressed', 'false');

    // The keys: arrows step 1 (Shift 10), Page keys 10, Home and End run to the edges.
    await expect(handle).toBeFocused();
    for (const [key, value] of [
      ['ArrowLeft', 14],
      ['ArrowRight', 15],
      ['ArrowRight', 16],
      ['Shift+ArrowRight', 26],
      ['Home', 0],
      ['End', 100],
      ['PageDown', 90],
      ['ArrowUp', 91],
    ]) {
      await page.keyboard.press(key);
      await expect(handle, key).toHaveAttribute('aria-valuenow', String(value));
      expect(Math.abs((await clipLeft(page)) - value), key).toBeLessThanOrEqual(0.2);
    }
    await expect(canvas).toHaveAttribute('data-mode', 'photo');
    const keyed = await layerBoxes(page);
    expectSameBox(keyed.photo, rest.photo);

    // The quick views glide the divider to 92, 8 and back to 52, and the pressed key follows.
    for (const view of [XRAY_VIEWS[1], XRAY_VIEWS[2], XRAY_VIEWS[0]]) {
      const key = page.getByTestId(`xray-view-${view.id}`);
      await key.click();
      await expect(handle).toHaveAttribute('aria-valuenow', String(view.split));
      await expect(canvas).toHaveAttribute('data-motion', 'idle');
      await expect(key).toHaveAttribute('aria-pressed', 'true');
      expect(await clipLeft(page)).toBe(view.split);
      for (const other of XRAY_VIEWS.filter((entry) => entry !== view)) await expect(page.getByTestId(`xray-view-${other.id}`)).toHaveAttribute('aria-pressed', 'false');
    }

    // Pointing at a capability brings its callouts forward and steps the rest back.
    await expect(stage).toHaveAttribute('data-focus', 'none');
    const card = page.getByTestId('studio-pillar-eye-level');
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await expect(stage).toHaveAttribute('data-focus', 'eye-level');
    await expect(card).toHaveAttribute('data-active', 'true');
    const opacity = (id) => page.locator(`.xr[data-layer="${id}"]`).evaluate((el) => getComputedStyle(el).opacity);
    await expect.poll(() => opacity('datum')).toBe('1');
    await expect.poll(() => opacity('bus')).toBe('0.24');
    await expect.poll(() => opacity('fixtures')).toBe('1');
    await page.mouse.move(box.x + 4, 4);
    await expect(stage).toHaveAttribute('data-focus', 'none');

    // Choosing one pins it and opens a closed blueprint as far as its callouts; choosing it again lets go.
    await page.getByTestId('xray-view-photo').click();
    await expect(handle).toHaveAttribute('aria-valuenow', '92');
    await expect(canvas).toHaveAttribute('data-motion', 'idle');
    const toggle = page.getByTestId('studio-pillar-bus-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(stage).toHaveAttribute('data-focus', 'bus');
    await expect(canvas).toHaveAttribute('data-motion', 'idle');
    const opened = Number(await handle.getAttribute('aria-valuenow'));
    expect(opened).toBeLessThanOrEqual(52);
    expect(opened).toBeGreaterThanOrEqual(8);
    await expect.poll(() => opacity('bus')).toBe('1');
    await expect.poll(() => page.locator('.xray__label[data-label="hub"]').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(20, 19, 17)');
    await expect.poll(() => page.getByTestId('xray-sheet-rt60').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(20, 19, 17)');
    // A blueprint already open stays where it is when another capability is chosen.
    await page.getByTestId('studio-pillar-exports-toggle').click();
    await expect(stage).toHaveAttribute('data-focus', 'exports');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(handle).toHaveAttribute('aria-valuenow', String(opened));
    await page.getByTestId('studio-pillar-exports-toggle').click();
    await expect(page.getByTestId('studio-pillar-exports-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.mouse.move(box.x + 4, 4);
    await expect(stage).toHaveAttribute('data-focus', 'none');
    expect(await maxShadowBlur(page.getByTestId('home-3d-showcase'))).toBe(0);
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('with reduced motion the quick views land at once', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { canvas, handle } = await openStage(page);
    await page.getByTestId('xray-view-cad').click();
    // No glide: the divider is at 8 the moment the key is pressed.
    expect(await handle.getAttribute('aria-valuenow')).toBe('8');
    expect(await canvas.getAttribute('data-motion')).toBe('idle');
    expect(await clipLeft(page)).toBe(8);
    expect(errors).toEqual([]);
  });

  test('the key opens the planner and the Grand Loft preset lands at eye level in 800 x 650 x 340 cm', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const cta = page.getByTestId('launch-3d-studio-cta');
    await cta.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('showcase-launchpad')).toHaveAttribute('data-reveal-settled', '');
    // Keys stay where they are under the pointer: only the arrows travel, and the carbon key deepens a step.
    for (const key of [cta, page.getByTestId('launch-preset-loft')]) {
      const rest = await key.boundingBox();
      await key.hover();
      await expect.poll(() => key.locator('svg').last().evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).e)).toBeGreaterThan(0);
      const held = await key.boundingBox();
      expect(Math.abs(held.x - rest.x) + Math.abs(held.y - rest.y)).toBeLessThan(0.5);
      if (key === cta) await expect(cta).toHaveCSS('background-color', 'rgb(43, 41, 37)');
    }

    const loft = ROOM_SIZE_PRESETS.find((preset) => preset.id === 'loft');
    await page.getByTestId('launch-preset-loft').click();
    await expect(page).toHaveURL(/\/room-3d$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    const stage = page.getByTestId('room-viewport');
    await expect(stage).toHaveAttribute('data-room-width', String(loft.widthCm));
    await expect(stage).toHaveAttribute('data-room-depth', String(loft.depthCm));
    await expect(stage).toHaveAttribute('data-room-height', String(loft.heightCm));
    await expect(page.getByTestId('room-preset-loft')).toHaveAttribute('aria-pressed', 'true');
    const walk = page.getByTestId('room-walkthrough-state');
    await expect(walk).toHaveAttribute('data-camera-mode', 'inside');
    await expect(walk).toHaveAttribute('data-fov-deg', String(INSIDE_FOV_DEG));
    await expect(page.getByTestId('room-notice')).toHaveText('Launched Grand Loft 800 x 650 x 340 cm, Inside Room (165 cm) lens.');
    await expect.poll(async () => (await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROOM_KEY))?.room?.widthCm).toBe(loft.widthCm);

    // Back on the overview, the key itself opens the planner as left.
    await page.goto(`/#${SHOWCASE_3D_ID}`);
    await expect(page.getByTestId('home-3d-showcase').getByRole('heading', { level: 2 })).toBeInViewport();
    await page.getByTestId('launch-3d-studio-cta').click();
    await expect(page).toHaveURL(/\/room-3d$/);
    await expect(page.getByTestId('room-viewport')).toHaveAttribute('data-room-width', String(loft.widthCm));
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('at phone width the stage crops square onto the lit half, the ledger stacks to one column and the key leads the launch rule, without overflow', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const { canvas, handle } = await openStage(page, { width: 390, height: 844 });
    // A square stage; both layers share one 16:9 frame cropped to x 1100 to 2540 of the 2560 px still.
    const box = await canvas.boundingBox();
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
    const { photo, svg } = await layerBoxes(page);
    expectSameBox(photo, svg);
    expect(Math.abs(photo.width / photo.height - 16 / 9)).toBeLessThan(0.01);
    expect(Math.abs(photo.height - box.height)).toBeLessThanOrEqual(1);
    expect(Math.abs((box.x - photo.x) / photo.width - 1100 / XRAY_FRAME.width)).toBeLessThan(0.002);
    await expect(handle).toHaveAttribute('aria-valuenow', '52');
    // Short keys on the bar, short badges, no title block, only the notes that fit a phone.
    await expect(page.getByTestId('xray-view-photo').locator('.xray__view-short')).toBeVisible();
    await expect(page.getByTestId('xray-view-photo').locator('.xray__view-long')).toBeHidden();
    await expect(page.getByTestId('xray-view-photo')).toHaveAccessibleName('Photo');
    const cadBadge = page.getByTestId('xray-badge-cad');
    await expect(cadBadge.locator('.xray__badge-short')).toHaveText('CAD // 1:20');
    await expect(cadBadge.locator('.xray__badge-short')).toBeVisible();
    await expect(cadBadge.locator('.xray__badge-long')).toBeHidden();
    await expect(page.getByTestId('xray-title-block')).toBeHidden();
    const shown = await page.locator('.xray__label').evaluateAll((els) => els.filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.dataset.label));
    expect(shown.sort()).toEqual(['grazer-phone', 'lux-500', 'wash']);
    // Each one sits whole inside the square crop, clear of both edges.
    const box2 = await canvas.boundingBox();
    for (const id of shown) {
      const note = await page.locator(`.xray__label[data-label="${id}"]`).boundingBox();
      expect(note.x, id).toBeGreaterThanOrEqual(box2.x);
      expect(note.x + note.width, id).toBeLessThanOrEqual(box2.x + box2.width);
    }
    const bar = await page.getByTestId('xray-view-xray').boundingBox();
    expect(bar.height).toBeGreaterThanOrEqual(34);

    // A touch-sized drag still carries the divider.
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5, { steps: 5 });
    await page.mouse.up();
    await expect(handle).toHaveAttribute('aria-valuenow', '20');

    const grid = page.getByTestId('studio-pillars');
    expect(await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
    const boxes = await Promise.all((await grid.getByRole('article').all()).map((card) => card.boundingBox()));
    for (let i = 1; i < boxes.length; i += 1) expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height);

    const foot = page.getByTestId('showcase-launchpad');
    await foot.scrollIntoViewIfNeeded();
    const [footBox, ctaBox] = await Promise.all([foot.boundingBox(), page.getByTestId('launch-3d-studio-cta').boundingBox()]);
    expect(ctaBox.width).toBeGreaterThanOrEqual(footBox.width - 1);
    const presetBoxes = await Promise.all(PRESETS.map(([id]) => page.getByTestId(`launch-preset-${id}`).boundingBox()));
    expect(presetBoxes[0].y).toBeGreaterThan(ctaBox.y + ctaBox.height);
    for (let i = 1; i < presetBoxes.length; i += 1) expect(presetBoxes[i].y).toBeGreaterThan(presetBoxes[i - 1].y);
    for (const presetBox of presetBoxes) expect(presetBox.height).toBeGreaterThanOrEqual(44);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('3D spatial studio x-ray stage on a touch screen', () => {
  test.use({ hasTouch: true });

  test('a vertical swipe scrolls past the stage, a sideways swipe on the picture or the handle carries the divider and a tap sets it', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const { canvas, handle } = await openStage(page, { width: 390, height: 844 });
    // Real touch input through the browser, so pan-y, implicit capture and the pointer events behave as on a phone.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ x: point[0], y: point[1] }] : [] });
    const swipe = async (points) => {
      await touch('touchStart', points[0]);
      for (const point of points.slice(1)) await touch('touchMove', point);
      await touch('touchEnd');
    };
    // A swipe flings the page: the next gesture starts once the page has held still for six frames.
    const scrollSettled = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            let last = window.scrollY;
            let still = 0;
            const tick = () => {
              still = window.scrollY === last ? still + 1 : 0;
              last = window.scrollY;
              if (still >= 6) resolve();
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }),
      );

    let box = await canvas.boundingBox();
    const x = box.x + box.width * 0.7;
    const y = box.y + box.height * 0.6;
    const before = await page.evaluate(() => window.scrollY);
    await swipe([[x, y], [x + 1, y - 30], [x + 2, y - 90], [x + 2, y - 160], [x + 2, y - 220]]);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 40);
    await scrollSettled();
    await expect(canvas).toHaveAttribute('data-motion', 'idle');
    await expect(handle).toHaveAttribute('aria-valuenow', '52');

    // On the picture, clear of the handle: the touch lands on the drawing (Chrome captures it there)
    // and the divider takes it over once it travels sideways, all the way to the end of the swipe.
    box = await canvas.boundingBox();
    const grip = await handle.boundingBox();
    const above = box.y + box.height * 0.25;
    expect(above).toBeLessThan(grip.y - 20);
    await swipe([0.6, 0.56, 0.45, 0.35, 0.25].map((f) => [box.x + box.width * f, above]));
    await expect(handle).toHaveAttribute('aria-valuenow', '25');
    await expect(canvas).toHaveAttribute('data-motion', 'idle');
    expect(Math.abs((await clipLeft(page)) - 25)).toBeLessThanOrEqual(0.5);

    // On the handle itself the drag starts at once.
    const held = await handle.boundingBox();
    const centre = [held.x + held.width / 2, held.y + held.height / 2];
    await swipe([centre, [centre[0] + 12, centre[1]], [centre[0] + 60, centre[1] + 4], [box.x + box.width * 0.6, centre[1] + 6]]);
    await expect(handle).toHaveAttribute('aria-valuenow', '60');
    await expect(canvas).toHaveAttribute('data-motion', 'idle');

    // A tap that stays put glides the divider to where it landed.
    await swipe([[box.x + box.width * 0.8, above]]);
    await expect(handle).toHaveAttribute('aria-valuenow', '80');
    await expect(canvas).toHaveAttribute('data-motion', 'idle');
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
