const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const INTEGER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatInt(value) {
  return INTEGER.format(Number.isFinite(value) ? value : 0);
}

/** Watts to 0.1 W: dimmed channels draw fractional loads. */
export function formatWatts(value) {
  const w = Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;
  return Number.isInteger(w) ? String(w) : w.toFixed(1);
}

export function formatUsd(value) {
  return USD.format(Number.isFinite(value) ? value : 0);
}

export function padIndex(value, width = 2) {
  return String(value).padStart(width, '0');
}

export function formatLeadTime([min, max]) {
  return min === max ? `${min} wk` : `${min}-${max} wk`;
}
