const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatUsd(value) {
  return USD.format(Number.isFinite(value) ? value : 0);
}

export function padIndex(value, width = 2) {
  return String(value).padStart(width, '0');
}

export function formatLeadTime([min, max]) {
  return min === max ? `${min} wk` : `${min}-${max} wk`;
}
