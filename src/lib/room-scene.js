import { getFinish, getProduct } from '../data/products.js';
import { dimFactor } from './dimming.js';
import { kelvinToRgb } from './photometry.js';
import { CAMERA_ZOOM, clearanceCallouts, furnitureLayout, moduleBox } from './room-3d.js';
import {
  boxToRoom,
  DEFAULT_ROOM_WALL,
  ROOM_WALLS,
  sanitizeWallId,
  WALL_HEADING,
  WALL_ROT_Y,
  wallOf,
  wallSpanCm,
  wallToRoom,
} from './room-walls.js';

/*
 * Scene description for the WebGL room viewport. Converts the room state
 * (cm; each module in its own wall frame, the room with X along the north
 * wall, Y up and Z toward the south wall) into plain mesh, material and
 * light records in metres. Pure and deterministic, so it is testable without
 * a WebGL context. RoomCanvas only maps these records onto React Three Fiber
 * primitives.
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
const TRIM_LIFT_M = 0.003;
const BASEBOARD_H_CM = 8;
const BASEBOARD_D_CM = 1.6;
const PLANK_CM = 18;
const SCALE_TICK_CM = 50;
const CREASE_INSET_CM = 0.4;
// The orbit centre leans 6% of the room toward the wall in view.
const TARGET_LEAN = 0.06;

const m = (cm) => Number((cm * CM).toFixed(4));
const v3 = (p) => p.map(m);

function hex(rgb) {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/*
 * Lighting rigs. The canvas is transparent: the stage behind it carries a
 * warm horizon gradient. At night every surface keeps an emissive floor
 * tone, so walls, floor and furniture stay legible even with no channel lit,
 * while the albedo stays light enough for the LED washes to read. With
 * nothing lit the fill lifts further (idle).
 */
