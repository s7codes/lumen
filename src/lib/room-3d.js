import { getProduct, productHasFinish } from '../data/products.js';
import { isOneOf, safeStorage } from '../security/sanitize.js';
import { dimPatch, recordChanged, sanitizeDimPct, withDimPct } from './dimming.js';
import {
  boxToRoom,
  boxToWall,
  DEFAULT_ROOM_WALL,
  isRoomWall,
  perimeterCm,
  perimeterOffset,
  ROOM_WALLS,
  sanitizeWallId,
  wallOf,
  wallPatch,
  wallSpanCm,
  wallToRoom,
  withWall,
} from './room-walls.js';
import {
  clampToWall,
  createLayout,
  findConflicts,
  findFreeSpot,
  layoutFromPreset,
  loadLayout,
  MAX_WALL_ITEMS,
  nextUid,
  persistLayout,
  preferredSpot,
  sanitizeItems,
  sanitizeWall,
} from './wall-studio.js';

export {
  DEFAULT_ROOM_WALL,
  isRoomWall,
  ROOM_WALLS,
  sanitizeWallId,
  WALL_HEADING,
  WALL_LABELS,
  wallCounts,
  wallOf,
  wallSpanCm,
} from './room-walls.js';

export const ROOM_STORAGE_KEY = 'lumen_room_3d_v1';
export const ROOM_FORMAT = 'lumen.room3d';
export const ROOM_VERSION = 1;

export const ROOM_WIDTH = Object.freeze({ min: 240, max: 500, initial: 320 });
export const ROOM_DEPTH = Object.freeze({ min: 200, max: 450, initial: 280 });
export const ROOM_HEIGHT = Object.freeze({ min: 220, max: 320, initial: 250 });
export const CAMERA_YAW = Object.freeze({ min: -65, max: 65 });
export const CAMERA_PITCH = Object.freeze({ min: 8, max: 50 });
export const CAMERA_ZOOM = Object.freeze({ min: 0.6, max: 1.8 });
export const IMPORT_FALLBACK_PRESET = 'nordic-reading-wall';

export const LIGHTING_MODES = Object.freeze([
  { id: 'night', label: 'Night Ambient (2700K)', surface: 'ambient' },
  { id: 'daylight', label: 'Daylight Studio', surface: 'daylight' },
]);
const LIGHTING_IDS = LIGHTING_MODES.map((mode) => mode.id);

// Yaw is measured from the active wall's heading, so every preset and limit
// applies to whichever wall the planner is facing.
export const DEFAULT_CAMERA = Object.freeze({ yaw: -24, pitch: 24, zoom: 1 });

export const CAMERA_PRESETS = Object.freeze([
  { id: 'perspective', label: 'Perspective', camera: Object.freeze({ yaw: -34, pitch: 14, zoom: 1.25 }) },
  { id: 'front', label: 'Front Elevation', camera: Object.freeze({ yaw: 0, pitch: 8, zoom: 1.1 }) },
  { id: 'corner', label: 'Corner Iso', camera: Object.freeze({ yaw: 45, pitch: 35.3, zoom: 0.95 }) },
]);

export const DEFAULT_ROOM = Object.freeze({
  widthCm: ROOM_WIDTH.initial,
  depthCm: ROOM_DEPTH.initial,
  heightCm: ROOM_HEIGHT.initial,
  furniture: 'none',
  lighting: 'night',
});


// Furniture stands this far off the main wall, so a module shallower than the
// gap (an art frame) can hang behind a sofa back without touching it.
const FURNITURE_WALL_GAP_CM = 6;
const MAX_SCANNED_ENTRIES = 256;

function part(id, tone, x, y, z, w, h, d) {
  return { id, tone, x, y, z, w, h, d };
}

/**
 * Reference furniture in its own frame: x from the left end, y up from the
 * floor, z out from the wall. `minHeadroomCm` is the clear height a wall
 * module above it should keep (sitting up in bed, a monitor, a head on a
 * sofa back).
 */
