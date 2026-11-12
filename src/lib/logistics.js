import { isOneOf } from '../security/sanitize.js';
import { driverUnit } from './drivers.js';

export const FULFILMENT_MODES = Object.freeze(['consolidated', 'split']);
export const FULFILMENT_LABELS = Object.freeze({
  consolidated: 'Consolidated Dispatch',
  split: 'Split Rough-In & Millwork',
});

export const TARE_RATIO = 0.18;
export const MIN_TARE_KG = 0.8;
export const LONG_SPAN_CM = 120;
export const PARCEL_MAX_KG = 35;
export const PARCEL_MAX_LENGTH_CM = 160;
export const PALLET_MIN_KG = 65;
export const STOCK_MAX_WEEKS = 2;

export const FREIGHT_CLASSES = Object.freeze({
  parcel: 'Parcel Courier',
  van: 'Dedicated Van / LTL',
  pallet: 'ISPM-15 Euro-Pallet Freight',
});

export const CRATE_TYPES = Object.freeze([
  Object.freeze({ id: 'long-span', label: 'Long-Span Timber Tube', capacityKg: 25 }),
  Object.freeze({ id: 'millwork', label: 'Reinforced Millwork Crate', capacityKg: 45 }),
  Object.freeze({ id: 'hardware', label: 'Precision Hardware Carton', capacityKg: 15 }),
]);

const MILLWORK_SHAPES = new Set(['shelf', 'cube', 'sideboard', 'frame']);
const DEFAULT_LEAD = Object.freeze([1, 2]);
const MAX_QTY = 999;

// All mass arithmetic runs in integer tenths of a kilogram so net + tare === gross exactly.
function toTenths(kg) {
  return Number.isFinite(kg) && kg > 0 ? Math.round(kg * 10) : 0;
}

function fromTenths(tenths) {
  return tenths / 10;
}

function safeQty(qty) {
  return Number.isInteger(qty) && qty > 0 ? Math.min(qty, MAX_QTY) : 0;
}

function safeDims(dims) {
  const read = (v) => (Number.isFinite(v) && v > 0 ? v : 1);
  return { w: read(dims?.w), h: read(dims?.h), d: read(dims?.d) };
}

/** Accepts [min, max] or a label such as "2-3 weeks"; anything else falls back to stock lead. */
export function parseLeadWeeks(value) {
  let pair = null;
  if (Array.isArray(value) && value.length === 2) {
    pair = value;
  } else if (typeof value === 'string') {
    const match = /^\s*(\d{1,2})\s*(?:-\s*(\d{1,2}))?\s*(?:weeks?|wks?)?\s*$/i.exec(value);
    if (match) pair = [Number(match[1]), Number(match[2] ?? match[1])];
  }
  if (!pair || !pair.every((n) => Number.isInteger(n) && n >= 0 && n <= 52)) return [...DEFAULT_LEAD];
  return [Math.min(pair[0], pair[1]), Math.max(pair[0], pair[1])];
}

export function formatWeeks([min, max]) {
  if (min === max) return `${min} week${min === 1 ? '' : 's'}`;
  return `${min}-${max} weeks`;
}

export function crateTypeFor(shape, dimsCm) {
  const { w, h, d } = safeDims(dimsCm);
  if (Math.max(w, h, d) >= LONG_SPAN_CM) return 'long-span';
  return MILLWORK_SHAPES.has(shape) ? 'millwork' : 'hardware';
}

function sortedSides(dims) {
  return [dims.w, dims.h, dims.d].sort((a, b) => b - a);
}

/**
 * Crate envelopes, all in whole cm:
 * tube: longest part + 12 cm end caps, square bore sized to the bundled
 * cross-sections plus 30% void and a 6 cm wall, 16 cm minimum;
 * millwork: parts laid flat and stacked, 10 cm frame, 3 cm foam per layer;
 * carton: footprint of the largest part + 6 cm, height from summed part
 * volume with 40% void fill.
 */
function crateDims(type, pieces) {
  const sides = pieces.map((piece) => sortedSides(piece.dims));
  const maxL = Math.max(...sides.map((s) => s[0]));
  const maxM = Math.max(...sides.map((s) => s[1]));
  const maxS = Math.max(...sides.map((s) => s[2]));
  if (type === 'long-span') {
    const area = sides.reduce((sum, s) => sum + (s[1] + 1) * (s[2] + 1), 0);
    const bore = Math.max(16, Math.ceil(Math.sqrt(area * 1.3)) + 6);
    return { w: Math.ceil(maxL + 12), h: bore, d: bore };
  }
  if (type === 'millwork') {
    const stack = sides.reduce((sum, s) => sum + s[2] + 3, 0);
    return { w: Math.ceil(maxL + 10), h: Math.ceil(stack + 8), d: Math.ceil(maxM + 10) };
  }
  const w = Math.ceil(maxL + 6);
  const d = Math.ceil(maxM + 6);
  const volume = sides.reduce((sum, s) => sum + s[0] * s[1] * s[2], 0) * 1.4;
  const h = Math.max(10, Math.ceil(maxS + 4), Math.ceil(volume / (w * d)) + 4);
  return { w, h, d };
}

