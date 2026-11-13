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
  windowWallsOf,
} from './room-3d.js';
import {
  boxToRoom,
  DEFAULT_ROOM_WALL,
  ROOM_WALLS,
  sanitizeWallId,
  WALL_HEADING,
  WALL_ROT_Y,
  wallDirToRoom,
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
    cove: { gap: '#14120f', crown: '#cbc4b9' },
    cornerShade: 0.2,
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
    cove: { gap: '#3a3631', crown: '#e9e4db' },
    cornerShade: 0.14,
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
  return { ceiling, baseboards, creases, coves: buildCoves(room, rig), cornerShades: buildCornerShades(room, rig) };
}

const COVE_GAP_CM = 1.2;
const COVE_GAP_D_CM = 0.8;
const CROWN_H_CM = 3.6;
const CROWN_D_CM = 1.4;
const CORNER_SHADE_CM = 44;

/**
 * A perimeter shadow-gap at the ceiling: a dark 12 mm reveal along the top of
 * every wall over a slim plaster crown band, so the wall plane stops short of
 * the ceiling the way a detailed gallery wall does. Each cove hides with its
 * wall's section cut.
 */
function buildCoves(room, rig) {
  const H = room.heightCm;
  const cove = rig.cove;
  const strip = (id, kind, look, box) => ({
    ...slab(id, look.color, box),
    kind,
    geometry: 'box',
    radius: null,
    radiusBottom: null,
    rotation: [0, 0, 0],
    material: look.material,
    roughness: look.roughness,
    metalness: 0,
    grain: null,
    shadow: false,
    emissive: null,
    emissiveIntensity: 0,
  });
  return ROOM_WALLS.map((wall) => {
    const span = wallSpanCm(room, wall);
    const at = (box) => boxToRoom(room, wall, box);
    return {
      id: `cove-${wall}`,
      wall,
      cull: wallCull(room, wall),
      parts: [
        strip(`cove-${wall}-gap`, 'shadow-gap', { material: 'metal-obsidian', color: cove.gap, roughness: 0.92 }, at({
          x0: 0,
          x1: span,
          y0: H - COVE_GAP_CM,
          y1: H,
          z0: 0,
          z1: COVE_GAP_D_CM,
        })),
        strip(`cove-${wall}-crown`, 'crown', { material: 'wall-plaster', color: cove.crown, roughness: 0.84 }, at({
          x0: 0,
          x1: span,
          y0: H - COVE_GAP_CM - CROWN_H_CM,
          y1: H - COVE_GAP_CM,
          z0: 0,
          z1: CROWN_D_CM,
        })),
      ],
    };
  });
}

/** The walls meeting at a room-frame corner point (cm). */
function wallsAt(room, [x, , z]) {
  const walls = [];
  if (z <= 0.5) walls.push('north');
  if (x >= room.widthCm - 0.5) walls.push('east');
  if (z >= room.depthCm - 0.5) walls.push('south');
  if (x <= 0.5) walls.push('west');
  return walls;
}

/**
 * Corner ambient depth: a soft vertical falloff on each wall at every inside
 * corner, densest on the corner line, so the room reads as a volume rather
 * than four flat planes. A shade hides when either of its walls is cut.
 */
