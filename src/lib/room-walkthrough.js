import { isOneOf } from '../security/sanitize.js';
import { luminousSources, planePointLux } from './illuminance-field.js';
import { furnitureLayout } from './room-3d.js';
import { computeEnvironmentalPhysics } from './room-physics.js';
import { sanitizeWallId, wallSpanCm, wallToRoom } from './room-walls.js';

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
export const LOOK_PITCH = Object.freeze({ min: -40, max: 40 });
export const INSIDE_FOV_DEG = 64;
export const ELEVATION_FOV_DEG = 30;
const ELEVATION_MARGIN = 1.14;
const DEG = Math.PI / 180;

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

/** The opening stance: near the room centre, a little toward the south wall, facing `wall`. */
export function defaultStance(room, wall = 'north') {
  return resolveStance(
    {
      xCm: room.widthCm / 2,
      zCm: room.depthCm * 0.55,
      headingDeg: WALL_LOOK_HEADING[sanitizeWallId(wall)],
      pitchDeg: 0,
    },
    room,
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

