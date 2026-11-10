import { getFinish, getProduct } from '../data/products.js';
import { kelvinToRgb } from './photometry.js';
import { CAMERA_ZOOM, clearanceCallouts, furnitureLayout, moduleBox } from './room-3d.js';

/*
 * Scene description for the WebGL room viewport. Converts the room state
 * (cm, x along the main wall, y up from the floor, z into the room) into
 * plain mesh, material and light records in metres. Pure and deterministic,
 * so it is testable without a WebGL context. RoomCanvas only maps these
 * records onto React Three Fiber primitives.
 */

export const CM = 0.01;
const DEG = Math.PI / 180;
const FOV_DEG = 38;
const FRAME_FILL_WIDE = 1.26;
const WIDE_ASPECT = 1.6;
const WALL_T_CM = 12;
const SLAB_T_CM = 10;
const GRID_CM = 50;
const AXIS_OVERRUN_CM = 26;
const TICK_CM = 5;

const m = (cm) => Number((cm * CM).toFixed(4));
const v3 = (p) => p.map(m);

function hex(rgb) {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/* Lighting rigs. Same room surfaces in both modes: only the light changes. */

export const LIGHTING_RIGS = Object.freeze({
  night: {
    background: '#0b0b0a',
    ambient: { color: '#ffd8ae', intensity: 0.06 },
    hemisphere: { sky: '#46506a', ground: '#16120d', intensity: 0.1 },
    sun: { color: '#a9bad6', intensity: 0.22, from: [-0.35, 1.1, 1.2] },
    led: 1,
    emissive: 2.6,
    grid: { color: '#f2eee7', opacity: 0.06 },
  },
  daylight: {
    background: '#0b0b0a',
    ambient: { color: '#fff6ea', intensity: 0.85 },
    hemisphere: { sky: '#f3efe8', ground: '#8d8578', intensity: 0.55 },
    sun: { color: '#fff1dc', intensity: 2.4, from: [-0.45, 1.25, 1] },
    led: 0.45,
    emissive: 1.1,
    grid: { color: '#0b0b0a', opacity: 0.08 },
  },
});

const SURFACES = Object.freeze({
  wall: '#e4dfd6',
  side: '#d8d2c7',
  floor: '#9a9389',
  poche: '#2c2a27',
});

const FURNITURE_TONES = Object.freeze({
  shadow: '#0d0c0b',
  oak: '#c4a57c',
  linen: '#d8d2c6',
  'linen-hi': '#e8e3d9',
  steel: '#2c2e30',
  felt: '#5b5853',
  'felt-hi': '#68655f',
});

// Timber reads matte, powder-coated obsidian has a soft sheen.
const FINISH_SURFACE = Object.freeze({
  walnut: { roughness: 0.62, metalness: 0 },
  oak: { roughness: 0.66, metalness: 0 },
  obsidian: { roughness: 0.38, metalness: 0.25 },
  chalk: { roughness: 0.82, metalness: 0 },
});

/* Camera */

/**
 * Orbit frame for a room and a viewport aspect. Distance at zoom 1 fits the
 * room's bounding sphere to the shorter viewport side; a wide viewport lets
 * it overfill the height by up to 26 percent. Three.js fov is vertical, so a
 * portrait viewport widens it to keep 38 deg across its width.
 */
export function cameraFrame(room, aspect) {
  const W = room.widthCm * CM;
  const H = room.heightCm * CM;
  const D = room.depthCm * CM;
  const half = (FOV_DEG / 2) * DEG;
  const radius = 0.5 * Math.hypot(W, H, D);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.6;
  const fill = 1 + (FRAME_FILL_WIDE - 1) * Math.min(1, Math.max(0, (safeAspect - 1) / (WIDE_ASPECT - 1)));
  const base = radius / (Math.tan(half) * fill);
  const fov = safeAspect >= 1 ? FOV_DEG : (2 * Math.atan(Math.tan(half) / safeAspect)) / DEG;
  return {
    target: [W / 2, H * 0.42, D * 0.44],
    base,
    fov,
    minDistance: base / CAMERA_ZOOM.max,
    maxDistance: base / CAMERA_ZOOM.min,
  };
}

/** Eye position for a yaw / pitch / zoom camera. Yaw 0 looks straight at the main wall. */
export function cameraPosition(frame, camera) {
  const distance = frame.base / camera.zoom;
  const yaw = camera.yaw * DEG;
  const pitch = camera.pitch * DEG;
  const [tx, ty, tz] = frame.target;
  return [
    tx + distance * Math.sin(yaw) * Math.cos(pitch),
    ty + distance * Math.sin(pitch),
    tz + distance * Math.cos(yaw) * Math.cos(pitch),
  ];
}

/** Inverse of cameraPosition. The result is unclamped; sanitizeCamera rounds it. */
export function cameraFromPosition(frame, position) {
  const dx = position[0] - frame.target[0];
  const dy = position[1] - frame.target[1];
  const dz = position[2] - frame.target[2];
  const distance = Math.hypot(dx, dy, dz) || frame.base;
  return {
    yaw: Math.atan2(dx, dz) / DEG,
    pitch: Math.asin(Math.max(-1, Math.min(1, dy / distance))) / DEG,
    zoom: frame.base / distance,
  };
}

/** OrbitControls limits matching CAMERA_YAW and CAMERA_PITCH (polar angle runs from +Y). */
export function orbitLimits(yawRange, pitchRange) {
  return {
    minAzimuthAngle: yawRange.min * DEG,
    maxAzimuthAngle: yawRange.max * DEG,
    minPolarAngle: (90 - pitchRange.max) * DEG,
    maxPolarAngle: (90 - pitchRange.min) * DEG,
  };
}

/* Room shell */

function slab(id, color, box) {
  return {
    id,
    color,
    size: [m(box.x1 - box.x0), m(box.y1 - box.y0), m(box.z1 - box.z0)],
    position: [m((box.x0 + box.x1) / 2), m((box.y0 + box.y1) / 2), m((box.z0 + box.z1) / 2)],
  };
}

/**
 * Interior faces are single-sided planes facing into the room, so a wall the
 * camera has orbited past culls itself. Side walls also carry a `cull` axis:
 * the poche slab behind them hides once the eye crosses that plane.
 */
function buildShell(room) {
  const { widthCm: W, depthCm: D, heightCm: H } = room;
  const T = WALL_T_CM;
  return {
    surfaces: [
      { id: 'floor', color: SURFACES.floor, size: [m(W), m(D)], position: [m(W / 2), 0, m(D / 2)], rotation: [-Math.PI / 2, 0, 0] },
      { id: 'back', color: SURFACES.wall, size: [m(W), m(H)], position: [m(W / 2), m(H / 2), 0], rotation: [0, 0, 0] },
      { id: 'left', color: SURFACES.side, size: [m(D), m(H)], position: [0, m(H / 2), m(D / 2)], rotation: [0, Math.PI / 2, 0], cull: { axis: 0, below: 0 } },
      { id: 'right', color: SURFACES.side, size: [m(D), m(H)], position: [m(W), m(H / 2), m(D / 2)], rotation: [0, -Math.PI / 2, 0], cull: { axis: 0, above: m(W) } },
    ],
    poche: [
      slab('floor', SURFACES.poche, { x0: -T, x1: W + T, y0: -SLAB_T_CM, y1: -0.2, z0: -T, z1: D }),
      slab('back', SURFACES.poche, { x0: -T, x1: W + T, y0: 0, y1: H, z0: -T, z1: -0.2 }),
      { ...slab('left', SURFACES.poche, { x0: -T, x1: -0.2, y0: 0, y1: H, z0: 0, z1: D }), cull: { axis: 0, below: 0 } },
      { ...slab('right', SURFACES.poche, { x0: W + 0.2, x1: W + T, y0: 0, y1: H, z0: 0, z1: D }), cull: { axis: 0, above: m(W) } },
    ],
  };
}

function buildGrid(room) {
  const { widthCm: W, depthCm: D } = room;
  const points = [];
  for (let x = GRID_CM; x < W; x += GRID_CM) points.push([m(x), 0.002, 0], [m(x), 0.002, m(D)]);
  for (let z = GRID_CM; z < D; z += GRID_CM) points.push([0, 0.002, m(z)], [m(W), 0.002, m(z)]);
  return points;
}

function roomEdges(room) {
  const { widthCm: W, depthCm: D, heightCm: H } = room;
  const c = (x, y, z) => v3([x, y, z]);
  const corners = [c(0, 0, 0), c(W, 0, 0), c(0, H, 0), c(W, H, 0), c(0, 0, D), c(W, 0, D), c(0, H, D), c(W, H, D)];
  const pairs = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  return pairs.flatMap(([a, b]) => [corners[a], corners[b]]);
}

/* Modules */

function boxRecord(box) {
  return {
    size: [m(box.x1 - box.x0), m(box.y1 - box.y0), m(box.z1 - box.z0)],
    position: [m((box.x0 + box.x1) / 2), m((box.y0 + box.y1) / 2), m((box.z0 + box.z1) / 2)],
  };
}

/** Thin emissive strips where the LED channel actually sits on each part. */
function emitterBoxes(shape, b) {
  const xMid = (b.x0 + b.x1) / 2;
  switch (shape) {
    case 'shelf':
      return [{ x0: b.x0 + 2, x1: b.x1 - 2, y0: b.y0 - 0.4, y1: b.y0 + 0.6, z0: b.z1 - 3, z1: b.z1 - 1 }];
    case 'cube':
      return [{ x0: b.x0 + 2, x1: b.x1 - 2, y0: b.y1 - 3.4, y1: b.y1 - 2, z0: b.z1 - 2, z1: b.z1 + 0.2 }];
    case 'sideboard':
      return [{ x0: b.x0 + 2, x1: b.x1 - 2, y0: b.y0 - 0.4, y1: b.y0 + 0.5, z0: b.z1 - 4, z1: b.z1 - 2 }];
    case 'lightbar':
      return [{ x0: b.x0 + 1, x1: b.x1 - 1, y0: b.y0 + 1.2, y1: b.y0 + 3.6, z0: b.z1 - 0.2, z1: b.z1 + 0.3 }];
    case 'column':
      return [{ x0: xMid - 1.5, x1: xMid + 1.5, y0: b.y0 + 4, y1: b.y1 - 6, z0: b.z1 - 1.2, z1: b.z1 + 0.6 }];
    case 'spot':
      return [{ x0: b.x0 + 3, x1: b.x1 - 3, y0: b.y0 - 0.3, y1: b.y0 + 0.4, z0: b.z0 + 3, z1: b.z1 - 3 }];
    default:
      return [];
  }
}

/**
 * The real light each lit module throws, in metres. Spot lights wash the
 * wall and floor below shelves and bars; the column and the backlit frame
 * are omnidirectional. Intensity scales with the part's rated lumens.
 */
function moduleLights(item, product, b, room, rig) {
  if (!item.led || product.watts === 0) return [];
  const color = hex(kelvinToRgb(product.kelvin ?? 2700));
  const strength = (product.lumens / 1000) * rig.led;
  const xMid = (b.x0 + b.x1) / 2;
  const yMid = (b.y0 + b.y1) / 2;
  const spot = (id, from, to, angleDeg, intensity, distanceCm) => ({
    id,
    type: 'spot',
    color,
    position: v3(from),
    target: v3(to),
    angle: angleDeg * DEG,
    penumbra: 0.85,
    intensity: Number((intensity * strength).toFixed(3)),
    distance: m(distanceCm),
    decay: 2,
  });
  const point = (id, at, intensity, distanceCm) => ({
    id,
    type: 'point',
    color,
    position: v3(at),
    intensity: Number((intensity * strength).toFixed(3)),
    distance: m(distanceCm),
    decay: 2,
  });

  switch (product.shape) {
    case 'shelf':
      return [spot('wash', [xMid, b.y0 - 1, b.z1 - 4], [xMid, Math.max(0, b.y0 - 160), 2], 58, 5.5, 360)];
    case 'cube':
      return [spot('wash', [xMid, b.y0 - 1, b.z1 - 6], [xMid, Math.max(0, b.y0 - 120), 2], 46, 4.5, 280)];
    case 'sideboard':
      return [spot('graze', [xMid, b.y0 - 1, b.z1 - 6], [xMid, 0, b.z1 * 0.8], 72, 5, 260)];
    case 'lightbar':
      return [
        spot('down', [xMid, b.y0 - 0.5, b.z1 + 1], [xMid, Math.max(0, b.y0 - 140), 2], 62, 3.2, 300),
        spot('up', [xMid, b.y1 + 0.5, b.z1 + 1], [xMid, Math.min(room.heightCm, b.y1 + 140), 2], 62, 3.2, 300),
      ];
    case 'column':
      return [point('glow', [xMid, b.y0 + (b.y1 - b.y0) * 0.58, b.z1 + 6], 4.8, 340)];
    case 'spot':
      return [spot('beam', [xMid, b.y0 - 0.5, (b.z0 + b.z1) / 2], [xMid, Math.max(0, b.y0 - 150), 2], 26, 7, 360)];
    case 'frame':
      return [point('halo', [xMid, yMid, 0.6], 1.6, 120)];
    default:
      return [];
  }
}

function moduleRecord(item, room, rig, conflicts, selectedUid) {
  const product = getProduct(item.productId);
  const finish = getFinish(item.finish);
  const box = moduleBox(item);
  const lit = item.led && product.watts > 0;
  const light = hex(kelvinToRgb(product.kelvin ?? 2700));
  const cylinder = product.shape === 'column' || product.shape === 'spot';
  const { w, h, d } = product.dimsCm;

  return {
    uid: item.uid,
    productId: product.id,
    name: product.name,
    sku: product.sku,
    shape: product.shape,
    finish: finish.id,
    color: finish.hex,
    ...(FINISH_SURFACE[finish.id] ?? FINISH_SURFACE.chalk),
    geometry: cylinder ? 'cylinder' : 'box',
    radius: cylinder ? m(Math.min(w, d) / 2) : null,
    ...boxRecord(box),
    box,
    xCm: item.xCm,
    yCm: item.yCm,
    dims: `${w}x${h}x${d}`,
    led: product.watts > 0 ? String(item.led) : 'none',
    lit,
    emitters: emitterBoxes(product.shape, box).map((e, i) => ({
      key: `${item.uid}-e${i}`,
      color: light,
      intensity: lit ? rig.emissive : 0,
      ...boxRecord(e),
    })),
    felt:
      product.shape === 'frame'
        ? { color: '#3a3834', ...boxRecord({ x0: box.x0 + 3, x1: box.x1 - 3, y0: box.y0 + 3, y1: box.y1 - 3, z0: box.z1 - 1, z1: box.z1 + 0.15 }) }
        : null,
    lights: moduleLights(item, product, box, room, rig),
    selected: item.uid === selectedUid,
    conflict: conflicts.has(item.uid),
  };
}

function furnitureRecords(room) {
  const furniture = furnitureLayout(room);
  if (!furniture) return [];
  return furniture.parts.map((p) => ({
    part: p.id,
    color: FURNITURE_TONES[p.tone],
    box: p.box,
    ...boxRecord(p.box),
  }));
}

/* Technical annotations */

function buildAxes(room) {
  const { widthCm: W, depthCm: D, heightCm: H } = room;
  const axes = [
    { id: 'x', length: W, label: `X ${W} cm`, dir: [1, 0, 0], tick: [0, 0, TICK_CM] },
    { id: 'y', length: H, label: `Y ${H} cm`, dir: [0, 1, 0], tick: [TICK_CM, 0, 0] },
    { id: 'z', length: D, label: `Z ${D} cm`, dir: [0, 0, 1], tick: [TICK_CM, 0, 0] },
  ];
  return axes.map((axis) => {
    const at = (t) => axis.dir.map((c) => c * t);
    const ticks = [];
    for (let t = GRID_CM; t <= axis.length; t += GRID_CM) {
      ticks.push(v3(at(t)), v3(at(t).map((c, i) => c + axis.tick[i])));
    }
    return {
      id: axis.id,
      label: axis.label,
      points: [v3([0, 0, 0]), v3(at(axis.length + AXIS_OVERRUN_CM)), ...ticks],
      labelAt: v3(at(axis.length + AXIS_OVERRUN_CM + 10)),
    };
  });
}

function buildCallouts(state, selectedUid) {
  return clearanceCallouts(state, selectedUid).map((callout) => ({
    id: callout.id,
    label: callout.label,
    tone: callout.tone,
    valueCm: callout.valueCm,
    points: [v3(callout.from), v3(callout.to)],
    labelAt: v3(callout.from.map((c, i) => (c + callout.to[i]) / 2)),
  }));
}

/**
 * Compiles the room into mesh, light and annotation records. The wireframe
 * view turns faces to smoked glass and adds box and room edges; the
 * technical view adds axes, SKU tags and clearance callouts on top.
 */
export function buildScene({ state, conflicts = new Map(), selectedUid = null, technical = false, wireframe = false }) {
  const { room, items } = state;
  const rig = LIGHTING_RIGS[room.lighting] ?? LIGHTING_RIGS.night;
  const modules = items.map((item) => moduleRecord(item, room, rig, conflicts, selectedUid));
  const furniture = furnitureRecords(room);
  const shell = buildShell(room);
  const edges = technical || wireframe;

  const lights = modules.flatMap((module) => module.lights.map((light) => ({ ...light, uid: module.uid })));
  const meshes =
    shell.surfaces.length +
    shell.poche.length +
    furniture.length +
    modules.reduce((sum, module) => sum + 1 + module.emitters.length + (module.felt ? 1 : 0), 0);

  return {
    lighting: room.lighting,
    rig,
    size: v3([room.widthCm, room.heightCm, room.depthCm]),
    shell,
    grid: buildGrid(room),
    modules,
    furniture,
    lights,
    wireframe: wireframe && !technical,
    technical,
    edges,
    roomEdges: edges ? roomEdges(room) : null,
    axes: technical ? buildAxes(room) : null,
    callouts: technical ? buildCallouts(state, selectedUid) : null,
    tags: technical
      ? modules.map((module) => ({ uid: module.uid, sku: module.sku, at: v3([module.box.x0, module.box.y1 + 6, module.box.z1]) }))
      : null,
    stats: { meshes, lights: lights.length + 3 },
  };
}
