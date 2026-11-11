import { getProduct, productHasFinish } from '../data/products.js';
import { getWallPreset } from '../data/wall-presets.js';
import { isOneOf, isSafeId, safeStorage } from '../security/sanitize.js';
import { recommendPsu } from './bag.js';
import { dimFactor, dimPatch, recordChanged, sanitizeDimPct, withDimPct } from './dimming.js';

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
  if (product.mount === 'ceiling') {
    if (n < 2) return [point(item.xCm + w / 2, top)];
    return Array.from({ length: n }, (_, i) => point(item.xCm + (w * (i + 1)) / (n + 1), top));
  }
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
  const item = { ...result.item, finish: source.finish, led: source.led, ...dimPatch(product, source.dimPct) };
  return { ...result, item, layout: { ...layout, items: [...layout.items, item] } };
}

export function updateItem(layout, uid, patch) {
  const index = layout.items.findIndex((item) => item.uid === uid);
  if (index === -1 || !isRecord(patch)) return layout;

  const current = layout.items[index];
  const product = getProduct(current.productId);
  let next = { ...current };

  if (productHasFinish(product, patch.finish)) next.finish = patch.finish;
  if (typeof patch.led === 'boolean' && product.watts > 0) next.led = patch.led;
  if (isFiniteNumber(patch.dimPct) && product.watts > 0) next = withDimPct(next, sanitizeDimPct(patch.dimPct));
  if (typeof patch.locked === 'boolean') next.locked = patch.locked;
  if (!current.locked && (isFiniteNumber(patch.xCm) || isFiniteNumber(patch.yCm))) {
    const x = isFiniteNumber(patch.xCm) ? patch.xCm : current.xCm;
    const y = isFiniteNumber(patch.yCm) ? patch.yCm : current.yCm;
    Object.assign(next, snapToWall(product, layout.wall, x, y));
  }

  if (!recordChanged(next, current)) return layout;
  return { ...layout, items: layout.items.map((item, i) => (i === index ? next : item)) };
}

export function removeItem(layout, uid) {
  const item = layout.items.find((entry) => entry.uid === uid);
  if (!item || item.locked) return layout;
  return { ...layout, items: layout.items.filter((entry) => entry !== item) };
}

/* Multi-selection. Group edits touch unlocked modules only. */

function pickUnlocked(layout, uids) {
  if (!Array.isArray(uids)) return [];
  const wanted = new Set(uids);
  return layout.items.filter((item) => wanted.has(item.uid) && !item.locked);
}

function withPositions(layout, spots) {
  let changed = false;
  const items = layout.items.map((item) => {
    const spot = spots.get(item.uid);
    if (!spot || (spot.xCm === item.xCm && spot.yCm === item.yCm)) return item;
    changed = true;
    return { ...item, xCm: spot.xCm, yCm: spot.yCm };
  });
  return changed ? { ...layout, items } : layout;
}