/** Largest-remainder split of `total` across `weights`, so the shares sum to `total` exactly. */
function apportion(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const shares = raw.map(Math.floor);
  let left = total - shares.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k += 1, left -= 1) shares[order[k % order.length][1]] += 1;
  return shares;
}

function collectLines(bagLines, electrical) {
  const lines = [];
  for (const line of Array.isArray(bagLines) ? bagLines : []) {
    const product = line?.product;
    const qty = safeQty(line?.qty);
    if (!product || qty === 0) continue;
    const dims = safeDims(product.dimsCm);
    lines.push({
      sku: String(product.sku),
      name: String(product.name),
      qty,
      unitTenths: toTenths(product.weightKg),
      dims,
      type: crateTypeFor(product.shape, dims),
      leadWeeks: parseLeadWeeks(product.leadWeeks),
      driver: false,
    });
  }
  const psu = electrical?.psu;
  const drivers = safeQty(psu?.drivers);
  if (drivers > 0 && electrical?.driverIncluded !== false) {
    const unit = driverUnit(psu.id);
    lines.push({
      sku: unit.sku,
      name: psu.id === 'driver-array' ? 'Multi-bus 24V Driver Array (150W units)' : unit.name,
      qty: drivers,
      unitTenths: toTenths(unit.weightKg),
      dims: safeDims(unit.dimsCm),
      type: 'hardware',
      leadWeeks: parseLeadWeeks(unit.leadWeeks),
      driver: true,
    });
  }
  return lines;
}

