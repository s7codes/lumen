import { isOneOf, safeStorage, sanitizeMultilineText, sanitizeText } from '../security/sanitize.js';
import { recommendPsu, resolveBagLines } from './bag.js';
import { DRIVERS, driverUnit } from './drivers.js';
import { BUS_RATED_W, BUS_VOLTAGE } from './electrical.js';
import { computeLogisticsSchedule, serializeLogistics } from './logistics.js';

export { DRIVERS };

export const WALL_SPAN_MOUNTS = Object.freeze(['wall', 'recessed']);
export const CABLE_LEAD_IN_M = 3;
export const CABLE_TAIL_M = 0.5;
const CABLE_STEP_M = 0.5;

/**
 * Site hardware from the cart. Anchors follow the catalog mounting points;
 * wall span counts wall-hung and recessed parts. Each SELV circuit carries at
 * most 150 W and gets its own 3 m lead-in from the driver void; the trunk
 * then runs the wall span with a 0.5 m tail per powered part, rounded up to
 * the next 0.5 m.
 */
export function buildInstallation(bagLines) {
  let totalAnchors = 0;
  let totalLinearWidthCm = 0;
  let poweredUnits = 0;
  let loadW = 0;
  for (const { product, qty } of bagLines) {
    totalAnchors += product.mountingPoints * qty;
    if (WALL_SPAN_MOUNTS.includes(product.mount)) totalLinearWidthCm += product.dimsCm.w * qty;
    if (product.watts > 0) poweredUnits += qty;
    loadW += product.watts * qty;
  }
  const circuits = loadW <= 0 ? 0 : loadW <= BUS_RATED_W ? 1 : Math.ceil(loadW / BUS_RATED_W);
  const rawCableM = circuits * CABLE_LEAD_IN_M + totalLinearWidthCm / 100 + poweredUnits * CABLE_TAIL_M;
  const recommendedCableM = circuits === 0 ? 0 : Math.ceil(rawCableM / CABLE_STEP_M - 1e-9) * CABLE_STEP_M;
  return { totalAnchors, totalLinearWidthCm, recommendedCableM, circuits, poweredUnits, circuitRatedW: BUS_RATED_W };
}

export const CURRENCY_STORAGE_KEY = 'lumen_currency_v1';
export const VAT_RATE_PCT = 27;
export const QUOTE_FORMAT = 'lumen.quote';
export const QUOTE_VERSION = 1;
export const QUOTE_VALID_DAYS = 30;

export const ISSUER = Object.freeze({
  name: 'Lumen Architectural Systems',
  address: '1052 Budapest, Fenyiv utca 14',
  country: 'Hungary',
});

// Rates are exact ratios to USD so unit prices convert without float drift.
// `minor` is minor units per major unit: cents for USD and EUR, whole forints for HUF.
export const CURRENCIES = Object.freeze([
  Object.freeze({ code: 'USD', label: 'US Dollar', num: 1, den: 1, minor: 100 }),
  Object.freeze({ code: 'EUR', label: 'Euro', num: 92, den: 100, minor: 100 }),
  Object.freeze({ code: 'HUF', label: 'Hungarian Forint', num: 360, den: 1, minor: 1 }),
]);
export const CURRENCY_CODES = CURRENCIES.map((currency) => currency.code);
const CURRENCY_BY_CODE = new Map(CURRENCIES.map((currency) => [currency.code, currency]));

export const PROMOS = Object.freeze([
  Object.freeze({ code: 'LUMEN10', pct: 10, label: 'Lumen account' }),
  Object.freeze({ code: 'TRADE15', pct: 15, label: 'Trade programme' }),
  Object.freeze({ code: 'STUDIO20', pct: 20, label: 'Studio partner' }),
]);
const PROMO_BY_CODE = new Map(PROMOS.map((promo) => [promo.code, promo]));

export const FIELD_LIMITS = Object.freeze({ reference: 96, preparedFor: 96, notes: 600 });

const INTEGER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function getCurrency(code) {
  return CURRENCY_BY_CODE.get(code) ?? CURRENCIES[0];
}

export function loadCurrency() {
  return safeStorage.read(CURRENCY_STORAGE_KEY, {
    fallback: 'USD',
    validate: (value) => isOneOf(value, CURRENCY_CODES),
  });
}

export function persistCurrency(code) {
  return isOneOf(code, CURRENCY_CODES) ? safeStorage.write(CURRENCY_STORAGE_KEY, code) : false;
}

/** Case-insensitive, whitespace-tolerant lookup. Returns null for unknown codes. */
export function resolvePromo(input) {
  const code = sanitizeText(input, { maxLength: 24 }).replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{1,16}$/.test(code)) return null;
  return PROMO_BY_CODE.get(code) ?? null;
}

/** Whole-dollar USD price to integer minor units of `currency`, rounded half up. */
export function toMinor(priceUsd, currency) {
  return Math.round((priceUsd * currency.minor * currency.num) / currency.den);
}

/** ASCII money such as "USD 1,234.50" or "HUF 66,600". No locale glyphs or no-break spaces. */
export function formatMoney(minorUnits, currency) {
  const value = Number.isFinite(minorUnits) ? Math.round(minorUnits) : 0;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const whole = Math.floor(abs / currency.minor);
  const fraction = currency.minor > 1 ? `.${String(abs % currency.minor).padStart(2, '0')}` : '';
  return `${sign}${currency.code} ${INTEGER.format(whole)}${fraction}`;
}

