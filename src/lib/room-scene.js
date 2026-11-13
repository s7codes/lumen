import { getFinish, getProduct } from '../data/products.js';
import { dimFactor } from './dimming.js';
import { finishMaterial, PBR_MATERIALS } from './pbr-materials.js';
import { kelvinToRgb } from './photometry.js';
import {
  CAMERA_ZOOM,
  clearanceCallouts,
  furnitureLayout,
  moduleBox,
  moduleRoomBox,
  solarHourOf,
  windowWallOf,
} from './room-3d.js';
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
import { solarState } from './solar-path.js';

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
    // How strongly light beams read in the air: dark rooms show them best.
    air: 1,
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
    air: 0.3,
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

/**
 * Key light direction. At night the fill is turned with the heading, so it
 * always falls over the viewer's shoulder; the daylight sun is fixed in the
 * room frame by the solar path.
 */
export function sunDirection(rig, heading = 0) {
  if (rig.sun.fixed) return rig.sun.from;
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
    ].map((surface) =>
      // A wide-plank floor under Venetian plaster walls.
      surface.id === 'floor'
        ? { ...surface, material: 'floor-parquet', roughness: PBR_MATERIALS['floor-parquet'].roughness }
        : { ...surface, material: 'wall-plaster', roughness: PBR_MATERIALS['wall-plaster'].roughness },
    ),
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
    material: 'wall-plaster',
    roughness: 0.95,
  };
  const baseboards = ROOM_WALLS.map((wall) => ({
    material: 'matte-chalk',
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


/*
 * Parametric CAD sub-assemblies. Each part is drawn as the real assembly it
 * is (slab and cleat, carcass and doors, housing and stand-offs, slats and
 * fins), built in its wall frame in cm and carried into the room in metres.
 * The module record keeps its single bounding primitive for picking,
 * collisions and every existing reader; `subparts` is what the canvas draws.
 *
 * A subpart: { id, kind, geometry: 'box' | 'cylinder', size (metres, in the
 * part's own frame: x along the wall, y up, z out), radius, radiusBottom,
 * position (room metres, centre), rotation ([x, y, z], Euler order YXZ: a
 * cylinder's axis turned first, then the wall's quarter turn), material (a
 * PBR family key), color, roughness, metalness, grain, shadow, emissive }.
 */

const ACCENTS = Object.freeze({
  shadow: { material: 'metal-obsidian', color: '#151412', roughness: 0.86, metalness: 0.08 },
  anodised: { material: 'metal-obsidian', color: '#2b2d30' },
  aluminium: { material: 'metal-steel', color: '#a8acaf' },
  steel: { material: 'metal-steel', color: '#8c9196' },
  brass: { material: 'metal-steel', color: '#b39060', metalness: 0.62 },
  copper: { material: 'metal-steel', color: '#b8774a', metalness: 0.62 },
  felt: { material: 'felt-acoustic', color: '#3a3834' },
  ceramic: { material: 'matte-chalk', color: '#d7d0c3' },
  slate: { material: 'matte-chalk', color: '#3e4a52' },
  linen: { material: 'matte-chalk', color: '#cdbd9f' },
  opal: { material: 'matte-chalk', color: '#f4efe6', roughness: 0.6 },
  amber: { material: 'matte-chalk', color: '#e8923a', roughness: 0.55 },
  screen: { material: 'metal-obsidian', color: '#232b33', roughness: 0.2, metalness: 0.1 },
});

const FURNITURE_LOOK = Object.freeze({
  shadow: { material: 'metal-obsidian', roughness: 0.86, metalness: 0.08 },
  oak: { material: 'wood-oak' },
  linen: { material: 'felt-acoustic' },
  'linen-hi': { material: 'felt-acoustic' },
  steel: { material: 'metal-steel' },
  felt: { material: 'felt-acoustic' },
  'felt-hi': { material: 'felt-acoustic' },
});

/**
 * The look a sub-part is drawn with. Sub-parts sharing a look batch into one
 * draw call in the canvas, so the drawn mesh count is the number of looks.
 */
export function subpartLookKey(part) {
  return [part.material, part.color, part.roughness, part.metalness, part.emissive ?? '-', part.emissiveIntensity, part.shadow ? 1 : 0].join('|');
}

function lookCount(parts) {
  return new Set(parts.map(subpartLookKey)).size;
}

/** Wall-frame box spec, cm. */
function B(id, kind, tone, x0, x1, y0, y1, z0, z1, extra = {}) {
  return { id, kind, tone, geometry: 'box', box: { x0, x1, y0, y1, z0, z1 }, ...extra };
}

/** Wall-frame cylinder spec, cm: centre, radius, length along `axis` ('y' up, 'z' out of the wall, 'x' along it). */
function C(id, kind, tone, cx, cy, cz, r, len, axis = 'y', extra = {}) {
  return { id, kind, tone, geometry: 'cylinder', at: [cx, cy, cz], r, r2: extra.r2 ?? r, len, axis, ...extra };
}

function lookOf(tone, ctx) {
  if (tone === 'finish') return ctx.finishLook;
  if (tone === 'finish-shade') return ctx.shadeLook;
  if (Object.hasOwn(FURNITURE_TONES, tone)) return { ...FURNITURE_LOOK[tone], color: FURNITURE_TONES[tone] };
  return ACCENTS[tone] ?? ACCENTS.shadow;
}

const AXIS_TURN = Object.freeze({ y: [0, 0], z: [Math.PI / 2, 0], x: [0, Math.PI / 2] });

function placeSubpart(spec, ctx) {
  const look = lookOf(spec.tone, ctx);
  const pbr = PBR_MATERIALS[look.material];
  const glowing = spec.glow === true && ctx.lit;
  const base = {
    id: `${ctx.uid}-${spec.id}`,
    kind: spec.kind,
    material: look.material,
    color: look.color,
    roughness: look.roughness ?? pbr.roughness,
    metalness: look.metalness ?? pbr.metalness,
    grain: spec.grain ?? null,
    shadow: spec.shadow !== false,
    emissive: glowing ? ctx.lightColor : null,
    emissiveIntensity: glowing ? Number((ctx.emissive * 0.5).toFixed(3)) : 0,
  };
  if (spec.geometry === 'box') {
    const b = spec.box;
    return {
      ...base,
      geometry: 'box',
      radius: null,
      radiusBottom: null,
      size: [m(b.x1 - b.x0), m(b.y1 - b.y0), m(b.z1 - b.z0)],
      position: v3(ctx.place([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2])),
      rotation: [0, ctx.rotY, 0],
    };
  }
  const [ax, az] = AXIS_TURN[spec.axis] ?? AXIS_TURN.y;
  const span = 2 * Math.max(spec.r, spec.r2);
  return {
    ...base,
    geometry: 'cylinder',
    radius: m(spec.r),
    radiusBottom: m(spec.r2),
    segments: spec.segments ?? 24,
    size: [m(span), m(spec.len), m(span)],
    position: v3(ctx.place(spec.at)),
    rotation: [ax, ctx.rotY, az],
  };
}

/** Curated objects on a shelf top, scaled to the clear height above it, or none when it is tight. */
function shelfObjects(b, headroom) {
  const { x0, x1, y1, z1 } = b;
  const clear = headroom - 1.5;
  if (clear < 6) return [];
  const objects = [
    B('monograph-1', 'object', 'slate', x0 + 12, x0 + 36, y1, y1 + 3.2, z1 - 20, z1 - 3),
    B('monograph-2', 'object', 'linen', x0 + 13.5, x0 + 34, y1 + 3.2, y1 + 5.6, z1 - 18.5, z1 - 4.5),
  ];
  const vessel = Math.min(16, clear);
  if (vessel >= 8) objects.push(C('vessel', 'object', 'ceramic', x1 - 22, y1 + vessel / 2, z1 - 12, 5.2, vessel, 'y', { segments: 32 }));
  return objects;
}

const SUBASSEMBLIES = Object.freeze({
  // Timber slab floating 8 mm off a dark steel cleat, an aluminium LED channel under its front lip.
  shelf(b, ctx) {
    const { x0, x1, y0, y1, z1 } = b;
    return [
      B('slab', 'slab', 'finish', x0, x1, y0, y1, 0.8, z1, { grain: 'x' }),
      B('cleat', 'cleat', 'shadow', x0 + 6, x1 - 6, y0 + 1.5, y1 - 1.5, 0, 3.6),
      B('channel-rear', 'channel', 'aluminium', x0 + 2, x1 - 2, y0 - 1, y0, z1 - 3.6, z1 - 3, { grain: 'x', shadow: false }),
      B('channel-front', 'channel', 'aluminium', x0 + 2, x1 - 2, y0 - 1, y0, z1 - 1, z1 - 0.4, { grain: 'x', shadow: false }),
      B('channel-cap-left', 'channel', 'aluminium', x0 + 1.4, x0 + 2, y0 - 1, y0, z1 - 3.6, z1 - 0.4, { shadow: false }),
      B('channel-cap-right', 'channel', 'aluminium', x1 - 2, x1 - 1.4, y0 - 1, y0, z1 - 3.6, z1 - 0.4, { shadow: false }),
      ...shelfObjects(b, ctx.headroom),
    ];
  },
  // Hollow 2 cm carcass, recessed back panel, mid divider and two small objects inside.
  cube(b) {
    const { x0, x1, y0, y1, z1 } = b;
    const t = 2;
    const ym = (y0 + y1) / 2;
    return [
      B('top', 'carcass', 'finish', x0, x1, y1 - t, y1, 0, z1, { grain: 'x' }),
      B('bottom', 'carcass', 'finish', x0, x1, y0, y0 + t, 0, z1, { grain: 'x' }),
      B('side-left', 'carcass', 'finish', x0, x0 + t, y0 + t, y1 - t, 0, z1, { grain: 'y' }),
      B('side-right', 'carcass', 'finish', x1 - t, x1, y0 + t, y1 - t, 0, z1, { grain: 'y' }),
      B('back', 'back-panel', 'finish-shade', x0 + t, x1 - t, y0 + t, y1 - t, 0, 1.2, { grain: 'y' }),
      B('divider', 'divider', 'finish', x0 + t, x1 - t, ym - 0.75, ym + 0.75, 1.2, z1 - 2, { grain: 'x' }),
      B('book-1', 'object', 'slate', x0 + 4, x0 + 13, y0 + t, y0 + t + 2.4, 6, z1 - 8),
      B('book-2', 'object', 'linen', x0 + 4.6, x0 + 12.4, y0 + t + 2.4, y0 + t + 4.2, 7, z1 - 9),
      C('vessel', 'object', 'ceramic', x1 - 10, ym + 0.75 + 4.5, z1 / 2 + 2, 3.2, 9, 'y', { segments: 24 }),
    ];
  },
  // Carcass over a recessed shadow-line plinth, twin inset doors with a 6 mm reveal, steel pulls, tray top.
  sideboard(b) {
    const { x0, x1, y0, y1, z1 } = b;
    const xm = (x0 + x1) / 2;
    const plinth = 3;
    const door = 2;
    return [
      B('carcass', 'carcass', 'finish', x0, x1, y0 + plinth, y1 - 1.4, 0, z1 - door, { grain: 'x' }),
      B('plinth', 'plinth', 'shadow', x0 + 3, x1 - 3, y0, y0 + plinth, 2, z1 - 6),
      B('led-channel', 'channel', 'aluminium', x0 + 2, x1 - 2, y0 + 0.5, y0 + plinth, z1 - 4.4, z1 - 1.6, { grain: 'x', shadow: false }),
      B('door-left', 'door', 'finish', x0 + 0.6, xm - 0.3, y0 + plinth + 0.6, y1 - 2, z1 - door, z1, { grain: 'y' }),
      B('door-right', 'door', 'finish', xm + 0.3, x1 - 0.6, y0 + plinth + 0.6, y1 - 2, z1 - door, z1, { grain: 'y' }),
      B('reveal', 'reveal', 'shadow', xm - 0.3, xm + 0.3, y0 + plinth + 0.6, y1 - 2, z1 - door - 0.4, z1 - 0.2, { shadow: false }),
      B('handle-left', 'handle', 'steel', xm - 3.2, xm - 2.4, y1 - 15, y1 - 5, z1, z1 + 1.4),
      B('handle-right', 'handle', 'steel', xm + 2.4, xm + 3.2, y1 - 15, y1 - 5, z1, z1 + 1.4),
      B('top', 'tray', 'finish', x0, x1, y1 - 1.4, y1, 0, z1, { grain: 'x' }),
      B('tray-back', 'tray', 'finish', x0, x1, y1, y1 + 1.6, 0, 1.2, { grain: 'x' }),
      B('tray-left', 'tray', 'finish', x0, x0 + 1.2, y1, y1 + 1.6, 1.2, z1, { grain: 'z' }),
      B('tray-right', 'tray', 'finish', x1 - 1.2, x1, y1, y1 + 1.6, 1.2, z1, { grain: 'z' }),
    ];
  },
  // Extruded housing on two round stand-offs, machined end caps, bezel lines framing the opal face.
  lightbar(b) {
    const { x0, x1, y0, y1, z1 } = b;
    const ym = (y0 + y1) / 2;
    const stand = 1.6;
    return [
      B('housing', 'housing', 'finish', x0 + 1.2, x1 - 1.2, y0 + 0.4, y1 - 0.4, stand, z1, { grain: 'x' }),
      C('bracket-left', 'bracket', 'aluminium', x0 + 8, ym, stand / 2, 0.9, stand, 'z', { segments: 16 }),
      C('bracket-right', 'bracket', 'aluminium', x1 - 8, ym, stand / 2, 0.9, stand, 'z', { segments: 16 }),
      B('cap-left', 'end-cap', 'anodised', x0, x0 + 1.2, y0, y1, stand - 0.2, z1),
      B('cap-right', 'end-cap', 'anodised', x1 - 1.2, x1, y0, y1, stand - 0.2, z1),
      B('bezel-top', 'lens-bezel', 'anodised', x0 + 1.2, x1 - 1.2, y0 + 3.6, y0 + 3.9, z1, z1 + 0.15, { shadow: false }),
      B('bezel-bottom', 'lens-bezel', 'anodised', x0 + 1.2, x1 - 1.2, y0 + 0.9, y0 + 1.2, z1, z1 + 0.15, { shadow: false }),
    ];
  },
  // Weighted steel base, anodised core, machined cap and twin ribs framing the opal slot.
  column(b) {
    const { x0, x1, y0, y1, z1 } = b;
    const xm = (x0 + x1) / 2;
    const zc = z1 / 2;
    return [
      C('base', 'base', 'anodised', xm, y0 + 1.5, zc, 9, 3, 'y', { segments: 40 }),
      C('core', 'core', 'finish', xm, (y0 + y1) / 2, zc, 6.5, y1 - y0 - 6, 'y', { segments: 32, grain: 'y' }),
      C('cap', 'cap', 'aluminium', xm, y1 - 1.5, zc, 7, 3, 'y', { segments: 32 }),
      B('slot', 'slot-housing', 'shadow', xm - 3, xm + 3, y0 + 4, y1 - 6, zc + 4, z1 - 1.2),
      B('rib-left', 'rib', 'aluminium', xm - 3, xm - 1.5, y0 + 4, y1 - 6, z1 - 1.4, z1 + 0.4, { grain: 'y' }),
      B('rib-right', 'rib', 'aluminium', xm + 1.5, xm + 3, y0 + 4, y1 - 6, z1 - 1.4, z1 + 0.4, { grain: 'y' }),
    ];
  },
  // Wall canopy and arm, U-bracket yoke, finned heat-sink body, honeycomb baffle and bezel.
  spot(b) {
    const { x0, x1, y0, y1, z1 } = b;
    const xm = (x0 + x1) / 2;
    const zc = z1 / 2;
    const bodyTop = y1 - 4.2;
    const bodyBottom = y0 + 0.8;
    return [
      C('canopy', 'canopy', 'finish', xm, y1 - 3.4, 0.6, 3.4, 1.2, 'z', { segments: 32 }),
      B('arm', 'arm', 'anodised', xm - 0.7, xm + 0.7, y1 - 4.1, y1 - 2.7, 1.2, zc),
      B('yoke-top', 'yoke', 'anodised', x0 + 1.4, x1 - 1.4, y1 - 3.6, y1 - 2.8, zc - 0.7, zc + 0.7),
      B('yoke-left', 'yoke', 'anodised', x0 + 1.4, x0 + 2, y0 + 3.2, y1 - 2.8, zc - 0.7, zc + 0.7),
      B('yoke-right', 'yoke', 'anodised', x1 - 2, x1 - 1.4, y0 + 3.2, y1 - 2.8, zc - 0.7, zc + 0.7),
      C('body', 'heat-sink', 'finish', xm, (bodyTop + bodyBottom) / 2, zc, 3.1, bodyTop - bodyBottom, 'y', { segments: 32 }),
      C('fin-1', 'fin', 'aluminium', xm, y0 + 3, zc, 3.5, 0.4, 'y', { segments: 32, shadow: false }),
      C('fin-2', 'fin', 'aluminium', xm, y0 + 4.2, zc, 3.5, 0.4, 'y', { segments: 32, shadow: false }),
      C('fin-3', 'fin', 'aluminium', xm, y0 + 5.4, zc, 3.5, 0.4, 'y', { segments: 32, shadow: false }),
      C('baffle', 'baffle', 'shadow', xm, y0 + 0.5, zc, 2.7, 0.6, 'y', { segments: 24, shadow: false }),
      C('bezel', 'bezel', 'aluminium', xm, y0 + 0.15, zc, 3.3, 0.3, 'y', { segments: 32, shadow: false }),
    ];
  },
  // Mitred 3 cm frame, dark backing board and nine fluted PET felt slats with shadow gaps.
  frame(b) {
    const { x0, x1, y0, y1, z1 } = b;
    const t = 3;
    const parts = [
      B('rail-top', 'rail', 'finish', x0, x1, y1 - t, y1, 0, z1, { grain: 'x' }),
      B('rail-bottom', 'rail', 'finish', x0, x1, y0, y0 + t, 0, z1, { grain: 'x' }),
      B('stile-left', 'stile', 'finish', x0, x0 + t, y0 + t, y1 - t, 0, z1, { grain: 'y' }),
      B('stile-right', 'stile', 'finish', x1 - t, x1, y0 + t, y1 - t, 0, z1, { grain: 'y' }),
      B('backing', 'backing', 'shadow', x0 + t, x1 - t, y0 + t, y1 - t, 0, 0.6, { shadow: false }),
    ];
    const count = 9;
    const gap = 0.8;
    const slat = (x1 - x0 - 2 * t - gap * (count + 1)) / count;
    for (let i = 0; i < count; i += 1) {
      const sx = x0 + t + gap + i * (slat + gap);
      const front = i % 2 === 0 ? z1 - 0.3 : z1 - 0.9;
      parts.push(B(`slat-${i + 1}`, 'slat', 'felt', sx, sx + slat, y0 + t + 0.5, y1 - t - 0.5, 0.6, front, { grain: 'y' }));
    }
    return parts;
  },
  // Dark anodised U-channel, twin copper 24V conductors and three twist-lock couplers.
  track(b) {
    const { x0, x1, y0, y1, z1 } = b;
    const ym = (y0 + y1) / 2;
    return [
      B('channel-back', 'channel', 'anodised', x0, x1, y0, y1, 0, 0.4, { grain: 'x', shadow: false }),
      B('channel-top', 'channel', 'anodised', x0, x1, y1 - 0.4, y1, 0.4, z1, { grain: 'x' }),
      B('channel-bottom', 'channel', 'anodised', x0, x1, y0, y0 + 0.4, 0.4, z1, { grain: 'x' }),
      B('end-left', 'end-cap', 'anodised', x0, x0 + 0.6, y0 + 0.4, y1 - 0.4, 0.4, z1),
      B('end-right', 'end-cap', 'anodised', x1 - 0.6, x1, y0 + 0.4, y1 - 0.4, 0.4, z1),
      B('conductor-upper', 'conductor', 'copper', x0 + 0.6, x1 - 0.6, y1 - 1.25, y1 - 0.95, 0.4, 1, { grain: 'x', shadow: false }),
      B('conductor-lower', 'conductor', 'copper', x0 + 0.6, x1 - 0.6, y0 + 0.95, y0 + 1.25, 0.4, 1, { grain: 'x', shadow: false }),
      ...[0.2, 0.5, 0.8].map((f, i) =>
        C(`coupler-${i + 1}`, 'coupler', 'anodised', x0 + (x1 - x0) * f, ym, 1.3, 0.9, 1.4, 'z', { segments: 16 }),
      ),
    ];
  },
  // Extruded beam with a louvred optic, hung on twin cables with a feed from a ceiling canopy.
  // The beam fills the lower 7.5 cm of the part's envelope, so even a pendant mounted flush
  // under the ceiling shows its suspension; lowered, the cables lengthen to the ceiling.
  pendant(b, ctx) {
    const { x0, x1, y0, z1 } = b;
    const xm = (x0 + x1) / 2;
    const zc = z1 / 2;
    const beamTop = y0 + 7.5;
    const parts = [
      B('beam', 'beam', 'finish', x0, x1, y0 + 1.2, beamTop, 0, z1, { grain: 'x' }),
      B('louver-recess', 'louver', 'shadow', x0 + 1, x1 - 1, y0 + 0.4, y0 + 1.2, 0.8, z1 - 0.8, { shadow: false }),
    ];
    const blades = 11;
    for (let i = 0; i < blades; i += 1) {
      const bx = x0 + 1 + ((i + 0.5) * (x1 - x0 - 2)) / blades;
      parts.push(B(`louver-${i + 1}`, 'louver', 'anodised', bx - 0.18, bx + 0.18, y0 - 0.4, y0 + 1, 0.9, z1 - 0.9, { shadow: false }));
    }
    const ceiling = ctx.room.heightCm;
    const drop = ceiling - beamTop;
    if (drop > 0.5) {
      for (const [side, cx] of [
        ['left', x0 + 15],
        ['right', x1 - 15],
      ]) {
        parts.push(C(`cable-${side}`, 'cable', 'steel', cx, beamTop + drop / 2, zc, 0.12, drop, 'y', { segments: 8, shadow: false }));
        parts.push(C(`gripper-${side}`, 'gripper', 'aluminium', cx, ceiling - 0.6, zc, 0.7, 1.2, 'y', { segments: 16, shadow: false }));
      }
      parts.push(C('feed', 'cable', 'steel', xm, beamTop + drop / 2, zc, 0.2, drop, 'y', { segments: 8, shadow: false }));
      parts.push(B('canopy', 'canopy', 'finish', xm - 6, xm + 6, ceiling - 2.4, ceiling, 0, 8));
    }
    return parts;
  },
  // Concealed aluminium rails, a 12 mm timber edge and seven chamfered felt fins in a wave.
  baffle(b) {
    const { x0, x1, y0, y1, z1 } = b;
    const t = 1.2;
    const parts = [
      B('rail-upper', 'rail', 'aluminium', x0 + 4, x1 - 4, y1 - 7, y1 - 5, 0, 1.2, { grain: 'x', shadow: false }),
      B('rail-lower', 'rail', 'aluminium', x0 + 4, x1 - 4, y0 + 5, y0 + 7, 0, 1.2, { grain: 'x', shadow: false }),
      B('edge-top', 'edge', 'finish', x0, x1, y1 - t, y1, 1.2, z1, { grain: 'x' }),
      B('edge-bottom', 'edge', 'finish', x0, x1, y0, y0 + t, 1.2, z1, { grain: 'x' }),
      B('edge-left', 'edge', 'finish', x0, x0 + t, y0 + t, y1 - t, 1.2, z1, { grain: 'y' }),
      B('edge-right', 'edge', 'finish', x1 - t, x1, y0 + t, y1 - t, 1.2, z1, { grain: 'y' }),
    ];
    const count = 7;
    const gap = 1.4;
    const fin = (x1 - x0 - 2 * t - gap * (count + 1)) / count;
    for (let i = 0; i < count; i += 1) {
      const fx = x0 + t + gap + i * (fin + gap);
      // Depth swells toward the middle fin and eases off at both ends.
      const front = Math.min(z1 + 0.6, 1.2 + 2.2 + 1.4 * Math.sin(((i + 0.5) / count) * Math.PI));
      parts.push(B(`fin-${i + 1}`, 'fin', 'felt', fx, fx + fin, y0 + t + 0.4, y1 - t - 0.4, 1.2, front - 0.6, { grain: 'y' }));
      parts.push(
        B(`fin-${i + 1}-chamfer`, 'fin-chamfer', 'felt', fx + 0.9, fx + fin - 0.9, y0 + t + 1.2, y1 - t - 1.2, front - 0.6, front, {
          grain: 'y',
          shadow: false,
        }),
      );
    }
    return parts;
  },
  // Rear mounting block, vertical body, a brass or obsidian reveal band and opal end lenses.
  sconce(b, ctx) {
    const { x0, x1, y0, y1, z1 } = b;
    const xm = (x0 + x1) / 2;
    const ym = (y0 + y1) / 2;
    const band = ctx.finishId === 'chalk' || ctx.finishId === 'oak' ? 'anodised' : 'brass';
    return [
      B('mount', 'mount-block', 'anodised', xm - 2.5, xm + 2.5, ym - 6, ym + 6, 0, 2),
      B('body', 'body', 'finish', x0 + 0.5, x1 - 0.5, y0 + 2, y1 - 2, 2, z1, { grain: 'y' }),
      B('band', 'reveal-band', band, x0 + 0.3, x1 - 0.3, ym - 1.2, ym + 1.2, 1.8, z1 + 0.1),
      B('bezel-top', 'lens-bezel', 'aluminium', x0 + 0.5, x1 - 0.5, y1 - 2, y1, 2, z1),
      B('bezel-bottom', 'lens-bezel', 'aluminium', x0 + 0.5, x1 - 0.5, y0, y0 + 2, 2, z1),
      B('lens-top', 'lens', 'opal', x0 + 1.5, x1 - 1.5, y1 - 0.2, y1 + 0.05, 3, z1 - 1, { glow: true, shadow: false }),
      B('lens-bottom', 'lens', 'opal', x0 + 1.5, x1 - 1.5, y0 - 0.05, y0 + 0.2, 3, z1 - 1, { glow: true, shadow: false }),
    ];
  },
  // Plaster-in steel enclosure, faceplate, heat-sink fins, three terminal blocks and a flat status bar.
  hub(b) {
    const { x0, x1, y0, y1, z1 } = b;
    const ym = (y0 + y1) / 2;
    const parts = [
      B('enclosure', 'enclosure', 'anodised', x0, x1, y0, y1, 0, z1 - 0.8, { grain: 'x' }),
      B('faceplate', 'faceplate', 'finish', x0 + 0.4, x1 - 0.4, y0 + 0.4, y1 - 0.4, z1 - 0.8, z1 - 0.4, { grain: 'x' }),
    ];
    for (let i = 0; i < 8; i += 1) {
      const fx = x0 + 3 + i * 2.2;
      parts.push(B(`fin-${i + 1}`, 'heat-sink', 'aluminium', fx, fx + 0.6, y0 + 1, y1 - 1, z1 - 0.4, z1, { shadow: false }));
    }
    for (let i = 0; i < 3; i += 1) {
      const tx = x1 - 22 + i * 7;
      parts.push(B(`terminal-${i + 1}`, 'terminal', 'shadow', tx, tx + 5.6, y0 + 1.2, y1 - 1.2, z1 - 0.4, z1 + 0.3));
      parts.push(B(`terminal-${i + 1}-screw`, 'terminal', 'copper', tx + 2.2, tx + 3.4, ym - 0.6, ym + 0.6, z1 + 0.3, z1 + 0.5, { shadow: false }));
    }
    parts.push(B('status', 'status-bar', 'amber', x0 + 24, x0 + 34, ym - 0.35, ym + 0.35, z1 - 0.4, z1 + 0.05, { shadow: false }));
    return parts;
  },
});

/* Reference furniture detail, in each piece's own frame (x from its left end, y up, z out from its wall). */

const FURNITURE_DETAILS = Object.freeze({
  'bed-160': {
    // An upholstered headboard with tufting channels rises off the oak frame.
    frame: {
      body: true,
      parts: [
        B('headboard', 'headboard', 'felt-hi', 0, 160, 24, 86, 0, 9, { grain: 'y' }),
        ...[40, 80, 120].map((x, i) => B(`tuft-${i + 1}`, 'tuft', 'shadow', x - 0.3, x + 0.3, 28, 82, 9, 9.3, { shadow: false })),
      ],
    },
    // A layered duvet drapes over the mattress sides and foot; a folded throw and a bolster sit on it.
    mattress: {
      body: true,
      parts: [
        B('duvet', 'duvet', 'linen-hi', 1.5, 158.5, 41.5, 45, 42, 205),
        B('duvet-left', 'duvet', 'linen-hi', -0.5, 1.5, 28, 45, 42, 205),
        B('duvet-right', 'duvet', 'linen-hi', 158.5, 160.5, 28, 45, 42, 205),
        B('duvet-foot', 'duvet', 'linen-hi', -0.5, 160.5, 28, 45, 205, 207),
        B('throw', 'throw', 'felt', 1.5, 158.5, 45, 47, 160, 188),
        C('bolster', 'bolster', 'linen', 80, 47.5, 47, 5, 136, 'x', { segments: 24 }),
      ],
    },
    'pillow-left': { body: true, parts: [B('crown', 'pillow', 'linen-hi', 15, 71, 52, 54, 11, 41)] },
    'pillow-right': { body: true, parts: [B('crown', 'pillow', 'linen-hi', 89, 145, 52, 54, 11, 41)] },
  },
  'desk-140': {
    // Steel A-frame trestles: two posts, a foot and a top bar each.
    'trestle-left': {
      body: false,
      parts: [
        B('post-back', 'post', 'steel', 8, 12, 2, 69, 8, 12),
        B('post-front', 'post', 'steel', 8, 12, 2, 69, 58, 62),
        B('foot', 'foot', 'steel', 8, 12, 0, 2, 6, 64),
        B('bar', 'bar', 'steel', 8, 12, 69, 71, 6, 64),
      ],
    },
    'trestle-right': {
      body: false,
      parts: [
        B('post-back', 'post', 'steel', 128, 132, 2, 69, 8, 12),
        B('post-front', 'post', 'steel', 128, 132, 2, 69, 58, 62),
        B('foot', 'foot', 'steel', 128, 132, 0, 2, 6, 64),
        B('bar', 'bar', 'steel', 128, 132, 69, 71, 6, 64),
      ],
    },
    // A steel cable tray hangs from the rail under the top.
    rail: {
      body: true,
      parts: [
        B('tray-bottom', 'cable-tray', 'steel', 30, 110, 63.5, 64.3, 4, 16),
        B('tray-lip', 'cable-tray', 'steel', 30, 110, 64.3, 69, 15.2, 16),
      ],
    },
    // On the oak top: a monitor on its stand, a sketchbook and pencil, a task lamp.
    top: {
      body: true,
      parts: [
        B('monitor-base', 'monitor', 'steel', 62, 78, 74, 74.8, 8, 20),
        B('monitor-neck', 'monitor', 'steel', 68.5, 71.5, 74.8, 84, 11.6, 13.6),
        B('monitor-panel', 'monitor', 'anodised', 46, 94, 83, 111, 10, 11.6),
        B('monitor-screen', 'monitor', 'screen', 47, 93, 84, 110, 11.6, 11.7, { shadow: false }),
        B('sketchbook', 'object', 'linen', 100, 130, 74, 75.4, 30, 52),
        C('pencil', 'object', 'oak', 115, 75.8, 49, 0.35, 14, 'x', { segments: 8, shadow: false }),
        C('lamp-base', 'lamp', 'anodised', 18, 75, 18, 6, 2, 'y', { segments: 24 }),
        C('lamp-arm', 'lamp', 'steel', 18, 91, 18, 0.7, 30, 'y', { segments: 12 }),
        B('lamp-boom', 'lamp', 'steel', 18, 36, 105, 106.4, 17.3, 18.7),
        C('lamp-shade', 'lamp', 'anodised', 34, 101, 18, 3, 8, 'y', { r2: 5, segments: 24 }),
      ],
    },
  },
  'sofa-200': {
    // Six tapered oak legs replace the plinth block.
    plinth: {
      body: false,
      parts: [10, 100, 190].flatMap((x, i) => [
        C(`leg-back-${i + 1}`, 'leg', 'oak', x, 3, 12, 2.2, 6, 'y', { r2: 1.4, segments: 16, grain: 'y' }),
        C(`leg-front-${i + 1}`, 'leg', 'oak', x, 3, 80, 2.2, 6, 'y', { r2: 1.4, segments: 16, grain: 'y' }),
      ]),
    },
    // Two plush back cushions with a softened crown.
    back: {
      body: false,
      parts: [
        B('cushion-left', 'cushion', 'felt-hi', 18.5, 99.5, 44, 76, 1, 20),
        B('cushion-left-crown', 'cushion', 'felt-hi', 20.5, 97.5, 76, 78.5, 3, 18),
        B('cushion-right', 'cushion', 'felt-hi', 100.5, 181.5, 44, 76, 1, 20),
        B('cushion-right-crown', 'cushion', 'felt-hi', 102.5, 179.5, 76, 78.5, 3, 18),
      ],
    },
    'seat-left': { body: true, parts: [B('crown', 'cushion', 'felt-hi', 21, 97, 50, 51.8, 23, 88)] },
    'seat-right': { body: true, parts: [B('crown', 'cushion', 'felt-hi', 103, 179, 50, 51.8, 23, 88)] },
    // Bolster armrests on lowered arm blocks.
    'arm-left': {
      body: false,
      parts: [
        B('block', 'arm', 'felt', 0, 18, 40, 54, 0, 92),
        C('bolster', 'bolster', 'felt', 9, 54, 46, 8, 88, 'z', { segments: 24 }),
      ],
    },
    'arm-right': {
      body: false,
      parts: [
        B('block', 'arm', 'felt', 182, 200, 40, 54, 0, 92),
        C('bolster', 'bolster', 'felt', 191, 54, 46, 8, 88, 'z', { segments: 24 }),
      ],
    },
  },
});

/* Volumetric light and contact occlusion */

/**
 * Translucent beams in the air for a lit module, drawn additively and never
 * picked. `plane` sheets (a single sheet, or a four-sided frustum when it has
 * depth) carry wall washes and grazing fans: width0 at the source, width1 at
 * the far end, `length` up (+1) or down (-1) from the source, leaning `reach`
 * out from the wall by the far end. `cone` beams run from an apex along a
 * direction; `symmetric` ones fade toward both ends. Opacity scales with the
 * part's flux, its DALI-2 level and how well the rig shows light in the air.
 */
function moduleVolumetrics(item, product, b, room, rig, place, rotY) {
  if (!item.led || !(product.watts > 0)) return [];
  const color = hex(kelvinToRgb(product.kelvin ?? 2700));
  const flux = Math.min(1.4, Math.max(0.6, product.lumens / 1200));
  const opacity = (base) => Number((base * flux * dimFactor(item) * (rig.air ?? 1)).toFixed(4));
  const { x0, x1, y0, y1, z1 } = b;
  const xm = (x0 + x1) / 2;
  const w = x1 - x0;
  const out = [];
  const plane = (id, from, drop, farZ, w0, w1, base, extra = {}) => {
    const length = Math.abs(drop);
    if (length < 8) return;
    out.push({
      id: `${item.uid}-${id}`,
      kind: extra.kind ?? 'fan',
      geometry: 'plane',
      position: v3(place(from)),
      rotation: [0, rotY, 0],
      width0: m(w0),
      width1: m(w1),
      depth0: m(extra.depth0 ?? 0),
      depth1: m(extra.depth1 ?? 0),
      length: m(length),
      direction: extra.symmetric ? 0 : Math.sign(drop),
      reach: m(farZ - from[2]),
      symmetric: extra.symmetric === true,
      color,
      opacity: opacity(base),
    });
  };
  const cone = (id, from, to, halfAngleDeg, base, maxCm, extra = {}) => {
    const p = place(from);
    const q = place(to);
    const span = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) || 1;
    const dir = [(q[0] - p[0]) / span, (q[1] - p[1]) / span, (q[2] - p[2]) / span];
    const length = Math.min(maxCm, dir[1] < -1e-6 ? p[1] / -dir[1] : maxCm);
    if (length < 8) return;
    const r0 = extra.radiusTop ?? 2.5;
    out.push({
      id: `${item.uid}-${id}`,
      kind: extra.kind ?? 'beam',
      geometry: 'cone',
      position: v3(p),
      direction: dir.map((c) => Number(c.toFixed(4)) + 0),
      length: m(length),
      radiusTop: m(r0),
      radiusBottom: m(extra.radiusBottom ?? r0 + length * Math.tan(halfAngleDeg * DEG)),
      symmetric: extra.symmetric === true,
      color,
      opacity: opacity(base),
    });
  };
  const H = room.heightCm;
  switch (product.shape) {
    case 'shelf':
      plane('wash', [xm, y0 - 0.6, z1 - 2], -Math.min(y0 - 1, 150), 3, w - 4, w + 50, 0.15);
      break;
    case 'cube':
      plane('wash', [xm, y0 - 0.6, z1 - 4], -Math.min(y0 - 1, 110), 3, w - 4, w + 34, 0.13);
      break;
    case 'sideboard':
      plane('graze', [xm, y0 - 0.6, z1 - 3], -Math.min(y0 - 0.6, 120), z1 * 0.8, w - 4, w + 40, 0.14);
      break;
    case 'lightbar':
      plane('down', [xm, y0 - 0.3, z1 + 0.4], -Math.min(y0 - 0.3, 120), 2, w - 2, w + 40, 0.12);
      plane('up', [xm, y1 + 0.3, z1 + 0.4], Math.min(H - y1 - 0.3, 120), 2, w - 2, w + 40, 0.12);
      break;
    case 'sconce':
      plane('down', [xm, y0 - 0.3, z1 - 1], -Math.min(y0 - 0.3, 110), 1.5, 6, 46, 0.14);
      plane('up', [xm, y1 + 0.3, z1 - 1], Math.min(H - y1 - 0.3, 110), 1.5, 6, 46, 0.14);
      break;
    case 'spot':
      cone('beam', [xm, y0 - 0.5, z1 / 2], [xm, Math.max(0, y0 - 150), 2], 18, 0.2, 180);
      break;
    case 'pendant':
      // The far end's back edge sits on the wall plane, so the pyramid never runs into the wall.
      plane('down', [xm, y0 - 0.5, z1 / 2], -Math.min(y0 - 0.5, 170), (z1 + 70) / 2, w - 2, w + 60, 0.11, {
        kind: 'pyramid',
        depth0: Math.max(1, z1 - 2),
        depth1: z1 + 70,
      });
      break;
    case 'column':
      cone('glow', [xm, y1 - 8, z1 / 2], [xm, y0, z1 / 2], 0, 0.1, y1 - y0 - 16, {
        kind: 'glow',
        radiusTop: 16,
        radiusBottom: 16,
        symmetric: true,
      });
      break;
    case 'frame':
      plane('halo', [xm, (y0 + y1) / 2, 0.25], y1 - y0 + 26, 0.25, w + 26, w + 26, 0.22, { kind: 'halo', symmetric: true });
      break;
    default:
      break;
  }
  return out;
}

/**
 * Contact occlusion: a soft dark halo on the wall right behind a module,
 * wider for deeper parts, plus one on the floor under a part that stands on
 * it. Planes in metres, never picked.
 */
function moduleOcclusion(item, b, room, place, rotY) {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const d = b.z1 - b.z0;
  const pad = Math.min(8, Math.max(1.5, d * 0.35));
  const wall = {
    position: v3(place([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0.12])),
    rotation: [0, rotY, 0],
    size: [m(w + 2 * pad), m(h + 2 * pad)],
    opacity: Number(Math.min(0.62, 0.3 + d / 80).toFixed(3)),
  };
  if (b.y0 > 1) return { wall, floor: null };
  const r = moduleRoomBox(item, room);
  return {
    wall,
    floor: {
      position: [m((r.x0 + r.x1) / 2), 0.0025, m((r.z0 + r.z1) / 2)],
      rotation: [-Math.PI / 2, 0, 0],
      size: [m(r.x1 - r.x0 + 2 * pad), m(r.z1 - r.z0 + 2 * pad)],
      opacity: 0.5,
    },
  };
}

/** Clear height above a module on its wall: up to the next module over it, or the ceiling. */
function headroomAbove(item, items, room) {
  const box = moduleBox(item);
  const wall = wallOf(item);
  let free = room.heightCm - box.y1;
  for (const other of items) {
    if (other === item || wallOf(other) !== wall) continue;
    const o = moduleBox(other);
    if (o.x1 <= box.x0 || o.x0 >= box.x1 || o.y0 < box.y1) continue;
    free = Math.min(free, o.y0 - box.y1);
  }
  return free;
}

function moduleRecord(item, room, rig, conflicts, selectedUid, headroom = room.heightCm) {
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
  const material = finishMaterial(finish.id);
  const ctx = {
    uid: item.uid,
    place,
    rotY: WALL_ROT_Y[wall],
    room,
    headroom,
    finishId: finish.id,
    finishLook: { material, color: finish.hex },
    shadeLook: { material, color: finish.shade },
    lit,
    lightColor: light,
    emissive: rig.emissive * level,
  };
  const build = SUBASSEMBLIES[product.shape];
  const occlusion = moduleOcclusion(item, box, room, place, ctx.rotY);

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
    material,
    subparts: build ? build(box, ctx).map((spec) => placeSubpart(spec, ctx)) : [],
    volumetrics: moduleVolumetrics(item, product, box, room, rig, place, ctx.rotY),
    aoShadow: occlusion.wall,
    aoFloor: occlusion.floor,
    selected: item.uid === selectedUid,
    conflict: conflicts.has(item.uid),
  };
}

/**
 * Floor reference parts. Each keeps its collision box (`box`, `size`,
 * `position`, room frame) and gains the architectural detail drawn over or
 * in place of it (`subparts`, in the furniture's own frame on its wall);
 * `body` says whether the plain box still shows.
 */
function furnitureRecords(furniture, room) {
  if (!furniture) return [];
  const { wall, x0, z0 } = furniture.frame;
  const details = FURNITURE_DETAILS[furniture.id] ?? {};
  const ctx = {
    uid: `furniture-${furniture.id}`,
    place: (point) => wallToRoom(room, wall, [x0 + point[0], point[1], z0 + point[2]]),
    rotY: WALL_ROT_Y[wall],
    room,
    lit: false,
  };
  return furniture.parts.map((p) => {
    const look = FURNITURE_LOOK[p.tone] ?? FURNITURE_LOOK.felt;
    const pbr = PBR_MATERIALS[look.material];
    const detail = Object.hasOwn(details, p.id) ? details[p.id] : null;
    return {
      part: p.id,
      color: FURNITURE_TONES[p.tone],
      box: p.box,
      ...boxRecord(p.box),
      material: look.material,
      roughness: look.roughness ?? pbr.roughness,
      metalness: look.metalness ?? pbr.metalness,
      body: detail ? detail.body : true,
      subparts: detail ? detail.parts.map((spec) => placeSubpart(spec, { ...ctx, uid: `${ctx.uid}-${p.id}` })) : [],
    };
  });
}

/** Soft contact shadow under the whole floor reference, in metres. */
function furnitureOcclusion(furniture) {
  if (!furniture) return null;
  const { bounds } = furniture;
  const pad = 12;
  return {
    position: [m((bounds.x0 + bounds.x1) / 2), 0.002, m((bounds.z0 + bounds.z1) / 2)],
    rotation: [-Math.PI / 2, 0, 0],
    size: [m(bounds.x1 - bounds.x0 + 2 * pad), m(bounds.z1 - bounds.z0 + 2 * pad)],
    opacity: 0.55,
  };
}

/* Daylight: the sun on its path, the window and the light it lets in */

const WINDOW_SILL_CM = 85;
const MULLION_CM = 4;
const FRAME_CM = 6;
const INWARD = Object.freeze({ north: [0, 1], east: [-1, 0], south: [0, -1], west: [1, 0] });

function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return hex(pa.map((c, i) => c + (pb[i] - c) * t));
}