/** First-fit decreasing by mass within each crate type; ties break on SKU so the manifest is stable. */
function packCrates(lines) {
  const crates = [];
  for (const type of CRATE_TYPES) {
    const pieces = lines
      .filter((line) => line.type === type.id)
      .flatMap((line) => Array.from({ length: line.qty }, () => line))
      .sort((a, b) => b.unitTenths - a.unitTenths || (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
    const capacity = type.capacityKg * 10;
    const bins = [];
    for (const piece of pieces) {
      let bin = bins.find((b) => b.netTenths + piece.unitTenths <= capacity);
      if (!bin) {
        bin = { type, netTenths: 0, pieces: [] };
        bins.push(bin);
      }
      bin.netTenths += piece.unitTenths;
      bin.pieces.push(piece);
    }
    crates.push(...bins);
  }
  return crates;
}

function contentsOf(pieces) {
  const bySku = new Map();
  for (const piece of pieces) {
    const entry = bySku.get(piece.sku);
    if (entry) entry.qty += 1;
    else bySku.set(piece.sku, { sku: piece.sku, name: piece.name, qty: 1 });
  }
  return [...bySku.values()];
}

function windowOf(lines, earliestStart) {
  const mins = lines.map((line) => line.leadWeeks[0]);
  const maxs = lines.map((line) => line.leadWeeks[1]);
  return [earliestStart ? Math.min(...mins) : Math.max(...mins), Math.max(...maxs)];
}

function buildWave(index, label, lines, earliestStart) {
  const windowWeeks = windowOf(lines, earliestStart);
  return {
    id: `wave-${String(index).padStart(2, '0')}`,
    code: `Wave ${String(index).padStart(2, '0')}`,
    label,
    windowWeeks,
    window: formatWeeks(windowWeeks),
    itemCount: lines.reduce((sum, line) => sum + line.qty, 0),
    netWeightKg: fromTenths(lines.reduce((sum, line) => sum + line.unitTenths * line.qty, 0)),
    lines: lines.map((line) => ({
      sku: line.sku,
      name: line.name,
      qty: line.qty,
      lead: formatWeeks(line.leadWeeks),
      driver: line.driver,
    })),
  };
}

function planWaves(lines, mode) {
  if (lines.length === 0) return { waves: [], note: '' };
  if (mode === 'consolidated') {
    return { waves: [buildWave(1, 'Consolidated Dispatch', lines, false)], note: '' };
  }
  const roughIn = lines.filter((line) => line.driver || line.leadWeeks[1] <= STOCK_MAX_WEEKS);
  const custom = lines.filter((line) => !roughIn.includes(line));
  const groups = [
    ['Rough-In & In-Stock Dispatch', roughIn, false],
    ['Custom Millwork & Luminaires', custom, true],
  ].filter(([, group]) => group.length > 0);
  const waves = groups.map(([label, group, earliest], i) => buildWave(i + 1, label, group, earliest));
  let note = `All lines qualify for Wave 01 (${waves[0].window}). Nothing to split.`;
  if (waves.length > 1) {
    note = roughIn.some((line) => line.driver)
      ? 'Wave 01 lands the driver and stock parts for wall rough-in. Fabricated parts follow in Wave 02.'
      : 'Stock parts ship first. Fabricated parts follow in Wave 02.';
  }
  return { waves, note };
}

function freightClassOf(grossTenths, longestCm) {
  if (grossTenths === 0) return null;
  if (grossTenths >= PALLET_MIN_KG * 10) return FREIGHT_CLASSES.pallet;
  if (grossTenths < PARCEL_MAX_KG * 10 && longestCm <= PARCEL_MAX_LENGTH_CM) return FREIGHT_CLASSES.parcel;
  return FREIGHT_CLASSES.van;
}

/**
 * Deterministic logistics manifest for a quote: mass, crated volume, crate
 * packing, freight class and dispatch waves. Pure data in, pure data out;
 * pricing is untouched.
 */
export function computeLogisticsSchedule(bagLines, electrical, options = {}) {
  const mode = isOneOf(options?.fulfilmentMode, FULFILMENT_MODES) ? options.fulfilmentMode : 'consolidated';
  const lines = collectLines(bagLines, electrical);

  const netTenths = lines.reduce((sum, line) => sum + line.unitTenths * line.qty, 0);
  const pieceCount = lines.reduce((sum, line) => sum + line.qty, 0);
  const tareTenths = pieceCount === 0 ? 0 : Math.max(toTenths(MIN_TARE_KG), Math.round(netTenths * TARE_RATIO));
  const grossTenths = netTenths + tareTenths;

  const bins = packCrates(lines);
  const tareShares = apportion(tareTenths, bins.map((bin) => Math.max(1, bin.netTenths)));
  let volumeCm3 = 0;
  let longestCm = 0;
  const crates = bins.map((bin, i) => {
    const dimsCm = crateDims(bin.type.id, bin.pieces);
    const cm3 = dimsCm.w * dimsCm.h * dimsCm.d;
    volumeCm3 += cm3;
    longestCm = Math.max(longestCm, dimsCm.w, dimsCm.h, dimsCm.d);
    const contents = contentsOf(bin.pieces);
    const n = String(i + 1).padStart(2, '0');
    return {
      id: `crt-${n}`,
      code: `CRT-${n}`,
      type: bin.type.id,
      label: bin.type.label,
      dimsCm,
      volumeM3: Math.round(cm3 / 1e3) / 1e3,
      netWeightKg: fromTenths(bin.netTenths),
      grossWeightKg: fromTenths(bin.netTenths + tareShares[i]),
      itemCount: bin.pieces.length,
      skus: contents.map((entry) => entry.sku),
      contents,
    };
  });

  const { waves, note } = planWaves(lines, mode);
  const windowLabel = waves.length === 0 ? '--' : waves.map((wave) => wave.window).join(' / ');
  const volume = Math.round(volumeCm3 / 1e4) / 100;

  return {
    mode,
    modeLabel: FULFILMENT_LABELS[mode],
    pieceCount,
    netWeightKg: fromTenths(netTenths),
    tareWeightKg: fromTenths(tareTenths),
    grossWeightKg: fromTenths(grossTenths),
    totalVolumeM3: crates.length > 0 ? Math.max(0.01, volume) : 0,
    longestCrateCm: longestCm,
    freightClass: freightClassOf(grossTenths, longestCm),
    crates,
    waves,
    windowLabel,
    note,
  };
}

/** Plain, explicitly shaped copy for the spec JSON export. */
export function serializeLogistics(logistics) {
  return {
    fulfilmentMode: logistics.mode,
    fulfilmentLabel: logistics.modeLabel,
    netWeightKg: logistics.netWeightKg,
    tareWeightKg: logistics.tareWeightKg,
    grossWeightKg: logistics.grossWeightKg,
    totalVolumeM3: logistics.totalVolumeM3,
    freightClass: logistics.freightClass,
    windowLabel: logistics.windowLabel,
    crates: logistics.crates.map((crate) => ({
      code: crate.code,
      label: crate.label,
      dimsCm: { ...crate.dimsCm },
      grossWeightKg: crate.grossWeightKg,
      itemCount: crate.itemCount,
      skus: [...crate.skus],
    })),
    waves: logistics.waves.map((wave) => ({
      code: wave.code,
      label: wave.label,
      window: wave.window,
      itemCount: wave.itemCount,
      lines: wave.lines.map((line) => ({ sku: line.sku, qty: line.qty, lead: line.lead })),
    })),
  };
}
