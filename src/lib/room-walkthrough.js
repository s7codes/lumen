import { isOneOf } from '../security/sanitize.js';
import { luminousSources, planePointLux } from './illuminance-field.js';
import { furnitureLayout } from './room-3d.js';
import { computeEnvironmentalPhysics } from './room-physics.js';
import { sanitizeWallId, wallSpanCm, wallToRoom } from './room-walls.js';
import { approach } from './spring.js';

/*
 * Camera lenses for the 3D room and the inside-room observer.
 *
 * Room frame, in cm: X along the north wall, Y up, Z toward the south wall.
 * The observer stands at (xCm, zCm) with the eye at 165 cm. headingDeg is a
 * plan bearing: 0 faces the north wall, 90 the east wall, 180 the south wall
 * and -90 the west wall. pitchDeg tilts the gaze, positive up.
 */

export const CAMERA_MODES = Object.freeze(['orbit', 'inside', 'elevation']);
export const DEFAULT_CAMERA_MODE = 'orbit';
export const CAMERA_MODE_LABELS = Object.freeze({
  orbit: 'Orbit Cutaway',
  inside: 'Inside Room (165 cm)',
  elevation: 'Wall Elevation',
});

export const EYE_HEIGHT_CM = 165;
export const WALL_BUFFER_CM = 32;
export const FURNITURE_BUFFER_CM = 20;
export const WALK_STEP_CM = 25;
export const TURN_STEP_DEG = 15;
export const LOOK_PITCH = Object.freeze({ min: -65, max: 65 });
// An architectural wide-angle lens; the wheel and the plus / minus keys swing
// it between a 50 deg detail view and a 92 deg ultra-wide interior.
export const INSIDE_FOV_DEG = 78;
export const INSIDE_FOV = Object.freeze({ min: 50, max: 92 });
export const INSIDE_FOV_STEP_DEG = 4;
// The opening stance stands 78 percent of the way back from the wall in view,
// so a bed or a sofa against it leaves open floor in front of the eye.
const STANCE_BACKOFF = 0.78;
export const ELEVATION_FOV_DEG = 30;
const ELEVATION_MARGIN = 1.14;
const DEG = Math.PI / 180;

/*
 * Continuous locomotion. A tap of a walk key steps WALK_STEP_CM or turns
 * TURN_STEP_DEG at once; a key held past WALK_HOLD_S hands the stance to a
 * per-frame velocity loop, so walking never waits on the OS key repeat.
 * Speeds are an architectural walking pace, in cm/s and deg/s.
 */
export const WALK_SPEED = Object.freeze({ forward: 145, strafe: 120, turn: 78 });
export const RUN_SPEED = Object.freeze({ forward: 215, strafe: 178, turn: 78 });
export const WALK_ACCEL_TAU_S = 0.11;
// Close to 1 / sqrt(120), the inside lens spring's time constant: a released
// walk handed back to that spring at its own speed lands as a plain
// exponential coast, the same curve as this deceleration.
export const WALK_DECEL_TAU_S = 0.09;
export const WALK_HOLD_S = 0.15;

/** Locomotion keys by their lower-case `KeyboardEvent.key`: unit forward, strafe and turn intents. */
export const WALK_KEYS = Object.freeze({
  w: Object.freeze({ forward: 1 }),
  arrowup: Object.freeze({ forward: 1 }),
  s: Object.freeze({ forward: -1 }),
  arrowdown: Object.freeze({ forward: -1 }),
  a: Object.freeze({ strafe: -1 }),
  d: Object.freeze({ strafe: 1 }),
  q: Object.freeze({ turn: -1 }),
  arrowleft: Object.freeze({ turn: -1 }),
  e: Object.freeze({ turn: 1 }),
  arrowright: Object.freeze({ turn: 1 }),
});
const VELOCITY_AXES = Object.freeze(['forward', 'strafe', 'turn']);

