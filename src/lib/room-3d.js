import { getProduct, productHasFinish } from '../data/products.js';
import { isOneOf, safeStorage } from '../security/sanitize.js';
import { dimPatch, recordChanged, sanitizeDimPct, withDimPct } from './dimming.js';
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

/** The main wall (z = 0) seen as a Wall Studio wall. The room has a flat ceiling. */
export function roomWall(room) {
  return {
    widthCm: room.widthCm,
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

/* Geometry. cm, x along the main wall, y up from the floor, z into the room. */

export function moduleBox(item) {
  const { w, h, d } = getProduct(item.productId).dimsCm;
  return { x0: item.xCm, x1: item.xCm + w, y0: item.yCm, y1: item.yCm + h, z0: 0, z1: d };
}

export function boxesIntersect(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1 && a.z0 < b.z1 && b.z0 < a.z1;
}

/** Furniture placed centred on the main wall, pulled forward only as far as the room allows. */
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

/** Elevation rects of the furniture parts that a product of depth `d` would actually reach. */
function furnitureObstacles(furniture, depthCm) {
  if (!furniture) return [];
  return furniture.parts
    .filter(({ box }) => depthCm > box.z0)
    .map(({ box }) => ({ x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 }));
}

/**
 * Wall Studio conflicts (overlap, bounds) for the main wall, plus a true 3D
 * AABB test of every module against the furniture volumes.
 */
export function findRoomConflicts(state) {
  const base = findConflicts(createLayout(roomWall(state.room), state.items));
  const conflicts = new Map();
  for (const [uid, entry] of base) conflicts.set(uid, { ...entry, furniture: false });

  const furniture = furnitureLayout(state.room);
  if (furniture) {
    for (const item of state.items) {
      const box = moduleBox(item);
      if (!furniture.parts.some((p) => boxesIntersect(box, p.box))) continue;
      const entry = conflicts.get(item.uid) ?? { overlaps: [], slope: false, bounds: false, furniture: false };
      conflicts.set(item.uid, { ...entry, furniture: true });
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
 * segment in cm with a label and a tone ('ok' or 'tight').
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
    const x = (box.x0 + box.x1) / 2;
    const z = box.z1 + 2;
    const ceiling = room.heightCm - box.y1;
    callouts.push({
      id: 'floor',
      label: `FFL +${selected.yCm} cm`,
      valueCm: selected.yCm,
      tone: 'ok',
      uid: selected.uid,
      from: [x, 0, z],
      to: [x, box.y0, z],
    });
    callouts.push({
      id: 'ceiling',
      label: `Ceiling ${ceiling} cm`,
      valueCm: ceiling,
      tone: 'ok',
      uid: selected.uid,
      from: [x, box.y1, z],
      to: [x, room.heightCm, z],
    });
  }

  return callouts.filter((callout) => callout.valueCm > 0);
}

/* Edits. Each returns the same state object when nothing changes. */

function pullInside(items, wall) {
  let changed = false;
  const next = items.map((item) => {
    const spot = clampToWall(getProduct(item.productId), wall, item.xCm, item.yCm);
    if (spot.xCm === item.xCm && spot.yCm === item.yCm) return item;
    changed = true;
    return { ...item, ...spot };
  });
  return changed ? next : items;
}

export function updateRoom(state, patch) {
  const room = sanitizeRoom({ ...state.room, ...(isRecord(patch) ? patch : {}) });
  if (Object.keys(room).every((key) => room[key] === state.room[key])) return state;
  return { ...state, room, items: pullInside(state.items, roomWall(room)) };
}

export function updateCamera(state, camera) {
  const next = sanitizeCamera(camera);
  return sameCamera(next, state.camera) ? state : { ...state, camera: next };
}

/**
 * Mounts a part on the main wall at the first clear spot near its natural
 * height, keeping clear of other modules and of the furniture it would reach.
 */
export function mountInRoom(state, productId) {
  const product = getProduct(productId);
  if (!product || state.items.length >= MAX_WALL_ITEMS) return null;

  const wall = roomWall(state.room);
  const layout = createLayout(wall, state.items);
  const obstacles = furnitureObstacles(furnitureLayout(state.room), product.dimsCm.d);
  const free = findFreeSpot(layout, product, preferredSpot(product, wall), obstacles);
  const fallback = preferredSpot(product, wall);
  const spot = free ?? clampToWall(product, wall, Math.round(fallback.x), Math.round(fallback.y));
  const item = {
    uid: nextUid(state.items),
    productId: product.id,
    finish: product.defaultFinish,
    xCm: spot.xCm,
    yCm: spot.yCm,
    led: product.watts > 0,
  };
  return { state: { ...state, items: [...state.items, item] }, item, clear: free !== null };
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
  if (isFiniteNumber(patch.xCm) || isFiniteNumber(patch.yCm)) {
    const x = isFiniteNumber(patch.xCm) ? patch.xCm : current.xCm;
    const y = isFiniteNumber(patch.yCm) ? patch.yCm : current.yCm;
    Object.assign(next, clampToWall(product, roomWall(state.room), Math.round(x), Math.round(y)));
  }

  if (!recordChanged(next, current)) return state;
  return { ...state, items: state.items.map((item, i) => (i === index ? next : item)) };
}

export function removeRoomItem(state, uid) {
  const items = state.items.filter((item) => item.uid !== uid);
  return items.length === state.items.length ? state : { ...state, items };
}

/* Untrusted input */

function stripLock({ uid, productId, finish, xCm, yCm, led, dimPct }) {
  return { uid, productId, finish, xCm, yCm, led, ...dimPatch(getProduct(productId), dimPct) };
}

/**
 * Rebuilds a room from untrusted data. Returns null unless the envelope is a
 * Lumen 3D room. Dimensions, furniture, lighting and camera are clamped or
 * reset; modules pass the same per-entry rules as Wall Studio layouts.
 */
export function sanitizeRoomState(input) {
  if (!isRecord(input) || input.format !== ROOM_FORMAT || input.version !== ROOM_VERSION) return null;
  if (!Array.isArray(input.items)) return null;

  const room = sanitizeRoom(input.room);
  const items = sanitizeItems(input.items.slice(0, MAX_SCANNED_ENTRIES), roomWall(room)).map(stripLock);
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

/**
 * Adapts a wall layout into the room: wall width and height become room
 * width and ceiling height (clamped to the room ranges), modules keep their
 * uid, finish, channel and floor-referenced position. Depth, furniture and
 * camera stay as they are.
 */
export function roomFromWallLayout(state, layout) {
  const room = sanitizeRoom({
    ...state.room,
    widthCm: layout.wall.widthCm,
    heightCm: layout.wall.heightCm,
    lighting: layout.wall.surface === 'daylight' ? 'daylight' : 'night',
  });
  const items = sanitizeItems(layout.items, roomWall(room)).map(stripLock);
  return { ...state, room, items };
}

/** Reads the saved 2D wall, or the default composition when the wall is empty. */
export function importFromWallStudio(state) {
  const saved = loadLayout();
  const fromPreset = saved.items.length === 0;
  const layout = fromPreset ? layoutFromPreset(IMPORT_FALLBACK_PRESET, saved.wall) : saved;
  return {
    state: roomFromWallLayout(state, layout),
    fromPreset,
    slope: layout.wall.slope,
    count: layout.items.length,
  };
}

/**
 * Builds the 2D layout for the room's main wall. The 2D wall keeps its snap
 * preference; lock flags survive for modules that kept their uid and part.
 * The wall caps at 400 cm, so modules beyond it are pulled inside.
 */
export function wallLayoutFromRoom(state, current = loadLayout()) {
  const locks = new Map(current.items.map((item) => [item.uid, item]));
  const wall = sanitizeWall({
    ...current.wall,
    widthCm: state.room.widthCm,
    heightCm: state.room.heightCm,
    slope: false,
    surface: roomWall(state.room).surface,
  });
  const entries = state.items.map((item) => {
    const previous = locks.get(item.uid);
    return { ...item, locked: previous?.productId === item.productId && previous.locked === true };
  });
  const items = sanitizeItems(entries, wall);
  const moved = items.filter((item, i) => item.xCm !== entries[i].xCm || item.yCm !== entries[i].yCm).length;
  return { layout: createLayout(wall, items), moved, capped: wall.widthCm < state.room.widthCm };
}

export function exportToWallStudio(state) {
  const result = wallLayoutFromRoom(state);
  persistLayout(result.layout);
  return result;
}

/* Launcher from a product page */

/** Same contract as appendToWallStudio, for the stored 3D room. */
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
