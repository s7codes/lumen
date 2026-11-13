import { CATEGORIES, FINISH_IDS, FINISHES, getFinish, getProduct, PRODUCTS, productHasFinish, STOCK_LABELS } from '../data/products.js';
import { sanitizeText } from '../security/sanitize.js';
import { bagReducer, MAX_LINE_QTY, recommendPsu, resolveBagLines, sanitizeBagItems } from './bag.js';
import { computeBusTopology, CONDUCTOR_LABEL, DROP_LIMIT_PCT } from './bus-topology.js';
import {
  CONCIERGE_CATEGORIES,
  ESCALATION_NOTICE,
  evaluateConciergeQuery,
  noiseReductionCoefficient,
  QUESTION_MAX,
  sanitizeWorkspaceContext,
  validateWorkspaceContext,
} from './concierge-engine.js';
import { DIM_RANGE } from './dimming.js';
import { DRIVERS } from './drivers.js';
import { BUS_RATED_W, BUS_VOLTAGE, LOOP_OHM_PER_M, maxRunM } from './electrical.js';
import { computeFloorLuxField } from './illuminance-field.js';
import { applyLightingSceneToLayout, applyLightingSceneToRoom, getLightingScene, LIGHTING_SCENE_IDS, LIGHTING_SCENES } from './lighting-scenes.js';
import { computeLogisticsSchedule } from './logistics.js';
import { buildQuote, CURRENCY_CODES, formatMoney, getCurrency, toMinor } from './quote.js';
import {
  clearRoomWall,
  createRoomState,
  findRoomConflicts,
  FURNITURE,
  getFurniture,
  LIGHTING_MODES,
  mountInRoom,
  removeRoomItem,
  ROOM_DEPTH,
  ROOM_HEIGHT,
  ROOM_SIZE_PRESETS,
  ROOM_WALLS,
  ROOM_WIDTH,
  roomSizePreset,
  serializeRoomState,
  unrolledRoom,
  updateRoom,
  updateRoomItem,
  WALL_LABELS,
  wallCounts,
  wallOf,
} from './room-3d.js';
import { OCTAVE_ALPHA, OCTAVE_LABELS, STI_GRADES, computeEnvironmentalPhysics } from './room-physics.js';
import { CAMERA_MODE_LABELS, CAMERA_MODES, EYE_HEIGHT_CM } from './room-walkthrough.js';
import {
  aggregateBagLines,
  createLayout,
  findConflicts,
  MAX_WALL_ITEMS,
  mountProduct,
  removeItem,
  serializeLayout,
  SURFACES,
  summarizeWall,
  updateItem,
  updateWall,
  WALL_HEIGHT,
  WALL_WIDTH,
} from './wall-studio.js';

/**
 * Lumen Spatial MCP server. A transport-free Model Context Protocol endpoint
 * (JSON-RPC 2.0, protocol revision 2025-06-18) over the catalog, the platform
 * engines and the caller's live workspace. server/app.js mounts it at
 * POST /api/mcp; the concierge orchestrator and the LLM agent call it
 * in-process through the same handleMcpRequest entry point.
 *
 * Pure and stateless: a tool never writes storage. Mutation tools return the
 * next sanitized room, wall or cart as `clientActions`, and the browser's
 * workspace bus applies them as one undoable step.
 */

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_SERVER_NAME = 'lumen-spatial-mcp';
export const MCP_WORKSPACE_META = 'lumen/workspace';

export const JSONRPC_ERRORS = Object.freeze({
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  resourceNotFound: -32002,
});

export const CLIENT_ACTION_TYPES = Object.freeze(['apply_room_state', 'apply_wall_state', 'apply_bag_items']);
export const MUTATION_TOOLS = Object.freeze(['mutate_3d_room', 'mutate_2d_wall', 'manage_cart_bag']);

const METHOD_PATTERN = /^[A-Za-z][A-Za-z0-9_/.-]{0,63}$/;
/**
 * Deepest container nesting a message may carry. The deepest legitimate shape
 * is a room or wall draft in `params._meta["lumen/workspace"]`, seven levels
 * down; anything past twelve is refused before any method runs.
 */
export const MCP_MAX_DEPTH = 12;
const UID_PATTERN = '^m[0-9]{1,4}$';
const MAX_MOUNTS = 6;
const MAX_CATALOG_ROWS = 12;
// Quotes are dated for their id only; a fixed date keeps tool output pure.
const QUOTE_DATE = new Date(Date.UTC(2026, 0, 1));

