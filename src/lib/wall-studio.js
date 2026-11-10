import { getProduct, productHasFinish } from '../data/products.js';
import { getWallPreset } from '../data/wall-presets.js';
import { isOneOf, isSafeId, safeStorage } from '../security/sanitize.js';
import { recommendPsu } from './bag.js';

export const WALL_STORAGE_KEY = 'lumen_wall_studio_v1';
export const LAYOUT_FORMAT = 'lumen.wall';
export const LAYOUT_VERSION = 1;

export const PX_PER_CM = 2.5;
export const WALL_WIDTH = Object.freeze({ min: 180, max: 400, initial: 300 });
export const WALL_HEIGHT = Object.freeze({ min: 180, max: 320, initial: 250 });
export const SLOPE_CM = 90;
export const FINE_STEP_CM = 1;
export const GRID_STEP_CM = 5;
export const HISTORY_LIMIT = 30;
export const MAX_WALL_ITEMS = 48;
export const MAX_IMPORT_BYTES = 100_000;
export const SURFACES = Object.freeze(['ambient', 'daylight']);

const MAX_SCANNED_ENTRIES = 256;
const PLACEMENT_CLEARANCE_CM = 4;
const EYE_LEVEL_CM = 150;
const UID_PATTERN = /^m[1-9]\d{0,5}$/;

