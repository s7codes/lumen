import { getProduct } from '../data/products.js';
import { BUS_VOLTAGE, busCurrent, CONDUCTOR_MM2, DROP_LIMIT, voltageDrop } from './electrical.js';

export const FEED_DATUM = Object.freeze({ xCm: 20, yCm: 30 });
export const TRACK_BUS_ID = 'track-bus-200';
export const BUS_HUB_ID = 'power-hub-dali';
// Passive 24V parts: either can feed the run, and every other one is a pass-through node.
export const BUS_FEED_IDS = Object.freeze([TRACK_BUS_ID, BUS_HUB_ID]);
const FEED_KIND = new Map([
  [TRACK_BUS_ID, 'track'],
  [BUS_HUB_ID, 'hub'],
]);

function isBusPart(product) {
  return FEED_KIND.has(product.id);
}
export const DROP_LIMIT_PCT = DROP_LIMIT * 100;
export const CONDUCTOR_LABEL = `2 x ${CONDUCTOR_MM2} mm2`;

const MAX_NODES = 64;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function round(value, places) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function dimensions(source) {
  const frame = isRecord(source?.wall) ? source.wall : isRecord(source?.room) ? source.room : {};
  return {
    widthCm: isFiniteNumber(frame.widthCm) ? frame.widthCm : 0,
    heightCm: isFiniteNumber(frame.heightCm) ? frame.heightCm : 0,
  };
}

/**
 * Where the 24V pigtail lands on each part, in wall cm (y up from FFL):
 * track bus at its left end cap, the DALI-2 hub at its terminal block,
 * ceiling parts at the canopy, everything else at the bottom centre where the
 * driver lead exits.
 */
export function feedPoint(item, product) {
  const { w, h } = product.dimsCm;
  if (product.id === TRACK_BUS_ID) return { xCm: item.xCm, yCm: item.yCm + h / 2 };
  if (product.id === BUS_HUB_ID) return { xCm: item.xCm + w / 2, yCm: item.yCm + h / 2 };
  if (product.mount === 'ceiling') return { xCm: item.xCm + w / 2, yCm: item.yCm + h };
  return { xCm: item.xCm + w / 2, yCm: item.yCm };
}

function manhattan(a, b) {
  return Math.abs(a.xCm - b.xCm) + Math.abs(a.yCm - b.yCm);
}

/** Horizontal leg at the source height, then the vertical drop or rise. Zero-length legs are skipped. */
function route(from, to, order, toUid) {
  const legs = [];
  if (from.xCm !== to.xCm) legs.push({ x1: from.xCm, y1: from.yCm, x2: to.xCm, y2: from.yCm, order, toUid });
  if (from.yCm !== to.yCm) legs.push({ x1: to.xCm, y1: from.yCm, x2: to.xCm, y2: to.yCm, order, toUid });
  return legs;
}

/**
 * Greedy nearest-neighbour chain from the feed. Ties break left to right,
 * then bottom to top, then by uid, so the same wall always wires the same way.
 */
function orderChain(origin, candidates) {
  const pool = [...candidates];
  const chain = [];
  let cursor = origin;
  while (pool.length > 0) {
    const from = cursor;
    const rank = (a, b) =>
      manhattan(from, a.point) - manhattan(from, b.point) ||
      a.point.xCm - b.point.xCm ||
      a.point.yCm - b.point.yCm ||
      String(a.uid).localeCompare(String(b.uid));
    let best = 0;
    for (let i = 1; i < pool.length; i += 1) {
      if (rank(pool[i], pool[best]) < 0) best = i;
    }
    const [next] = pool.splice(best, 1);
    chain.push(next);
    cursor = next.point;
  }
  return chain;
}

/**
 * 24V DC daisy-chain for a wall layout ({ wall, items }) or a 3D room
 * ({ room, items }, main wall). The feed sits at the utility datum, or at
 * the first mounted track bus or bus hub. Every lit module and every other
 * passive bus part becomes a node.
 *
 * Drop model: each hop carries the current of every node downstream of it,
 * on a 2 x 2.5 mm2 copper loop. The worst case is the sum of hop drops at
 * the last node.
 */
export function computeBusTopology(layoutOrRoom) {
  const { widthCm, heightCm } = dimensions(layoutOrRoom);
  const items = Array.isArray(layoutOrRoom?.items) ? layoutOrRoom.items : [];

  const parts = [];
  for (const item of items) {
    if (!isRecord(item) || !isFiniteNumber(item.xCm) || !isFiniteNumber(item.yCm)) continue;
    const product = getProduct(item.productId);
    if (!product) continue;
    parts.push({ item, product });
  }

  const feedTrack = parts.find(({ product }) => isBusPart(product)) ?? null;
  const origin = feedTrack
    ? {
        ...feedPoint(feedTrack.item, feedTrack.product),
        kind: FEED_KIND.get(feedTrack.product.id),
        uid: feedTrack.item.uid,
      }
    : { ...FEED_DATUM, kind: 'datum', uid: null };

  const candidates = parts
    .filter(({ item, product }) => {
      if (feedTrack && item === feedTrack.item) return false;
      if (isBusPart(product)) return true;
      return product.watts > 0 && item.led !== false && item.ledOn !== false;
    })
    .slice(0, MAX_NODES)
    .map(({ item, product }) => ({
      uid: item.uid,
      productId: product.id,
      watts: isBusPart(product) ? 0 : product.watts,
      point: feedPoint(item, product),
    }));

  const chain = orderChain(origin, candidates);
  const activeWatts = chain.reduce((sum, node) => sum + node.watts, 0);

  const segments = [];
  const nodes = [];
  let cursor = origin;
  let downstreamW = activeWatts;
  let runCm = 0;
  let dropV = 0;

  chain.forEach((node, i) => {
    const order = i + 1;
    const hopCm = manhattan(cursor, node.point);
    segments.push(...route(cursor, node.point, order, node.uid));
    runCm += hopCm;
    dropV += voltageDrop(downstreamW, hopCm / 100).volts;
    downstreamW -= node.watts;
    nodes.push({
      uid: node.uid,
      productId: node.productId,
      order,
      label: `N${String(order).padStart(2, '0')}`,
      xCm: node.point.xCm,
      yCm: node.point.yCm,
      watts: node.watts,
      hopCm,
      hopM: round(hopCm / 100, 2),
      dropV: round(dropV, 3),
    });
    cursor = node.point;
  });

  const voltageDropPct = (dropV / BUS_VOLTAGE) * 100;

  return {
    wall: { widthCm, heightCm },
    origin,
    nodes,
    segments,
    totalRunCm: round(runCm, 1),
    totalRunM: round(runCm / 100, 2),
    activeWatts,
    currentA: round(busCurrent(activeWatts), 3),
    voltageDropV: round(dropV, 3),
    voltageDropPct: round(voltageDropPct, 2),
    withinSpec: voltageDropPct <= DROP_LIMIT_PCT,
    limitPct: DROP_LIMIT_PCT,
    conductor: CONDUCTOR_LABEL,
    busVoltage: BUS_VOLTAGE,
  };
}

/** "Run 3.4 m / 1.42 A / 0.21 V drop (0.9%)" */
export function formatBusTelemetry(topology) {
  return `Run ${topology.totalRunM.toFixed(1)} m / ${topology.currentA.toFixed(2)} A / ${topology.voltageDropV.toFixed(2)} V drop (${topology.voltageDropPct.toFixed(1)}%)`;
}
