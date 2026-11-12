import { getProduct } from '../data/products.js';
import { isOneOf } from '../security/sanitize.js';
import { isRoomWall, wallSpanCm } from './room-walls.js';

/*
 * Ray to wall-plane solver for direct manipulation in the 3D room.
 *
 * Room frame, in cm: X along the north wall, Y up from the floor, Z from the
 * north wall toward the south wall. Each wall is solved in its own elevation
 * frame, the one room-walls.js and the Wall Studio use: u runs along the wall
 * from its left corner as seen from inside the room, v is height above the
 * floor. Pure and deterministic, so the same math runs in Node and in the
 * viewport.
 */

export const GRID_SNAP_CM = 5;
export const FREE_SNAP_CM = 1;
export const AXIS_LOCKS = Object.freeze(['free', 'x', 'y']);
export const AXIS_LOCK_LABELS = Object.freeze({ free: 'Free XY', x: 'Lock X Horizontal', y: 'Lock Y Vertical' });

const EPSILON = 1e-9;

// Interior plane per wall: the room axis it is normal to, where it sits, the
// sign of its inward normal and the u coordinate of a point on it.
const PLANES = Object.freeze({
  north: { axis: 2, at: () => 0, inward: 1, u: (p) => p[0] },
  east: { axis: 0, at: (W) => W, inward: -1, u: (p) => p[2] },
  south: { axis: 2, at: (W, D) => D, inward: -1, u: (p, W) => W - p[0] },
  west: { axis: 0, at: () => 0, inward: 1, u: (p, W, D) => D - p[2] },
});

function isVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every((c) => typeof c === 'number' && Number.isFinite(c));
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const clean = (value) => (Object.is(value, -0) ? 0 : value);
const fixed = (value) => clean(Number(value.toFixed(6)));

/** Width and height of a wall item: explicit wCm / hCm, w / h, or its product's dims. */
export function itemSize(item) {
  if (isFiniteNumber(item?.wCm) && isFiniteNumber(item?.hCm)) return { w: item.wCm, h: item.hCm };
  if (isFiniteNumber(item?.w) && isFiniteNumber(item?.h)) return { w: item.w, h: item.h };
  const dims = getProduct(item?.productId)?.dimsCm;
  return dims ? { w: dims.w, h: dims.h } : { w: 0, h: 0 };
}

/**
 * Intersects a room-frame ray with the interior plane of a wall: north at
 * Z = 0, east at X = W, south at Z = D, west at X = 0. `offsetCm` pushes the
 * plane into the room, so a drag can run on a module's front face. Returns
 * the hit in room cm and in wall-local (uCm, vCm), or null when the ray runs
 * parallel to the plane or points away from it.
 */
export function intersectRayWithWall(rayOrigin, rayDir, wallId, roomDims, offsetCm = 0) {
  if (!isVector(rayOrigin) || !isVector(rayDir) || !isRoomWall(wallId)) return null;
  const W = roomDims?.widthCm;
  const D = roomDims?.depthCm;
  const H = roomDims?.heightCm;
  if (![W, D, H].every((value) => isFiniteNumber(value) && value > 0)) return null;

  const plane = PLANES[wallId];
  const offset = isFiniteNumber(offsetCm) ? offsetCm : 0;
  const level = plane.at(W, D) + plane.inward * offset;
  const denom = rayDir[plane.axis];
  if (Math.abs(denom) < EPSILON) return null;
  const t = (level - rayOrigin[plane.axis]) / denom;
  if (!(t > EPSILON)) return null;

  const point = rayOrigin.map((c, i) => c + rayDir[i] * t);
  point[plane.axis] = level;
  const uCm = plane.u(point, W, D);
  const vCm = point[1];
  const span = wallSpanCm({ widthCm: W, depthCm: D }, wallId);
  return {
    wall: wallId,
    t: fixed(t),
    point: point.map(fixed),
    uCm: fixed(uCm),
    vCm: fixed(vCm),
    inside: uCm >= 0 && uCm <= span && vCm >= 0 && vCm <= H,
  };
}

/** Grab offset between a hit and the item's bottom-left anchor, so a module never jumps on pick-up. */
export function grabOffset(hit, item) {
  return {
    grabOffsetUCm: fixed((hit?.uCm ?? 0) - (item?.xCm ?? 0)),
    grabOffsetVCm: fixed((hit?.vCm ?? 0) - (item?.yCm ?? 0)),
  };
}

