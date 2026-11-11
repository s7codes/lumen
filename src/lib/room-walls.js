import { isOneOf } from '../security/sanitize.js';

/*
 * Wall frames for the four-wall room. Room frame, in cm: X along the north
 * wall, Y up from the floor, Z from the north wall toward the south wall.
 *
 * Every wall carries its own elevation frame, the one the Wall Studio uses:
 * x runs along the wall from its left corner as seen from inside the room,
 * y up from the floor, z out from the wall into the room. Seen from above,
 * the four left corners chain clockwise into one unrolled perimeter: north
 * runs west to east, east runs north to south, south runs east to west and
 * west runs south to north.
 */

export const ROOM_WALLS = Object.freeze(['north', 'east', 'south', 'west']);
export const DEFAULT_ROOM_WALL = 'north';

export const WALL_LABELS = Object.freeze({
  north: 'North Wall',
  east: 'East Wall',
  south: 'South Wall',
  west: 'West Wall',
});

/** Rotation about +Y that turns a wall frame into the room frame. */
export const WALL_ROT_Y = Object.freeze({ north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 });

/** Orbit azimuth in degrees that looks squarely at each wall from the room's open side. */
export const WALL_HEADING = Object.freeze({ north: 0, east: -90, south: 180, west: 90 });

// Origin, along-wall unit vector and inward normal, as [x, z] pairs.
const FRAMES = Object.freeze({
  north: { origin: (W, D) => [0, 0], u: [1, 0], n: [0, 1] },
  east: { origin: (W, D) => [W, 0], u: [0, 1], n: [-1, 0] },
  south: { origin: (W, D) => [W, D], u: [-1, 0], n: [0, -1] },
  west: { origin: (W, D) => [0, D], u: [0, -1], n: [1, 0] },
});

export function isRoomWall(value) {
  return isOneOf(value, ROOM_WALLS);
}

export function sanitizeWallId(value) {
  return isRoomWall(value) ? value : DEFAULT_ROOM_WALL;
}

/** The wall a room item hangs on. A missing or unknown field reads as north. */
export function wallOf(item) {
  return sanitizeWallId(item?.wall);
}

/** The wall as an item field: present only off the north wall, like dimPct below 100. */
export function wallPatch(wall) {
  const id = sanitizeWallId(wall);
  return id === DEFAULT_ROOM_WALL ? {} : { wall: id };
}

/** Copy of `item` on `wall`, dropping the field for north. */
export function withWall(item, wall) {
  const { wall: _previous, ...rest } = item;
  return { ...rest, ...wallPatch(wall) };
}

/** Horizontal span of a wall: room width for north and south, depth for east and west. */
export function wallSpanCm(room, wall) {
  const id = sanitizeWallId(wall);
  return id === 'east' || id === 'west' ? room.depthCm : room.widthCm;
}

function frameOf(room, wall) {
  const f = FRAMES[sanitizeWallId(wall)];
  return { o: f.origin(room?.widthCm ?? 0, room?.depthCm ?? 0), u: f.u, n: f.n };
}

const clean = (value) => (Object.is(value, -0) ? 0 : value);

/** Room point for a wall-frame point [x along, y up, z out]. */
export function wallToRoom(room, wall, [a, y, b]) {
  const { o, u, n } = frameOf(room, wall);
  return [clean(o[0] + a * u[0] + b * n[0]), y, clean(o[1] + a * u[1] + b * n[1])];
}

/** Room direction for a wall-frame direction. */
export function wallDirToRoom(wall, [a, y, b]) {
  const { u, n } = frameOf(null, wall);
  return [clean(a * u[0] + b * n[0]), y, clean(a * u[1] + b * n[1])];
}

/** Wall-frame point for a room point. The frame is orthonormal, so the inverse is two dot products. */
export function roomToWall(room, wall, [x, y, z]) {
  const { o, u, n } = frameOf(room, wall);
  const dx = x - o[0];
  const dz = z - o[1];
  return [clean(dx * u[0] + dz * u[1]), y, clean(dx * n[0] + dz * n[1])];
}

function spanBox(p, q) {
  return {
    x0: Math.min(p[0], q[0]),
    x1: Math.max(p[0], q[0]),
    y0: Math.min(p[1], q[1]),
    y1: Math.max(p[1], q[1]),
    z0: Math.min(p[2], q[2]),
    z1: Math.max(p[2], q[2]),
  };
}

/** Room AABB of a wall-frame box. Quarter turns keep every box axis-aligned. */
export function boxToRoom(room, wall, box) {
  return spanBox(wallToRoom(room, wall, [box.x0, box.y0, box.z0]), wallToRoom(room, wall, [box.x1, box.y1, box.z1]));
}

/** Wall-frame AABB of a room box. */
export function boxToWall(room, wall, box) {
  return spanBox(roomToWall(room, wall, [box.x0, box.y0, box.z0]), roomToWall(room, wall, [box.x1, box.y1, box.z1]));
}

/** Where each wall's left corner sits along the unrolled perimeter, in cm. */
export function perimeterOffset(room, wall) {
  const { widthCm: W, depthCm: D } = room;
  switch (sanitizeWallId(wall)) {
    case 'east':
      return W;
    case 'south':
      return W + D;
    case 'west':
      return 2 * W + D;
    default:
      return 0;
  }
}

export function perimeterCm(room) {
  return 2 * (room.widthCm + room.depthCm);
}

/** Module count per wall, in ROOM_WALLS order. */
export function wallCounts(items) {
  const counts = Object.fromEntries(ROOM_WALLS.map((wall) => [wall, 0]));
  for (const item of Array.isArray(items) ? items : []) counts[wallOf(item)] += 1;
  return counts;
}