/** Plan bearing that faces each wall dead-on from inside the room. */
export const WALL_LOOK_HEADING = Object.freeze({ north: 0, east: 90, south: 180, west: -90 });

export function sanitizeCameraMode(value) {
  return isOneOf(value, CAMERA_MODES) ? value : DEFAULT_CAMERA_MODE;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const tenth = (value) => {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** Bearing folded into (-180, 180]. */
export function normalizeHeading(deg) {
  const folded = ((((deg + 180) % 360) + 360) % 360) - 180;
  return tenth(folded === -180 ? 180 : folded);
}

/** Bearing as a three-digit azimuth, 000 to 359. */
export function compassReadout(bearing) {
  return `AZ ${String(((Math.round(bearing) % 360) + 360) % 360).padStart(3, '0')}`;
}

/** Shortest signed turn between two bearings, within [-180, 180). */
export function headingTurn(from, to) {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

/** Unit gaze vector for a bearing and pitch, in the room frame. */
export function lookDirection(headingDeg, pitchDeg = 0) {
  const h = headingDeg * DEG;
  const p = pitchDeg * DEG;
  return [Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p)];
}

/** Where the observer may stand: 32 cm clear of every wall. */
export function walkBounds(room) {
  const x1 = Math.max(WALL_BUFFER_CM, room.widthCm - WALL_BUFFER_CM);
  const z1 = Math.max(WALL_BUFFER_CM, room.depthCm - WALL_BUFFER_CM);
  return { x0: WALL_BUFFER_CM, x1, z0: WALL_BUFFER_CM, z1 };
}

/** Plan footprint of the floor reference furniture, grown by the body clearance; null without furniture. */
export function furnitureZone(room) {
  const furniture = furnitureLayout(room);
  if (!furniture) return null;
  const { bounds } = furniture;
  return {
    x0: bounds.x0 - FURNITURE_BUFFER_CM,
    x1: bounds.x1 + FURNITURE_BUFFER_CM,
    z0: bounds.z0 - FURNITURE_BUFFER_CM,
    z1: bounds.z1 + FURNITURE_BUFFER_CM,
  };
}

function blocked(x, z, zone) {
  return zone !== null && x > zone.x0 && x < zone.x1 && z > zone.z0 && z < zone.z1;
}

/** Pulls a stance inside the wall buffer and out of the furniture footprint, to the nearest free point. */
export function resolveStance(walk, room) {
  const b = walkBounds(room);
  const zone = furnitureZone(room);
  const x = clamp(walk.xCm, b.x0, b.x1);
  const z = clamp(walk.zCm, b.z0, b.z1);
  if (!blocked(x, z, zone)) return { ...walk, xCm: tenth(x), zCm: tenth(z) };
  const candidates = [
    [zone.x0, z],
    [zone.x1, z],
    [x, zone.z0],
    [x, zone.z1],
  ]
    .map(([cx, cz]) => [clamp(cx, b.x0, b.x1), clamp(cz, b.z0, b.z1)])
    .filter(([cx, cz]) => !blocked(cx, cz, zone))
    .sort((p, q) => Math.hypot(p[0] - x, p[1] - z) - Math.hypot(q[0] - x, q[1] - z));
  const [rx, rz] = candidates[0] ?? [x, z];
  return { ...walk, xCm: tenth(rx), zCm: tenth(rz) };
}

/** Inside-room field of view, clamped to the lens range and kept to 0.1 deg. */
export function sanitizeInsideFov(value) {
  return tenth(clamp(isFiniteNumber(value) ? value : INSIDE_FOV_DEG, INSIDE_FOV.min, INSIDE_FOV.max));
}

/**
 * The opening stance: centred across `wall`, backed up along its look axis
 * toward the opposite wall, facing it dead-on.
 */
export function defaultStance(room, wall = 'north') {
  const id = sanitizeWallId(wall);
  const near = 1 - STANCE_BACKOFF;
  const [u, v] = { north: [0.5, STANCE_BACKOFF], south: [0.5, near], east: [near, 0.5], west: [STANCE_BACKOFF, 0.5] }[id];
  return resolveStance(
    { xCm: room.widthCm * u, zCm: room.depthCm * v, headingDeg: WALL_LOOK_HEADING[id], pitchDeg: 0 },
    room,
  );
}

/**
 * Carries a stance into a resized envelope at the same relative spot, so an
 * observer backed up in a compact room is still backed up in a loft.
 */
export function rescaleStance(walk, from, to) {
  if (from.widthCm === to.widthCm && from.depthCm === to.depthCm) return walk;
  return resolveStance(
    { ...walk, xCm: (walk.xCm * to.widthCm) / from.widthCm, zCm: (walk.zCm * to.depthCm) / from.depthCm },
    to,
  );
}

/** Rebuilds a stance from untrusted numbers; anything missing falls back to the default stance. */
export function sanitizeWalk(input, room) {
  const base = defaultStance(room);
  const source = input !== null && typeof input === 'object' ? input : {};
  return resolveStance(
    {
      xCm: isFiniteNumber(source.xCm) ? source.xCm : base.xCm,
      zCm: isFiniteNumber(source.zCm) ? source.zCm : base.zCm,
      headingDeg: normalizeHeading(isFiniteNumber(source.headingDeg) ? source.headingDeg : base.headingDeg),
      pitchDeg: tenth(clamp(isFiniteNumber(source.pitchDeg) ? source.pitchDeg : 0, LOOK_PITCH.min, LOOK_PITCH.max)),
    },
    room,
  );
}

/**
 * One step: `forward` and `strafe` in whole steps along and across the
 * bearing. The wall buffer clamps; a step into the furniture footprint slides
 * along it and stops at its edge, axis by axis.
 */
export function stepWalk(walk, room, { forward = 0, strafe = 0 } = {}) {
  const h = walk.headingDeg * DEG;
  const f = (isFiniteNumber(forward) ? forward : 0) * WALK_STEP_CM;
  const s = (isFiniteNumber(strafe) ? strafe : 0) * WALK_STEP_CM;
  const b = walkBounds(room);
  const zone = furnitureZone(room);
  let x = clamp(walk.xCm + Math.sin(h) * f + Math.cos(h) * s, b.x0, b.x1);
  let z = clamp(walk.zCm - Math.cos(h) * f + Math.sin(h) * s, b.z0, b.z1);
  if (blocked(x, z, zone)) {
    if (!blocked(x, walk.zCm, zone)) z = walk.zCm <= zone.z0 ? zone.z0 : zone.z1;
    else if (!blocked(walk.xCm, z, zone)) x = walk.xCm <= zone.x0 ? zone.x0 : zone.x1;
    else {
      x = walk.xCm;
      z = walk.zCm;
    }
  }
  return { ...walk, xCm: tenth(x), zCm: tenth(z) };
}

export function turnWalk(walk, deltaDeg) {
  return { ...walk, headingDeg: normalizeHeading(walk.headingDeg + (isFiniteNumber(deltaDeg) ? deltaDeg : 0)) };
}

/** The locomotion key id for a `KeyboardEvent.key`, or null for any other key. */
export function walkKey(key) {
  if (typeof key !== 'string') return null;
  const id = key.toLowerCase();
  return Object.hasOwn(WALK_KEYS, id) ? id : null;
}

/**
 * Unit intent from the held keys. Opposite keys cancel; a diagonal is
 * normalised so W + D walks no faster than W alone.
 */
export function walkIntent(keys) {
  let forward = 0;
  let strafe = 0;
  let turn = 0;
  for (const key of keys ?? []) {
    const id = walkKey(key);
    if (id === null) continue;
    const binding = WALK_KEYS[id];
    forward += binding.forward ?? 0;
    strafe += binding.strafe ?? 0;
    turn += binding.turn ?? 0;
  }
  forward = clamp(forward, -1, 1);
  strafe = clamp(strafe, -1, 1);
  const reach = Math.hypot(forward, strafe);
  if (reach > 1) {
    forward /= reach;
    strafe /= reach;
  }
  return { forward, strafe, turn: clamp(turn, -1, 1) };
}

/** Velocity the held keys ask for: cm/s along and across the bearing, deg/s of turn. Shift strides. */
export function walkTargetVelocity(intent, run = false) {
  const speed = run ? RUN_SPEED : WALK_SPEED;
  const of = (axis) => (isFiniteNumber(intent?.[axis]) ? clamp(intent[axis], -1, 1) * speed[axis] : 0);
  return { forward: of('forward'), strafe: of('strafe'), turn: of('turn') };
}

/**
 * Eases each velocity axis toward its target, first order: tau 0.11 s while
 * speeding up, 0.09 s while slowing, stopping or reversing. Exact for the
 * frame, so 60, 120 and 240 Hz trace the same ramp.
 */
export function rampWalkVelocity(velocity, target, dt) {
  const next = {};
  for (const axis of VELOCITY_AXES) {
    const v = isFiniteNumber(velocity?.[axis]) ? velocity[axis] : 0;
    const t = isFiniteNumber(target?.[axis]) ? target[axis] : 0;
    const speeding = t !== 0 && Math.sign(t) === Math.sign(v || t) && Math.abs(t) >= Math.abs(v);
    next[axis] = approach(v, t, 1 / (speeding ? WALK_ACCEL_TAU_S : WALK_DECEL_TAU_S), dt);
  }
  return next;
}

/**
 * Moves a plan point by (dx, dz): the wall buffer clamps, and a move into the
 * furniture footprint slides along its edge, axis by axis, as stepWalk does.
 */
function slideWalk(pose, room, dx, dz, zone) {
  const b = walkBounds(room);
  let x = clamp(pose.xCm + dx, b.x0, b.x1);
  let z = clamp(pose.zCm + dz, b.z0, b.z1);
  if (blocked(x, z, zone)) {
    if (!blocked(x, pose.zCm, zone)) z = pose.zCm <= zone.z0 ? zone.z0 : zone.z1;
    else if (!blocked(pose.xCm, z, zone)) x = pose.xCm <= zone.x0 ? zone.x0 : zone.x1;
    else {
      x = pose.xCm;
      z = pose.zCm;
    }
  }
  return { xCm: x, zCm: z };
}

/**
 * One frame of continuous walking. `velocity` is cm/s along (`forward`) and
 * across (`strafe`) the bearing and deg/s of `turn`; the bearing turns first,
 * then the body moves along it. The wall buffer and the furniture footprint
 * act as in stepWalk, so the observer slides along a sofa instead of
 * stopping dead. Nothing is rounded and the bearing is not folded: the
 * stance commits rounded once, when the walk ends. `zone` may pass a
 * precomputed furnitureZone for the room.
 */
export function stepContinuousWalk(pose, room, velocity, dt, zone = furnitureZone(room)) {
  const step = isFiniteNumber(dt) && dt > 0 ? dt : 0;
  const rate = (axis) => (isFiniteNumber(velocity?.[axis]) ? velocity[axis] : 0);
  const headingDeg = pose.headingDeg + rate('turn') * step;
  const h = headingDeg * DEG;
  const f = rate('forward') * step;
  const s = rate('strafe') * step;
  const moved = slideWalk(pose, room, Math.sin(h) * f + Math.cos(h) * s, -Math.cos(h) * f + Math.sin(h) * s, zone);
  return { ...pose, ...moved, headingDeg };
}

/**
 * Where a released walk comes to rest. `world` is the plan velocity of the
 * last frame (vx, vz in cm/s, vh in deg/s); decaying at WALK_DECEL_TAU_S it
 * carries the stance v x tau further, through the same wall and furniture
 * rules. The bearing stays unfolded, like stepContinuousWalk.
 */
export function coastWalk(pose, room, world, zone = furnitureZone(room)) {
  const rate = (key) => (isFiniteNumber(world?.[key]) ? world[key] : 0);
  const moved = slideWalk(pose, room, rate('vx') * WALK_DECEL_TAU_S, rate('vz') * WALK_DECEL_TAU_S, zone);
  return { ...pose, ...moved, headingDeg: pose.headingDeg + rate('vh') * WALK_DECEL_TAU_S };
}

/**
 * Commits a live stance: any finite xCm, zCm, headingDeg or pitchDeg in
 * `patch` replaces the walk's own, then the stance is folded, rounded to
 * 0.1 and pulled clear of the walls and the furniture like any other.
 */
export function placeWalk(walk, room, patch) {
  const source = patch !== null && typeof patch === 'object' ? patch : {};
  const pick = (key) => (isFiniteNumber(source[key]) ? source[key] : walk[key]);
  return resolveStance(
    {
      xCm: pick('xCm'),
      zCm: pick('zCm'),
      headingDeg: normalizeHeading(pick('headingDeg')),
      pitchDeg: tenth(clamp(pick('pitchDeg'), LOOK_PITCH.min, LOOK_PITCH.max)),
    },
    room,
  );
}

export function lookWalk(walk, headingDeg, pitchDeg) {
  return {
    ...walk,
    headingDeg: normalizeHeading(headingDeg),
    pitchDeg: tenth(clamp(pitchDeg, LOOK_PITCH.min, LOOK_PITCH.max)),
  };
}

export function eyePosition(walk) {
  return [walk.xCm, EYE_HEIGHT_CM, walk.zCm];
}

/** The wall the gaze meets first in plan, from where the observer stands. */
export function facingWall(walk, room) {
  const h = walk.headingDeg * DEG;
  const dx = Math.sin(h);
  const dz = -Math.cos(h);
  const hits = [
    ['north', dz < -1e-9 ? -walk.zCm / dz : Infinity],
    ['east', dx > 1e-9 ? (room.widthCm - walk.xCm) / dx : Infinity],
    ['south', dz > 1e-9 ? (room.depthCm - walk.zCm) / dz : Infinity],
    ['west', dx < -1e-9 ? -walk.xCm / dx : Infinity],
  ];
  let best = hits[0];
  for (const hit of hits) if (hit[1] < best[1] - 1e-9) best = hit;
  return best[0];
}

/**
 * Vertical illuminance at the eye on the plane facing the gaze: the direct
 * light of every lit module ahead of the observer plus the room's uniform
 * inter-reflected component.
 */
export function eyeIlluminance(state, walk) {
  const sources = luminousSources(state.items, state.room);
  const direct = planePointLux(sources, eyePosition(walk), lookDirection(walk.headingDeg, walk.pitchDeg));
  return Math.round(direct + computeEnvironmentalPhysics(state).reflectedLux);
}

/**
 * Wall Elevation lens: dead-on and level with the middle of `wall`, far
 * enough back that the whole wall fits the frame. Positions in room cm.
 */
export function elevationCamera(room, wall, aspect = 1.6) {
  const id = sanitizeWallId(wall);
  const span = wallSpanCm(room, id);
  const height = room.heightCm;
  const safeAspect = isFiniteNumber(aspect) && aspect > 0 ? aspect : 1.6;
  const tan = Math.tan((ELEVATION_FOV_DEG / 2) * DEG);
  const distance = Math.max((height / 2) * ELEVATION_MARGIN / tan, (span / 2) * ELEVATION_MARGIN / (tan * safeAspect));
  return {
    wall: id,
    fov: ELEVATION_FOV_DEG,
    distanceCm: Math.round(distance),
    target: wallToRoom(room, id, [span / 2, height / 2, 0]),
    position: wallToRoom(room, id, [span / 2, height / 2, distance]),
  };
}