export const LIGHTING_RIGS = Object.freeze({
  night: {
    ambient: { color: '#ffd8ae', intensity: 0.2 },
    hemisphere: { sky: '#6a7286', ground: '#2a2219', intensity: 0.5 },
    sun: { color: '#b4c2da', intensity: 0.32, from: [-0.35, 1.1, 1.2] },
    idle: 1.55,
    led: 1,
    emissive: 2.6,
    surfaces: {
      wall: '#d2ccc2',
      side: '#c9c2b7',
      floor: '#8c8479',
      poche: '#34312d',
      glow: { wall: '#262320', side: '#24211e', floor: '#1c1a17' },
    },
    grid: { color: '#f2eee7', opacity: 0.1 },
    trim: { color: '#7d756a', opacity: 0.95 },
    baseboard: '#bcb5a9',
    ceiling: { color: '#c6c0b6', glow: '#1f1d1a' },
    plank: { color: '#d8b48a', opacity: 0.07 },
    crease: { color: '#0b0a09', opacity: 0.28 },
  },
  daylight: {
    ambient: { color: '#fff6ea', intensity: 0.85 },
    hemisphere: { sky: '#f3efe8', ground: '#8d8578', intensity: 0.55 },
    sun: { color: '#fff1dc', intensity: 2.4, from: [-0.45, 1.25, 1] },
    idle: 1,
    led: 0.45,
    emissive: 1.1,
    surfaces: {
      wall: '#dcd7ce',
      side: '#d3cdc3',
      floor: '#b8b0a4',
      poche: '#2c2a27',
      glow: null,
    },
    grid: { color: '#0b0b0a', opacity: 0.09 },
    trim: { color: '#6f685e', opacity: 0.9 },
    baseboard: '#e6e1d8',
    ceiling: { color: '#e4dfd6', glow: null },
    plank: { color: '#6b5a44', opacity: 0.08 },
    crease: { color: '#5d574e', opacity: 0.32 },
  },
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

/** Shortest signed turn from one heading to another, in degrees, within [-180, 180). */
export function headingDelta(from, to) {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

/**
 * Orbit frame for a room, a viewport aspect and the wall in view (north by
 * default). Distance at zoom 1 fits the room's bounding sphere to the shorter
 * viewport side; a wide viewport lets it overfill the height by up to 26
 * percent. Three.js fov is vertical, so a portrait viewport widens it to keep
 * 38 deg across its width. `heading` is the azimuth that faces the wall; the
 * camera yaw is measured from it.
 */
export function cameraFrame(room, aspect, wall = DEFAULT_ROOM_WALL) {
  const W = room.widthCm * CM;
  const H = room.heightCm * CM;
  const D = room.depthCm * CM;
  const id = sanitizeWallId(wall);
  const half = (FOV_DEG / 2) * DEG;
  const radius = 0.5 * Math.hypot(W, H, D);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.6;
  const fill = 1 + (FRAME_FILL_WIDE - 1) * Math.min(1, Math.max(0, (safeAspect - 1) / (WIDE_ASPECT - 1)));
  const base = radius / (Math.tan(half) * fill);
  const fov = safeAspect >= 1 ? FOV_DEG : (2 * Math.atan(Math.tan(half) / safeAspect)) / DEG;
  const lean = {
    north: [0, -D * TARGET_LEAN],
    east: [W * TARGET_LEAN, 0],
    south: [0, D * TARGET_LEAN],
    west: [-W * TARGET_LEAN, 0],
  }[id];
  return {
    target: [W / 2 + lean[0], H * 0.42, D / 2 + lean[1]],
    heading: WALL_HEADING[id],
    base,
    fov,
    minDistance: base / CAMERA_ZOOM.max,
    maxDistance: base / CAMERA_ZOOM.min,
  };
}

/** Eye position for a yaw / pitch / zoom camera. Yaw 0 looks straight at the wall the frame faces. */
export function cameraPosition(frame, camera) {
  const distance = frame.base / camera.zoom;
  const yaw = ((frame.heading ?? 0) + camera.yaw) * DEG;
  const pitch = camera.pitch * DEG;
  const [tx, ty, tz] = frame.target;
  return [
    tx + distance * Math.sin(yaw) * Math.cos(pitch),
    ty + distance * Math.sin(pitch),
    tz + distance * Math.cos(yaw) * Math.cos(pitch),
  ];
}

/** Inverse of cameraPosition, yaw relative to the frame heading. Unclamped; sanitizeCamera rounds it. */
export function cameraFromPosition(frame, position) {
  const dx = position[0] - frame.target[0];
  const dy = position[1] - frame.target[1];
  const dz = position[2] - frame.target[2];
  const distance = Math.hypot(dx, dy, dz) || frame.base;
  return {
    yaw: headingDelta(frame.heading ?? 0, Math.atan2(dx, dz) / DEG),
    pitch: Math.asin(Math.max(-1, Math.min(1, dy / distance))) / DEG,
    zoom: frame.base / distance,
  };
}

/**
 * OrbitControls limits matching CAMERA_YAW and CAMERA_PITCH around a heading
 * (polar angle runs from +Y). Past +-180 deg OrbitControls wraps the range.
 */
export function orbitLimits(yawRange, pitchRange, heading = 0) {
  return {
    minAzimuthAngle: (heading + yawRange.min) * DEG,
    maxAzimuthAngle: (heading + yawRange.max) * DEG,
    minPolarAngle: (90 - pitchRange.max) * DEG,
    maxPolarAngle: (90 - pitchRange.min) * DEG,
  };
}

/** Key light direction turned with the heading, so it always falls over the viewer's shoulder. */
export function sunDirection(rig, heading = 0) {
  const [x, y, z] = rig.sun.from;
  const a = heading * DEG;
  return [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
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
 * Section cut per wall, in metres: a wall, its poche and the modules on it
 * hide once the eye crosses its plane, so the wall between the camera and the
 * room never blocks the view. `below` keeps it while the eye coordinate is
 * above the value, `above` while it is below.
 */
export function wallCull(room, wall) {
  switch (sanitizeWallId(wall)) {
    case 'east':
      return { axis: 0, above: m(room.widthCm) };
    case 'south':
      return { axis: 2, above: m(room.depthCm) };
    case 'west':
      return { axis: 0, below: 0 };
    default:
      return { axis: 2, below: 0 };
  }
}

/**
 * Interior faces are single-sided planes facing into the room, so a wall the
 * camera has orbited past culls itself. Each wall also carries its section
 * `cull`, which hides the poche slab behind it and the modules on it.
 */
function buildShell(room, rig) {
  const { widthCm: W, depthCm: D, heightCm: H } = room;
  const T = WALL_T_CM;
  const { surfaces: tone } = rig;
  const glow = (key) => (tone.glow ? tone.glow[key] : null);
  return {
    surfaces: [
      { id: 'floor', color: tone.floor, glow: glow('floor'), size: [m(W), m(D)], position: [m(W / 2), 0, m(D / 2)], rotation: [-Math.PI / 2, 0, 0] },
      { id: 'back', wall: 'north', color: tone.wall, glow: glow('wall'), size: [m(W), m(H)], position: [m(W / 2), m(H / 2), 0], rotation: [0, 0, 0], cull: wallCull(room, 'north') },
      { id: 'right', wall: 'east', color: tone.side, glow: glow('side'), size: [m(D), m(H)], position: [m(W), m(H / 2), m(D / 2)], rotation: [0, -Math.PI / 2, 0], cull: wallCull(room, 'east') },
      { id: 'front', wall: 'south', color: tone.wall, glow: glow('wall'), size: [m(W), m(H)], position: [m(W / 2), m(H / 2), m(D)], rotation: [0, Math.PI, 0], cull: wallCull(room, 'south') },
      { id: 'left', wall: 'west', color: tone.side, glow: glow('side'), size: [m(D), m(H)], position: [0, m(H / 2), m(D / 2)], rotation: [0, Math.PI / 2, 0], cull: wallCull(room, 'west') },
    ],
    poche: [
      slab('floor', tone.poche, { x0: -T, x1: W + T, y0: -SLAB_T_CM, y1: -0.2, z0: -T, z1: D + T }),
      { ...slab('back', tone.poche, { x0: -T, x1: W + T, y0: 0, y1: H, z0: -T, z1: -0.2 }), cull: wallCull(room, 'north') },
      { ...slab('right', tone.poche, { x0: W + 0.2, x1: W + T, y0: 0, y1: H, z0: 0, z1: D }), cull: wallCull(room, 'east') },
      { ...slab('front', tone.poche, { x0: -T, x1: W + T, y0: 0, y1: H, z0: D + 0.2, z1: D + T }), cull: wallCull(room, 'south') },
      { ...slab('left', tone.poche, { x0: -T, x1: -0.2, y0: 0, y1: H, z0: 0, z1: D }), cull: wallCull(room, 'west') },
    ],
  };
}

/**
 * Architectural envelope details. The ceiling is a single-sided plane facing
 * down, so seen from above it culls itself; the viewport also drops it in the
 * orbit cutaway. Baseboards run along the foot of every wall and hide with
 * their wall's section cut, as do the corner creases, which need both walls.
 */
function buildEnvelope(room, rig) {
  const { widthCm: W, depthCm: D, heightCm: H } = room;
  const ceiling = {
    id: 'ceiling',
    color: rig.ceiling.color,
    glow: rig.ceiling.glow,
    size: [m(W), m(D)],
    position: [m(W / 2), m(H), m(D / 2)],
    rotation: [Math.PI / 2, 0, 0],
  };
  const baseboards = ROOM_WALLS.map((wall) => ({
    ...slab(`baseboard-${wall}`, rig.baseboard, boxToRoom(room, wall, {
      x0: 0,
      x1: wallSpanCm(room, wall),
      y0: 0,
      y1: BASEBOARD_H_CM,
      z0: 0,
      z1: BASEBOARD_D_CM,
    })),
    wall,
    cull: wallCull(room, wall),
  }));
  const i = CREASE_INSET_CM;
  const creases = [
    { id: 'north-west', walls: ['north', 'west'], at: [i, i] },
    { id: 'north-east', walls: ['north', 'east'], at: [W - i, i] },
    { id: 'south-east', walls: ['south', 'east'], at: [W - i, D - i] },
    { id: 'south-west', walls: ['south', 'west'], at: [i, D - i] },
  ].map((corner) => ({
    id: corner.id,
    walls: corner.walls,
    culls: corner.walls.map((wall) => wallCull(room, wall)),
    points: [v3([corner.at[0], 0, corner.at[1]]), v3([corner.at[0], H, corner.at[1]])],
  }));
  return { ceiling, baseboards, creases };
}

/** Warm plank seams along the room width, and a 50 cm scale tick row inside the floor perimeter. */
function buildPlanks(room) {
  const { widthCm: W, depthCm: D } = room;
  const points = [];
  for (let z = PLANK_CM; z < D; z += PLANK_CM) points.push([0, 0.0015, m(z)], [m(W), 0.0015, m(z)]);
  return points;
}

function buildScaleTicks(room) {
  const { widthCm: W, depthCm: D } = room;
  const y = 0.0025;
  const points = [];
  for (let x = SCALE_TICK_CM; x < W; x += SCALE_TICK_CM) {
    const len = x % 100 === 0 ? 9 : 5;
    points.push([m(x), y, m(BASEBOARD_D_CM)], [m(x), y, m(BASEBOARD_D_CM + len)]);
  }
  for (let z = SCALE_TICK_CM; z < D; z += SCALE_TICK_CM) {
    const len = z % 100 === 0 ? 9 : 5;
    points.push([m(BASEBOARD_D_CM), y, m(z)], [m(BASEBOARD_D_CM + len), y, m(z)]);
  }
  return points;
}

function buildGrid(room) {
  const { widthCm: W, depthCm: D } = room;
  const points = [];
  for (let x = GRID_CM; x < W; x += GRID_CM) points.push([m(x), 0.002, 0], [m(x), 0.002, m(D)]);
  for (let z = GRID_CM; z < D; z += GRID_CM) points.push([0, 0.002, m(z)], [m(W), 0.002, m(z)]);
  return points;
}

/** Floor perimeter trim: a crisp line where every wall meets the floor. */
function buildTrim(room) {
  const W = m(room.widthCm);
  const D = m(room.depthCm);
  const y = TRIM_LIFT_M;
  const corners = [
    [0, y, 0],
    [W, y, 0],
    [W, y, D],
    [0, y, D],
  ];
  return corners.flatMap((corner, i) => [corner, corners[(i + 1) % corners.length]]);
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

/* Modules. Boxes are built in the wall frame, then placed in the room. */

/** Mesh record for a wall-frame box: size in the wall frame, centre carried into the room. */
function placedRecord(box, place) {
  return {
    size: [m(box.x1 - box.x0), m(box.y1 - box.y0), m(box.z1 - box.z0)],
    position: v3(place([(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2])),
  };
}

function boxRecord(box) {
  return placedRecord(box, (point) => point);
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
    case 'pendant':
      return [{ x0: b.x0 + 1, x1: b.x1 - 1, y0: b.y0 - 0.3, y1: b.y0 + 0.5, z0: b.z0 + 1, z1: b.z1 - 1 }];
    case 'sconce':
      return [{ x0: xMid - 1.5, x1: xMid + 1.5, y0: b.y0 + 1.5, y1: b.y1 - 1.5, z0: b.z1 - 0.2, z1: b.z1 + 0.3 }];
    default:
      return [];
  }
}

/**
 * The real light each lit module throws, in metres. Spot lights wash the
 * wall and floor below shelves and bars; the column and the backlit frame
 * are omnidirectional. Intensity scales with the part's rated lumens and its
 * DALI-2 dim level. Positions and targets are worked out in the wall frame
 * and carried into the room by `place`.
 */
function moduleLights(item, product, b, room, rig, place) {
  if (!item.led || product.watts === 0) return [];
  const color = hex(kelvinToRgb(product.kelvin ?? 2700));
  const strength = (product.lumens / 1000) * rig.led * dimFactor(item);
  const xMid = (b.x0 + b.x1) / 2;
  const yMid = (b.y0 + b.y1) / 2;
  const spot = (id, from, to, angleDeg, intensity, distanceCm) => ({
    id,
    type: 'spot',
    color,
    position: v3(place(from)),
    target: v3(place(to)),
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
    position: v3(place(at)),
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
    case 'pendant': {
      const zMid = (b.z0 + b.z1) / 2;
      return [spot('down', [xMid, b.y0 - 0.5, zMid], [xMid, 0, zMid], 64, 5.5, 380)];
    }
    case 'sconce':
      return [
        spot('down', [xMid, b.y0 - 0.5, b.z1 - 1], [xMid, Math.max(0, b.y0 - 140), 2], 38, 3, 280),
        spot('up', [xMid, b.y1 + 0.5, b.z1 - 1], [xMid, Math.min(room.heightCm, b.y1 + 140), 2], 38, 3, 280),
      ];
    default:
      return [];
  }
}

const FELT_INSET_CM = new Map([
  ['frame', 3],
  ['baffle', 1.2],
]);

function feltRecord(shape, box) {
  const t = FELT_INSET_CM.get(shape);
  if (t === undefined) return null;
  return {
    color: '#3a3834',
    box: { x0: box.x0 + t, x1: box.x1 - t, y0: box.y0 + t, y1: box.y1 - t, z0: box.z1 - 1, z1: box.z1 + 0.15 },
  };
}


function moduleRecord(item, room, rig, conflicts, selectedUid) {
  const product = getProduct(item.productId);
  const finish = getFinish(item.finish);
  const wall = wallOf(item);
  const place = wall === DEFAULT_ROOM_WALL ? (point) => point : (point) => wallToRoom(room, wall, point);
  const rotation = [0, WALL_ROT_Y[wall], 0];
  const box = moduleBox(item);
  const lit = item.led && product.watts > 0;
  const level = product.watts > 0 ? dimFactor(item) : 1;
  const light = hex(kelvinToRgb(product.kelvin ?? 2700));
  const cylinder = product.shape === 'column' || product.shape === 'spot';
  const { w, h, d } = product.dimsCm;
  const felt = feltRecord(product.shape, box);

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
    wall,
    rotation,
    cull: wallCull(room, wall),
    ...placedRecord(box, place),
    box,
    xCm: item.xCm,
    yCm: item.yCm,
    dims: `${w}x${h}x${d}`,
    led: product.watts > 0 ? String(item.led) : 'none',
    lit,
    dimPct: Math.round(level * 100),
    emitters: emitterBoxes(product.shape, box).map((e, i) => ({
      key: `${item.uid}-e${i}`,
      color: light,
      intensity: lit ? Number((rig.emissive * level).toFixed(3)) : 0,
      ...placedRecord(e, place),
    })),
    felt: felt ? { color: felt.color, ...placedRecord(felt.box, place) } : null,
    lights: moduleLights(item, product, box, room, rig, place),
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

/** With no channel lit, the ambient and sky fill lift so the empty room still reads. */
function fillRig(rig, idle) {
  if (!idle || rig.idle === 1) return rig;
  return {
    ...rig,
    ambient: { ...rig.ambient, intensity: Number((rig.ambient.intensity * rig.idle).toFixed(3)) },
    hemisphere: { ...rig.hemisphere, intensity: Number((rig.hemisphere.intensity * rig.idle).toFixed(3)) },
  };
}

/**
 * Compiles the room into mesh, light and annotation records. The wireframe
 * view turns faces to smoked glass and adds box and room edges; the
 * technical view adds axes, SKU tags and clearance callouts on top.
 */
export function buildScene({ state, conflicts = new Map(), selectedUid = null, technical = false, wireframe = false }) {
  const { room, items } = state;
  const base = LIGHTING_RIGS[room.lighting] ?? LIGHTING_RIGS.night;
  const modules = items.map((item) => moduleRecord(item, room, base, conflicts, selectedUid));
  const lights = modules.flatMap((module) => module.lights.map((light) => ({ ...light, uid: module.uid })));
  const rig = fillRig(base, lights.length === 0);
  const furniture = furnitureRecords(room);
  const shell = buildShell(room, rig);
  const envelope = buildEnvelope(room, rig);
  const edges = technical || wireframe;

  const meshes =
    shell.surfaces.length +
    shell.poche.length +
    envelope.baseboards.length +
    1 +
    furniture.length +
    modules.reduce((sum, module) => sum + 1 + module.emitters.length + (module.felt ? 1 : 0), 0);

  return {
    lighting: room.lighting,
    rig,
    size: v3([room.widthCm, room.heightCm, room.depthCm]),
    shell,
    grid: buildGrid(room),
    trim: buildTrim(room),
    envelope,
    planks: buildPlanks(room),
    scaleTicks: buildScaleTicks(room),
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
      ? modules.map((module) => ({
          uid: module.uid,
          sku: module.sku,
          at: v3(wallToRoom(room, module.wall, [module.box.x0, module.box.y1 + 6, module.box.z1])),
          cull: module.cull,
        }))
      : null,
    stats: { meshes, lights: lights.length + 3 },
  };
}
