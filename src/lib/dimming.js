/**
 * DALI-2 dimming. Each powered module has an integer arc level `dimPct`
 * from 10 to 100. The field is held only below 100: a missing level reads
 * as 100, so records that predate dimming, and every undimmed layout, stay
 * identical in memory, storage and links, and every engine stays
 * bit-identical for them (the factor is exactly 1).
 *
 * Flux and active bus draw scale linearly with the level. Driver sizing
 * keeps the rated connected load, since any channel can be raised to 100%.
 */

export const DIM_RANGE = Object.freeze({ min: 10, max: 100, step: 5, initial: 100 });

export function sanitizeDimPct(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DIM_RANGE.initial;
  return Math.min(DIM_RANGE.max, Math.max(DIM_RANGE.min, Math.round(value)));
}

/** Arc level of a powered module; passive parts always hold 100. */
export function dimPctFor(product, value) {
  return product && product.watts > 0 ? sanitizeDimPct(value) : DIM_RANGE.initial;
}

/** The level as an item field: present only when the module is actually dimmed. */
export function dimPatch(product, value) {
  const level = dimPctFor(product, value);
  return level === DIM_RANGE.initial ? {} : { dimPct: level };
}

/** Copy of `item` at `level`, dropping the field at 100. */
export function withDimPct(item, level) {
  const { dimPct, ...rest } = item;
  return level === DIM_RANGE.initial ? rest : { ...rest, dimPct: level };
}

/** True when two records differ in any own field, including one present in only one of them. */
export function recordChanged(a, b) {
  const keys = Object.keys(a);
  return keys.length !== Object.keys(b).length || keys.some((key) => a[key] !== b[key]);
}

/** Output factor from the level alone, 0.1 to 1. The LED channel is checked by each engine. */
export function dimFactor(item) {
  return sanitizeDimPct(item?.dimPct) / 100;
}