/** The driver line that completes the electrical specification, or null for a passive-only bag. */
export function driverLine(psu) {
  if (psu.drivers === 0) return null;
  const driver = driverUnit(psu.id);
  return {
    key: `driver:${psu.id}`,
    sku: driver.sku,
    name: psu.id === 'driver-array' ? 'Multi-bus 24V Driver Array (150W units)' : driver.name,
    finish: 'RAL 7035',
    qty: psu.drivers,
    priceUsd: driver.priceUsd,
    watts: 0,
    driver: true,
  };
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function isoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Builds the quote in integer minor units. Discount and VAT are each rounded
 * once, half up, and gross is defined as their sum, so
 * net - discount + vat === gross holds exactly in every currency.
 */
export function buildQuote({
  items,
  currencyCode,
  promo = null,
  includeDriver = true,
  fulfilmentMode = 'consolidated',
  date = new Date(),
}) {
  const currency = getCurrency(currencyCode);
  const bagLines = resolveBagLines(items);
  const loadW = bagLines.reduce((sum, line) => sum + line.lineW, 0);
  const psu = recommendPsu(loadW);

  const lines = bagLines.map((line) => ({
    key: line.key,
    sku: line.product.sku,
    name: line.product.name,
    finish: line.finish.label,
    qty: line.qty,
    priceUsd: line.product.priceUsd,
    watts: line.product.watts,
    driver: false,
  }));
  const driver = includeDriver ? driverLine(psu) : null;
  if (driver) lines.push(driver);

  const priced = lines.map((line) => {
    const unitMinor = toMinor(line.priceUsd, currency);
    return { ...line, unitMinor, lineMinor: unitMinor * line.qty };
  });

  const net = priced.reduce((sum, line) => sum + line.lineMinor, 0);
  const pct = promo ? promo.pct : 0;
  const discount = Math.round((net * pct) / 100);
  const netAfterDiscount = net - discount;
  const vat = Math.round((netAfterDiscount * VAT_RATE_PCT) / 100);
  const gross = netAfterDiscount + vat;

  const fingerprint = [currency.code, promo?.code ?? '', ...priced.map((l) => `${l.sku}:${l.finish}:${l.qty}`)].join('|');
  const day = isoDate(date);
  const valid = new Date(date.getTime());
  valid.setDate(valid.getDate() + QUOTE_VALID_DAYS);
  const suffix = fnv1a(fingerprint).toString(36).toUpperCase().padStart(6, '0').slice(-6);

  const electrical = {
    busVoltage: BUS_VOLTAGE,
    loadW,
    currentA: loadW / BUS_VOLTAGE,
    psu,
    driverIncluded: Boolean(driver),
  };

  return {
    quoteId: `LMN-Q-${day.replaceAll('-', '')}-${suffix}`,
    date: day,
    validUntil: isoDate(valid),
    currency,
    promo,
    lines: priced,
    electrical,
    installation: buildInstallation(bagLines),
    logistics: computeLogisticsSchedule(bagLines, electrical, { fulfilmentMode }),
    totals: { net, discount, netAfterDiscount, vat, gross, vatPct: VAT_RATE_PCT, discountPct: pct },
  };
}

export function sanitizeProject(input) {
  return {
    reference: sanitizeText(input.reference, { maxLength: FIELD_LIMITS.reference }),
    preparedFor: sanitizeText(input.preparedFor, { maxLength: FIELD_LIMITS.preparedFor }),
    notes: sanitizeMultilineText(input.notes, { maxLength: FIELD_LIMITS.notes }),
  };
}

export function validateProject(project) {
  const errors = {};
  if (project.reference.length < 3) errors.reference = 'Enter a project reference, 3 characters minimum.';
  if (project.preparedFor.length < 2) errors.preparedFor = 'Enter the client or studio this quote is prepared for.';
  return errors;
}

/** Export payload: plain data in integer minor units. */
export function serializeQuote(quote, project) {
  return {
    format: QUOTE_FORMAT,
    version: QUOTE_VERSION,
    quoteId: quote.quoteId,
    date: quote.date,
    validUntil: quote.validUntil,
    issuer: { ...ISSUER },
    project: { ...project },
    currency: {
      code: quote.currency.code,
      minorUnitsPerMajor: quote.currency.minor,
      ratePerUsd: quote.currency.num / quote.currency.den,
    },
    promo: quote.promo ? { code: quote.promo.code, pct: quote.promo.pct } : null,
    electrical: {
      busVoltage: quote.electrical.busVoltage,
      loadW: quote.electrical.loadW,
      currentA: Number(quote.electrical.currentA.toFixed(2)),
      driver: quote.electrical.psu.label,
      drivers: quote.electrical.psu.drivers,
      capacityW: quote.electrical.psu.capacityW,
      driverIncluded: quote.electrical.driverIncluded,
    },
    installation: { ...quote.installation },
    logistics: serializeLogistics(quote.logistics),
    bom: quote.lines.map((line) => ({
      sku: line.sku,
      name: line.name,
      finish: line.finish,
      qty: line.qty,
      unitMinor: line.unitMinor,
      lineMinor: line.lineMinor,
    })),
    totals: { ...quote.totals },
  };
}