export const FURNITURE = Object.freeze([
  { id: 'none', label: 'None' },
  {
    id: 'bed-160',
    label: 'Low Platform Bed 160cm',
    w: 160,
    d: 206,
    minHeadroomCm: 60,
    parts: [
      part('plinth', 'shadow', 6, 0, 6, 148, 8, 194),
      part('frame', 'oak', 0, 8, 0, 160, 16, 206),
      part('mattress', 'linen', 3, 24, 3, 154, 18, 200),
      part('pillow-left', 'linen-hi', 12, 42, 8, 62, 10, 36),
      part('pillow-right', 'linen-hi', 86, 42, 8, 62, 10, 36),
    ],
  },
  {
    id: 'desk-140',
    label: 'Architect Desk 140cm',
    w: 140,
    d: 70,
    minHeadroomCm: 40,
    parts: [
      part('trestle-left', 'steel', 8, 0, 6, 4, 71, 58),
      part('trestle-right', 'steel', 128, 0, 6, 4, 71, 58),
      part('rail', 'steel', 12, 58, 8, 116, 6, 2),
      part('top', 'oak', 0, 71, 0, 140, 3, 70),
    ],
  },
  {
    id: 'sofa-200',
    label: 'Modular Sofa 200cm',
    w: 200,
    d: 92,
    minHeadroomCm: 30,
    parts: [
      part('plinth', 'shadow', 6, 0, 6, 188, 6, 80),
      part('base', 'felt', 0, 6, 0, 200, 34, 92),
      part('back', 'felt-hi', 18, 40, 0, 164, 38, 20),
      part('seat-left', 'felt-hi', 18, 40, 20, 82, 10, 72),
      part('seat-right', 'felt-hi', 100, 40, 20, 82, 10, 72),
      part('arm-left', 'felt', 0, 40, 0, 18, 22, 92),
      part('arm-right', 'felt', 182, 40, 0, 18, 22, 92),
    ],
  },
]);

const FURNITURE_BY_ID = new Map(FURNITURE.map((entry) => [entry.id, entry]));
const FURNITURE_IDS = FURNITURE.map((entry) => entry.id);