export const DEFAULT_WALL = Object.freeze({
  widthCm: WALL_WIDTH.initial,
  heightCm: WALL_HEIGHT.initial,
  slope: false,
  snap: false,
  surface: 'ambient',
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampInt(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function createLayout(wall = DEFAULT_WALL, items = []) {
  return { format: LAYOUT_FORMAT, version: LAYOUT_VERSION, wall: { ...DEFAULT_WALL, ...wall }, items };
}

export function snapStep(wall) {
  return wall.snap ? GRID_STEP_CM : FINE_STEP_CM;
}

/* Geometry. All values in cm, y measured up from the finished floor. */

export function itemRect(item) {
  const product = getProduct(item.productId);
  return { x: item.xCm, y: item.yCm, w: product.dimsCm.w, h: product.dimsCm.h };
}

export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// The slope removes the top-right triangle with vertices (W - 90, H), (W, H),
// (W, H - 90). Its hypotenuse is x + y = W + H - 90. For a rect inside the
// wall, the top-right corner has the largest x + y, so the rect cuts into the
// triangle exactly when that corner lies beyond the line.
export function cutsSlope(rect, wall) {
  return wall.slope && rect.x + rect.w + rect.y + rect.h > wall.widthCm + wall.heightCm - SLOPE_CM;
}

export function exceedsWall(rect, wall) {
  return rect.x < 0 || rect.y < 0 || rect.x + rect.w > wall.widthCm || rect.y + rect.h > wall.heightCm;
}

export function productFits(product, wall) {
  return product.dimsCm.w <= wall.widthCm && product.dimsCm.h <= wall.heightCm;
}

export function clampToWall(product, wall, xCm, yCm) {
  const maxX = Math.max(0, wall.widthCm - product.dimsCm.w);
  const maxY = Math.max(0, wall.heightCm - product.dimsCm.h);
  return { xCm: Math.min(maxX, Math.max(0, xCm)), yCm: Math.min(maxY, Math.max(0, yCm)) };
}

/** Quantizes to the active step, then clamps so a module can sit flush to any wall edge. */
export function snapToWall(product, wall, xCm, yCm) {
  const step = snapStep(wall);
  return clampToWall(product, wall, Math.round(xCm / step) * step, Math.round(yCm / step) * step);
}

/**
 * Returns a Map of uid -> { overlaps: uid[], slope, bounds } for every module
 * in conflict. Edges that touch are not a conflict.
 */
export function findConflicts(layout) {
  const { wall, items } = layout;
  const rects = items.map(itemRect);
  const conflicts = new Map();
  const entry = (uid) => {
    if (!conflicts.has(uid)) conflicts.set(uid, { overlaps: [], slope: false, bounds: false });
    return conflicts.get(uid);
  };

  for (let i = 0; i < items.length; i += 1) {
    if (exceedsWall(rects[i], wall)) entry(items[i].uid).bounds = true;
    else if (cutsSlope(rects[i], wall)) entry(items[i].uid).slope = true;

    for (let j = i + 1; j < items.length; j += 1) {
      if (!rectsOverlap(rects[i], rects[j])) continue;
      entry(items[i].uid).overlaps.push(items[j].uid);
      entry(items[j].uid).overlaps.push(items[i].uid);
    }
  }
  return conflicts;
}

/** Mounting anchors in wall coordinates, matching the catalog drawings. */
export function anchorPoints(item) {
  const product = getProduct(item.productId);
  const { w, h } = product.dimsCm;
  const n = product.mountingPoints;
  const top = item.yCm + h;
  const round = (value) => Math.round(value * 10) / 10;
  const point = (x, y) => ({ xCm: round(x), yCm: round(y) });

  if (product.mount === 'floor') return [point(item.xCm + w / 2, top - 5)];
  if (product.mount === 'ceiling') return [point(item.xCm + w / 2, top)];
  if (product.shape === 'track' && n > 1) {
    return Array.from({ length: n }, (_, i) => point(item.xCm + 3 + ((w - 6) * i) / (n - 1), item.yCm + h / 2));
  }
  const y = h > 16 ? top - 5 : item.yCm + h / 2;
  return Array.from({ length: n }, (_, i) => point(item.xCm + (w * (i + 1)) / (n + 1), y));
}

/* Placement */

export function preferredSpot(product, wall) {
  const { w, h } = product.dimsCm;
  const x = (wall.widthCm - w) / 2;
  if (product.mount === 'floor') return { x, y: 0 };
  if (product.mount === 'ceiling') return { x, y: wall.heightCm - h };
  if (product.mount === 'recessed') return { x, y: wall.heightCm - h - 18 };
  return { x, y: EYE_LEVEL_CM - h / 2 };
}

function candidates(max, preferred) {
  const values = new Set([Math.min(max, Math.max(0, Math.round(preferred))), max]);
  for (let v = 0; v <= max; v += GRID_STEP_CM) values.add(v);
  return [...values].sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b);
}

/**
 * First free position for `product`, searched outward from a preferred spot on
 * a 5 cm lattice (plus the flush edges). Keeps a small clearance to other
 * modules and to any extra elevation `obstacles`, and stays out of the slope.
 * Returns null when nothing is free.
 */
export function findFreeSpot(layout, product, preferred = preferredSpot(product, layout.wall), obstacles = []) {
  const { wall } = layout;
  if (!productFits(product, wall)) return null;

  const { w, h } = product.dimsCm;
  const pad = PLACEMENT_CLEARANCE_CM;
  const others = [...layout.items.map(itemRect), ...obstacles].map((r) => ({
    x: r.x - pad,
    y: r.y - pad,
    w: r.w + 2 * pad,
    h: r.h + 2 * pad,
  }));
  const xs = candidates(wall.widthCm - w, preferred.x);
  const ys = candidates(wall.heightCm - h, preferred.y);

  for (const y of ys) {
    for (const x of xs) {
      const rect = { x, y, w, h };
      if (cutsSlope(rect, wall)) continue;
      if (others.some((other) => rectsOverlap(rect, other))) continue;
      return { xCm: x, yCm: y };
    }
  }
  return null;
}

export function nextUid(items) {
  let max = 0;
  for (const item of items) max = Math.max(max, Number(item.uid.slice(1)));
  return `m${max + 1}`;
}

/* Layout edits. Each returns the same layout object when nothing changes. */

export function mountProduct(layout, productId, at) {
  const product = getProduct(productId);
  if (!product || layout.items.length >= MAX_WALL_ITEMS || !productFits(product, layout.wall)) return null;

  const free = findFreeSpot(layout, product, at);
  const fallback = preferredSpot(product, layout.wall);
  const spot = free ?? snapToWall(product, layout.wall, fallback.x, fallback.y);
  const item = {
    uid: nextUid(layout.items),
    productId: product.id,
    finish: product.defaultFinish,
    xCm: spot.xCm,
    yCm: spot.yCm,
    led: product.watts > 0,
    locked: false,
  };
  return { layout: { ...layout, items: [...layout.items, item] }, item, clear: free !== null };
}

export function duplicateItem(layout, uid) {
  const source = layout.items.find((item) => item.uid === uid);
  if (!source) return null;
  const product = getProduct(source.productId);
  const result = mountProduct(layout, source.productId, {
    x: source.xCm + product.dimsCm.w + PLACEMENT_CLEARANCE_CM,
    y: source.yCm,
  });
  if (!result) return null;
  const item = { ...result.item, finish: source.finish, led: source.led };
  return { ...result, item, layout: { ...layout, items: [...layout.items, item] } };
}

export function updateItem(layout, uid, patch) {
  const index = layout.items.findIndex((item) => item.uid === uid);
  if (index === -1 || !isRecord(patch)) return layout;

  const current = layout.items[index];
  const product = getProduct(current.productId);
  const next = { ...current };

  if (productHasFinish(product, patch.finish)) next.finish = patch.finish;
  if (typeof patch.led === 'boolean' && product.watts > 0) next.led = patch.led;
  if (typeof patch.locked === 'boolean') next.locked = patch.locked;
  if (!current.locked && (isFiniteNumber(patch.xCm) || isFiniteNumber(patch.yCm))) {
    const x = isFiniteNumber(patch.xCm) ? patch.xCm : current.xCm;
    const y = isFiniteNumber(patch.yCm) ? patch.yCm : current.yCm;
    Object.assign(next, snapToWall(product, layout.wall, x, y));
  }

  const changed = Object.keys(next).some((key) => next[key] !== current[key]);
  if (!changed) return layout;
  return { ...layout, items: layout.items.map((item, i) => (i === index ? next : item)) };
}

export function removeItem(layout, uid) {
  const item = layout.items.find((entry) => entry.uid === uid);
  if (!item || item.locked) return layout;
  return { ...layout, items: layout.items.filter((entry) => entry !== item) };
}

export function sanitizeWall(input) {
  const source = isRecord(input) ? input : {};
  const dim = (value, range) => (isFiniteNumber(value) ? clampInt(value, range.min, range.max) : range.initial);
  return {
    widthCm: dim(source.widthCm, WALL_WIDTH),
    heightCm: dim(source.heightCm, WALL_HEIGHT),
    slope: source.slope === true,
    snap: source.snap === true,
    surface: isOneOf(source.surface, SURFACES) ? source.surface : DEFAULT_WALL.surface,
  };
}

/** Applies a wall patch and pulls every module back inside the new bounds. */
export function updateWall(layout, patch) {
  const wall = sanitizeWall({ ...layout.wall, ...(isRecord(patch) ? patch : {}) });
  const sameWall = Object.keys(wall).every((key) => wall[key] === layout.wall[key]);
  if (sameWall) return layout;

  const items = layout.items.map((item) => {
    const spot = clampToWall(getProduct(item.productId), wall, item.xCm, item.yCm);
    return spot.xCm === item.xCm && spot.yCm === item.yCm ? item : { ...item, ...spot };
  });
  return { ...layout, wall, items };
}

export function layoutFromPreset(presetId, currentWall = DEFAULT_WALL) {
  const preset = getWallPreset(presetId);
  if (!preset) return null;
  const wall = sanitizeWall({ ...currentWall, ...preset.wall });
  const items = preset.items.map((entry, i) => ({
    uid: `m${i + 1}`,
    productId: entry.productId,
    finish: entry.finish,
    xCm: entry.xCm,
    yCm: entry.yCm,
    led: getProduct(entry.productId).watts > 0,
    locked: false,
  }));
  return createLayout(wall, items);
}

/* Untrusted input: storage and imported files */

/**
 * Rebuilds module entries from untrusted data against a wall. A module
 * survives only with a known product, a finish that product ships in and
 * finite coordinates; positions are rounded and pulled inside the wall, flags
 * must be real booleans, and invalid or duplicate uids are reissued. At most
 * 48 modules are kept.
 */
export function sanitizeItems(entries, wall) {
  if (!Array.isArray(entries)) return [];
  const kept = [];
  const seen = new Set();

  for (const entry of entries.slice(0, MAX_SCANNED_ENTRIES)) {
    if (kept.length >= MAX_WALL_ITEMS) break;
    if (!isRecord(entry) || !isSafeId(entry.productId)) continue;
    const product = getProduct(entry.productId);
    if (!product || !productHasFinish(product, entry.finish)) continue;
    if (!isFiniteNumber(entry.xCm) || !isFiniteNumber(entry.yCm)) continue;

    const uid = typeof entry.uid === 'string' && UID_PATTERN.test(entry.uid) && !seen.has(entry.uid) ? entry.uid : null;
    if (uid) seen.add(uid);
    const spot = clampToWall(product, wall, Math.round(entry.xCm), Math.round(entry.yCm));
    kept.push({
      uid,
      productId: product.id,
      finish: entry.finish,
      xCm: spot.xCm,
      yCm: spot.yCm,
      led: product.watts > 0 && entry.led !== false,
      locked: entry.locked === true,
    });
  }

  const items = [];
  for (const item of kept) {
    items.push(item.uid ? item : { ...item, uid: nextUid([...kept.filter((k) => k.uid), ...items]) });
  }
  return items;
}

/** Rebuilds a layout from untrusted data. Returns null unless the envelope is a Lumen wall layout. */
export function sanitizeLayout(input) {
  if (!isRecord(input) || input.format !== LAYOUT_FORMAT || input.version !== LAYOUT_VERSION) return null;
  if (!Array.isArray(input.items)) return null;

  const wall = sanitizeWall(input.wall);
  return createLayout(wall, sanitizeItems(input.items, wall));
}

export function serializeLayout(layout) {
  return {
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    wall: { ...layout.wall },
    items: layout.items.map(({ uid, productId, finish, xCm, yCm, led, locked }) => ({
      uid,
      productId,
      finish,
      xCm,
      yCm,
      led,
      locked,
    })),
  };
}

export function loadLayout() {
  const stored = safeStorage.read(WALL_STORAGE_KEY, { fallback: null, validate: isRecord });
  return sanitizeLayout(stored) ?? createLayout();
}

export function persistLayout(layout) {
  return safeStorage.write(WALL_STORAGE_KEY, serializeLayout(layout));
}

/* Telemetry and bag aggregation */

export function summarizeWall(layout) {
  let loadW = 0;
  let activeW = 0;
  let lumens = 0;
  let priceUsd = 0;
  for (const item of layout.items) {
    const product = getProduct(item.productId);
    loadW += product.watts;
    priceUsd += product.priceUsd;
    if (item.led) {
      activeW += product.watts;
      lumens += product.lumens;
    }
  }
  return { modules: layout.items.length, loadW, activeW, lumens, priceUsd, psu: recommendPsu(loadW) };
}

/** Groups modules into bag lines by (productId, finish), in first-mounted order. */
export function aggregateBagLines(items) {
  const lines = new Map();
  for (const item of items) {
    const key = `${item.productId}:${item.finish}`;
    const line = lines.get(key);
    if (line) line.qty += 1;
    else lines.set(key, { id: item.productId, finish: item.finish, qty: 1 });
  }
  return [...lines.values()];
}

/* Undo / redo */

export function createHistory(present) {
  return { past: [], present, future: [] };
}

export function commitHistory(history, layout) {
  if (!layout || layout === history.present) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: layout, future: [] };
}

export function undoHistory(history) {
  if (history.past.length === 0) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past.at(-1),
    future: [history.present, ...history.future],
  };
}

export function redoHistory(history) {
  if (history.future.length === 0) return history;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: history.future[0],
    future: history.future.slice(1),
  };
}

/* Launcher from a product page */

/**
 * Mounts one part in the stored wall at the first clear spot, in the finish
 * chosen on the product page, and writes the layout back. Returns null when
 * the part is unknown, does not ship in that finish, or the wall is full.
 */
export function appendToWallStudio(productId, finish) {
  const product = getProduct(productId);
  if (!productHasFinish(product, finish)) return null;
  const layout = loadLayout();
  const result = mountProduct(layout, product.id);
  if (!result) return null;
  const item = { ...result.item, finish };
  const next = { ...layout, items: [...layout.items, item] };
  persistLayout(next);
  return { item, clear: result.clear, count: next.items.length };
}