/** Clips a plan polygon ([x, z] points) to the floor rectangle, Sutherland-Hodgman. */
function clipToFloor(points, W, D) {
  const edges = [
    [(p) => p[0] >= 0, (p, q) => -p[0] / (q[0] - p[0])],
    [(p) => p[0] <= W, (p, q) => (W - p[0]) / (q[0] - p[0])],
    [(p) => p[1] >= 0, (p, q) => -p[1] / (q[1] - p[1])],
    [(p) => p[1] <= D, (p, q) => (D - p[1]) / (q[1] - p[1])],
  ];
  let poly = points;
  for (const [inside, cut] of edges) {
    if (poly.length === 0) break;
    const next = [];
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const pin = inside(p);
      const qin = inside(q);
      if (pin) next.push(p);
      if (pin !== qin) {
        const t = cut(p, q);
        next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    poly = next;
  }
  return poly;
}

/**
 * The daylight window on its wall, as a glazed opening framed by jambs, a
 * head, a deep sill, two mullions and a transom. With the sun up on the
 * window's side, each pane throws a sunlit patch across the floor (the pane
 * projected along the sun, clipped to the floor) and a shaft of light through
 * the air from the pane to where its corners land, inside the room.
 */
function buildWindow(room, wall, solar, daylight) {
  const span = wallSpanCm(room, wall);
  const H = room.heightCm;
  const width = Math.round(Math.min(200, Math.max(80, span * 0.42)));
  const head = Math.min(H - 28, 225);
  const x0 = Math.round((span - width) / 2);
  const x1 = x0 + width;
  const y0 = WINDOW_SILL_CM;
  const y1 = head;
  const rotY = WALL_ROT_Y[wall];
  const place = (point) => wallToRoom(room, wall, point);
  const bar = (id, bx0, bx1, by0, by1, bz1) => ({
    id: `window-${id}`,
    size: [m(bx1 - bx0), m(by1 - by0), m(bz1)],
    position: v3(place([(bx0 + bx1) / 2, (by0 + by1) / 2, bz1 / 2])),
    rotation: [0, rotY, 0],
  });
  const third = width / 3;
  const transom = y0 + (y1 - y0) * 0.72;
  const m1 = x0 + third;
  const m2 = x0 + 2 * third;
  const h2 = MULLION_CM / 2;
  const members = [
    bar('head', x0 - FRAME_CM, x1 + FRAME_CM, y1, y1 + FRAME_CM, 4),
    bar('sill', x0 - FRAME_CM - 2, x1 + FRAME_CM + 2, y0 - 4, y0, 9),
    bar('jamb-left', x0 - FRAME_CM, x0, y0, y1, 4),
    bar('jamb-right', x1, x1 + FRAME_CM, y0, y1, 4),
    bar('mullion-1', m1 - h2, m1 + h2, y0, y1, 3),
    bar('mullion-2', m2 - h2, m2 + h2, y0, y1, 3),
    bar('transom', x0, x1, transom - h2, transom + h2, 3),
  ];
  const columns = [
    [x0, m1 - h2],
    [m1 + h2, m2 - h2],
    [m2 + h2, x1],
  ];
  const rows = [
    [y0, transom - h2],
    [transom + h2, y1],
  ];
  const panes = rows.flatMap(([py0, py1]) => columns.map(([px0, px1]) => ({ px0, px1, py0, py1 })));

  const sky = daylight ? (solar.up ? mix('#dbe7f2', solar.color, 0.3) : '#53627a') : '#141c26';
  const glazing = {
    id: 'window-glazing',
    size: [m(width), m(y1 - y0)],
    position: v3(place([(x0 + x1) / 2, (y0 + y1) / 2, 0.15])),
    rotation: [0, rotY, 0],
    color: sky,
    intensity: daylight ? Number((solar.up ? 0.5 + 0.6 * solar.strength : 0.32).toFixed(3)) : 0.18,
  };

  const [nx, nz] = INWARD[wall];
  const [lx, ly, lz] = solar.direction;
  const sunlit = daylight && solar.up && ly > 0.02 && lx * nx + lz * nz < -0.02;
  const patches = [];
  const shafts = [];
  if (sunlit) {
    const { widthCm: W, depthCm: D } = room;
    const travel = (p) => {
      // Along -sun from a point on the glass: to the floor, or out through the room's far side.
      const limits = [p[1] / ly];
      if (lx < -1e-9) limits.push((W - p[0]) / -lx);
      if (lx > 1e-9) limits.push(p[0] / lx);
      if (lz < -1e-9) limits.push((D - p[2]) / -lz);
      if (lz > 1e-9) limits.push(p[2] / lz);
      return Math.max(0, Math.min(...limits));
    };
    const along = (p, t) => [p[0] - lx * t, p[1] - ly * t, p[2] - lz * t];
    const strength = solar.strength;
    for (const [i, pane] of panes.entries()) {
      const corners = [
        [pane.px0, pane.py1],
        [pane.px1, pane.py1],
        [pane.px1, pane.py0],
        [pane.px0, pane.py0],
      ].map(([a, y]) => place([a, y, 0.2]));
      const floor = clipToFloor(
        corners.map((p) => {
          const q = along(p, p[1] / ly);
          return [q[0], q[2]];
        }),
        W,
        D,
      );
      if (floor.length >= 3) {
        patches.push({
          id: `sun-patch-${i + 1}`,
          points: floor.map(([x, z]) => [m(x), 0.003, m(z)]),
          color: solar.color,
          opacity: Number((0.34 * strength).toFixed(4)),
        });
      }
      shafts.push({
        id: `sun-shaft-${i + 1}`,
        kind: 'shaft',
        geometry: 'prism',
        from: corners.map(v3),
        to: corners.map((p) => v3(along(p, travel(p)))),
        color: solar.color,
        opacity: Number((0.15 * strength).toFixed(4)),
      });
    }
  }
  return { wall, cull: wallCull(room, wall), x0, x1, y0, y1, glazing, members, patches, shafts, sunlit };
}

/**
 * Daylight follows the solar path: the key light comes from where the sun
 * is, fixed in the room frame, with its colour temperature, dimming toward
 * dusk; the sky fill eases down with it. Night keeps its own rig.
 */
function daylightRig(rig, solar) {
  const base = LIGHTING_RIGS.daylight;
  const lift = 0.1 + 0.9 * solar.strength;
  const [dx, dy, dz] = solar.direction;
  // Below the horizon the key light still falls from a low sky, never from under the floor.
  const low = Math.sin(3 * DEG);
  const plan = Math.hypot(dx, dz) || 1;
  const from = dy >= low ? solar.direction : [(dx / plan) * Math.cos(3 * DEG), low, (dz / plan) * Math.cos(3 * DEG)];
  return {
    ...rig,
    sun: {
      color: solar.color,
      intensity: Number((base.sun.intensity * lift).toFixed(3)),
      from: from.map((c) => Number(c.toFixed(4)) + 0),
      fixed: true,
    },
    ambient: {
      color: mix(base.ambient.color, solar.color, 0.18),
      intensity: Number((base.ambient.intensity * (0.62 + 0.38 * solar.strength)).toFixed(3)),
    },
    hemisphere: {
      ...base.hemisphere,
      sky: mix(base.hemisphere.sky, solar.color, 0.22),
      intensity: Number((base.hemisphere.intensity * (0.7 + 0.3 * solar.strength)).toFixed(3)),
    },
  };
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
  const daylight = room.lighting === 'daylight';
  const solar = solarState(solarHourOf(room));
  const lighting = LIGHTING_RIGS[room.lighting] ?? LIGHTING_RIGS.night;
  const base = daylight ? daylightRig(lighting, solar) : lighting;
  const modules = items.map((item) => moduleRecord(item, room, base, conflicts, selectedUid, headroomAbove(item, items, room)));
  const lights = modules.flatMap((module) => module.lights.map((light) => ({ ...light, uid: module.uid })));
  const rig = fillRig(base, lights.length === 0);
  const layout = furnitureLayout(room);
  const furniture = furnitureRecords(layout, room);
  const furnitureAo = furnitureOcclusion(layout);
  const windowWall = windowWallOf(room);
  const window = windowWall === 'none' ? null : buildWindow(room, windowWall, solar, daylight);
  const shell = buildShell(room, rig);
  const envelope = buildEnvelope(room, rig);
  const edges = technical || wireframe;

  const submeshes =
    modules.reduce((sum, module) => sum + module.subparts.length, 0) +
    furniture.reduce((sum, part) => sum + part.subparts.length, 0);
  const volumetrics = modules.reduce((sum, module) => sum + module.volumetrics.length, 0) + (window ? window.shafts.length : 0);
  // Drawn meshes: sub-parts batch by look, one draw call per look.
  const meshes =
    shell.surfaces.length +
    shell.poche.length +
    envelope.baseboards.length +
    1 +
    furniture.reduce((sum, part) => sum + (part.body ? 1 : 0) + lookCount(part.subparts), 0) +
    (furnitureAo ? 1 : 0) +
    modules.reduce(
      (sum, module) => sum + (lookCount(module.subparts) || 1) + module.emitters.length + 1 + (module.aoFloor ? 1 : 0),
      0,
    ) +
    volumetrics +
    (window ? 2 + window.patches.length : 0);

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
    furnitureAo,
    furniturePlacement: layout ? { wall: layout.wall, offsetCm: layout.offsetCm, bounds: layout.bounds } : null,
    solar,
    window,
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
    stats: { meshes, lights: lights.length + 3, submeshes, volumetrics },
  };
}