export function getFurniture(id) {
  return typeof id === 'string' ? (FURNITURE_BY_ID.get(id) ?? null) : null;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampRange(value, range, fallback = range.initial) {
  if (!isFiniteNumber(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, value));
}

function roundTo(value, step) {
  return Math.round(value / step) * step;
}


/* Envelope, camera and wall adapter */

export function sanitizeRoom(input) {
  const source = isRecord(input) ? input : {};
  return {
    widthCm: Math.round(clampRange(source.widthCm, ROOM_WIDTH)),
    depthCm: Math.round(clampRange(source.depthCm, ROOM_DEPTH)),
    heightCm: Math.round(clampRange(source.heightCm, ROOM_HEIGHT)),
    furniture: isOneOf(source.furniture, FURNITURE_IDS) ? source.furniture : DEFAULT_ROOM.furniture,
    lighting: isOneOf(source.lighting, LIGHTING_IDS) ? source.lighting : DEFAULT_ROOM.lighting,
  };
}

/** Yaw and pitch keep 0.1 deg, zoom keeps 0.01, so stored and rendered values agree. */
export function sanitizeCamera(input) {
  const source = isRecord(input) ? input : {};
  return {
    yaw: Number(roundTo(clampRange(source.yaw, CAMERA_YAW, DEFAULT_CAMERA.yaw), 0.1).toFixed(1)),
    pitch: Number(roundTo(clampRange(source.pitch, CAMERA_PITCH, DEFAULT_CAMERA.pitch), 0.1).toFixed(1)),
    zoom: Number(roundTo(clampRange(source.zoom, CAMERA_ZOOM, DEFAULT_CAMERA.zoom), 0.01).toFixed(2)),
  };
}

export function sameCamera(a, b) {
  return a.yaw === b.yaw && a.pitch === b.pitch && a.zoom === b.zoom;
}

export function activePreset(camera) {
  return CAMERA_PRESETS.find((preset) => sameCamera(sanitizeCamera(preset.camera), camera))?.id ?? null;
}

/**
 * One wall of the room seen as a Wall Studio wall: north and south span the
 * room width, east and west its depth. The room has a flat ceiling.
 */
export function roomWall(room, wall = DEFAULT_ROOM_WALL) {
  return {
    widthCm: wallSpanCm(room, wall),
    heightCm: room.heightCm,
    slope: false,
    snap: false,
    surface: room.lighting === 'daylight' ? 'daylight' : 'ambient',
  };
}

export function createRoomState(room = DEFAULT_ROOM, items = [], camera = DEFAULT_CAMERA) {
  return {
    format: ROOM_FORMAT,
    version: ROOM_VERSION,
    room: sanitizeRoom(room),
    camera: sanitizeCamera(camera),
    items,
  };
}

/*
 * Geometry, in cm. A module box is in its wall frame: x along the wall, y up
 * from the floor, z out into the room. Room boxes are in the room frame: X
 * along the north wall, Y up, Z toward the south wall.
 */

export function moduleBox(item) {
  const { w, h, d } = getProduct(item.productId).dimsCm;
  return { x0: item.xCm, x1: item.xCm + w, y0: item.yCm, y1: item.yCm + h, z0: 0, z1: d };
}

export function moduleRoomBox(item, room) {
  return boxToRoom(room, wallOf(item), moduleBox(item));
}

export function boxesIntersect(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1 && a.z0 < b.z1 && b.z0 < a.z1;
}

/** Furniture placed centred on the north wall, pulled forward only as far as the room allows. */
export function furnitureLayout(room) {
  const spec = getFurniture(room.furniture);
  if (!spec || !spec.parts) return null;

  const x0 = Math.round((room.widthCm - spec.w) / 2);
  const z0 = Math.max(0, Math.min(FURNITURE_WALL_GAP_CM, room.depthCm - spec.d));
  const parts = spec.parts.map((p) => ({
    id: p.id,
    tone: p.tone,
    box: {
      x0: x0 + p.x,
      x1: x0 + p.x + p.w,
      y0: p.y,
      y1: p.y + p.h,
      z0: z0 + p.z,
      z1: Math.min(room.depthCm, z0 + p.z + p.d),
    },
  }));
  const bounds = parts.reduce(
    (acc, { box }) => ({
      x0: Math.min(acc.x0, box.x0),
      x1: Math.max(acc.x1, box.x1),
      y0: Math.min(acc.y0, box.y0),
      y1: Math.max(acc.y1, box.y1),
      z0: Math.min(acc.z0, box.z0),
      z1: Math.max(acc.z1, box.z1),
    }),
    { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity },
  );
  return { id: spec.id, label: spec.label, minHeadroomCm: spec.minHeadroomCm, parts, bounds };
}

function itemsOn(items, wall) {
  return items.filter((item) => wallOf(item) === wall);
}

/**
 * Elevation rects, in `wall`'s frame, of every volume a part `depthCm` deep
 * would actually reach there: furniture parts, and modules on the other walls
 * that meet this one at a corner.
 */
function wallObstacles(state, wall, depthCm) {
  const { room } = state;
  const volumes = [];
  const furniture = furnitureLayout(room);
  if (furniture) for (const p of furniture.parts) volumes.push(p.box);
  for (const item of state.items) {
    if (wallOf(item) !== wall) volumes.push(moduleRoomBox(item, room));
  }
  return volumes
    .map((box) => boxToWall(room, wall, box))
    .filter((box) => depthCm > box.z0 && box.z1 > 0)
    .map((box) => ({ x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 }));
}

function conflictEntry(conflicts, uid) {
  if (!conflicts.has(uid)) conflicts.set(uid, { overlaps: [], slope: false, bounds: false, furniture: false });
  return conflicts.get(uid);
}

/**
 * Wall Studio conflicts (overlap, bounds) wall by wall, a true 3D AABB test
 * between modules on different walls that meet in a corner, and a 3D AABB
 * test of every module against the furniture volumes.
 */
export function findRoomConflicts(state) {
  const { room, items } = state;
  const conflicts = new Map();
  for (const wall of ROOM_WALLS) {
    const onWall = itemsOn(items, wall);
    if (onWall.length === 0) continue;
    for (const [uid, entry] of findConflicts(createLayout(roomWall(room, wall), onWall))) {
      conflicts.set(uid, { ...entry, furniture: false });
    }
  }

  const volumes = items.map((item) => ({ item, wall: wallOf(item), box: moduleRoomBox(item, room) }));
  for (let i = 0; i < volumes.length; i += 1) {
    for (let j = i + 1; j < volumes.length; j += 1) {
      const a = volumes[i];
      const b = volumes[j];
      if (a.wall === b.wall || !boxesIntersect(a.box, b.box)) continue;
      conflictEntry(conflicts, a.item.uid).overlaps.push(b.item.uid);
      conflictEntry(conflicts, b.item.uid).overlaps.push(a.item.uid);
    }
  }

  const furniture = furnitureLayout(room);
  if (furniture) {
    for (const { item, box } of volumes) {
      if (furniture.parts.some((p) => boxesIntersect(box, p.box))) conflictEntry(conflicts, item.uid).furniture = true;
    }
  }
  return conflicts;
}

/* Clearances */

function overlapSpan(a0, a1, b0, b1) {
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  return hi > lo ? { lo, hi } : null;
}

/**
 * Dimensioned clearances for the technical overlay. Each callout is a 3D
 * segment in room cm with a label and a tone ('ok' or 'tight'). Headroom is
 * read on the north wall, the one the reference furniture backs onto.
 */
export function clearanceCallouts(state, selectedUid = null) {
  const { room, items } = state;
  const callouts = [];
  const furniture = furnitureLayout(room);

  if (furniture) {
    const { bounds, minHeadroomCm } = furniture;
    const walkway = Math.max(0, room.depthCm - bounds.z1);
    const x = Math.min(room.widthCm - 12, bounds.x1 + 14);
    callouts.push({
      id: 'walkway',
      label: `Walkway ${walkway} cm`,
      valueCm: walkway,
      tone: walkway >= 60 ? 'ok' : 'tight',
      from: [x, 0, bounds.z1],
      to: [x, 0, room.depthCm],
    });

    let lowest = null;
    for (const item of items) {
      if (wallOf(item) !== DEFAULT_ROOM_WALL) continue;
      const box = moduleBox(item);
      const span = overlapSpan(box.x0, box.x1, bounds.x0, bounds.x1);
      if (!span || box.y0 < bounds.y1) continue;
      const gap = box.y0 - bounds.y1;
      if (!lowest || gap < lowest.gap) lowest = { gap, x: (span.lo + span.hi) / 2, item };
    }
    if (lowest) {
      callouts.push({
        id: 'headroom',
        label: `Headroom ${lowest.gap} cm`,
        valueCm: lowest.gap,
        tone: lowest.gap >= minHeadroomCm ? 'ok' : 'tight',
        uid: lowest.item.uid,
        from: [lowest.x, bounds.y1, 3],
        to: [lowest.x, lowest.item.yCm, 3],
      });
    }
  }

  const selected = items.find((item) => item.uid === selectedUid);
  if (selected) {
    const box = moduleBox(selected);
    const at = (point) => wallToRoom(room, wallOf(selected), point);
    const x = (box.x0 + box.x1) / 2;
    const z = box.z1 + 2;
    const ceiling = room.heightCm - box.y1;
    callouts.push({
      id: 'floor',
      label: `FFL +${selected.yCm} cm`,
      valueCm: selected.yCm,
      tone: 'ok',
      uid: selected.uid,
      from: at([x, 0, z]),
      to: at([x, box.y0, z]),
    });
    callouts.push({
      id: 'ceiling',
      label: `Ceiling ${ceiling} cm`,
      valueCm: ceiling,
      tone: 'ok',
      uid: selected.uid,
      from: at([x, box.y1, z]),
      to: at([x, room.heightCm, z]),
    });
  }

  return callouts.filter((callout) => callout.valueCm > 0);
}

/* Edits. Each returns the same state object when nothing changes. */

function pullInside(items, room) {
  let changed = false;
  const next = items.map((item) => {
    const spot = clampToWall(getProduct(item.productId), roomWall(room, wallOf(item)), item.xCm, item.yCm);
    if (spot.xCm === item.xCm && spot.yCm === item.yCm) return item;
    changed = true;
    return { ...item, ...spot };
  });
  return changed ? next : items;
}

export function updateRoom(state, patch) {
  const room = sanitizeRoom({ ...state.room, ...(isRecord(patch) ? patch : {}) });
  if (Object.keys(room).every((key) => room[key] === state.room[key])) return state;
  return { ...state, room, items: pullInside(state.items, room) };
}

export function updateCamera(state, camera) {
  const next = sanitizeCamera(camera);
  return sameCamera(next, state.camera) ? state : { ...state, camera: next };
}

/**
 * Mounts a part on `wall` (north by default) at the first clear spot near
 * its natural height, keeping clear of the other modules on that wall, of
 * modules meeting it at the corners and of the furniture it would reach.
 */
export function mountInRoom(state, productId, wall = DEFAULT_ROOM_WALL) {
  const product = getProduct(productId);
  if (!product || state.items.length >= MAX_WALL_ITEMS) return null;

  const wallId = sanitizeWallId(wall);
  const surface = roomWall(state.room, wallId);
  const layout = createLayout(surface, itemsOn(state.items, wallId));
  const obstacles = wallObstacles(state, wallId, product.dimsCm.d);
  const free = findFreeSpot(layout, product, preferredSpot(product, surface), obstacles);
  const fallback = preferredSpot(product, surface);
  const spot = free ?? clampToWall(product, surface, Math.round(fallback.x), Math.round(fallback.y));
  const item = {
    uid: nextUid(state.items),
    productId: product.id,
    finish: product.defaultFinish,
    xCm: spot.xCm,
    yCm: spot.yCm,
    led: product.watts > 0,
    ...wallPatch(wallId),
  };
  return { state: { ...state, items: [...state.items, item] }, item, clear: free !== null, wall: wallId };
}

/** Rehangs a module on another wall at the clear spot nearest to (x, y) there. */
function moveToWall(state, item, product, wall, x, y) {
  const rest = { ...state, items: state.items.filter((entry) => entry.uid !== item.uid) };
  const surface = roomWall(state.room, wall);
  const near = clampToWall(product, surface, Math.round(x), Math.round(y));
  const layout = createLayout(surface, itemsOn(rest.items, wall));
  const free = findFreeSpot(layout, product, { x: near.xCm, y: near.yCm }, wallObstacles(rest, wall, product.dimsCm.d));
  return withWall({ ...item, ...(free ?? near) }, wall);
}

export function updateRoomItem(state, uid, patch) {
  const index = state.items.findIndex((item) => item.uid === uid);
  if (index === -1 || !isRecord(patch)) return state;

  const current = state.items[index];
  const product = getProduct(current.productId);
  let next = { ...current };
  if (productHasFinish(product, patch.finish)) next.finish = patch.finish;
  if (typeof patch.led === 'boolean' && product.watts > 0) next.led = patch.led;
  if (isFiniteNumber(patch.dimPct) && product.watts > 0) next = withDimPct(next, sanitizeDimPct(patch.dimPct));
  const x = isFiniteNumber(patch.xCm) ? patch.xCm : current.xCm;
  const y = isFiniteNumber(patch.yCm) ? patch.yCm : current.yCm;
  if (isRoomWall(patch.wall) && patch.wall !== wallOf(current)) {
    next = moveToWall(state, next, product, patch.wall, x, y);
  } else if (isFiniteNumber(patch.xCm) || isFiniteNumber(patch.yCm)) {
    Object.assign(next, clampToWall(product, roomWall(state.room, wallOf(current)), Math.round(x), Math.round(y)));
  }

  if (!recordChanged(next, current)) return state;
  return { ...state, items: state.items.map((item, i) => (i === index ? next : item)) };
}

export function removeRoomItem(state, uid) {
  const items = state.items.filter((item) => item.uid !== uid);
  return items.length === state.items.length ? state : { ...state, items };
}

/** Takes every module off one wall; the other walls stay as they are. */
export function clearRoomWall(state, wall) {
  const id = sanitizeWallId(wall);
  const items = state.items.filter((item) => wallOf(item) !== id);
  return items.length === state.items.length ? state : { ...state, items };
}

/**
 * The four walls unrolled into one elevation, north first and clockwise,
 * for wall-based engines such as the 24V daisy-chain: a run crossing a
 * corner keeps its true length. A north-only room is returned as it is.
 */
export function unrolledRoom(state) {
  const { room, items } = state;
  if (items.every((item) => wallOf(item) === DEFAULT_ROOM_WALL)) return state;
  return {
    ...state,
    room: { ...room, widthCm: perimeterCm(room) },
    items: items.map((item) => {
      const offset = perimeterOffset(room, wallOf(item));
      return offset === 0 ? item : { ...item, xCm: item.xCm + offset };
    }),
  };
}

/* Untrusted input */

function stripLock({ uid, productId, finish, xCm, yCm, led, dimPct, wall }) {
  return { uid, productId, finish, xCm, yCm, led, ...dimPatch(getProduct(productId), dimPct), ...wallPatch(wall) };
}

/**
 * Rebuilds a room from untrusted data. Returns null unless the envelope is a
 * Lumen 3D room. Dimensions, furniture, lighting and camera are clamped or
 * reset; modules pass the same per-entry rules as Wall Studio layouts, each
 * clamped to its own wall. A missing or unknown wall reads as north.
 */
export function sanitizeRoomState(input) {
  if (!isRecord(input) || input.format !== ROOM_FORMAT || input.version !== ROOM_VERSION) return null;
  if (!Array.isArray(input.items)) return null;

  const room = sanitizeRoom(input.room);
  const items = sanitizeItems(input.items.slice(0, MAX_SCANNED_ENTRIES), roomWall(room), {
    wallFor: (entry) => roomWall(room, entry.wall),
    extend: (entry) => wallPatch(entry.wall),
  }).map(stripLock);
  return createRoomState(room, items, input.camera);
}

export function serializeRoomState(state) {
  return {
    format: ROOM_FORMAT,
    version: ROOM_VERSION,
    room: { ...state.room },
    camera: { ...state.camera },
    items: state.items.map(stripLock),
  };
}

export function loadRoomState() {
  const stored = safeStorage.read(ROOM_STORAGE_KEY, { fallback: null, validate: isRecord });
  return sanitizeRoomState(stored) ?? createRoomState();
}

export function persistRoomState(state) {
  return safeStorage.write(ROOM_STORAGE_KEY, serializeRoomState(state));
}

/* Bridge to the 2D Wall Studio (lumen_wall_studio_v1) */

// Incoming modules keep their uid unless a module on another wall holds it.
function withFreeUids(incoming, kept) {
  if (kept.length === 0) return incoming;
  const taken = new Set(kept.map((item) => item.uid));
  let max = [...kept, ...incoming].reduce((acc, item) => Math.max(acc, Number(item.uid.slice(1))), 0);
  return incoming.map((item) => {
    if (!taken.has(item.uid)) {
      taken.add(item.uid);
      return item;
    }
    max += 1;
    taken.add(`m${max}`);
    return { ...item, uid: `m${max}` };
  });
}

/**
 * Adapts a wall layout onto one wall of the room (north by default): the
 * wall width becomes that wall's span (room width for north and south, depth
 * for east and west) and the wall height the ceiling, both clamped to the
 * room ranges. Its modules replace the ones on that wall and keep their uid,
 * finish, channel and floor-referenced position; the other walls stay and are
 * pulled inside the new envelope.
 */
export function roomFromWallLayout(state, layout, wall = DEFAULT_ROOM_WALL) {
  const wallId = sanitizeWallId(wall);
  const span = wallId === 'east' || wallId === 'west' ? 'depthCm' : 'widthCm';
  const room = sanitizeRoom({
    ...state.room,
    [span]: layout.wall.widthCm,
    heightCm: layout.wall.heightCm,
    lighting: layout.wall.surface === 'daylight' ? 'daylight' : 'night',
  });
  const kept = pullInside(
    state.items.filter((item) => wallOf(item) !== wallId),
    room,
  );
  const incoming = sanitizeItems(layout.items, roomWall(room, wallId))
    .slice(0, Math.max(0, MAX_WALL_ITEMS - kept.length))
    .map((item) => stripLock({ ...item, wall: wallId }));
  return { ...state, room, items: [...kept, ...withFreeUids(incoming, kept)] };
}

/** Reads the saved 2D wall, or the default composition when the wall is empty, onto `wall`. */
export function importFromWallStudio(state, wall = DEFAULT_ROOM_WALL) {
  const wallId = sanitizeWallId(wall);
  const saved = loadLayout();
  const fromPreset = saved.items.length === 0;
  const layout = fromPreset ? layoutFromPreset(IMPORT_FALLBACK_PRESET, saved.wall) : saved;
  const next = roomFromWallLayout(state, layout, wallId);
  return {
    state: next,
    fromPreset,
    slope: layout.wall.slope,
    count: itemsOn(next.items, wallId).length,
    wall: wallId,
  };
}

/**
 * Builds the 2D layout for one wall of the room (north by default). The 2D
 * wall keeps its snap preference; lock flags survive for modules that kept
 * their uid and part. The wall caps at 400 cm, so modules beyond it are
 * pulled inside.
 */
export function wallLayoutFromRoom(state, current = loadLayout(), wall = DEFAULT_ROOM_WALL) {
  const wallId = sanitizeWallId(wall);
  const span = wallSpanCm(state.room, wallId);
  const locks = new Map(current.items.map((item) => [item.uid, item]));
  const surface = sanitizeWall({
    ...current.wall,
    widthCm: span,
    heightCm: state.room.heightCm,
    slope: false,
    surface: roomWall(state.room).surface,
  });
  const entries = itemsOn(state.items, wallId).map(({ wall: _wall, ...item }) => {
    const previous = locks.get(item.uid);
    return { ...item, locked: previous?.productId === item.productId && previous.locked === true };
  });
  const items = sanitizeItems(entries, surface);
  const moved = items.filter((item, i) => item.xCm !== entries[i].xCm || item.yCm !== entries[i].yCm).length;
  return { layout: createLayout(surface, items), moved, capped: surface.widthCm < span, wall: wallId };
}

export function exportToWallStudio(state, wall = DEFAULT_ROOM_WALL) {
  const result = wallLayoutFromRoom(state, loadLayout(), wall);
  persistLayout(result.layout);
  return result;
}

/* Launcher from a product page */

/** Same contract as appendToWallStudio, for the stored 3D room. Mounts on the north wall. */
export function appendToRoom(productId, finish) {
  const product = getProduct(productId);
  if (!productHasFinish(product, finish)) return null;
  const state = loadRoomState();
  const result = mountInRoom(state, product.id);
  if (!result) return null;
  const item = { ...result.item, finish };
  const next = { ...state, items: [...state.items, item] };
  persistRoomState(next);
  return { item, clear: result.clear, count: next.items.length };
}