export function boundsOf(rects) {
  if (!Array.isArray(rects) || rects.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Uids of modules whose rect touches or crosses `rect` (wall cm). */
export function modulesInRect(items, rect) {
  if (!isRecord(rect) || ![rect.x, rect.y, rect.w, rect.h].every(isFiniteNumber)) return [];
  return items
    .filter((item) => {
      const r = itemRect(item);
      return r.x <= rect.x + rect.w && rect.x <= r.x + r.w && r.y <= rect.y + rect.h && rect.y <= r.y + r.h;
    })
    .map((item) => item.uid);
}

// Each rect bounds the shared translation from both sides; the group moves as
// far toward (dx, dy) as its most constrained member allows.
export function clampGroupDelta(wall, rects, dx, dy) {
  if (rects.length === 0) return { dx: 0, dy: 0 };
  let loX = -Infinity;
  let hiX = Infinity;
  let loY = -Infinity;
  let hiY = Infinity;
  for (const r of rects) {
    loX = Math.max(loX, -r.x);
    hiX = Math.min(hiX, wall.widthCm - r.w - r.x);
    loY = Math.max(loY, -r.y);
    hiY = Math.min(hiY, wall.heightCm - r.h - r.y);
  }
  const clamp = (v, lo, hi) => (lo > hi ? 0 : Math.min(hi, Math.max(lo, v)));
  return { dx: clamp(dx, loX, hiX), dy: clamp(dy, loY, hiY) };
}

/** Translates the unlocked modules in `uids` as one rigid group, kept inside the wall. */
export function moveModules(layout, uids, dx, dy) {
  const items = pickUnlocked(layout, uids);
  if (items.length === 0 || !isFiniteNumber(dx) || !isFiniteNumber(dy)) return layout;
  const delta = clampGroupDelta(layout.wall, items.map(itemRect), Math.round(dx), Math.round(dy));
  if (delta.dx === 0 && delta.dy === 0) return layout;
  return withPositions(
    layout,
    new Map(items.map((item) => [item.uid, { xCm: item.xCm + delta.dx, yCm: item.yCm + delta.dy }])),
  );
}

export function removeModules(layout, uids) {
  const doomed = new Set(pickUnlocked(layout, uids).map((item) => item.uid));
  if (doomed.size === 0) return layout;
  return { ...layout, items: layout.items.filter((item) => !doomed.has(item.uid)) };
}

/** Batch finish, LED channel and dim level. Parts that do not ship in the finish keep theirs. */
export function updateModules(layout, uids, patch) {
  if (!Array.isArray(uids) || !isRecord(patch)) return layout;
  const safe = {};
  if (typeof patch.finish === 'string') safe.finish = patch.finish;
  if (typeof patch.led === 'boolean') safe.led = patch.led;
  if (isFiniteNumber(patch.dimPct)) safe.dimPct = patch.dimPct;
  if (Object.keys(safe).length === 0) return layout;
  return [...new Set(uids)].reduce((acc, uid) => updateItem(acc, uid, safe), layout);
}

export const ALIGN_MODES = Object.freeze(['left', 'center-x', 'right', 'top', 'center-y', 'bottom']);
export const DISTRIBUTE_AXES = Object.freeze(['horizontal', 'vertical']);

/** Aligns 2+ unlocked modules to an edge or centreline of their joint bounding box. */
export function alignModules(layout, uids, mode) {
  if (!isOneOf(mode, ALIGN_MODES)) return layout;
  const items = pickUnlocked(layout, uids);
  if (items.length < 2) return layout;
  const rects = items.map(itemRect);
  const box = boundsOf(rects);
  const spots = new Map();
  items.forEach((item, i) => {
    const r = rects[i];
    let { x, y } = r;
    if (mode === 'left') x = box.x;
    else if (mode === 'right') x = box.x + box.w - r.w;
    else if (mode === 'center-x') x = Math.round(box.x + (box.w - r.w) / 2);
    else if (mode === 'bottom') y = box.y;
    else if (mode === 'top') y = box.y + box.h - r.h;
    else y = Math.round(box.y + (box.h - r.h) / 2);
    spots.set(item.uid, clampToWall(getProduct(item.productId), layout.wall, x, y));
  });
  return withPositions(layout, spots);
}

/**
 * Spaces 3+ unlocked modules evenly between the outermost two along an axis.
 * Gaps are equalized; when the parts are too wide for the span (gaps would be
 * negative) the centres are spaced evenly instead. The end modules stay put.
 */
export function distributeModules(layout, uids, axis) {
  if (!isOneOf(axis, DISTRIBUTE_AXES)) return layout;
  const items = pickUnlocked(layout, uids);
  if (items.length < 3) return layout;
  const horizontal = axis === 'horizontal';
  const entries = items
    .map((item) => {
      const r = itemRect(item);
      return { item, start: horizontal ? r.x : r.y, size: horizontal ? r.w : r.h };
    })
    .sort((a, b) => a.start + a.size / 2 - (b.start + b.size / 2) || a.start - b.start);

  const n = entries.length;
  const first = entries[0];
  const last = entries[n - 1];
  const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
  const gap = (last.start + last.size - first.start - totalSize) / (n - 1);
  const starts = [];
  if (gap >= 0) {
    let cursor = first.start;
    for (const e of entries) {
      starts.push(Math.round(cursor));
      cursor += e.size + gap;
    }
  } else {
    const c0 = first.start + first.size / 2;
    const pitch = (last.start + last.size / 2 - c0) / (n - 1);
    entries.forEach((e, i) => starts.push(Math.round(c0 + pitch * i - e.size / 2)));
  }

  const spots = new Map();
  entries.forEach((e, i) => {
    const x = horizontal ? starts[i] : e.item.xCm;
    const y = horizontal ? e.item.yCm : starts[i];
    spots.set(e.item.uid, clampToWall(getProduct(e.item.productId), layout.wall, x, y));
  });
  return withPositions(layout, spots);
}

/* Smart alignment guides */

export const EYE_DATUM_CM = 145;
export const GUIDE_TOLERANCE_CM = 2;
const MAX_GUIDES = 12;

function edgeValues(r, axis) {
  return axis === 'x'
    ? [
        ['left', r.x],
        ['center-x', r.x + r.w / 2],
        ['right', r.x + r.w],
      ]
    : [
        ['bottom', r.y],
        ['center-y', r.y + r.h / 2],
        ['top', r.y + r.h],
      ];
}

/**
 * Alignment hits for a dragged module or group against the wall centreline,
 * the 145 cm eye-level datum and every other module's edges and centrelines.
 * `active` is a uid or a list of uids; the group is treated as its bounding
 * box. Each guide is a line in wall cm: axis 'x' is vertical at x = `at`,
 * axis 'y' horizontal at y = `at`, running `from` -> `to` along the other
 * axis. `delta` is the signed offset of the matching edge (0 = exact).
 */
export function computeSmartGuides(wall, items, active) {
  const ids = new Set(typeof active === 'string' ? [active] : Array.isArray(active) ? active : []);
  const moving = items.filter((item) => ids.has(item.uid));
  if (moving.length === 0) return [];
  const box = boundsOf(moving.map(itemRect));
  const others = items.filter((item) => !ids.has(item.uid)).map((item) => ({ uid: item.uid, r: itemRect(item) }));

  const targets = {
    x: [{ at: wall.widthCm / 2, kind: 'wall-centre', span: [0, wall.heightCm] }],
    y: [{ at: EYE_DATUM_CM, kind: 'eye-level', span: [0, wall.widthCm] }],
  };
  for (const { uid, r } of others) {
    for (const [edge, at] of edgeValues(r, 'x')) targets.x.push({ at, kind: 'module', uid, edge, span: [r.y, r.y + r.h] });
    for (const [edge, at] of edgeValues(r, 'y')) targets.y.push({ at, kind: 'module', uid, edge, span: [r.x, r.x + r.w] });
  }

  const merged = new Map();
  for (const axis of ['x', 'y']) {
    const own = axis === 'x' ? [box.y, box.y + box.h] : [box.x, box.x + box.w];
    const edges = edgeValues(box, axis);
    for (const target of targets[axis]) {
      let best = null;
      for (const [edge, value] of edges) {
        const delta = value - target.at;
        if (Math.abs(delta) > GUIDE_TOLERANCE_CM + 1e-9) continue;
        if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { edge, delta };
      }
      if (!best) continue;
      const key = `${axis}:${target.at}`;
      const from = Math.min(target.span[0], own[0]);
      const to = Math.max(target.span[1], own[1]);
      const prev = merged.get(key);
      if (prev) {
        prev.from = Math.min(prev.from, from);
        prev.to = Math.max(prev.to, to);
        if (target.uid) prev.targets.push(target.uid);
        continue;
      }
      merged.set(key, {
        axis,
        at: target.at,
        kind: target.kind,
        edge: best.edge,
        delta: Math.round(best.delta * 10) / 10,
        from,
        to,
        targets: target.uid ? [target.uid] : [],
      });
    }
  }

  const rank = (g) => (g.kind === 'module' ? 1 : 0) * 100 + Math.abs(g.delta);
  return [...merged.values()].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_GUIDES);
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
      ...dimPatch(product, entry.dimPct),
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
    items: layout.items.map(({ uid, productId, finish, xCm, yCm, led, dimPct, locked }) => ({
      uid,
      productId,
      finish,
      xCm,
      yCm,
      led,
      ...dimPatch(getProduct(productId), dimPct),
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

/**
 * loadW is the rated connected load and sizes the driver; activeW and
 * lumens are what the lit channels actually draw and emit at their dim level.
 */
export function summarizeWall(layout) {
  let loadW = 0;
  let activeW = 0;
  let lumens = 0;
  let priceUsd = 0;
  let dimmed = 0;
  for (const item of layout.items) {
    const product = getProduct(item.productId);
    loadW += product.watts;
    priceUsd += product.priceUsd;
    if (item.led) {
      const factor = dimFactor(item);
      activeW += product.watts * factor;
      lumens += product.lumens * factor;
      if (product.watts > 0 && factor < 1) dimmed += 1;
    }
  }
  return {
    modules: layout.items.length,
    loadW,
    activeW: Math.round(activeW * 10) / 10,
    lumens: Math.round(lumens),
    dimmed,
    priceUsd,
    psu: recommendPsu(loadW),
  };
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
