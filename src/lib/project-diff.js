import { getFinish, getProduct } from '../data/products.js';
import { isOneOf } from '../security/sanitize.js';
import { sanitizeDimPct } from './dimming.js';
import { PROJECT_KINDS } from './project-library.js';
import {
  createRoomState,
  getFurniture,
  LIGHTING_MODES,
  ROOM_FORMAT,
  sanitizeRoomState,
  WALL_LABELS,
  wallOf,
} from './room-3d.js';
import { computeEnvironmentalPhysics } from './room-physics.js';
import { createLayout, LAYOUT_FORMAT, sanitizeLayout, summarizeWall } from './wall-studio.js';

/**
 * A/B comparison of two walls or rooms: KPI deltas (target minus base) and a
 * module-level change log. Pure and deterministic: the same two inputs always
 * give the same result, in the input order of the modules.
 */

// Decimal places each delta is rounded to, so float noise never reads as a change.
export const DIFF_METRICS = Object.freeze({
  modules: 0,
  loadW: 1,
  activeW: 1,
  fluxLm: 0,
  priceUsd: 2,
  luxAvg: 0,
  rt60Sec: 2,
  stiScore: 2,
});

export const CHANGE_KINDS = Object.freeze(['added', 'removed', 'modified']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function round(value, digits) {
  const scale = 10 ** digits;
  // `|| 0` folds -0 into 0.
  return Math.round(value * scale) / scale || 0;
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function emptyState(kind) {
  return kind === 'room' ? createRoomState() : createLayout();
}

/**
 * Reads a cloud record ({ kind, data }) or a bare wall layout / room state
 * and rebuilds it through the planner sanitizers. Returns { kind, state }, or
 * null when the input is neither.
 */
export function resolveProjectState(input) {
  if (!isRecord(input)) return null;
  if (isOneOf(input.kind, PROJECT_KINDS) && isRecord(input.data)) {
    const state = input.kind === 'wall' ? sanitizeLayout(input.data) : sanitizeRoomState(input.data);
    return state ? { kind: input.kind, state } : null;
  }
  if (input.format === LAYOUT_FORMAT) {
    const state = sanitizeLayout(input);
    return state ? { kind: 'wall', state } : null;
  }
  if (input.format === ROOM_FORMAT) {
    const state = sanitizeRoomState(input);
    return state ? { kind: 'room', state } : null;
  }
  return null;
}

/** The figures a comparison reads, from the same engines as the planner summaries. */
export function projectMetrics(state) {
  const summary = summarizeWall(state);
  const physics = computeEnvironmentalPhysics(state);
  return {
    modules: summary.modules,
    loadW: summary.loadW,
    activeW: summary.activeW,
    fluxLm: summary.lumens,
    priceUsd: summary.priceUsd,
    luxAvg: physics.avgFloorLux,
    rt60Sec: physics.rt60Sec,
    stiScore: physics.stiScore,
  };
}

function productName(item) {
  return getProduct(item.productId)?.name ?? item.productId;
}

function finishLabel(id) {
  return getFinish(id)?.label ?? id;
}

function placement(item, room) {
  const parts = [finishLabel(item.finish), `X ${item.xCm} / Y ${item.yCm} cm`];
  if (room) parts.unshift(WALL_LABELS[wallOf(item)]);
  if (item.led === false && getProduct(item.productId)?.watts > 0) parts.push('channel off');
  else if (sanitizeDimPct(item.dimPct) < 100) parts.push(`dimmed ${sanitizeDimPct(item.dimPct)}%`);
  return parts.join(' / ');
}

function moduleEntry(item, room) {
  return {
    uid: item.uid,
    productId: item.productId,
    name: productName(item),
    finish: item.finish,
    wall: wallOf(item),
    xCm: item.xCm,
    yCm: item.yCm,
    summary: placement(item, room),
  };
}

/**
 * Field-level differences between two matched modules, in a fixed order:
 * wall, position, finish, LED channel, dim level. A module rehung on another
 * wall reports the wall only, since its X/Y now sit in a different frame.
 */
export function describeModuleChange(base, target) {
  const details = [];
  const fromWall = wallOf(base);
  const toWall = wallOf(target);
  if (fromWall !== toWall) {
    details.push({
      field: 'wall',
      from: fromWall,
      to: toWall,
      text: `Rehung ${WALL_LABELS[fromWall]} to ${WALL_LABELS[toWall]}`,
    });
  } else {
    const dx = target.xCm - base.xCm;
    const dy = target.yCm - base.yCm;
    if (dx !== 0 || dy !== 0) {
      const axes = [];
      if (dx !== 0) axes.push(`${signed(dx)} cm X`);
      if (dy !== 0) axes.push(`${signed(dy)} cm Y`);
      details.push({
        field: 'position',
        from: { xCm: base.xCm, yCm: base.yCm },
        to: { xCm: target.xCm, yCm: target.yCm },
        text: `Moved ${axes.join(', ')}`,
      });
    }
  }
  if (base.finish !== target.finish) {
    details.push({
      field: 'finish',
      from: base.finish,
      to: target.finish,
      text: `Finish ${finishLabel(base.finish)} to ${finishLabel(target.finish)}`,
    });
  }
  if (Boolean(base.led) !== Boolean(target.led)) {
    details.push({
      field: 'led',
      from: Boolean(base.led),
      to: Boolean(target.led),
      text: target.led ? 'Channel switched on' : 'Channel switched off',
    });
  }
  const fromLevel = sanitizeDimPct(base.dimPct);
  const toLevel = sanitizeDimPct(target.dimPct);
  if (fromLevel !== toLevel) {
    details.push({
      field: 'dimPct',
      from: fromLevel,
      to: toLevel,
      text: `${toLevel < fromLevel ? 'Dimmed' : 'Raised'} ${fromLevel}% to ${toLevel}%`,
    });
  }
  return details;
}

/**
 * Pairs base and target modules. First by uid, when the uid still names the
 * same part; then each unpaired target module takes the nearest unpaired
 * base module of the same part on the same wall (Manhattan distance, ties to
 * the earlier module). Returns [baseIndex, targetIndex] pairs in target order.
 */
export function pairModules(baseItems, targetItems) {
  const baseByUid = new Map(baseItems.map((item, index) => [item.uid, index]));
  const usedBase = new Set();
  const pairedTarget = new Map();

  targetItems.forEach((item, t) => {
    const b = baseByUid.get(item.uid);
    if (b === undefined || usedBase.has(b) || baseItems[b].productId !== item.productId) return;
    usedBase.add(b);
    pairedTarget.set(t, b);
  });

  targetItems.forEach((item, t) => {
    if (pairedTarget.has(t)) return;
    let best = -1;
    let bestDistance = Infinity;
    baseItems.forEach((candidate, b) => {
      if (usedBase.has(b) || candidate.productId !== item.productId || wallOf(candidate) !== wallOf(item)) return;
      const distance = Math.abs(candidate.xCm - item.xCm) + Math.abs(candidate.yCm - item.yCm);
      if (distance < bestDistance) {
        best = b;
        bestDistance = distance;
      }
    });
    if (best === -1) return;
    usedBase.add(best);
    pairedTarget.set(t, best);
  });

  return [...pairedTarget.entries()].sort((a, b) => a[0] - b[0]).map(([t, b]) => [b, t]);
}

function envelopeFacts(kind, state) {
  if (kind === 'wall') {
    const { widthCm, heightCm, slope, surface } = state.wall;
    return [
      ['Wall', `${widthCm} x ${heightCm} cm`],
      ['Attic slope', slope ? 'on' : 'off'],
      ['Surface', surface === 'daylight' ? 'Daylight' : 'Ambient'],
    ];
  }
  const { widthCm, depthCm, heightCm, lighting, furniture } = state.room;
  return [
    ['Room', `${widthCm} x ${depthCm} x ${heightCm} cm`],
    ['Lighting', LIGHTING_MODES.find((mode) => mode.id === lighting)?.label ?? lighting],
    ['Floor reference', getFurniture(furniture)?.label ?? furniture],
  ];
}

/** Envelope differences: dimensions, slope, surface or lighting, floor reference. */
export function diffEnvelope(base, target) {
  if (base.kind !== target.kind) {
    const label = (kind) => (kind === 'wall' ? '2D wall' : '3D room');
    return [{ field: 'kind', from: base.kind, to: target.kind, text: `Project type ${label(base.kind)} to ${label(target.kind)}` }];
  }
  const from = envelopeFacts(base.kind, base.state);
  const to = envelopeFacts(target.kind, target.state);
  return from
    .map(([field, value], i) => ({ field, from: value, to: to[i][1], text: `${field} ${value} to ${to[i][1]}` }))
    .filter((entry) => entry.from !== entry.to);
}

/**
 * Compares `base` (A, the baseline or cloud revision) with `target` (B, the
 * draft or another project). Each input is a cloud record or a bare state; an
 * unreadable input compares as an empty project of the other side's kind.
 *
 * deltas: { modules, loadW, activeW, fluxLm, priceUsd, luxAvg, rt60Sec,
 * stiScore }, each { base, target, delta }. A negative rt60Sec delta is
 * added damping. changes: { added, removed, modified, unchanged }.
 */
export function compareProjectStates(baseInput, targetInput) {
  const resolvedBase = resolveProjectState(baseInput);
  const resolvedTarget = resolveProjectState(targetInput);
  const baseKind = resolvedBase?.kind ?? resolvedTarget?.kind ?? 'wall';
  const targetKind = resolvedTarget?.kind ?? baseKind;
  const base = resolvedBase ?? { kind: baseKind, state: emptyState(baseKind) };
  const target = resolvedTarget ?? { kind: targetKind, state: emptyState(targetKind) };

  const a = projectMetrics(base.state);
  const b = projectMetrics(target.state);
  const deltas = {};
  for (const [key, digits] of Object.entries(DIFF_METRICS)) {
    deltas[key] = { base: a[key], target: b[key], delta: round(b[key] - a[key], digits) };
  }

  const baseItems = base.state.items;
  const targetItems = target.state.items;
  const room = base.kind === 'room' || target.kind === 'room';
  const pairs = pairModules(baseItems, targetItems);
  const pairedBase = new Set(pairs.map(([i]) => i));
  const pairedTarget = new Set(pairs.map(([, j]) => j));

  const modified = [];
  let unchanged = 0;
  for (const [i, j] of pairs) {
    const details = describeModuleChange(baseItems[i], targetItems[j]);
    if (details.length === 0) {
      unchanged += 1;
      continue;
    }
    modified.push({
      ...moduleEntry(targetItems[j], room),
      baseUid: baseItems[i].uid,
      fields: details.map((detail) => detail.field),
      details,
      summary: details.map((detail) => detail.text).join(' / '),
    });
  }

  const added = targetItems.filter((_, j) => !pairedTarget.has(j)).map((item) => moduleEntry(item, room));
  const removed = baseItems.filter((_, i) => !pairedBase.has(i)).map((item) => moduleEntry(item, room));
  const envelope = diffEnvelope(base, target);

  return {
    kinds: { base: base.kind, target: target.kind },
    subjects: { base, target },
    deltas,
    changes: { added, removed, modified, unchanged },
    envelope,
    identical: added.length === 0 && removed.length === 0 && modified.length === 0 && envelope.length === 0,
  };
}

/** A delta as signed text: "+2", "-0.04", "0". `digits` fixes the decimals. */
export function formatSignedDelta(delta, digits = 0, format = null) {
  const magnitude = format ? format(Math.abs(delta)) : Math.abs(delta).toFixed(digits);
  if (delta > 0) return `+${magnitude}`;
  if (delta < 0) return `-${magnitude}`;
  return magnitude;
}
