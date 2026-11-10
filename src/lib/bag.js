import { getFinish, getProduct, productHasFinish } from '../data/products.js';
import { isSafeId, safeStorage } from '../security/sanitize.js';

export const BAG_STORAGE_KEY = 'lumen_bag_v1';
export const MAX_LINE_QTY = 99;

const MAX_STORED_ENTRIES = 256;
const DRIVER_60W = 60;
const DRIVER_150W = 150;

export function lineKey(id, finish) {
  return `${id}:${finish}`;
}

function isValidQty(qty) {
  return Number.isInteger(qty) && qty >= 1 && qty <= MAX_LINE_QTY;
}

function isOrderable(id, finish) {
  return isSafeId(id) && isSafeId(finish) && productHasFinish(getProduct(id), finish);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Rebuilds bag lines from untrusted input (storage, another tab). A line
 * survives only if its product exists, ships in the stated finish and has an
 * integer quantity in 1..99. Duplicate lines merge and clamp to the cap.
 */
export function sanitizeBagItems(input) {
  if (!Array.isArray(input)) return [];

  const merged = new Map();
  for (const entry of input.slice(0, MAX_STORED_ENTRIES)) {
    if (!isRecord(entry)) continue;
    const { id, finish, qty } = entry;
    if (!isOrderable(id, finish) || !isValidQty(qty)) continue;

    const key = lineKey(id, finish);
    const previous = merged.get(key)?.qty ?? 0;
    merged.set(key, { id, finish, qty: Math.min(MAX_LINE_QTY, previous + qty) });
  }
  return [...merged.values()];
}

function sameItems(a, b) {
  return (
    a.length === b.length &&
    a.every((line, i) => line.id === b[i].id && line.finish === b[i].finish && line.qty === b[i].qty)
  );
}

function findLine(state, id, finish) {
  const key = lineKey(id, finish);
  return state.findIndex((line) => lineKey(line.id, line.finish) === key);
}

function withQty(state, index, qty) {
  if (index === -1 || !isValidQty(qty) || state[index].qty === qty) return state;
  return state.map((line, i) => (i === index ? { ...line, qty } : line));
}

export function bagReducer(state, action) {
  switch (action?.type) {
    case 'add': {
      const qty = action.qty ?? 1;
      if (!isOrderable(action.id, action.finish) || !isValidQty(qty)) return state;
      const index = findLine(state, action.id, action.finish);
      if (index === -1) return [...state, { id: action.id, finish: action.finish, qty }];
      return withQty(state, index, Math.min(MAX_LINE_QTY, state[index].qty + qty));
    }
    case 'step': {
      if (action.delta !== 1 && action.delta !== -1) return state;
      const index = findLine(state, action.id, action.finish);
      return index === -1 ? state : withQty(state, index, state[index].qty + action.delta);
    }
    case 'remove': {
      const index = findLine(state, action.id, action.finish);
      return index === -1 ? state : state.filter((_, i) => i !== index);
    }
    case 'merge': {
      if (!Array.isArray(action.lines)) return state;
      return action.lines.reduce(
        (next, line) => bagReducer(next, { type: 'add', id: line?.id, finish: line?.finish, qty: line?.qty }),
        state,
      );
    }
    case 'clear':
      return state.length === 0 ? state : [];
    case 'hydrate': {
      const next = sanitizeBagItems(action.items);
      return sameItems(state, next) ? state : next;
    }
    default:
      return state;
  }
}

/**
 * Driver sizing for the 24V bus. Up to 60W runs on one 60W driver, up to
 * 150W on one 150W driver. Above that the load is split across several
 * 150W drivers, each feeding its own bus run.
 */
export function recommendPsu(loadW) {
  const load = Number.isFinite(loadW) && loadW > 0 ? loadW : 0;

  if (load === 0) {
    return { id: 'none', label: 'No driver required', drivers: 0, capacityW: 0, utilisation: 0 };
  }
  if (load <= DRIVER_60W) {
    return {
      id: 'driver-60',
      label: '1x Lumen 60W 24V Driver',
      drivers: 1,
      capacityW: DRIVER_60W,
      utilisation: load / DRIVER_60W,
    };
  }
  if (load <= DRIVER_150W) {
    return {
      id: 'driver-150',
      label: '1x Lumen 150W 24V Driver',
      drivers: 1,
      capacityW: DRIVER_150W,
      utilisation: load / DRIVER_150W,
    };
  }

  const drivers = Math.ceil(load / DRIVER_150W);
  return {
    id: 'driver-array',
    label: 'Multi-bus 24V Driver Array',
    drivers,
    capacityW: drivers * DRIVER_150W,
    utilisation: load / (drivers * DRIVER_150W),
  };
}

export function resolveBagLines(items) {
  return items.flatMap((item) => {
    const product = getProduct(item.id);
    const finish = getFinish(item.finish);
    if (!product || !finish) return [];
    return [
      {
        key: lineKey(item.id, item.finish),
        id: item.id,
        qty: item.qty,
        product,
        finish,
        lineUsd: product.priceUsd * item.qty,
        lineW: product.watts * item.qty,
      },
    ];
  });
}

export function summarizeBag(items) {
  const lines = resolveBagLines(items);
  let count = 0;
  let subtotalUsd = 0;
  let loadW = 0;
  for (const line of lines) {
    count += line.qty;
    subtotalUsd += line.lineUsd;
    loadW += line.lineW;
  }
  return { lines, count, subtotalUsd, loadW, psu: recommendPsu(loadW) };
}

export function loadBag() {
  return sanitizeBagItems(safeStorage.read(BAG_STORAGE_KEY, { fallback: [], validate: Array.isArray }));
}

export function persistBag(items) {
  return items.length === 0
    ? safeStorage.remove(BAG_STORAGE_KEY)
    : safeStorage.write(BAG_STORAGE_KEY, items);
}