const PRODUCT_IDS = PRODUCTS.map((product) => product.id);
const SHAPES = [...new Set(PRODUCTS.map((product) => product.shape))];
const CATEGORY_IDS = CATEGORIES.map((category) => category.id);
const SCALE_IDS = ROOM_SIZE_PRESETS.map((preset) => preset.id);
const FURNITURE_IDS = FURNITURE.map((entry) => entry.id);
const LIGHTING_MODE_IDS = LIGHTING_MODES.map((mode) => mode.id);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function round(value, places) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function plural(count, word, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`;
}

/* JSON Schema (the subset the tool contracts use) */

const int = (minimum, maximum, description) => ({ type: 'integer', minimum, maximum, ...(description ? { description } : {}) });
const choice = (values, description) => ({ type: 'string', enum: [...values], ...(description ? { description } : {}) });

const MOUNT_SCHEMA = {
  type: 'object',
  description: 'One part to mount.',
  properties: {
    productId: choice(PRODUCT_IDS, 'Catalog id of the part.'),
    wall: choice(ROOM_WALLS, 'Room wall to mount on (3D room only). Defaults to north.'),
    finish: choice(FINISH_IDS, 'Finish id. Defaults to the part default finish.'),
    xCm: int(0, 900, 'Left edge along the wall in cm.'),
    yCm: int(0, 420, 'Bottom edge above the floor in cm.'),
    dimPct: int(DIM_RANGE.min, DIM_RANGE.max, 'DALI-2 arc level, 10 to 100.'),
    qty: int(1, MAX_MOUNTS, 'How many to mount, 1 to 6.'),
  },
  required: ['productId'],
  additionalProperties: false,
};

const MODULE_SCHEMA = {
  type: 'object',
  properties: {
    productId: choice(PRODUCT_IDS),
    finish: choice(FINISH_IDS),
    qty: int(1, MAX_MOUNTS),
  },
  required: ['productId'],
  additionalProperties: false,
};

function validateSchema(schema, value, path = 'arguments') {
  switch (schema.type) {
    case 'object': {
      if (!isRecord(value)) return `${path} must be an object.`;
      for (const key of schema.required ?? []) {
        if (value[key] === undefined) return `${path}.${key} is required.`;
      }
      for (const key of Object.keys(value)) {
        const child = schema.properties?.[key];
        if (!child || !Object.hasOwn(schema.properties, key)) {
          if (schema.additionalProperties === false) return `${path}.${key} is not a known field.`;
          continue;
        }
        if (value[key] === undefined) continue;
        const error = validateSchema(child, value[key], `${path}.${key}`);
        if (error) return error;
      }
      return null;
    }
    case 'array': {
      if (!Array.isArray(value)) return `${path} must be an array.`;
      if (schema.minItems !== undefined && value.length < schema.minItems) return `${path} needs at least ${schema.minItems} entries.`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} holds at most ${schema.maxItems} entries.`;
      for (let i = 0; i < value.length; i += 1) {
        const error = validateSchema(schema.items, value[i], `${path}[${i}]`);
        if (error) return error;
      }
      return null;
    }
    case 'string': {
      if (typeof value !== 'string') return `${path} must be text.`;
      if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(', ')}.`;
      if (schema.minLength !== undefined && value.length < schema.minLength) return `${path} is too short.`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} is limited to ${schema.maxLength} characters.`;
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path} is not in the expected format.`;
      return null;
    }
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} must be a number.`;
      if (schema.type === 'integer' && !Number.isInteger(value)) return `${path} must be a whole number.`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${path} must be at least ${schema.minimum}.`;
      if (schema.maximum !== undefined && value > schema.maximum) return `${path} must be at most ${schema.maximum}.`;
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `${path} must be true or false.`;
    default:
      return null;
  }
}

/* Workspace telemetry */

function lightFigures(subject, physics) {
  const field = computeFloorLuxField(subject);
  return { avgLux: physics.avgFloorLux, peakLux: field.peakLux, minLux: field.minLux, grade: physics.lightingGrade };
}

function acousticFigures(physics) {
  return {
    rt60Sec: physics.rt60Sec,
    baselineRt60Sec: physics.baselineRt60Sec,
    octaveRt60: physics.octaveRt60,
    stiScore: physics.stiScore,
    stiGrade: physics.stiGrade,
  };
}

function powerFigures(summary, bus) {
  return {
    ratedW: summary.loadW,
    activeW: summary.activeW,
    lumens: summary.lumens,
    psu: summary.psu.label,
    psuDrivers: summary.psu.drivers,
    psuUtilisationPct: Math.round(summary.psu.utilisation * 100),
    bus: {
      runM: bus.totalRunM,
      currentA: bus.currentA,
      dropV: bus.voltageDropV,
      dropPct: bus.voltageDropPct,
      withinSpec: bus.withinSpec,
      limitPct: bus.limitPct,
    },
  };
}

export function roomTelemetry(state) {
  const summary = summarizeWall(state);
  const physics = computeEnvironmentalPhysics(state);
  const preset = ROOM_SIZE_PRESETS.find((entry) => entry.id === roomSizePreset(state.room));
  return {
    envelope: {
      widthCm: state.room.widthCm,
      depthCm: state.room.depthCm,
      heightCm: state.room.heightCm,
      preset: preset?.id ?? null,
      presetLabel: preset?.label ?? 'Custom',
      furniture: state.room.furniture,
      lighting: state.room.lighting,
    },
    modules: summary.modules,
    perWall: wallCounts(state.items),
    ...powerFigures(summary, computeBusTopology(unrolledRoom(state))),
    acoustics: acousticFigures(physics),
    light: lightFigures(state, physics),
    conflicts: findRoomConflicts(state).size,
  };
}

export function wallTelemetry(layout) {
  const summary = summarizeWall(layout);
  const physics = computeEnvironmentalPhysics(layout);
  return {
    envelope: { ...layout.wall },
    modules: summary.modules,
    ...powerFigures(summary, computeBusTopology(layout)),
    acoustics: acousticFigures(physics),
    light: lightFigures(layout, physics),
    conflicts: findConflicts(layout).size,
  };
}

export function cartTelemetry(items, currencyCode) {
  const quote = buildQuote({ items, currencyCode, date: QUOTE_DATE });
  return {
    lines: items.length,
    pieces: items.reduce((sum, line) => sum + line.qty, 0),
    currency: quote.currency.code,
    gross: formatMoney(quote.totals.gross, quote.currency),
    grossMinor: quote.totals.gross,
    ratedW: quote.electrical.loadW,
    psu: quote.electrical.psu.label,
    crates: quote.logistics.crates.length,
    freightClass: quote.logistics.freightClass,
    grossWeightKg: quote.logistics.grossWeightKg,
    dispatch: quote.logistics.windowLabel,
  };
}

function roomLine(t) {
  return `${t.envelope.widthCm} x ${t.envelope.depthCm} x ${t.envelope.heightCm} cm (${t.envelope.presetLabel}), ${plural(t.modules, 'module')}, ${t.ratedW} W rated, ${t.psu}, drop ${t.bus.dropPct.toFixed(2)}%, RT60 ${t.acoustics.rt60Sec.toFixed(2)} s, STI ${t.acoustics.stiScore.toFixed(2)}, ${t.light.avgLux} lx avg / ${t.light.peakLux} lx peak, ${plural(t.conflicts, 'conflict')}`;
}

function wallLine(t) {
  return `${t.envelope.widthCm} x ${t.envelope.heightCm} cm, ${plural(t.modules, 'module')}, ${t.ratedW} W rated, ${t.psu}, drop ${t.bus.dropPct.toFixed(2)}%, RT60 ${t.acoustics.rt60Sec.toFixed(2)} s, ${t.light.avgLux} lx avg, ${plural(t.conflicts, 'conflict')}`;
}

function cartLine(t) {
  return `${plural(t.lines, 'line')} (${plural(t.pieces, 'piece')}), gross ${t.gross}, ${t.ratedW} W, ${t.psu}, ${plural(t.crates, 'crate')}`;
}

/* Resources */

function catalogResource() {
  return {
    finishes: FINISHES.map(({ id, label, name, surface, lrv }) => ({ id, label, name, surface, lrv })),
    categories: CATEGORIES.map(({ id, label }) => ({ id, label })),
    products: PRODUCTS.map((product) => catalogRow(product, 'USD')),
  };
}

function electricalResource() {
  return {
    busVoltage: BUS_VOLTAGE,
    busRatedW: BUS_RATED_W,
    conductor: CONDUCTOR_LABEL,
    loopOhmPerM: round(LOOP_OHM_PER_M, 5),
    dropLimitPct: DROP_LIMIT_PCT,
    maxRunM: { at60W: round(maxRunM(60), 2), at100W: round(maxRunM(100), 2), at150W: round(maxRunM(150), 2) },
    drivers: Object.entries(DRIVERS).map(([id, driver]) => ({ id, ...structuredClone(driver) })),
    dimming: { protocol: 'DALI-2', minPct: DIM_RANGE.min, maxPct: DIM_RANGE.max, stepPct: DIM_RANGE.step },
    scenes: LIGHTING_SCENES.map(({ id, label, task, accent, surface }) => ({ id, label, taskPct: task, accentPct: accent, surface })),
  };
}

function acousticsResource() {
  return {
    model: 'Sabine RT60 = 0.161 V / A, six octave bands',
    bands: OCTAVE_LABELS,
    absorption: Object.fromEntries(Object.entries(OCTAVE_ALPHA).map(([key, values]) => [key, [...values]])),
    stiGrades: STI_GRADES.map((grade) => ({ ...grade })),
    nrc: Object.fromEntries(
      PRODUCTS.filter((product) => noiseReductionCoefficient(product) !== null).map((product) => [product.id, noiseReductionCoefficient(product)]),
    ),
  };
}

function workspaceResource(ws) {
  return {
    route: ws.route,
    currency: ws.currency,
    room: ws.roomDraft ? { state: serializeRoomState(ws.roomDraft), telemetry: roomTelemetry(ws.roomDraft) } : null,
    wall: ws.wallDraft ? { state: serializeLayout(ws.wallDraft), telemetry: wallTelemetry(ws.wallDraft) } : null,
    cart: { items: ws.bagItems, telemetry: cartTelemetry(ws.bagItems, ws.currency) },
  };
}

export const MCP_RESOURCES = Object.freeze([
  Object.freeze({
    uri: 'lumen://catalog/products',
    name: 'catalog-products',
    title: 'Lumen Catalog',
    description: 'All 12 modular parts with dimensions, finishes, watts, lumens, CCT, CRI, NRC, mass, price and lead time.',
    mimeType: 'application/json',
    read: catalogResource,
  }),
  Object.freeze({
    uri: 'lumen://electrical/drivers-and-bus',
    name: 'electrical-drivers-and-bus',
    title: '24V SELV Drivers, Bus and DALI-2',
    description: 'Driver schedule, 2.5 mm2 loop resistance, 3% drop limit, run lengths and the DALI-2 scene levels.',
    mimeType: 'application/json',
    read: electricalResource,
  }),
  Object.freeze({
    uri: 'lumen://acoustics/sabine-6octave',
    name: 'acoustics-sabine-6octave',
    title: 'Sabine Six-Octave Acoustics',
    description: 'Octave absorption coefficients from 125 Hz to 4 kHz, part NRC values and the STI grade thresholds.',
    mimeType: 'application/json',
    read: acousticsResource,
  }),
  Object.freeze({
    uri: 'lumen://workspace/live',
    name: 'workspace-live',
    title: 'Live Workspace',
    description: 'Sanitized snapshot and computed telemetry of the caller 3D room, 2D wall and cart.',
    mimeType: 'application/json',
    read: (ws) => workspaceResource(ws),
  }),
]);

/* Prompts */

export const MCP_PROMPTS = Object.freeze([
  Object.freeze({
    name: 'audit-room-3d',
    title: 'Audit the 3D Room',
    description: 'Audit the live 3D room for driver sizing, voltage drop, RT60, STI, illuminance and conflicts.',
    arguments: [{ name: 'focus', description: 'Optional focus: power, acoustics, light or layout.', required: false }],
    text: ({ focus }) =>
      `Call inspect_workspace with target "room" and audit my live Lumen 3D room${focus ? `, focusing on ${focus}` : ''}. Report driver sizing, 24V voltage drop against the 3% limit, Sabine RT60 and STI, average and peak floor lux and any module conflicts, as one lead sentence and two to four labelled bullets.`,
  }),
  Object.freeze({
    name: 'size-24v-bus',
    title: 'Size the 24V Bus',
    description: 'Size the 24V SELV driver and daisy-chain for a module set.',
    arguments: [{ name: 'modules', description: 'Optional comma-separated part ids; defaults to the live room.', required: false }],
    text: ({ modules }) =>
      `Call simulate_physics_and_bus${modules ? ` with the modules ${modules}` : ' on my live room'} and size the 24V SELV driver with 20% headroom, the Manhattan daisy-chain run and the hop-by-hop voltage drop against the 3% limit on 2 x 2.5 mm2 copper.`,
  }),
  Object.freeze({
    name: 'optimize-acoustics-rt60',
    title: 'Optimize RT60',
    description: 'Recommend acoustic frames or baffles that bring RT60 toward a target.',
    arguments: [{ name: 'targetSec', description: 'Target RT60 in seconds, for example 0.6.', required: false }],
    text: ({ targetSec }) =>
      `Call inspect_workspace with target "room", then recommend Acoustic Art Frame 50x70 or Acoustic Wall Baffle 120 placements that bring the six-octave Sabine RT60 toward ${targetSec || '0.6'} s and lift STI, and say how many to mount on which wall.`,
  }),
]);

/* Tools */

function catalogRow(product, currencyCode) {
  const currency = getCurrency(currencyCode);
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category,
    shape: product.shape,
    dimsCm: { ...product.dimsCm },
    weightKg: product.weightKg,
    watts: product.watts,
    lumens: product.lumens,
    kelvin: product.kelvin,
    cri: product.cri,
    nrc: noiseReductionCoefficient(product),
    finishes: [...product.finishes],
    defaultFinish: product.defaultFinish,
    price: formatMoney(toMinor(product.priceUsd, currency), currency),
    priceUsd: product.priceUsd,
    stock: STOCK_LABELS[product.stock] ?? product.stock,
    leadWeeks: [...product.leadWeeks],
    mountingPoints: product.mountingPoints,
  };
}

function textResult(text, structuredContent, clientActions = []) {
  return { content: [{ type: 'text', text }], structuredContent, clientActions, isError: false };
}

function errorResult(text) {
  return { content: [{ type: 'text', text }], structuredContent: { error: text }, clientActions: [], isError: true };
}

function finishLabel(id) {
  return getFinish(id)?.label ?? id;
}

function andList(items) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function finishError(product, finish) {
  return `${product.name} ships in ${andList(product.finishes.map(finishLabel))}; ${finishLabel(finish)} is not offered.`;
}

function inspectWorkspace(args, ws) {
  const target = args.target ?? 'all';
  const out = {};
  const lines = [];
  if (target === 'room' || target === 'all') {
    out.room = ws.roomDraft ? roomTelemetry(ws.roomDraft) : null;
    lines.push(out.room ? `3D room: ${roomLine(out.room)}.` : '3D room: no stored room.');
  }
  if (target === 'wall' || target === 'all') {
    out.wall = ws.wallDraft ? wallTelemetry(ws.wallDraft) : null;
    lines.push(out.wall ? `2D wall: ${wallLine(out.wall)}.` : '2D wall: no stored wall.');
  }
  if (target === 'cart' || target === 'all') {
    out.cart = cartTelemetry(ws.bagItems, ws.currency);
    lines.push(`Cart: ${cartLine(out.cart)}.`);
  }
  const summary = out.room
    ? `${plural(out.room.modules, 'module')}, ${out.room.ratedW} W, RT60 ${out.room.acoustics.rt60Sec.toFixed(2)} s`
    : out.wall
      ? `${plural(out.wall.modules, 'module')}, ${out.wall.ratedW} W on the 2D wall`
      : out.cart
        ? `${plural(out.cart.lines, 'cart line')}, ${out.cart.gross}`
        : 'Workspace read';
  return textResult(lines.join('\n'), { target, summary, ...out });
}

function queryCatalog(args) {
  const currency = args.currency ?? 'USD';
  const words = (args.query ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1);
  const rows = PRODUCTS.filter((product) => {
    if (args.sku && product.sku.toLowerCase() !== args.sku.toLowerCase() && product.id !== args.sku.toLowerCase()) return false;
    if (args.shape && product.shape !== args.shape) return false;
    if (args.category && product.category !== args.category) return false;
    if (args.finish && !product.finishes.includes(args.finish)) return false;
    if (args.minWatts !== undefined && product.watts < args.minWatts) return false;
    if (args.maxWatts !== undefined && product.watts > args.maxWatts) return false;
    if (args.minLumens !== undefined && product.lumens < args.minLumens) return false;
    if (args.minNrc !== undefined && !(noiseReductionCoefficient(product) >= args.minNrc)) return false;
    if (words.length > 0) {
      const hay = `${product.name} ${product.sku} ${product.id} ${product.shape} ${product.category}`.toLowerCase();
      if (!words.some((word) => hay.includes(word))) return false;
    }
    return true;
  })
    .slice(0, args.limit ?? MAX_CATALOG_ROWS)
    .map((product) => catalogRow(product, currency));
  const text =
    rows.length === 0
      ? 'No catalog part matches those filters.'
      : rows.map((row) => `${row.name} (${row.sku}): ${row.dimsCm.w} x ${row.dimsCm.h} x ${row.dimsCm.d} cm, ${row.watts} W, ${row.lumens} lm, ${row.price}`).join('\n');
  return textResult(text, { currency, count: rows.length, summary: `${plural(rows.length, 'part')} matched`, products: rows });
}

/** A hypothetical room: the parts are mounted round the walls, north first, at their clear spots. */
function roomFromModules(modules, dims) {
  let state = createRoomState(dims ? { widthCm: dims.widthCm, depthCm: dims.depthCm, heightCm: dims.heightCm } : undefined);
  const bag = [];
  for (const entry of modules) {
    const product = getProduct(entry.productId);
    const finish = entry.finish ?? product.defaultFinish;
    if (!productHasFinish(product, finish)) return { error: finishError(product, finish) };
    for (let n = 0; n < (entry.qty ?? 1); n += 1) {
      const wall = ROOM_WALLS[Math.floor(state.items.length / 6) % ROOM_WALLS.length];
      const mounted = mountInRoom(state, product.id, wall);
      if (!mounted) return { error: `A room holds ${MAX_WALL_ITEMS} modules at most.` };
      state = updateRoomItem(mounted.state, mounted.item.uid, { finish });
    }
    bag.push({ id: product.id, finish, qty: entry.qty ?? 1 });
  }
  return { state, bag: sanitizeBagItems(bag) };
}

function simulatePhysicsAndBus(args, ws) {
  let subject;
  let bag;
  let label;
  const source = args.source ?? (args.modules ? 'modules' : 'room');
  if (source === 'modules') {
    if (!args.modules?.length) return errorResult('Send at least one module to simulate.');
    const built = roomFromModules(args.modules, args.dimensions);
    if (built.error) return errorResult(built.error);
    subject = built.state;
    bag = built.bag;
    label = 'Hypothetical room';
  } else if (source === 'wall') {
    if (!ws.wallDraft) return errorResult('No stored 2D wall to simulate.');
    subject = ws.wallDraft;
    bag = aggregateBagLines(subject.items);
    label = '2D wall';
  } else {
    if (!ws.roomDraft) return errorResult('No stored 3D room to simulate.');
    subject = ws.roomDraft;
    bag = aggregateBagLines(subject.items);
    label = '3D room';
  }
  const isRoom = source !== 'wall';
  const telemetry = isRoom ? roomTelemetry(subject) : wallTelemetry(subject);
  const bus = computeBusTopology(isRoom ? unrolledRoom(subject) : subject);
  const quote = buildQuote({ items: bag, currencyCode: ws.currency, date: QUOTE_DATE });
  const logistics = computeLogisticsSchedule(resolveBagLines(bag), quote.electrical);
  const structured = {
    source,
    summary: `${label}: ${telemetry.ratedW} W, drop ${telemetry.bus.dropPct.toFixed(2)}%, RT60 ${telemetry.acoustics.rt60Sec.toFixed(2)} s`,
    telemetry,
    bus: {
      origin: bus.origin?.kind ?? null,
      nodes: bus.nodes.length,
      segments: bus.segments.length,
      totalRunM: bus.totalRunM,
      currentA: bus.currentA,
      voltageDropV: bus.voltageDropV,
      voltageDropPct: bus.voltageDropPct,
      withinSpec: bus.withinSpec,
    },
    psu: recommendPsu(telemetry.ratedW),
    logistics: {
      pieces: logistics.pieceCount,
      grossWeightKg: logistics.grossWeightKg,
      crates: logistics.crates.length,
      freightClass: logistics.freightClass,
      dispatch: logistics.windowLabel,
    },
  };
  const text = `${label}: ${telemetry.ratedW} W rated on ${telemetry.psu}; bus ${bus.totalRunM} m, ${bus.currentA} A, ${bus.voltageDropPct.toFixed(2)}% drop (${bus.withinSpec ? 'within' : 'over'} the ${DROP_LIMIT_PCT}% limit); RT60 ${telemetry.acoustics.rt60Sec.toFixed(2)} s, STI ${telemetry.acoustics.stiScore.toFixed(2)}; ${telemetry.light.avgLux} lx avg; ${plural(structured.logistics.crates, 'crate')}, ${structured.logistics.grossWeightKg} kg gross.`;
  return textResult(text, structured);
}

function mountList(args) {
  if (args.mount && args.mounts) return { error: 'Send mount or mounts, not both.' };
  const list = args.mounts ?? (args.mount ? [args.mount] : []);
  for (const entry of list) {
    const product = getProduct(entry.productId);
    if (entry.finish !== undefined && !productHasFinish(product, entry.finish)) return { error: finishError(product, entry.finish) };
  }
  return { list };
}

function mutate3dRoom(args, ws) {
  const { list, error } = mountList(args);
  if (error) return errorResult(error);
  const original = ws.roomDraft ?? createRoomState();
  let state = original;
  const notes = [];
  let selectUid = null;
  let mountedWall = null;

  if (args.scalePreset) {
    const preset = ROOM_SIZE_PRESETS.find((entry) => entry.id === args.scalePreset);
    state = updateRoom(state, { widthCm: preset.widthCm, depthCm: preset.depthCm, heightCm: preset.heightCm });
    notes.push(`set the room to ${preset.label} ${preset.widthCm} x ${preset.depthCm} x ${preset.heightCm} cm`);
  }
  if (args.dimensions) {
    state = updateRoom(state, args.dimensions);
    notes.push(`resized the room to ${state.room.widthCm} x ${state.room.depthCm} x ${state.room.heightCm} cm`);
  }
  if (args.furniture) {
    state = updateRoom(state, { furniture: args.furniture });
    notes.push(args.furniture === 'none' ? 'removed the reference furniture' : `placed the ${getFurniture(args.furniture).label}`);
  }
  if (args.lightingMode) {
    state = updateRoom(state, { lighting: args.lightingMode });
    notes.push(`switched to ${LIGHTING_MODES.find((mode) => mode.id === args.lightingMode).label}`);
  }
  if (args.clearWall) {
    const before = state.items.length;
    state = args.clearWall === 'all' ? { ...state, items: [] } : clearRoomWall(state, args.clearWall);
    const removed = before - state.items.length;
    notes.push(`cleared ${plural(removed, 'module')} from ${args.clearWall === 'all' ? 'every wall' : `the ${WALL_LABELS[args.clearWall]}`}`);
  }
  if (args.removeUid || args.removeProduct) {
    const item = args.removeUid
      ? state.items.find((entry) => entry.uid === args.removeUid)
      : state.items.findLast(
          (entry) => entry.productId === args.removeProduct.productId && (!args.removeProduct.wall || wallOf(entry) === args.removeProduct.wall),
        );
    if (!item) {
      const what = args.removeUid ? `module ${args.removeUid}` : getProduct(args.removeProduct.productId).name;
      const where = args.removeProduct?.wall ? `on the ${WALL_LABELS[args.removeProduct.wall]}` : 'in the room';
      return errorResult(`No ${what} ${where} to remove.`);
    }
    state = removeRoomItem(state, item.uid);
    notes.push(`removed ${getProduct(item.productId).name} from the ${WALL_LABELS[wallOf(item)]}`);
  }
  for (const entry of list) {
    const product = getProduct(entry.productId);
    const finish = entry.finish ?? product.defaultFinish;
    const wall = entry.wall ?? 'north';
    const qty = entry.qty ?? 1;
    for (let n = 0; n < qty; n += 1) {
      const mounted = mountInRoom(state, product.id, wall);
      if (!mounted) return errorResult(`The room holds ${MAX_WALL_ITEMS} modules at most; ${product.name} was not mounted.`);
      const patch = { finish };
      if (entry.dimPct !== undefined) patch.dimPct = entry.dimPct;
      if (n === 0 && entry.xCm !== undefined) patch.xCm = entry.xCm;
      if (n === 0 && entry.yCm !== undefined) patch.yCm = entry.yCm;
      state = updateRoomItem(mounted.state, mounted.item.uid, patch);
      selectUid = mounted.item.uid;
    }
    mountedWall = wall;
    const placed = state.items.find((item) => item.uid === selectUid);
    notes.push(
      `mounted ${qty > 1 ? `${qty} x ` : ''}${product.name} in ${finishLabel(finish)} on the ${WALL_LABELS[wall]}${qty === 1 ? ` at X ${placed.xCm} / Y ${placed.yCm} cm` : ''}`,
    );
  }
  if (args.lightingScene) {
    const scene = getLightingScene(args.lightingScene);
    state = applyLightingSceneToRoom(state, scene.id);
    notes.push(`recalled ${scene.label} (task ${scene.task}% / accent ${scene.accent}%)`);
  }
  const activeWall = args.activeWall ?? mountedWall;
  if (args.activeWall) notes.push(`faced the ${WALL_LABELS[args.activeWall]}`);
  if (args.cameraLens) notes.push(`switched to the ${CAMERA_MODE_LABELS[args.cameraLens]} lens`);

  const changed = state !== original;
  if (!changed && !activeWall && !args.cameraLens) {
    return textResult('The room already matches that request; nothing changed.', { changed: false, summary: 'No change' });
  }
  const telemetry = roomTelemetry(state);
  const sentence = notes.length > 0 ? `${notes[0][0].toUpperCase()}${notes[0].slice(1)}${notes.length > 1 ? `, ${notes.slice(1).join(', ')}` : ''}.` : 'Updated the room view.';
  const notice = sanitizeText(`Lumen AI ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`, { maxLength: 240 });
  const action = {
    type: 'apply_room_state',
    state: serializeRoomState(state),
    ...(activeWall ? { activeWall } : {}),
    ...(args.cameraLens ? { cameraMode: args.cameraLens } : {}),
    ...(selectUid ? { selectUid } : {}),
    notice,
  };
  const structured = {
    // A lens or wall switch is a change the visitor sees, even with the room untouched.
    changed: true,
    roomChanged: changed,
    summary: sentence.replace(/\.$/, ''),
    activeWall: activeWall ?? null,
    cameraMode: args.cameraLens ?? null,
    selectUid,
    loadW: telemetry.ratedW,
    rt60Sec: telemetry.acoustics.rt60Sec,
    luxAvg: telemetry.light.avgLux,
    moduleCount: telemetry.modules,
    telemetry,
  };
  return textResult(`${sentence} Room now ${roomLine(telemetry)}.`, structured, [action]);
}

function mutate2dWall(args, ws) {
  const { list, error } = mountList(args);
  if (error) return errorResult(error);
  const original = ws.wallDraft ?? createLayout();
  let layout = original;
  const notes = [];
  let selectUid = null;

  const wallPatch = {};
  if (args.dimensions) Object.assign(wallPatch, args.dimensions);
  for (const key of ['slope', 'snap', 'surface']) if (args[key] !== undefined) wallPatch[key] = args[key];
  if (Object.keys(wallPatch).length > 0) {
    layout = updateWall(layout, wallPatch);
    const parts = [];
    if (args.dimensions) parts.push(`wall ${layout.wall.widthCm} x ${layout.wall.heightCm} cm`);
    if (args.slope !== undefined) parts.push(`attic slope ${args.slope ? 'on' : 'off'}`);
    if (args.snap !== undefined) parts.push(`grid snap ${args.snap ? 'on' : 'off'}`);
    if (args.surface !== undefined) parts.push(`${args.surface} surface`);
    notes.push(`set ${parts.join(', ')}`);
  }
  if (args.clear) {
    const removed = layout.items.filter((item) => !item.locked).length;
    layout = createLayout(layout.wall, layout.items.filter((item) => item.locked));
    notes.push(`cleared ${plural(removed, 'module')} from the wall`);
  }
  if (args.removeUid || args.removeProduct) {
    const item = args.removeUid
      ? layout.items.find((entry) => entry.uid === args.removeUid)
      : layout.items.findLast((entry) => entry.productId === args.removeProduct.productId && !entry.locked);
    if (!item) return errorResult(`No ${args.removeUid ? `module ${args.removeUid}` : getProduct(args.removeProduct.productId).name} on the 2D wall to remove.`);
    if (item.locked) return errorResult(`${getProduct(item.productId).name} is locked; unlock it in the Wall Studio first.`);
    layout = removeItem(layout, item.uid);
    notes.push(`removed ${getProduct(item.productId).name}`);
  }
  for (const entry of list) {
    const product = getProduct(entry.productId);
    const finish = entry.finish ?? product.defaultFinish;
    const qty = entry.qty ?? 1;
    for (let n = 0; n < qty; n += 1) {
      const at = n === 0 && entry.xCm !== undefined && entry.yCm !== undefined ? { x: entry.xCm, y: entry.yCm } : undefined;
      const mounted = mountProduct(layout, product.id, at);
      if (!mounted) {
        return errorResult(
          layout.items.length >= MAX_WALL_ITEMS
            ? `The wall holds ${MAX_WALL_ITEMS} modules at most; ${product.name} was not mounted.`
            : `${product.name} is wider or taller than this wall.`,
        );
      }
      const patch = { finish };
      if (entry.dimPct !== undefined) patch.dimPct = entry.dimPct;
      layout = updateItem(mounted.layout, mounted.item.uid, patch);
      selectUid = mounted.item.uid;
    }
    const placed = layout.items.find((item) => item.uid === selectUid);
    notes.push(`mounted ${qty > 1 ? `${qty} x ` : ''}${product.name} in ${finishLabel(finish)}${qty === 1 ? ` at X ${placed.xCm} / Y ${placed.yCm} cm` : ''}`);
  }
  if (args.lightingScene) {
    const scene = getLightingScene(args.lightingScene);
    layout = applyLightingSceneToLayout(layout, scene.id);
    notes.push(`recalled ${scene.label} (task ${scene.task}% / accent ${scene.accent}%)`);
  }
  if (layout === original) {
    return textResult('The wall already matches that request; nothing changed.', { changed: false, summary: 'No change' });
  }
  const telemetry = wallTelemetry(layout);
  const sentence = `${notes[0][0].toUpperCase()}${notes[0].slice(1)}${notes.length > 1 ? `, ${notes.slice(1).join(', ')}` : ''} on the 2D wall.`;
  const notice = sanitizeText(`Lumen AI ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`, { maxLength: 240 });
  return textResult(
    `${sentence} Wall now ${wallLine(telemetry)}.`,
    {
      changed: true,
      summary: sentence.replace(/\.$/, ''),
      selectUid,
      loadW: telemetry.ratedW,
      rt60Sec: telemetry.acoustics.rt60Sec,
      luxAvg: telemetry.light.avgLux,
      moduleCount: telemetry.modules,
      telemetry,
    },
    [{ type: 'apply_wall_state', state: serializeLayout(layout), notice }],
  );
}

function manageCartBag(args, ws) {
  let items = ws.bagItems;
  const notes = [];
  if (args.clear) {
    items = bagReducer(items, { type: 'clear' });
    notes.push('cleared the cart');
  }
  if (args.remove) {
    const product = getProduct(args.remove.productId);
    const before = items;
    const finishes = args.remove.finish ? [args.remove.finish] : product.finishes;
    for (const finish of finishes) items = bagReducer(items, { type: 'remove', id: product.id, finish });
    if (items === before) return errorResult(`${product.name} is not in the cart.`);
    notes.push(`removed ${product.name}${args.remove.finish ? ` in ${finishLabel(args.remove.finish)}` : ''}`);
  }
  if (args.add) {
    const product = getProduct(args.add.productId);
    const finish = args.add.finish ?? product.defaultFinish;
    if (!productHasFinish(product, finish)) return errorResult(finishError(product, finish));
    const qty = args.add.qty ?? 1;
    items = bagReducer(items, { type: 'add', id: product.id, finish, qty });
    notes.push(`added ${qty} x ${product.name} in ${finishLabel(finish)}`);
  }
  if (args.syncFrom) {
    const source = args.syncFrom === 'wall' ? ws.wallDraft : ws.roomDraft;
    const lines = source ? aggregateBagLines(source.items) : [];
    if (lines.length === 0) return errorResult(`The ${args.syncFrom === 'wall' ? '2D wall' : '3D room'} has no modules to sync.`);
    items = bagReducer(items, { type: 'merge', lines });
    notes.push(`synced ${plural(source.items.length, 'module')} from the ${args.syncFrom === 'wall' ? '2D wall' : '3D room'} as ${plural(lines.length, 'line')}`);
  }
  if (notes.length === 0) return errorResult('Send add, remove, syncFrom or clear.');
  if (items === ws.bagItems) {
    return textResult('The cart already matches that request; nothing changed.', { changed: false, summary: 'No change' });
  }
  const telemetry = cartTelemetry(items, ws.currency);
  const sentence = `${notes[0][0].toUpperCase()}${notes[0].slice(1)}${notes.length > 1 ? `, ${notes.slice(1).join(', ')}` : ''}${args.clear && notes.length === 1 ? '' : ' to the cart'}.`;
  const notice = sanitizeText(`Lumen AI ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`, { maxLength: 240 });
  return textResult(
    `${sentence} Cart now ${cartLine(telemetry)}.`,
    { changed: true, summary: sentence.replace(/\.$/, ''), items, telemetry },
    [{ type: 'apply_bag_items', items, notice }],
  );
}

function lookupStudioGuide(args, ws) {
  const reply = evaluateConciergeQuery(args.question, ws);
  return textResult(reply.answer, {
    summary: CONCIERGE_CATEGORIES[reply.category],
    category: reply.category,
    resolved: reply.resolved,
    confidence: reply.confidence,
    suggestedActions: reply.suggestedActions,
  });
}

function unlockEngineeringEscalation(args) {
  const reply = evaluateConciergeQuery(args.question);
  const unlocked = !reply.resolved;
  return textResult(unlocked ? ESCALATION_NOTICE : 'Studio AI resolves this inquiry directly; engineering contact stays locked.', {
    summary: unlocked ? 'Engineering contact unlocked' : 'Gate stays locked',
    unlocked,
    category: reply.category,
    confidence: reply.confidence,
    reason: args.reason ?? (unlocked ? 'unresolved_query' : null),
  });
}

const ROOM_PROPS = {
  mount: MOUNT_SCHEMA,
  mounts: { type: 'array', items: MOUNT_SCHEMA, minItems: 1, maxItems: MAX_MOUNTS, description: 'Several parts to mount.' },
  removeUid: { type: 'string', pattern: UID_PATTERN, description: 'Module uid to remove, such as m3.' },
  removeProduct: {
    type: 'object',
    description: 'Remove the most recently mounted module of this part, optionally on one wall.',
    properties: { productId: choice(PRODUCT_IDS), wall: choice(ROOM_WALLS) },
    required: ['productId'],
    additionalProperties: false,
  },
  clearWall: choice([...ROOM_WALLS, 'all'], 'Take every module off one wall, or all walls.'),
  scalePreset: choice(SCALE_IDS, 'Envelope preset: compact 320 x 280 x 250, living 480 x 420 x 270, gallery 640 x 520 x 300, loft (Grand Loft) 800 x 650 x 340 cm.'),
  dimensions: {
    type: 'object',
    description: 'Custom envelope in cm.',
    properties: {
      widthCm: int(ROOM_WIDTH.min, ROOM_WIDTH.max),
      depthCm: int(ROOM_DEPTH.min, ROOM_DEPTH.max),
      heightCm: int(ROOM_HEIGHT.min, ROOM_HEIGHT.max),
    },
    additionalProperties: false,
  },
  lightingScene: choice(LIGHTING_SCENE_IDS, 'DALI-2 scene: full, morning, evening or night.'),
  lightingMode: choice(LIGHTING_MODE_IDS, 'Room lighting rig: night (2700K ambient) or daylight.'),
  furniture: choice(FURNITURE_IDS, 'Reference furniture on the north wall.'),
  cameraLens: choice(CAMERA_MODES, `Camera lens: orbit, inside (${EYE_HEIGHT_CM} cm eye-level walkthrough) or elevation.`),
  activeWall: choice(ROOM_WALLS, 'Wall the planner faces.'),
};

const { wall: _roomWall, ...WALL_MOUNT_FIELDS } = MOUNT_SCHEMA.properties;
const WALL_MOUNT_SCHEMA = { ...MOUNT_SCHEMA, properties: WALL_MOUNT_FIELDS };

const WALL_PROPS = {
  mount: WALL_MOUNT_SCHEMA,
  mounts: { type: 'array', items: WALL_MOUNT_SCHEMA, minItems: 1, maxItems: MAX_MOUNTS },
  removeUid: { type: 'string', pattern: UID_PATTERN },
  removeProduct: {
    type: 'object',
    properties: { productId: choice(PRODUCT_IDS) },
    required: ['productId'],
    additionalProperties: false,
  },
  clear: { type: 'boolean', description: 'Take every unlocked module off the wall.' },
  dimensions: {
    type: 'object',
    properties: { widthCm: int(WALL_WIDTH.min, WALL_WIDTH.max), heightCm: int(WALL_HEIGHT.min, WALL_HEIGHT.max) },
    additionalProperties: false,
  },
  lightingScene: choice(LIGHTING_SCENE_IDS),
  slope: { type: 'boolean', description: 'Attic slope cut-out on or off.' },
  snap: { type: 'boolean', description: '5 cm grid snap on or off.' },
  surface: choice(SURFACES, 'Wall surface rendering: ambient or daylight.'),
};

const TOOL_DEFINITIONS = [
  {
    name: 'inspect_workspace',
    title: 'Inspect Workspace',
    description:
      'Live telemetry for the caller 3D room, 2D wall or cart: modules per wall, rated and active watts, PSU sizing, bus length and voltage drop, Sabine RT60, STI, average and peak lux, conflicts, cart totals.',
    inputSchema: { type: 'object', properties: { target: choice(['room', 'wall', 'cart', 'all'], 'Which workspace to read. Defaults to all.') }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: inspectWorkspace,
  },
  {
    name: 'query_catalog',
    title: 'Query Catalog',
    description: 'Search and filter the 12 canonical parts by text, SKU, shape, category, finish, wattage, lumens or NRC, priced in USD, EUR or HUF.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 120, description: 'Free text matched against name, SKU, shape and category.' },
        sku: { type: 'string', maxLength: 64 },
        shape: choice(SHAPES),
        category: choice(CATEGORY_IDS),
        finish: choice(FINISH_IDS),
        minWatts: int(0, 200),
        maxWatts: int(0, 200),
        minLumens: int(0, 10000),
        minNrc: { type: 'number', minimum: 0, maximum: 1 },
        currency: choice(CURRENCY_CODES),
        limit: int(1, MAX_CATALOG_ROWS),
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: (args) => queryCatalog(args),
  },
  {
    name: 'simulate_physics_and_bus',
    title: 'Simulate Physics and Bus',
    description: 'Runs the 24V bus topology, six-octave Sabine and illuminance physics and the crate logistics on the live room or wall, or on a hypothetical module set.',
    inputSchema: {
      type: 'object',
      properties: {
        source: choice(['room', 'wall', 'modules'], 'Live room, live wall or the modules below.'),
        modules: { type: 'array', items: MODULE_SCHEMA, minItems: 1, maxItems: 12 },
        dimensions: ROOM_PROPS.dimensions,
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: simulatePhysicsAndBus,
  },
  {
    name: 'mutate_3d_room',
    title: 'Mutate 3D Room',
    description:
      'Agentic control of the live 3D room: mount parts on the north, east, south or west wall, remove or clear modules, set the envelope preset or size, furniture, lighting rig and DALI-2 scene, and switch the camera lens or active wall. Returns the next room state as an undoable client action.',
    inputSchema: { type: 'object', properties: ROOM_PROPS, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    run: mutate3dRoom,
  },
  {
    name: 'mutate_2d_wall',
    title: 'Mutate 2D Wall',
    description: 'Agentic control of the 2D Wall Studio: mount, remove or clear modules, recall a lighting scene, resize the wall and toggle slope, snap or surface. Returns the next layout as an undoable client action.',
    inputSchema: { type: 'object', properties: WALL_PROPS, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    run: mutate2dWall,
  },
  {
    name: 'manage_cart_bag',
    title: 'Manage Cart',
    description: 'Adds or removes parts in the cart, clears it, or syncs every module from the live 3D room or 2D wall into it. Returns the next cart lines as a client action.',
    inputSchema: {
      type: 'object',
      properties: {
        add: {
          type: 'object',
          properties: { productId: choice(PRODUCT_IDS), finish: choice(FINISH_IDS), qty: int(1, MAX_LINE_QTY) },
          required: ['productId'],
          additionalProperties: false,
        },
        remove: {
          type: 'object',
          properties: { productId: choice(PRODUCT_IDS), finish: choice(FINISH_IDS) },
          required: ['productId'],
          additionalProperties: false,
        },
        syncFrom: choice(['room', 'wall'], 'Copy every module of the live 3D room or 2D wall into the cart.'),
        clear: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    run: manageCartBag,
  },
  {
    name: 'lookup_studio_guide',
    title: 'Look Up Studio Guide',
    description: 'Answers platform navigation, camera lens, transform gizmo, shortcut, Visual and Specs mode, save and CAD export questions from the studio guide.',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string', minLength: 1, maxLength: QUESTION_MAX } },
      required: ['question'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: lookupStudioGuide,
  },
  {
    name: 'unlock_engineering_escalation',
    title: 'Unlock Engineering Escalation',
    description: 'For bespoke non-catalog fabrication, structural certification, freight claims or onsite installation: verifies the inquiry is outside automated scope and unlocks Studio Engineering Contact.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', minLength: 1, maxLength: QUESTION_MAX },
        reason: choice(['bespoke', 'structural', 'freight', 'onsite', 'other']),
      },
      required: ['question'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: (args) => unlockEngineeringEscalation(args),
  },
];

const TOOLS_BY_NAME = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
export const MCP_TOOL_NAMES = Object.freeze(TOOL_DEFINITIONS.map((tool) => tool.name));

/** The tools/list payload: name, title, description, inputSchema and annotations. */
export function listMcpTools() {
  return TOOL_DEFINITIONS.map(({ run: _run, ...tool }) => structuredClone(tool));
}

/* JSON-RPC 2.0 */

function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

class ParamsError extends Error {
  constructor(message, code = JSONRPC_ERRORS.invalidParams) {
    super(message);
    this.code = code;
  }
}

function isValidId(id) {
  return typeof id === 'string' ? id.length <= 128 : Number.isSafeInteger(id);
}

/** True when `value` nests containers deeper than `maxDepth`. Iterative, so hostile depth cannot exhaust the stack. */
export function exceedsDepth(value, maxDepth = MCP_MAX_DEPTH) {
  if (value === null || typeof value !== 'object') return false;
  const stack = [[value, 1]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop();
    if (depth > maxDepth) return true;
    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      if (child !== null && typeof child === 'object') stack.push([child, depth + 1]);
    }
  }
  return false;
}

/**
 * Workspace for one request: an in-process caller passes it already
 * sanitized; a remote caller sends it as `params._meta["lumen/workspace"]`,
 * which must survive the strict concierge validator whole.
 */
function workspaceFor(params, context) {
  if (context.workspace) return sanitizeWorkspaceContext(context.workspace);
  const meta = isRecord(params?._meta) ? params._meta[MCP_WORKSPACE_META] : undefined;
  if (meta === undefined) return sanitizeWorkspaceContext(null);
  const { context: ws, error } = validateWorkspaceContext(meta);
  if (error) throw new ParamsError(`_meta.${MCP_WORKSPACE_META}: ${error}`);
  return ws;
}

function promptArguments(prompt, args) {
  if (args !== undefined && !isRecord(args)) throw new ParamsError('arguments must be an object of strings.');
  const out = {};
  for (const { name } of prompt.arguments) {
    const value = args?.[name];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new ParamsError(`arguments.${name} must be text.`);
    out[name] = sanitizeText(value, { maxLength: 120 });
  }
  return out;
}

/** Runs one tool. Unknown tools and schema violations throw; a refused edit is a result with isError. */
export function callMcpTool(name, args, workspace) {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) throw new ParamsError(`Unknown tool: ${typeof name === 'string' ? sanitizeText(name, { maxLength: 64 }) : 'name must be text'}.`);
  const input = args === undefined ? {} : args;
  const error = validateSchema(tool.inputSchema, input);
  if (error) throw new ParamsError(error);
  return tool.run(input, sanitizeWorkspaceContext(workspace));
}

const METHODS = {
  initialize: (params, context) => {
    if (params !== undefined && !isRecord(params)) throw new ParamsError('params must be an object.');
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false } },
      serverInfo: { name: MCP_SERVER_NAME, title: 'Lumen Spatial Studio MCP', version: context.version ?? '0.0.0' },
      instructions:
        'Lumen Spatial Studio: 12 modular 24V parts, a four-wall 3D room, a 2D wall studio and a cart. Read lumen://workspace/live or call inspect_workspace before advising; mutation tools return client actions the browser applies as one undoable step.',
    };
  },
  ping: () => ({}),
  'notifications/initialized': () => ({}),
  'resources/list': () => ({ resources: MCP_RESOURCES.map(({ read: _read, ...resource }) => ({ ...resource })) }),
  'resources/read': (params, context) => {
    if (!isRecord(params) || typeof params.uri !== 'string') throw new ParamsError('params.uri must be a resource URI.');
    const resource = MCP_RESOURCES.find((entry) => entry.uri === params.uri);
    if (!resource) throw new ParamsError(`Resource not found: ${sanitizeText(params.uri, { maxLength: 96 })}`, JSONRPC_ERRORS.resourceNotFound);
    const data = resource.read(workspaceFor(params, context));
    return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: JSON.stringify(data) }] };
  },
  'prompts/list': () => ({ prompts: MCP_PROMPTS.map(({ text: _text, ...prompt }) => structuredClone(prompt)) }),
  'prompts/get': (params) => {
    if (!isRecord(params) || typeof params.name !== 'string') throw new ParamsError('params.name must be a prompt name.');
    const prompt = MCP_PROMPTS.find((entry) => entry.name === params.name);
    if (!prompt) throw new ParamsError(`Unknown prompt: ${sanitizeText(params.name, { maxLength: 64 })}.`);
    return { description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: prompt.text(promptArguments(prompt, params.arguments)) } }] };
  },
  'tools/list': () => ({ tools: listMcpTools() }),
  'tools/call': (params, context) => {
    if (!isRecord(params) || typeof params.name !== 'string') throw new ParamsError('params.name must be a tool name.');
    if (params.arguments !== undefined && !isRecord(params.arguments)) throw new ParamsError('params.arguments must be an object.');
    return callMcpTool(params.name, params.arguments, workspaceFor(params, context));
  },
};

/**
 * Handles one JSON-RPC 2.0 message. Returns the response object, or null for
 * a well-formed notification (no id), which gets no response. Never throws.
 * Batches are not part of the 2025-06-18 revision and read as an invalid
 * request whatever their size, so a 50-message array costs one check. A
 * message nested deeper than MCP_MAX_DEPTH is refused the same way. A fault
 * inside a method answers -32603 and is handed to `context.onError`.
 * `context`: `{ version, workspace?, onError? }`.
 */
export function handleMcpRequest(message, context = {}) {
  if (Array.isArray(message)) {
    return rpcError(null, JSONRPC_ERRORS.invalidRequest, 'Invalid Request: batches are not supported; send one JSON-RPC 2.0 object per request.');
  }
  if (!isRecord(message)) return rpcError(null, JSONRPC_ERRORS.invalidRequest, 'Invalid Request: send one JSON-RPC 2.0 object.');
  const hasId = Object.hasOwn(message, 'id');
  const id = hasId && isValidId(message.id) ? message.id : null;
  if (exceedsDepth(message)) {
    return rpcError(id, JSONRPC_ERRORS.invalidRequest, `Invalid Request: the message nests deeper than ${MCP_MAX_DEPTH} levels.`);
  }
  if (message.jsonrpc !== '2.0') return rpcError(id, JSONRPC_ERRORS.invalidRequest, 'Invalid Request: jsonrpc must be "2.0".');
  if (hasId && !isValidId(message.id)) return rpcError(null, JSONRPC_ERRORS.invalidRequest, 'Invalid Request: id must be a string or an integer.');
  if (typeof message.method !== 'string' || !METHOD_PATTERN.test(message.method)) {
    return rpcError(id, JSONRPC_ERRORS.invalidRequest, 'Invalid Request: method must be a method name.');
  }
  if (message.params !== undefined && !isRecord(message.params)) {
    return rpcError(id, JSONRPC_ERRORS.invalidRequest, 'Invalid Request: params must be an object.');
  }
  const method = Object.hasOwn(METHODS, message.method) ? METHODS[message.method] : null;
  if (!hasId) {
    // Notifications are acknowledged by silence, known or not.
    return null;
  }
  if (!method) return rpcError(id, JSONRPC_ERRORS.methodNotFound, `Method not found: ${message.method}`);
  try {
    return rpcResult(id, method(message.params, context));
  } catch (error) {
    if (error instanceof ParamsError) return rpcError(id, error.code, error.message);
    if (typeof context.onError === 'function') context.onError(error);
    return rpcError(id, JSONRPC_ERRORS.internal, 'Internal error: the request could not be completed.');
  }
}

/** True when a tools/call result came from a mutation tool and changed something. */
export function isMutationResult(name, result) {
  return MUTATION_TOOLS.includes(name) && result?.isError === false && Array.isArray(result.clientActions) && result.clientActions.length > 0;
}