function buildCornerShades(room, rig) {
  const H = room.heightCm;
  return ROOM_WALLS.flatMap((wall) =>
    [0, wallSpanCm(room, wall)].map((x, i) => {
      const walls = wallsAt(room, wallToRoom(room, wall, [x, 0, 0]));
      return {
        id: `corner-shade-${wall}-${i + 1}`,
        wall,
        walls,
        culls: walls.map((id) => wallCull(room, id)),
        position: v3(wallToRoom(room, wall, [x, H / 2, 0.1])),
        rotation: [0, WALL_ROT_Y[wall], 0],
        size: [m(CORNER_SHADE_CM), m(H)],
        opacity: rig.cornerShade,
      };
    }),
  );
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
 * A subpart: { id, kind, geometry: 'box' | 'cylinder' | 'lathe', size
 * (metres, in the part's own frame: x along the wall, y up, z out), radius,
 * radiusBottom, position (room metres, centre), rotation ([x, y, z], Euler
 * order YXZ: a cylinder's axis turned first, then the wall's quarter turn; a
 * box's tilt about the along-wall axis and roll about its own depth axis),
 * material (a PBR family key), color, roughness, metalness, grain, shadow,
 * emissive }. A box also carries `bevel` ({ radius in metres, segments } or
 * null): upholstery is drawn with a lush rounded fillet, millwork and metal
 * with a crisp micro-bevel that catches a specular line along every seam. A
 * lathe is a turned solid (vase, bowl, spun shade) round a vertical axis
 * through its centre, `profile` holding [radius, height] pairs in metres
 * measured from that centre.
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
  // Soft furnishings for the reference furniture vignettes.
  rug: { material: 'felt-acoustic', color: '#9e9589' },
  'rug-border': { material: 'felt-acoustic', color: '#6e675e' },
  'cushion-sand': { material: 'felt-acoustic', color: '#b9a88e' },
  'cushion-slate': { material: 'felt-acoustic', color: '#5f6a70' },
  piping: { material: 'felt-acoustic', color: '#b3a998' },
  sheet: { material: 'felt-acoustic', color: '#efe9de' },
  // Glazed stoneware and porcelain read glossier than the chalk family default.
  porcelain: { material: 'matte-chalk', color: '#e6e0d6', roughness: 0.34 },
  celadon: { material: 'matte-chalk', color: '#a9b5a2', roughness: 0.3 },
  // Bookcloth covers and the cream page block of architectural monographs.
  pages: { material: 'matte-chalk', color: '#e8dfcc', roughness: 0.92 },
  oxblood: { material: 'matte-chalk', color: '#6b3a30', roughness: 0.7 },
  sage: { material: 'matte-chalk', color: '#7c8775', roughness: 0.7 },
  // Spun aluminium lamp shades and a lit studio display.
  spun: { material: 'metal-steel', color: '#c3c5c4', roughness: 0.26, metalness: 0.7 },
  display: { material: 'metal-obsidian', color: '#1b2128', roughness: 0.16, metalness: 0.1 },
});

/*
 * Edge treatment. Upholstery kinds in a fibre look take a lush rounded
 * fillet, a fixed share of the part's thinnest side, so every pillow,
 * mattress, duvet and cushion has loft. Millwork and metal kinds take a crisp
 * micro-bevel of at most 4 mm. Parts thinner than 6 mm stay sharp: a bevel
 * there would be invisible and cost triangles. A spec can force 'soft',
 * 'micro', 'none' or a radius in cm with `round`.
 */
const SOFT_KINDS = new Set(['pillow', 'cushion', 'mattress', 'duvet', 'headboard', 'throw', 'arm', 'seat']);
const MILLWORK_KINDS = new Set([
  'slab', 'carcass', 'door', 'tray', 'rail', 'stile', 'edge', 'fin', 'slat', 'beam', 'body', 'sill', 'frame', 'top', 'leg', 'post',
]);
export const BEVEL = Object.freeze({
  soft: Object.freeze({ ratio: 0.28, segments: 4 }),
  micro: Object.freeze({ maxM: 0.004, ratio: 0.12, segments: 2, minSizeM: 0.006 }),
  custom: Object.freeze({ segments: 3 }),
});

/** Bevel for a box sub-part of `size` metres, or null for a sharp box. */
export function subpartBevel(kind, size, round = null, material = null) {
  if (round === 'none') return null;
  const least = Math.min(...size);
  if (!(least > 0)) return null;
  if (typeof round === 'number' && round > 0) {
    return { radius: Number(Math.min(least / 2, round * CM).toFixed(5)), segments: BEVEL.custom.segments };
  }
  const soft = round === 'soft' || (round === null && SOFT_KINDS.has(kind) && material === 'felt-acoustic');
  if (soft) return { radius: Number((least * BEVEL.soft.ratio).toFixed(5)), segments: BEVEL.soft.segments };
  const micro = round === 'micro' || (round === null && MILLWORK_KINDS.has(kind));
  if (!micro || least < BEVEL.micro.minSizeM) return null;
  return { radius: Number(Math.min(BEVEL.micro.maxM, least * BEVEL.micro.ratio).toFixed(5)), segments: BEVEL.micro.segments };
}

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

/**
 * Wall-frame box spec, cm. `extra.tilt` turns it about the along-wall axis
 * through its centre (negative leans its top back toward the wall), `roll`
 * about its own depth axis and `yaw` about the vertical, all in degrees.
 */
function B(id, kind, tone, x0, x1, y0, y1, z0, z1, extra = {}) {
  return { id, kind, tone, geometry: 'box', box: { x0, x1, y0, y1, z0, z1 }, ...extra };
}

/** Wall-frame cylinder spec, cm: centre, radius, length along `axis` ('y' up, 'z' out of the wall, 'x' along it). */
function C(id, kind, tone, cx, cy, cz, r, len, axis = 'y', extra = {}) {
  return { id, kind, tone, geometry: 'cylinder', at: [cx, cy, cz], r, r2: extra.r2 ?? r, len, axis, ...extra };
}

/** Wall-frame lathe spec, cm: a turned solid on a vertical axis at (cx, cz), its profile [radius, height] from the base at cy. */
function L(id, kind, tone, cx, cy, cz, profile, extra = {}) {
  return { id, kind, tone, geometry: 'lathe', at: [cx, cy, cz], profile, ...extra };
}

/** A closed profile, base to rim and back down the inside: a vase that tapers from a belly to a flared lip. */
function vaseProfile(h, belly = 5.4) {
  const k = belly / 5.4;
  return [
    [0, 0],
    [3 * k, 0],
    [3.4 * k, 0.04 * h],
    [4.8 * k, 0.2 * h],
    [belly, 0.4 * h],
    [5 * k, 0.6 * h],
    [3.4 * k, 0.78 * h],
    [2.2 * k, 0.88 * h],
    [2.5 * k, 0.96 * h],
    [2.8 * k, h],
    [2.3 * k, h],
    [1.9 * k, 0.93 * h],
    [0, 0.93 * h],
  ];
}

/** A shallow turned bowl on a foot ring, `r` cm across the rim, `h` cm tall. */
function bowlProfile(r, h) {
  return [
    [0, 0],
    [0.36 * r, 0],
    [0.4 * r, 0.09 * h],
    [0.66 * r, 0.24 * h],
    [0.89 * r, 0.56 * h],
    [r, 0.94 * h],
    [0.97 * r, h],
    [0.9 * r, 0.92 * h],
    [0.73 * r, 0.52 * h],
    [0.43 * r, 0.3 * h],
    [0, 0.25 * h],
  ];
}

/**
 * An architectural monograph lying flat, spine out: two bookcloth boards, the
 * spine and a cream page block inset between them, so the pages read on the
 * head and tail. Four sub-parts, `h` cm thick.
 */
function book(id, tone, x0, x1, y0, h, z0, z1, extra = {}) {
  const board = 0.25;
  const spine = 0.35;
  return [
    B(`${id}-board-low`, 'object', tone, x0, x1, y0, y0 + board, z0, z1, extra),
    B(`${id}-board-high`, 'object', tone, x0, x1, y0 + h - board, y0 + h, z0, z1, extra),
    B(`${id}-spine`, 'object', tone, x0, x1, y0 + board, y0 + h - board, z1 - spine, z1, { ...extra, shadow: false }),
    B(`${id}-pages`, 'object', 'pages', x0 + 0.3, x1 - 0.3, y0 + board, y0 + h - board, z0 + 0.3, z1 - spine, { ...extra, shadow: false }),
  ];
}

/** A book standing upright on its tail, spine out: a cover wrap and the page block it shows on top. */
function standingBook(id, tone, x0, x1, y0, h, z0, z1) {
  return [
    B(`${id}-cover`, 'object', tone, x0, x1, y0, y0 + h, z0, z1),
    B(`${id}-pages`, 'object', 'pages', x0 + 0.25, x1 - 0.25, y0 + h, y0 + h + 0.05, z0 + 0.3, z1 - 0.4, { shadow: false }),
  ];
}

function lookOf(tone, ctx) {
  if (tone === 'finish') return ctx.finishLook;
  if (tone === 'finish-shade') return ctx.shadeLook;
  if (Object.hasOwn(FURNITURE_TONES, tone)) return { ...FURNITURE_LOOK[tone], color: FURNITURE_TONES[tone] };
  return ACCENTS[tone] ?? ACCENTS.shadow;
}

const AXIS_TURN = Object.freeze({ y: [0, 0], z: [Math.PI / 2, 0], x: [0, Math.PI / 2] });

/** Degrees to radians, rounded so the records stay byte-stable. */
const rad = (deg) => (deg ? Number((deg * DEG).toFixed(6)) : 0);

function placeSubpart(spec, ctx) {
  const look = lookOf(spec.tone, ctx);
  const pbr = PBR_MATERIALS[look.material];
  // Furniture lamps glow at night; a lit display glows by day too, in its own colour.
  const glowing = (spec.glow === true && ctx.lit) || spec.glow === 'always';
  const base = {
    id: `${ctx.uid}-${spec.id}`,
    kind: spec.kind,
    material: look.material,
    color: look.color,
    roughness: look.roughness ?? pbr.roughness,
    metalness: look.metalness ?? pbr.metalness,
    grain: spec.grain ?? null,
    shadow: spec.shadow !== false,
    emissive: glowing ? (spec.glowColor ?? ctx.lightColor) : null,
    emissiveIntensity: glowing ? Number((spec.glowIntensity ?? ctx.emissive * 0.5).toFixed(3)) : 0,
  };
  if (spec.geometry === 'box') {
    const b = spec.box;
    const size = [m(b.x1 - b.x0), m(b.y1 - b.y0), m(b.z1 - b.z0)];
    return {
      ...base,
      geometry: 'box',
      radius: null,
      radiusBottom: null,
      size,
      bevel: subpartBevel(spec.kind, size, spec.round ?? null, look.material),
      position: v3(ctx.place([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2])),
      rotation: [rad(spec.tilt), ctx.rotY + rad(spec.yaw), rad(spec.roll)],
    };
  }
  if (spec.geometry === 'lathe') {
    const heights = spec.profile.map(([, y]) => y);
    const yMin = Math.min(...heights);
    const height = Math.max(...heights) - yMin;
    const rMax = Math.max(...spec.profile.map(([r]) => r));
    const [cx, cy, cz] = spec.at;
    const mid = yMin + height / 2;
    return {
      ...base,
      geometry: 'lathe',
      radius: m(rMax),
      radiusBottom: null,
      segments: spec.segments ?? 32,
      profile: spec.profile.map(([r, y]) => [m(r), m(y - mid)]),
      size: [m(2 * rMax), m(height), m(2 * rMax)],
      position: v3(ctx.place([cx, cy + mid, cz])),
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
    rotation: [ax, ctx.rotY + rad(spec.yaw), az],
  };
}

/**
 * Curated objects on a shelf top, scaled to the clear height above it, or
 * none when it is tight: a stack of two monographs, a run of upright books
 * with their spines out where the shelf is long and tall enough, and a turned
 * porcelain amphora.
 */
function shelfObjects(b, headroom) {
  const { x0, x1, y1, z1 } = b;
  const clear = headroom - 1.5;
  if (clear < 6) return [];
  const objects = [
    ...book('monograph-1', 'slate', x0 + 12, x0 + 36, y1, 3.2, z1 - 20, z1 - 3),
    ...book('monograph-2', 'linen', x0 + 13.5, x0 + 34, y1 + 3.2, 2.4, z1 - 18.5, z1 - 4.5),
  ];
  if (clear >= 26 && x1 - x0 >= 90) {
    const spines = [
      ['slate', 2.6, 23],
      ['oxblood', 3.2, 24.5],
      ['sage', 2.2, 22],
      ['linen', 2.8, 24],
    ];
    let x = x0 + 44;
    for (const [i, [tone, w, h]] of spines.entries()) {
      objects.push(...standingBook(`spine-${i + 1}`, tone, x, x + w, y1, h, z1 - 21, z1 - 4));
      x += w + 0.15;
    }
  }
  const vessel = Math.min(18, clear);
  if (vessel >= 8) objects.push(L('vessel', 'object', 'porcelain', x1 - 22, y1, z1 - 12, vaseProfile(vessel), { segments: 32 }));
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
      B('divider', 'divider', 'finish', x0 + t, x1 - t, ym - 0.75, ym + 0.75, 1.2, z1 - 2, { grain: 'x', round: 'micro' }),
      ...book('book-1', 'slate', x0 + 4, x0 + 13, y0 + t, 2.4, 6, z1 - 8),
      ...book('book-2', 'oxblood', x0 + 4.6, x0 + 12.4, y0 + t + 2.4, 1.8, 7, z1 - 9),
      L('vessel', 'object', 'celadon', x1 - 10, ym + 0.75, z1 / 2 + 2, vaseProfile(9, 3.4), { segments: 28 }),
    ];
  },
  // Carcass over a recessed shadow-line plinth, twin inset doors with a 6 mm reveal, recessed
  // finger pulls behind slim steel handles, and a bevelled tray top.
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
      B('pull-left', 'pull-recess', 'shadow', xm - 4.8, xm - 1.6, y1 - 16.5, y1 - 3.5, z1 - 0.3, z1 + 0.02, { shadow: false }),
      B('pull-right', 'pull-recess', 'shadow', xm + 1.6, xm + 4.8, y1 - 16.5, y1 - 3.5, z1 - 0.3, z1 + 0.02, { shadow: false }),
      B('handle-left', 'handle', 'steel', xm - 3.2, xm - 2.4, y1 - 15, y1 - 5, z1, z1 + 1.4, { round: 'micro' }),
      B('handle-right', 'handle', 'steel', xm + 2.4, xm + 3.2, y1 - 15, y1 - 5, z1, z1 + 1.4, { round: 'micro' }),
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

/*
 * Reference furniture detail, in each piece's own frame (x from its left end,
 * y up, z out from its wall). Keys are collision part ids; each part's detail
 * is drawn over or in place of its box. `vignette` holds the free-standing
 * companions round the piece (an area rug, bedside ledges, a coffee table, a
 * task chair): drawn only, never part of the collision bounds, the walk zone
 * or the clearances. A vignette part marked `fromWall` measures z from the
 * wall plane; `fit` clips a rug to the room, and any other vignette part that
 * would leave the room is dropped.
 */

const RUG_T_CM = 0.6;
const RUG_BORDER_CM = 7;

/** A woven area rug: a darker border band under a 0.6 cm field, never casting a shadow. */
function rug(x0, x1, z0, z1) {
  const b = RUG_BORDER_CM;
  return [
    B('rug-border', 'rug', 'rug-border', x0, x1, 0, RUG_T_CM - 0.1, z0, z1, { shadow: false, fit: true, group: 'rug' }),
    B('rug-field', 'rug', 'rug', x0 + b, x1 - b, 0.05, RUG_T_CM, z0 + b, z1 - b, { shadow: false, fit: true, inset: b, group: 'rug' }),
  ];
}

/**
 * A floating, micro-bevelled oak ledge on the wall with a reading lamp on it:
 * a spun-metal dome base, a slim brass stem and a turned opal shade that
 * glows warm at night.
 */
function bedsideLedge(side, x0, x1) {
  const xm = (x0 + x1) / 2;
  const wall = { fromWall: true, shadow: false, group: `ledge-${side}` };
  return [
    B(`ledge-${side}`, 'ledge', 'oak', x0, x1, 48, 51, 0, 28, { ...wall, grain: 'x', round: 'micro' }),
    L(`lamp-${side}-base`, 'lamp', 'spun', xm, 51, 16, [[0, 0], [4.4, 0], [4.5, 0.5], [3.6, 1.5], [1.2, 2.5], [0.7, 2.7], [0, 2.7]], {
      ...wall,
      segments: 32,
    }),
    C(`lamp-${side}-stem`, 'lamp', 'brass', xm, 60.2, 16, 0.45, 13, 'y', { ...wall, segments: 12 }),
    L(`lamp-${side}-shade`, 'lamp', 'opal', xm, 66.4, 16, [[0, 0.3], [5.9, 0], [6.5, 0.9], [6.6, 2.4], [6.2, 7.2], [5.4, 11.6], [4.9, 13], [0, 13.2]], {
      ...wall,
      glow: true,
      segments: 36,
    }),
  ];
}

/**
 * Pillows for one side of the bed, `x0` the pillow part's left end: a large
 * Oxford euro sham (58 x 50 x 15 cm) leaning back 16 deg against the
 * headboard channels with its flat 2 cm flange in the same plane, and a
 * sleeping pillow in front, its back end raised onto the sham. The sham sits
 * 1 cm lower and closer to the wall than its sharp box would, the clearance
 * its 4.2 cm fillet rounds off the contact corners, so its curve rests on the
 * mattress and the channels.
 */
function pillowSet(tone, x0) {
  return [
    B('euro', 'pillow', tone, x0 + 2, x0 + 60, 41.6, 91.6, 16.6, 31.6, { tilt: -16 }),
    B('euro-flange', 'pillow', tone, x0, x0 + 62, 39.6, 93.6, 23.3, 24.9, { tilt: -16, shadow: false }),
    B('sleeper', 'pillow', 'linen-hi', x0 + 1, x0 + 61, 43.6, 56.6, 37, 73, { tilt: 12 }),
  ];
}

const VIEWPORT_AMBER = '#e8b06a';
const VIEWPORT_INK = '#d7e0ea';

/**
 * The illuminated architectural viewport on the studio display: an amber
 * room plan on the left and a fine white elevation grid on the right, each a
 * hairline a touch proud of the lit screen, glowing day and night.
 */
function viewportGraphics(x0, x1, y0, y1, z) {
  const line = (id, color, intensity, ax0, ax1, ay0, ay1) =>
    B(id, 'monitor', 'display', ax0, ax1, ay0, ay1, z, z + 0.06, { shadow: false, glow: 'always', glowColor: color, glowIntensity: intensity });
  const px0 = x0 + 7;
  const px1 = x0 + 33;
  const py0 = y0 + 5;
  const py1 = y1 - 5;
  const parts = [
    line('plan-north', VIEWPORT_AMBER, 1.1, px0, px1, py1 - 0.4, py1),
    line('plan-south', VIEWPORT_AMBER, 1.1, px0, px1, py0, py0 + 0.4),
    line('plan-west', VIEWPORT_AMBER, 1.1, px0, px0 + 0.4, py0, py1),
    line('plan-east', VIEWPORT_AMBER, 1.1, px1 - 0.4, px1, py0, py1),
    line('plan-module', VIEWPORT_AMBER, 1.1, px0 + 4, px0 + 13, py1 - 4.5, py1 - 2.5),
  ];
  for (let i = 1; i <= 3; i += 1) {
    parts.push(line(`grid-row-${i}`, VIEWPORT_INK, 0.55, x0 + 40, x1 - 5, y0 + i * 7.5 - 0.12, y0 + i * 7.5 + 0.12));
  }
  for (let i = 0; i < 4; i += 1) {
    const gx = x0 + 43 + i * 7.5;
    parts.push(line(`grid-col-${i + 1}`, VIEWPORT_INK, 0.55, gx, gx + 0.24, y0 + 3.5, y1 - 3.5));
  }
  return parts;
}

/**
 * Five micro-bevelled cast legs radiating from the task chair's gas column at
 * (cx, cz), turned 18 deg so none points straight at the desk.
 */
function chairStar(cx, cz) {
  return [0, 1, 2, 3, 4].map((i) => {
    const deg = i * 72 + 18;
    const x = cx + Math.cos(deg * DEG) * 12.5;
    const z = cz + Math.sin(deg * DEG) * 12.5;
    return B(`chair-leg-${i + 1}`, 'chair', 'anodised', x - 12.5, x + 12.5, 2.2, 5, z - 1.3, z + 1.3, {
      shadow: false,
      group: 'chair',
      round: 'micro',
      yaw: -deg,
    });
  });
}

// The desk lamp's cantilever: from the pivot on its column out over the sketchbook.
const DESK_LAMP = Object.freeze({ pivot: [9, 13], head: [32, 46], boomY: 113.4 });

function deskLamp() {
  const { pivot, head, boomY } = DESK_LAMP;
  const dx = head[0] - pivot[0];
  const dz = head[1] - pivot[1];
  const length = Math.hypot(dx, dz);
  const yaw = Math.atan2(dz, dx) / DEG;
  const mx = (pivot[0] + head[0]) / 2;
  const mz = (pivot[1] + head[1]) / 2;
  return [
    L('lamp-base', 'lamp', 'anodised', pivot[0], 74, pivot[1], [[0, 0], [6.2, 0], [6.4, 0.6], [5.6, 1.8], [1.4, 2.4], [0, 2.4]], { segments: 32 }),
    C('lamp-arm', 'lamp', 'steel', pivot[0], 94.2, pivot[1], 0.7, 35.6, 'y', { segments: 12 }),
    L('lamp-pivot', 'lamp', 'anodised', pivot[0], 112, pivot[1], [[0, 0], [1.4, 0.2], [1.6, 1.4], [1.4, 2.6], [0, 2.8]], { segments: 20 }),
    B('lamp-boom', 'lamp', 'steel', mx - length / 2, mx + length / 2, boomY - 0.7, boomY + 0.7, mz - 0.8, mz + 0.8, {
      round: 'micro',
      yaw: -Number(yaw.toFixed(3)),
    }),
    L('lamp-shade', 'lamp', 'spun', head[0], 104, head[1], [[0, 0.2], [4.8, 0], [5, 0.5], [4.2, 2.6], [2.4, 6.2], [1.2, 8.4], [0, 8.6]], {
      segments: 36,
    }),
    C('lamp-diffuser', 'lamp', 'opal', head[0], 103.9, head[1], 4.5, 0.4, 'y', { segments: 28, glow: true, shadow: false }),
  ];
}

export const FURNITURE_DETAILS = Object.freeze({
  'bed-160': {
    // A woven rug under the lower two thirds of the bed, oak ledges and spun-metal reading lamps either side.
    vignette: [...rug(-52, 212, 64, 262), ...bedsideLedge('left', -48, -8), ...bedsideLedge('right', 168, 208)],
    // A micro-bevelled oak frame and a channel-tufted upholstered headboard: six padded channels on a felt back.
    frame: {
      body: false,
      parts: [
        B('frame', 'frame', 'oak', 0, 160, 8, 24, 0, 206, { grain: 'z' }),
        B('headboard-back', 'headboard', 'felt', 0, 160, 8, 106, 0, 4, { grain: 'y' }),
        ...[0, 1, 2, 3, 4, 5].map((i) => {
          const w = (160 - 2 - 0.8 * 5) / 6;
          const x = 1 + i * (w + 0.8);
          return B(`channel-${i + 1}`, 'headboard', 'felt-hi', x, x + w, 26, 103, 3, 11, { grain: 'y' });
        }),
      ],
    },
    // A rounded, piped mattress under one plush duvet draped over its sides and foot, a crisp sheet
    // turned down at the head and a textured runner throw across the foot.
    mattress: {
      body: false,
      parts: [
        B('mattress', 'mattress', 'linen', 3, 157, 24, 41.5, 3, 203),
        B('welt-left', 'piping', 'piping', 2.4, 3.2, 32, 33, 8, 198, { shadow: false }),
        B('welt-right', 'piping', 'piping', 156.8, 157.6, 32, 33, 8, 198, { shadow: false }),
        B('duvet', 'duvet', 'linen-hi', 0, 160, 29, 46, 84, 206),
        B('sheet-fold', 'sheet', 'sheet', 0.4, 159.6, 43.5, 48, 79, 93, { round: 'soft' }),
        B('throw', 'throw', 'felt', -1.5, 161.5, 36, 48.2, 152, 184),
      ],
    },
    // Four sculpted pillows: two euro shams leaning on the headboard, two sleeping pillows in front.
    'pillow-left': { body: false, parts: pillowSet('cushion-sand', 12) },
    'pillow-right': { body: false, parts: pillowSet('cushion-slate', 86) },
  },
  'desk-140': {
    // A rug under the desk and an ergonomic task chair tucked in: a five-star base, gas column,
    // moulded shell, upholstered seat and a back curving round the sitter on two angled wings.
    vignette: [
      ...rug(-34, 174, 18, 196),
      ...chairStar(70, 82),
      C('chair-column', 'chair', 'steel', 70, 24.5, 82, 1.6, 39, 'y', { segments: 20, shadow: false, group: 'chair' }),
      B('chair-shell', 'chair', 'anodised', 47, 93, 42, 45, 59, 105, { shadow: false, group: 'chair', round: 2 }),
      B('chair-seat', 'chair', 'cushion-slate', 48, 92, 44.5, 50.5, 60, 104, { shadow: false, group: 'chair', round: 'soft' }),
      B('chair-spine', 'chair', 'anodised', 67, 73, 44, 66, 103, 107, { shadow: false, group: 'chair', round: 'micro', tilt: 8 }),
      B('chair-back', 'chair', 'cushion-slate', 56, 84, 58, 92, 102, 107.5, { shadow: false, group: 'chair', round: 'soft', tilt: 10 }),
      B('chair-wing-left', 'chair', 'cushion-slate', 47, 57, 60, 90, 100, 105.5, {
        shadow: false,
        group: 'chair',
        round: 'soft',
        tilt: 10,
        yaw: -20,
      }),
      B('chair-wing-right', 'chair', 'cushion-slate', 83, 93, 60, 90, 100, 105.5, {
        shadow: false,
        group: 'chair',
        round: 'soft',
        tilt: 10,
        yaw: 20,
      }),
    ],
    // Steel A-frame trestles: two posts, a foot and a top bar each, every edge micro-bevelled.
    'trestle-left': {
      body: false,
      parts: [
        B('post-back', 'post', 'steel', 8, 12, 2, 69, 8, 12),
        B('post-front', 'post', 'steel', 8, 12, 2, 69, 58, 62),
        B('foot', 'foot', 'steel', 8, 12, 0, 2, 6, 64, { round: 'micro' }),
        B('bar', 'bar', 'steel', 8, 12, 69, 71, 6, 64, { round: 'micro' }),
      ],
    },
    'trestle-right': {
      body: false,
      parts: [
        B('post-back', 'post', 'steel', 128, 132, 2, 69, 8, 12),
        B('post-front', 'post', 'steel', 128, 132, 2, 69, 58, 62),
        B('foot', 'foot', 'steel', 128, 132, 0, 2, 6, 64, { round: 'micro' }),
        B('bar', 'bar', 'steel', 128, 132, 69, 71, 6, 64, { round: 'micro' }),
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
    // On the micro-bevelled oak top: an ultrawide studio display lit with an architectural viewport,
    // a sketchbook and pencil under a cantilevered task lamp, and a porcelain cup.
    top: {
      body: false,
      parts: [
        B('top', 'top', 'oak', 0, 140, 71, 74, 0, 70, { grain: 'x' }),
        // The stand rises behind the display: its neck meets the panel's back face, clear of the screen.
        L('monitor-base', 'monitor', 'steel', 70, 74, 11, [[0, 0], [9.5, 0], [9.8, 0.35], [9.2, 0.9], [2, 1.1], [0, 1.1]], { segments: 40 }),
        B('monitor-neck', 'monitor', 'steel', 68.6, 71.4, 75, 98, 7.6, 10, { round: 'micro' }),
        B('monitor-panel', 'monitor', 'anodised', 33, 107, 84, 116, 10, 12.6, { round: 'micro' }),
        B('monitor-screen', 'monitor', 'display', 34, 106, 85, 115, 12.6, 12.7, {
          shadow: false,
          glow: 'always',
          glowColor: '#8ea3b8',
          glowIntensity: 0.55,
        }),
        ...viewportGraphics(34, 106, 85, 115, 12.7),
        ...book('sketchbook', 'linen', 18, 48, 74, 1.4, 34, 56),
        C('pencil', 'object', 'oak', 40, 75.8, 53, 0.35, 14, 'x', { segments: 8, shadow: false }),
        L('cup', 'object', 'porcelain', 118, 74, 40, [[0, 0], [2.2, 0], [2.6, 0.4], [3.2, 5.8], [3, 6.2], [2.7, 5.9], [0, 5.6]], { segments: 28 }),
        ...deskLamp(),
      ],
    },
  },
  'sofa-200': {
    // A rug in front, and a low micro-bevelled oak and slate coffee table carrying two monographs
    // and a turned porcelain bowl.
    vignette: [
      ...rug(-32, 232, 40, 252),
      B('table-base', 'coffee-table', 'slate', 62, 138, RUG_T_CM, 34, 130, 166, { shadow: false, group: 'table', round: 'micro' }),
      B('table-top', 'coffee-table', 'oak', 48, 152, 34, 38, 120, 176, { shadow: false, group: 'table', grain: 'x', round: 'micro' }),
      ...book('monograph', 'slate', 60, 92, 38, 2.4, 128, 152, { shadow: false, group: 'table' }),
      ...book('catalogue', 'oxblood', 63, 89, 40.4, 1.6, 130, 150, { shadow: false, group: 'table' }),
      L('bowl', 'object', 'porcelain', 124, 38, 150, bowlProfile(9, 7), { shadow: false, group: 'table', segments: 40 }),
    ],
    // Six tapered oak legs replace the plinth block.
    plinth: {
      body: false,
      parts: [10, 100, 190].flatMap((x, i) => [
        C(`leg-back-${i + 1}`, 'leg', 'oak', x, 3, 12, 2.2, 6, 'y', { r2: 1.4, segments: 16, grain: 'y' }),
        C(`leg-front-${i + 1}`, 'leg', 'oak', x, 3, 80, 2.2, 6, 'y', { r2: 1.4, segments: 16, grain: 'y' }),
      ]),
    },
    // The upholstered base, softly radiused all round.
    base: {
      body: false,
      parts: [B('base', 'seat', 'felt', 0.5, 199.5, 6, 40, 0.5, 91.5, { round: 4 })],
    },
    // Two plush back cushions with deep fillets, leaning back a touch.
    back: {
      body: false,
      parts: [
        B('cushion-left', 'cushion', 'felt-hi', 18.5, 99.5, 42, 80, 1.5, 21.5, { tilt: -7 }),
        B('cushion-right', 'cushion', 'felt-hi', 100.5, 181.5, 42, 80, 1.5, 21.5, { tilt: -7 }),
      ],
    },
    // Deep seat cushions, each with an angled accent cushion leaning on the back.
    'seat-left': {
      body: false,
      parts: [
        B('seat', 'cushion', 'felt-hi', 19, 99, 39, 52, 21, 91),
        B('throw-cushion', 'cushion', 'cushion-sand', 26, 68, 50, 90, 21, 35, { tilt: -12, roll: 5 }),
      ],
    },
    'seat-right': {
      body: false,
      parts: [
        B('seat', 'cushion', 'felt-hi', 101, 181, 39, 52, 21, 91),
        B('throw-cushion', 'cushion', 'cushion-slate', 132, 174, 50, 90, 21, 35, { tilt: -12, roll: -5 }),
      ],
    },
    // Rounded arm blocks under bolster rolls.
    'arm-left': {
      body: false,
      parts: [
        B('block', 'arm', 'felt', 0, 18, 40, 56, 0, 92),
        C('bolster', 'bolster', 'felt', 9, 56, 46, 7.5, 86, 'z', { segments: 28 }),
      ],
    },
    'arm-right': {
      body: false,
      parts: [
        B('block', 'arm', 'felt', 182, 200, 40, 56, 0, 92),
        C('bolster', 'bolster', 'felt', 191, 56, 46, 7.5, 86, 'z', { segments: 28 }),
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
// Furniture lamps (reading lamps, the desk lamp diffuser) glow a warm 2700K at night.
const FURNITURE_LAMP_COLOR = hex(kelvinToRgb(2700));

function furnitureContext(furniture, room, rig, daylight) {
  const { wall, x0, z0 } = furniture.frame;
  return {
    uid: `furniture-${furniture.id}`,
    place: (point) => wallToRoom(room, wall, [x0 + point[0], point[1], z0 + point[2]]),
    rotY: WALL_ROT_Y[wall],
    room,
    lit: !daylight,
    lightColor: FURNITURE_LAMP_COLOR,
    emissive: rig.emissive,
  };
}

/**
 * A detail box kept inside the room the way furnitureLayout clips the
 * collision boxes: trimmed to the wall planes in the furniture frame (a bed
 * in a shallow room ends at the far wall, a throw pushed to the side stops at
 * it). Turned boxes, cylinders and lathes never reach a wall and pass as they
 * are; a box trimmed to nothing is dropped.
 */
function fitDetail(spec, frame, span) {
  if (spec.geometry !== 'box' || spec.tilt || spec.yaw || spec.roll) return spec;
  const b = spec.box;
  const box = {
    ...b,
    x0: Math.max(b.x0, -frame.x0),
    x1: Math.min(b.x1, span - frame.x0),
    z0: Math.max(b.z0, -frame.z0),
    z1: Math.min(b.z1, frame.reach - frame.z0),
  };
  if (box.x0 === b.x0 && box.x1 === b.x1 && box.z0 === b.z0 && box.z1 === b.z1) return spec;
  return box.x1 - box.x0 > 0.1 && box.z1 - box.z0 > 0.1 ? { ...spec, box } : null;
}

function furnitureRecords(furniture, room, rig, daylight) {
  if (!furniture) return [];
  const details = FURNITURE_DETAILS[furniture.id] ?? {};
  const ctx = furnitureContext(furniture, room, rig, daylight);
  const span = wallSpanCm(room, furniture.frame.wall);
  return furniture.parts.map((p) => {
    const look = FURNITURE_LOOK[p.tone] ?? FURNITURE_LOOK.felt;
    const pbr = PBR_MATERIALS[look.material];
    const detail = Object.hasOwn(details, p.id) ? details[p.id] : null;
    const partCtx = { ...ctx, uid: `${ctx.uid}-${p.id}` };
    return {
      part: p.id,
      color: FURNITURE_TONES[p.tone],
      box: p.box,
      ...boxRecord(p.box),
      material: look.material,
      roughness: look.roughness ?? pbr.roughness,
      metalness: look.metalness ?? pbr.metalness,
      body: detail ? detail.body : true,
      subparts: detail
        ? detail.parts
            .map((spec) => fitDetail(spec, furniture.frame, span))
            .filter(Boolean)
            .map((spec) => placeSubpart(spec, partCtx))
        : [],
    };
  });
}

/**
 * A vignette spec brought into the furniture frame and kept inside the room:
 * `fromWall` z is measured from the wall plane, a `fit` rug is clipped to the
 * walls (its field keeps its border inset), and any other part that would
 * leave the room is dropped. Null when nothing is left to draw.
 */
function fitVignette(spec, frame, span) {
  const shiftZ = spec.fromWall ? -frame.z0 : 0;
  // The room's walls in the furniture frame; a rug keeps 1 cm clear of them.
  const lo = { x: -frame.x0, z: -frame.z0 };
  const hi = { x: span - frame.x0, z: frame.reach - frame.z0 };
  if (spec.geometry === 'cylinder' || spec.geometry === 'lathe') {
    const [cx, cy, cz] = spec.at;
    const z = cz + shiftZ;
    const r = spec.geometry === 'lathe' ? Math.max(...spec.profile.map(([radius]) => radius)) : Math.max(spec.r, spec.r2);
    if (cx - r < lo.x || cx + r > hi.x || z - r < lo.z || z + r > hi.z) return null;
    return { ...spec, at: [cx, cy, z] };
  }
  const box = { ...spec.box, z0: spec.box.z0 + shiftZ, z1: spec.box.z1 + shiftZ };
  if (spec.fit) {
    const inset = 1 + (spec.inset ?? 0);
    const fitted = {
      ...box,
      x0: Math.max(box.x0, lo.x + inset),
      x1: Math.min(box.x1, hi.x - inset),
      z0: Math.max(box.z0, lo.z + inset),
      z1: Math.min(box.z1, hi.z - inset),
    };
    return fitted.x1 - fitted.x0 > 4 && fitted.z1 - fitted.z0 > 4 ? { ...spec, box: fitted } : null;
  }
  if (box.x0 < lo.x || box.x1 > hi.x || box.z0 < lo.z || box.z1 > hi.z) return null;
  return { ...spec, box };
}

/**
 * The free-standing companions round the floor reference (rug, ledges and
 * lamps, coffee table, task chair) as sub-parts in the room. Drawn only: the
 * collision parts, bounds and walk zone never see them.
 */
function furnitureVignette(furniture, room, rig, daylight) {
  const specs = furniture ? FURNITURE_DETAILS[furniture.id]?.vignette : null;
  if (!specs) return null;
  const ctx = furnitureContext(furniture, room, rig, daylight);
  const span = wallSpanCm(room, furniture.frame.wall);
  const fitted = specs.map((spec) => ({ spec, fit: fitVignette(spec, furniture.frame, span) }));
  // A group goes whole or not at all: a lamp never floats where its ledge was dropped.
  const dropped = new Set(fitted.filter(({ spec, fit }) => !fit && spec.group).map(({ spec }) => spec.group));
  const parts = fitted
    .filter(({ spec, fit }) => fit && !dropped.has(spec.group))
    .map(({ fit }) => placeSubpart(fit, { ...ctx, uid: `${ctx.uid}-vignette` }));
  return { id: `${furniture.id}-vignette`, wall: furniture.frame.wall, parts };
}

// Floor overlays sit just above a 0.6 cm rug: the contact shadow under the
// furniture, then the sun and moon patches through the windows.
const FURNITURE_AO_Y_M = 0.0068;
const FLOOR_LIGHT_Y_M = 0.008;

/** Soft contact shadow under the whole floor reference, in metres. */
function furnitureOcclusion(furniture) {
  if (!furniture) return null;
  const { bounds } = furniture;
  const pad = 12;
  return {
    position: [m((bounds.x0 + bounds.x1) / 2), FURNITURE_AO_Y_M, m((bounds.z0 + bounds.z1) / 2)],
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

/*
 * Window joinery, each member a full sub-part look. The casing is a plaster
 * reveal standing 8 cm off the wall with four lighter lining faces returning
 * to the glass, so the opening reads recessed; a 15 cm deep, bevelled oak
 * sill with a shadow line under its nosing; a brushed champagne-steel glazing
 * frame, mullions and transom (1.5 to 4.5 cm proud of the glass); a slim
 * steel casement sash round each of the six panes and two brushed steel
 * espagnolette handles on the mullions.
 */
export const WINDOW_FRAME = Object.freeze({
  reveal: Object.freeze({ material: 'wall-plaster', color: '#7a736a', roughness: 0.86, metalness: 0 }),
  lining: Object.freeze({ material: 'wall-plaster', color: '#8d857b', roughness: 0.9, metalness: 0 }),
  sill: Object.freeze({ material: 'wood-oak', color: '#b89c74', roughness: 0.5, metalness: 0 }),
  shadow: Object.freeze({ material: 'metal-obsidian', color: '#1c1a17', roughness: 0.92, metalness: 0.05 }),
  mullion: Object.freeze({ material: 'metal-steel', color: '#857e75', roughness: 0.32, metalness: 0.45 }),
  sash: Object.freeze({ material: 'metal-steel', color: '#6e6860', roughness: 0.36, metalness: 0.42 }),
  handle: Object.freeze({ material: 'metal-steel', color: '#c4beb4', roughness: 0.22, metalness: 0.74 }),
});
const REVEAL_DEPTH_CM = 8;
const LINING_CM = 1.6;
const SILL_DEPTH_CM = 15;
const BEAD_CM = 2.5;
const SASH_CM = 1.4;
const SASH_Z = Object.freeze([0.45, 1.35]);
const BAR_Z = Object.freeze([1.5, 4.5]);

/*
 * Direct sun through a window keeps an architectural projection whatever the
 * hour: the ray's inward share never drops under 0.48, its slant along the
 * wall stays within +-0.55 and its pitch between 0.32 and 0.78, so the six
 * panes always throw a bold 2 x 3 gobo with mullion bars well out across the
 * floor instead of a sliver against the baseboard. The sun's strength through
 * the glass ramps in with its incidence on the wall (full from 0.25 inward),
 * so a sun that just comes round onto a wall starts at the sky's level.
 */
export const SUN_GOBO = Object.freeze({
  inwardMin: 0.48,
  lateralMax: 0.55,
  pitchMin: 0.32,
  pitchMax: 0.78,
  patch: 0.34,
  shaft: 0.15,
  soft: 1,
  incidenceFull: 0.25,
});

/*
 * Every gobo lands whole: the pitch rises until the top of the glass lands
 * within 85% of the room's depth from the window wall (so in a shallow room
 * or under a low sun the pitch may exceed SUN_GOBO.pitchMax), and the slant
 * along the wall is capped so the farthest pane corner keeps 10% of the clear
 * wall run beside the window. Applied to sun, sky and moon alike.
 */
export const GOBO_FIT = Object.freeze({ reach: 0.85, run: 0.9 });

/*
 * A window that does not face the sun still faces the open sky: by day it
 * lets a diffuse skylight portal in, a cool sky gobo tinted a quarter toward
 * the sun, falling steeply inward with a slight slant toward the sun's side,
 * and softer edged than direct sun. The sky eases from half strength at the
 * horizon (and all through twilight) to full once the sun's strength reaches
 * 0.5, so it is continuous through sunrise and sunset. A sun-facing window is
 * never darker than the sky it also faces.
 */
export const SKYLIGHT = Object.freeze({
  color: '#dce8f7',
  solarMix: 0.25,
  inward: 0.65,
  pitch: 0.58,
  lateralGain: 0.35,
  lateralMax: 0.3,
  patchOpacity: 0.18,
  shaftOpacity: 0.085,
  twilight: 0.5,
  fullAt: 0.5,
  soft: 1.5,
});

/*
 * Every window also carries a real 3D fill light: a soft spot from the middle
 * of the glass aimed at the floor 2.2 m inward along its gobo, coloured to
 * its sun, sky or moon, so furniture and walls near any window pick up
 * directional light and specular highlights.
 */
export const PORTAL_LIGHT = Object.freeze({ reachCm: 220, angleDeg: 60, penumbra: 1, decay: 2, distanceCm: 620, sun: 3.4, sky: 2, moon: 0.6 });

/*
 * The glass itself. Daylight carries the sky the sun paints; at night the
 * pane holds a luminous Nordic twilight over a deep blue base instead of a
 * black hole in the wall, and lets a cool moonlit sky into the room.
 */
export const NIGHT_GLAZING = Object.freeze({ color: '#2d4263', base: '#1a273b', intensity: 0.88 });
const DAY_GLAZING_BASE = '#0f1114';
// Diffuse moonlit sky through each window: 40 deg up, turned 14 deg off the
// wall's normal so the patches fall at a natural slant.
export const MOONLIGHT = Object.freeze({ color: '#8fa8c8', patchOpacity: 0.14, shaftOpacity: 0.05, elevationDeg: 40, skewDeg: 14, soft: 1.3 });

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

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const unit4 = (value) => Number(clamp(value, 0, 1).toFixed(4)) + 0;

/**
 * Light through a window's six pane apertures along `light` (the unit vector
 * from the room toward the source): each pane lands as a patch on the floor
 * (projected along the light, clipped to the floor) and a shaft through the
 * air from the glass to where its corners land, inside the room.
 *
 * Every patch vertex carries gobo coordinates for the soft-penumbra floor
 * shader: `uv` [u across the pane, 0 to 1; v from the pane's sill-side edge 0
 * to its far edge 1], found by inverting the affine projection of the pane,
 * so clipped vertices keep exact coordinates; and `depth`, 0 on the line the
 * window's lowest glass lands on and 1 at its far tip, which widens the
 * penumbra the further the light has travelled.
 */
function paneLight(room, panes, place, light, look, glass) {
  const [lx, ly, lz] = light;
  const { widthCm: W, depthCm: D } = room;
  const travel = (p) => {
    // Along -light from a point on the glass: to the floor, or out through the room's far side.
    const limits = [p[1] / ly];
    if (lx < -1e-9) limits.push((W - p[0]) / -lx);
    if (lx > 1e-9) limits.push(p[0] / lx);
    if (lz < -1e-9) limits.push((D - p[2]) / -lz);
    if (lz > 1e-9) limits.push(p[2] / lz);
    return Math.max(0, Math.min(...limits));
  };
  const along = (p, t) => [p[0] - lx * t, p[1] - ly * t, p[2] - lz * t];
  const toFloor = (p) => {
    const q = along(p, p[1] / ly);
    return [q[0], q[2]];
  };
  const glassSpan = Math.max(1e-6, glass.y1 - glass.y0);
  const patches = [];
  const shafts = [];
  for (const [i, pane] of panes.entries()) {
    const corners = [
      [pane.px0, pane.py1],
      [pane.px1, pane.py1],
      [pane.px1, pane.py0],
      [pane.px0, pane.py0],
    ].map(([a, y]) => place([a, y, 0.2]));
    const landed = corners.map(toFloor);
    const floor = clipToFloor(landed, W, D);
    if (floor.length >= 3) {
      // Pane frame on the floor: origin at the sill-side left corner, u along the sill, v toward the head.
      const [a0, a1] = [landed[3], landed[2]];
      const e1 = [a1[0] - a0[0], a1[1] - a0[1]];
      const e2 = [landed[0][0] - a0[0], landed[0][1] - a0[1]];
      const det = e1[0] * e2[1] - e1[1] * e2[0];
      const uv = floor.map(([x, z]) => {
        if (Math.abs(det) < 1e-9) return [0, 0];
        const dx = x - a0[0];
        const dz = z - a0[1];
        return [unit4((dx * e2[1] - dz * e2[0]) / det), unit4((e1[0] * dz - e1[1] * dx) / det)];
      });
      patches.push({
        id: `${look.source}-patch-${i + 1}`,
        light: look.source,
        points: floor.map(([x, z]) => [m(x), FLOOR_LIGHT_Y_M, m(z)]),
        uv,
        depth: uv.map(([, v]) => unit4((pane.py0 + v * (pane.py1 - pane.py0) - glass.y0) / glassSpan)),
        soft: look.soft,
        color: look.color,
        opacity: look.patchOpacity,
      });
    }
    shafts.push({
      id: `${look.source}-shaft-${i + 1}`,
      kind: 'shaft',
      light: look.source,
      geometry: 'prism',
      from: corners.map(v3),
      to: corners.map((p) => v3(along(p, travel(p)))),
      color: look.color,
      opacity: look.shaftOpacity,
    });
  }
  return { patches, shafts };
}

/** Unit vector toward the moonlit sky outside a wall: up 40 deg, slanted 14 deg off the outward normal. */
function moonDirection(wall) {
  const [nx, nz] = INWARD[wall];
  const e = MOONLIGHT.elevationDeg * DEG;
  const s = MOONLIGHT.skewDeg * DEG;
  const ox = -nx * Math.cos(s) + nz * Math.sin(s);
  const oz = -nz * Math.cos(s) - nx * Math.sin(s);
  return [ox * Math.cos(e), Math.sin(e), oz * Math.cos(e)];
}

/**
 * Unit vector toward a window's light source from its inward share, its slant
 * along the wall and its pitch, fitted so the gobo lands whole (GOBO_FIT):
 * `fit.top` is the height of the highest glass, `fit.reach` the room's depth
 * from the wall and `fit.run` the narrower clear wall run beside the glass,
 * all in cm. A point of the glass at height y lands y * inward / pitch into
 * the room and y * lateral / pitch along the wall.
 */
function goboRay(wall, inward, lateral, pitch, fit) {
  const [nx, nz] = INWARD[wall];
  const [ux, , uz] = wallDirToRoom(wall, [1, 0, 0]);
  const lift = Math.max(pitch, (fit.top * inward) / (GOBO_FIT.reach * fit.reach));
  const cap = (GOBO_FIT.run * lift * fit.run) / fit.top;
  const slant = clamp(lateral, -cap, cap);
  const ray = [-nx * inward + ux * slant, lift, -nz * inward + uz * slant];
  const length = Math.hypot(...ray);
  return ray.map((c) => Number((c / length).toFixed(6)) + 0);
}

/** A unit ray in the room frame split into a wall's inward share, its slant along the wall and its pitch. */
function rayShares(wall, ray) {
  const [nx, nz] = INWARD[wall];
  const [ux, , uz] = wallDirToRoom(wall, [1, 0, 0]);
  return { inward: -(ray[0] * nx + ray[2] * nz), lateral: ray[0] * ux + ray[2] * uz, pitch: ray[1] };
}

/**
 * The window's 3D fill light: a soft spot from the middle of the glass, just
 * inside the casing, aimed straight inward at the floor PORTAL_LIGHT.reachCm
 * from the wall (20 cm short of the far wall in a shallower room).
 */
function portalLight(room, wall, opening, look) {
  const reach = wall === 'east' || wall === 'west' ? room.widthCm : room.depthCm;
  const depth = clamp(reach - 20, 40, PORTAL_LIGHT.reachCm);
  const cx = (opening.x0 + opening.x1) / 2;
  const place = (point) => wallToRoom(room, wall, point);
  return {
    id: `window-${wall}-portal`,
    type: 'spot',
    source: look.source,
    color: look.color,
    position: v3(place([cx, (opening.y0 + opening.y1) / 2, REVEAL_DEPTH_CM + 4])),
    target: v3(place([cx, 0, depth])),
    angle: Number((PORTAL_LIGHT.angleDeg * DEG).toFixed(4)),
    penumbra: PORTAL_LIGHT.penumbra,
    intensity: look.intensity,
    distance: m(PORTAL_LIGHT.distanceCm),
    decay: PORTAL_LIGHT.decay,
  };
}

/**
 * One window on its wall, as a glazed opening in a recessed plaster casing
 * with lining returns, a bevelled oak sill, a steel glazing frame, two
 * mullions, a transom, six casement sashes and two espagnolette handles.
 * Every window lets light in, by day and by night:
 * - facing the sun, each pane throws a sunlit gobo patch across the floor and
 *   a shaft through the air, along a ray kept at an architectural angle;
 * - facing away from the sun by day, it is a skylight portal: a cooler,
 *   softer sky gobo and a faint air wash fall steeply inward;
 * - at night the glass holds a twilight sky and every pane lets in a soft,
 *   cool moonlit patch and a faint shaft.
 * Each window also carries `portalLight`, a soft 3D spot coloured to match.
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
  const bar = (id, look, bx0, bx1, by0, by1, bz0, bz1, extra = {}) => {
    const kind = extra.kind ?? id.split('-')[0];
    const size = [m(bx1 - bx0), m(by1 - by0), m(bz1 - bz0)];
    return {
      id: `window-${wall}-${id}`,
      kind,
      geometry: 'box',
      radius: null,
      radiusBottom: null,
      size,
      bevel: subpartBevel(kind, size, extra.round ?? null, WINDOW_FRAME[look].material),
      position: v3(place([(bx0 + bx1) / 2, (by0 + by1) / 2, (bz0 + bz1) / 2])),
      rotation: [0, rotY, 0],
      ...WINDOW_FRAME[look],
      grain: extra.grain ?? null,
      shadow: extra.shadow !== false,
      emissive: null,
      emissiveIntensity: 0,
    };
  };
  const third = width / 3;
  const transom = y0 + (y1 - y0) * 0.72;
  const m1 = x0 + third;
  const m2 = x0 + 2 * third;
  const h2 = MULLION_CM / 2;
  const [bz0, bz1] = BAR_Z;
  const [sz0, sz1] = SASH_Z;
  // Six sashes fill the glass inside the glazing bead, between the mullions and the transom.
  const columns = [
    [x0 + BEAD_CM, m1 - h2],
    [m1 + h2, m2 - h2],
    [m2 + h2, x1 - BEAD_CM],
  ];
  const rows = [
    [y0 + BEAD_CM, transom - h2],
    [transom + h2, y1 - BEAD_CM],
  ];
  const sashes = rows.flatMap(([py0, py1], r) => columns.map(([px0, px1], c) => ({ n: r * 3 + c + 1, px0, px1, py0, py1 })));
  // Light passes only the glass each sash leaves clear, so the gobo carries the full frame shadow.
  const apertures = sashes.map(({ px0, px1, py0, py1 }) => ({
    px0: px0 + SASH_CM,
    px1: px1 - SASH_CM,
    py0: py0 + SASH_CM,
    py1: py1 - SASH_CM,
  }));
  const handleY = y0 + (transom - y0) * 0.55;
  const lining = REVEAL_DEPTH_CM - 0.4;
  const members = [
    // The plaster casing: head, jambs and an apron under the sill, 8 cm off the wall.
    bar('head', 'reveal', x0 - FRAME_CM, x1 + FRAME_CM, y1, y1 + FRAME_CM, 0, REVEAL_DEPTH_CM),
    bar('jamb-left', 'reveal', x0 - FRAME_CM, x0, y0, y1, 0, REVEAL_DEPTH_CM),
    bar('jamb-right', 'reveal', x1, x1 + FRAME_CM, y0, y1, 0, REVEAL_DEPTH_CM),
    bar('apron', 'reveal', x0 - FRAME_CM, x1 + FRAME_CM, y0 - 12, y0 - 4.5, 0, 2),
    // Four lining faces return from the casing to the glass, so the opening reads recessed.
    bar('lining-head', 'lining', x0, x1, y1 - LINING_CM, y1, 0.2, lining),
    bar('lining-left', 'lining', x0, x0 + LINING_CM, y0, y1 - LINING_CM, 0.2, lining),
    bar('lining-right', 'lining', x1 - LINING_CM, x1, y0, y1 - LINING_CM, 0.2, lining),
    bar('lining-foot', 'lining', x0 + LINING_CM, x1 - LINING_CM, y0, y0 + 0.8, 0.2, lining),
    // A deep, bevelled oak sill running past the casing, a shadow line tucked under its nosing.
    bar('sill', 'sill', x0 - FRAME_CM - 3, x1 + FRAME_CM + 3, y0 - 4.5, y0, 0, SILL_DEPTH_CM, { grain: 'x' }),
    bar('shadowline-sill', 'shadow', x0 - FRAME_CM - 2, x1 + FRAME_CM + 2, y0 - 5.4, y0 - 4.5, 0, SILL_DEPTH_CM - 1.5, { shadow: false }),
    // The steel glazing frame round the glass.
    bar('bead-head', 'mullion', x0, x1, y1 - BEAD_CM, y1, 0.3, 1.8, { grain: 'x' }),
    bar('bead-foot', 'mullion', x0, x1, y0, y0 + BEAD_CM, 0.3, 1.8, { grain: 'x' }),
    bar('bead-left', 'mullion', x0, x0 + BEAD_CM, y0 + BEAD_CM, y1 - BEAD_CM, 0.3, 1.8, { grain: 'y' }),
    bar('bead-right', 'mullion', x1 - BEAD_CM, x1, y0 + BEAD_CM, y1 - BEAD_CM, 0.3, 1.8, { grain: 'y' }),
    // Mullions and transom standing proud of the glass, micro-bevelled to catch a highlight.
    bar('mullion-1', 'mullion', m1 - h2, m1 + h2, y0, y1, bz0, bz1, { grain: 'y', round: 'micro' }),
    bar('mullion-2', 'mullion', m2 - h2, m2 + h2, y0, y1, bz0, bz1, { grain: 'y', round: 'micro' }),
    bar('transom', 'mullion', x0, x1, transom - h2, transom + h2, bz0, bz1, { grain: 'x', round: 'micro' }),
    // A slim steel casement sash round each pane, behind the mullions.
    ...sashes.flatMap(({ n, px0, px1, py0, py1 }) => [
      bar(`sash-${n}-head`, 'sash', px0, px1, py1 - SASH_CM, py1, sz0, sz1, { grain: 'x' }),
      bar(`sash-${n}-foot`, 'sash', px0, px1, py0, py0 + SASH_CM, sz0, sz1, { grain: 'x' }),
      bar(`sash-${n}-left`, 'sash', px0, px0 + SASH_CM, py0 + SASH_CM, py1 - SASH_CM, sz0, sz1, { grain: 'y' }),
      bar(`sash-${n}-right`, 'sash', px1 - SASH_CM, px1, py0 + SASH_CM, py1 - SASH_CM, sz0, sz1, { grain: 'y' }),
    ]),
    // Two brushed steel espagnolette handles on the mullions: a rose, and a lever hanging from it.
    ...[m1, m2].flatMap((mx, i) => [
      bar(`handle-rose-${i + 1}`, 'handle', mx - 1.2, mx + 1.2, handleY - 3.2, handleY + 3.2, bz1, bz1 + 0.9, { round: 'micro' }),
      bar(`handle-lever-${i + 1}`, 'handle', mx - 0.55, mx + 0.55, handleY - 9.5, handleY + 1.2, bz1 + 0.9, bz1 + 2.1, { round: 'micro' }),
    ]),
  ];

  const glazing = {
    id: `window-${wall}-glazing`,
    size: [m(width), m(y1 - y0)],
    position: v3(place([(x0 + x1) / 2, (y0 + y1) / 2, 0.15])),
    rotation: [0, rotY, 0],
    color: daylight ? (solar.up ? mix('#dbe7f2', solar.color, 0.3) : '#53627a') : NIGHT_GLAZING.color,
    base: daylight ? DAY_GLAZING_BASE : NIGHT_GLAZING.base,
    intensity: daylight ? Number((solar.up ? 0.5 + 0.6 * solar.strength : 0.32).toFixed(3)) : NIGHT_GLAZING.intensity,
  };

  const [nx, nz] = INWARD[wall];
  const [ux, , uz] = wallDirToRoom(wall, [1, 0, 0]);
  const [lx, ly, lz] = solar.direction;
  // Negative when the sun stands outside this wall; `slant` is its share along the wall.
  const facing = lx * nx + lz * nz;
  const slant = lx * ux + lz * uz;
  const sunlit = daylight && solar.up && ly > 0.02 && facing < -0.02;
  const skylit = daylight && !sunlit;
  const moonlit = !daylight;
  // The highest glass, the room's depth from this wall and the clear wall run beside the glass, cm.
  const fit = {
    top: y1 - BEAD_CM - SASH_CM,
    reach: wall === 'east' || wall === 'west' ? room.widthCm : room.depthCm,
    run: Math.min(x0, span - x1) + BEAD_CM + SASH_CM,
  };
  // The open sky's level, continuous through sunrise and sunset.
  const skyLevel = solar.up
    ? SKYLIGHT.twilight + (1 - SKYLIGHT.twilight) * Math.min(1, solar.strength / SKYLIGHT.fullAt)
    : SKYLIGHT.twilight;
  const sky = {
    patch: SKYLIGHT.patchOpacity * skyLevel,
    shaft: SKYLIGHT.shaftOpacity * skyLevel,
    portal: PORTAL_LIGHT.sky * skyLevel,
  };
  let ray;
  let look;
  if (sunlit) {
    const incidence = Math.min(1, (-facing - 0.02) / (SUN_GOBO.incidenceFull - 0.02));
    ray = goboRay(
      wall,
      Math.max(SUN_GOBO.inwardMin, -facing),
      clamp(slant, -SUN_GOBO.lateralMax, SUN_GOBO.lateralMax),
      clamp(ly, SUN_GOBO.pitchMin, SUN_GOBO.pitchMax),
      fit,
    );
    // The window facing the sun also faces the sky, so it never reads darker than a sky portal.
    look = {
      source: 'sun',
      color: solar.color,
      patchOpacity: Number(Math.max(SUN_GOBO.patch * solar.strength * incidence, sky.patch).toFixed(4)),
      shaftOpacity: Number(Math.max(SUN_GOBO.shaft * solar.strength * incidence, sky.shaft).toFixed(4)),
      soft: SUN_GOBO.soft,
      intensity: Number(Math.max(PORTAL_LIGHT.sun * (0.4 + 0.6 * solar.strength) * incidence, sky.portal).toFixed(3)),
    };
  } else if (skylit) {
    ray = goboRay(
      wall,
      SKYLIGHT.inward,
      clamp(slant * SKYLIGHT.lateralGain, -SKYLIGHT.lateralMax, SKYLIGHT.lateralMax),
      SKYLIGHT.pitch,
      fit,
    );
    look = {
      source: 'sky',
      color: mix(SKYLIGHT.color, solar.color, SKYLIGHT.solarMix),
      patchOpacity: Number(sky.patch.toFixed(4)),
      shaftOpacity: Number(sky.shaft.toFixed(4)),
      soft: SKYLIGHT.soft,
      intensity: Number(sky.portal.toFixed(3)),
    };
  } else {
    const moon = rayShares(wall, moonDirection(wall));
    ray = goboRay(wall, moon.inward, moon.lateral, moon.pitch, fit);
    look = {
      source: 'moon',
      color: MOONLIGHT.color,
      patchOpacity: MOONLIGHT.patchOpacity,
      shaftOpacity: MOONLIGHT.shaftOpacity,
      soft: MOONLIGHT.soft,
      intensity: PORTAL_LIGHT.moon,
    };
  }
  const light = paneLight(room, apertures, place, ray, look, { y0, y1 });
  return {
    id: `window-${wall}`,
    wall,
    cull: wallCull(room, wall),
    x0,
    x1,
    y0,
    y1,
    glazing,
    members,
    patches: light.patches,
    shafts: light.shafts,
    sunlit,
    skylit,
    moonlit,
    light: look.source,
    ray: ray.map((c) => Number(c.toFixed(4)) + 0),
    portalLight: portalLight(room, wall, { x0, x1, y0, y1 }, look),
  };
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
  const furniture = furnitureRecords(layout, room, base, daylight);
  const vignette = furnitureVignette(layout, room, base, daylight);
  const furnitureAo = furnitureOcclusion(layout);
  // Every glazed wall builds its own window; `window` stays the primary one for older readers.
  const windows = windowWallsOf(room).map((wall) => buildWindow(room, wall, solar, daylight));
  const shell = buildShell(room, rig);
  const envelope = buildEnvelope(room, rig);
  const edges = technical || wireframe;

  const submeshes =
    modules.reduce((sum, module) => sum + module.subparts.length, 0) +
    furniture.reduce((sum, part) => sum + part.subparts.length, 0) +
    (vignette ? vignette.parts.length : 0);
  const beams = modules.reduce((sum, module) => sum + module.volumetrics.length, 0);
  const volumetrics = beams + windows.reduce((sum, win) => sum + win.shafts.length, 0);
  // Drawn meshes: sub-parts batch by look, one draw call per look; a window's
  // floor gobo and its air wash are one merged mesh each.
  const meshes =
    shell.surfaces.length +
    shell.poche.length +
    envelope.baseboards.length +
    1 +
    envelope.coves.reduce((sum, cove) => sum + lookCount(cove.parts), 0) +
    envelope.cornerShades.length +
    furniture.reduce((sum, part) => sum + (part.body ? 1 : 0) + lookCount(part.subparts), 0) +
    (furnitureAo ? 1 : 0) +
    (vignette ? lookCount(vignette.parts) : 0) +
    modules.reduce(
      (sum, module) => sum + (lookCount(module.subparts) || 1) + module.emitters.length + 1 + (module.aoFloor ? 1 : 0),
      0,
    ) +
    beams +
    windows.reduce(
      (sum, win) => sum + 1 + lookCount(win.members) + (win.patches.length > 0 ? 1 : 0) + (win.shafts.length > 0 ? 1 : 0),
      0,
    );

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
    furnitureVignette: vignette,
    furnitureAo,
    furniturePlacement: layout ? { wall: layout.wall, offsetCm: layout.offsetCm, bounds: layout.bounds } : null,
    solar,
    windows,
    window: windows[0] ?? null,
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
    // Three rig lights (ambient, sky, sun) plus every LED channel and every window's portal light.
    stats: { meshes, lights: lights.length + 3 + windows.filter((win) => win.portalLight).length, submeshes, volumetrics },
  };
}