export function sanitizeAxisLock(value) {
  return isOneOf(value, AXIS_LOCKS) ? value : 'free';
}

function sanitizeSnap(value) {
  return isFiniteNumber(value) && value >= FREE_SNAP_CM ? value : FREE_SNAP_CM;
}

function quantize(value, step) {
  return clean(Math.round(value / step) * step);
}

/** Axis-aligned overlap of two wall rects { xCm, yCm, w, h }; touching edges do not overlap. */
export function rectsOverlap(a, b) {
  return a.xCm < b.xCm + b.w && b.xCm < a.xCm + a.w && a.yCm < b.yCm + b.h && b.yCm < a.yCm + a.h;
}

/**
 * Turns a wall-plane hit into a module position. The grab offset comes off
 * first; an axis lock holds the other coordinate ('x' slides along the wall,
 * 'y' only changes height); the result snaps to `snapCm` and is clamped to
 * [0, span - w] x [0, height - h], so the module never leaves the wall.
 * `obstacles` (other rects on the same wall) only flag a collision.
 */
export function solveWallDragPosition({
  hitUCm,
  hitVCm,
  grabOffsetUCm = 0,
  grabOffsetVCm = 0,
  item,
  wallSpanCm: span,
  wallHeightCm: height,
  snapCm = GRID_SNAP_CM,
  axisLock = 'free',
  obstacles = [],
}) {
  const { w, h } = itemSize(item);
  const lock = sanitizeAxisLock(axisLock);
  const snap = sanitizeSnap(snapCm);
  const maxX = Math.max(0, (isFiniteNumber(span) ? span : 0) - w);
  const maxY = Math.max(0, (isFiniteNumber(height) ? height : 0) - h);
  const fromX = isFiniteNumber(item?.xCm) ? item.xCm : 0;
  const fromY = isFiniteNumber(item?.yCm) ? item.yCm : 0;

  const rawX = (isFiniteNumber(hitUCm) ? hitUCm : fromX) - (isFiniteNumber(grabOffsetUCm) ? grabOffsetUCm : 0);
  const rawY = (isFiniteNumber(hitVCm) ? hitVCm : fromY) - (isFiniteNumber(grabOffsetVCm) ? grabOffsetVCm : 0);
  const wantX = lock === 'y' ? fromX : quantize(rawX, snap);
  const wantY = lock === 'x' ? fromY : quantize(rawY, snap);
  const xCm = Math.round(clamp(wantX, 0, maxX));
  const yCm = Math.round(clamp(wantY, 0, maxY));
  const rect = { xCm, yCm, w, h };

  return {
    xCm,
    yCm,
    axisLock: lock,
    snapCm: snap,
    clampedX: xCm !== Math.round(wantX),
    clampedY: yCm !== Math.round(wantY),
    moved: xCm !== fromX || yCm !== fromY,
    collides: Array.isArray(obstacles) && obstacles.some((other) => rectsOverlap(rect, other)),
  };
}

/** One keyboard or nudge-pad step: to the next snap line in the given direction, then clamped. */
export function nudgeWallPosition({ item, dxSteps = 0, dySteps = 0, wallSpanCm: span, wallHeightCm: height, snapCm = GRID_SNAP_CM }) {
  const snap = sanitizeSnap(snapCm);
  const step = (value, dir) => {
    if (dir > 0) return Math.floor(value / snap + EPSILON) * snap + snap * dir;
    if (dir < 0) return Math.ceil(value / snap - EPSILON) * snap + snap * dir;
    return value;
  };
  const sign = (value) => (isFiniteNumber(value) ? Math.sign(value) : 0);
  return solveWallDragPosition({
    hitUCm: step(item.xCm, sign(dxSteps)),
    hitVCm: step(item.yCm, sign(dySteps)),
    item,
    wallSpanCm: span,
    wallHeightCm: height,
    snapCm: FREE_SNAP_CM,
  });
}

/** Laser dimensions from a wall position to the floor, both wall corners and the ceiling. */
export function liveDimensions({ item, xCm = item.xCm, yCm = item.yCm, wallSpanCm: span, wallHeightCm: height }) {
  const { w, h } = itemSize(item);
  return {
    floorCm: yCm,
    leftCm: xCm,
    rightCm: Math.max(0, span - (xCm + w)),
    ceilingCm: Math.max(0, height - (yCm + h)),
  };
}
