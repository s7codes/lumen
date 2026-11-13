import { sanitizeText } from '../security/sanitize.js';
import { parseAgentIntent } from './agent-intent.js';
import { sanitizeBagItems } from './bag.js';
import {
  composeReply,
  evaluateConciergeQuery,
  matchCatalogProducts,
  MCP_PROTOCOL,
  sanitizeQuestion,
  sanitizeWorkspaceContext,
} from './concierge-engine.js';
import { handleMcpRequest, isMutationResult, MCP_PROTOCOL_VERSION } from './mcp-server.js';
import { sanitizeRoomState, WALL_LABELS } from './room-3d.js';
import { CAMERA_MODE_LABELS } from './room-walkthrough.js';
import { sanitizeLayout } from './wall-studio.js';

/**
 * Deterministic MCP orchestrator. With no LLM configured (CI, offline, a
 * static host) it plans the tool calls itself and runs them through the same
 * JSON-RPC `tools/call` pipeline an external model would use:
 *
 * - an imperative command ("Mount a Floating Shelf 110 in Walnut on the East
 *   Wall") runs the matching mutation tool, and the reply carries the
 *   resulting client action for the browser's workspace bus;
 * - any other question runs the inspection tool for its topic and keeps the
 *   concierge engine's answer word for word.
 *
 * Shared by server/app.js (POST /api/concierge/ask and /stream) and the
 * browser's offline fallback, so both transports answer identically.
 */

if (MCP_PROTOCOL !== MCP_PROTOCOL_VERSION) throw new Error('MCP protocol revisions disagree.');

const SUMMARY_MAX = 160;

function plural(count, word, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`;
}

/** Applies mutation results to a working copy of the workspace, so a later tool sees them. */
export function applyClientActionsToContext(context, actions) {
  let next = context;
  for (const action of Array.isArray(actions) ? actions : []) {
    if (action?.type === 'apply_room_state') next = { ...next, roomDraft: sanitizeRoomState(action.state) ?? next.roomDraft };
    else if (action?.type === 'apply_wall_state') next = { ...next, wallDraft: sanitizeLayout(action.state) ?? next.wallDraft };
    else if (action?.type === 'apply_bag_items') next = { ...next, bagItems: sanitizeBagItems(action.items) };
  }
  return next;
}

/** One `tools/call` round trip through the MCP server; a protocol error reads as a failed result. */
export function invokeMcpTool(name, args, workspace, { version, id = 1 } = {}) {
  const response = handleMcpRequest(
    { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    { version, workspace },
  );
  if (response?.error) {
    const text = response.error.message;
    return { content: [{ type: 'text', text }], structuredContent: { error: text }, clientActions: [], isError: true };
  }
  return response.result;
}

export function toolSummary(result) {
  const summary = result?.structuredContent?.summary ?? result?.content?.[0]?.text?.split('\n')[0] ?? '';
  return sanitizeText(summary, { maxLength: SUMMARY_MAX });
}

/** The trace entry a reply carries for one executed call. */
export function traceEntry(name, args, result) {
  return { name, arguments: args, summary: toolSummary(result), status: result?.isError ? 'error' : 'completed' };
}

/* Inspection plan for a question the engine answers */

function workspaceTarget(ctx) {
  if (ctx.route === '/studio-2d') return 'wall';
  if (ctx.route === '/checkout') return 'cart';
  if (ctx.route === '/room-3d') return 'room';
  return 'all';
}

function physicsSource(ctx) {
  const room = ctx.roomDraft?.items.length > 0;
  const wall = ctx.wallDraft?.items.length > 0;
  if (ctx.route === '/studio-2d' && wall) return 'wall';
  if (room) return 'room';
  if (wall) return 'wall';
  return null;
}

function catalogArguments(question, ctx) {
  const products = matchCatalogProducts(question);
  const args = { currency: ctx.currency };
  if (products.length === 1) args.sku = products[0].sku;
  else if (products.length > 1) args.query = products.map((product) => product.name).join(' ');
  return args;
}

function inspectionPlan(question, ctx, category) {
  switch (category) {
    case 'workspace':
      return { name: 'inspect_workspace', arguments: { target: workspaceTarget(ctx) } };
    case 'catalog':
      return { name: 'query_catalog', arguments: catalogArguments(question, ctx) };
    case 'electrical':
    case 'physics': {
      const source = physicsSource(ctx);
      return source ? { name: 'simulate_physics_and_bus', arguments: { source } } : { name: 'query_catalog', arguments: catalogArguments(question, ctx) };
    }
    case 'commerce':
      return { name: 'inspect_workspace', arguments: { target: 'cart' } };
    case 'guide':
    case 'spatial':
      return { name: 'lookup_studio_guide', arguments: { question } };
    case 'engineering':
    case 'unrecognized':
      return { name: 'unlock_engineering_escalation', arguments: { question } };
    default:
      return null;
  }
}

/* Agent replies */

const PLANNER_ACTIONS = Object.freeze({
  mutate_3d_room: { label: 'Open 3D Spatial Studio', to: '/room-3d' },
  mutate_2d_wall: { label: 'Open Wall Studio', to: '/studio-2d' },
  manage_cart_bag: { label: 'Open Checkout Spec', to: '/checkout' },
});

const UNDO_LINE = Object.freeze({
  mutate_3d_room: ['/room-3d', 'Undo: press Ctrl+Z in the 3D planner to reverse this step in one move', 'View: open the 3D Spatial Studio to see it; Ctrl+Z there reverses it'],
  mutate_2d_wall: ['/studio-2d', 'Undo: press Ctrl+Z in the Wall Studio to reverse this step in one move', 'View: open the Wall Studio to see it; Ctrl+Z there reverses it'],
});

function roomBullets(s) {
  const t = s.telemetry;
  const view = [s.activeWall ? `${WALL_LABELS[s.activeWall]} active` : null, s.cameraMode ? `${CAMERA_MODE_LABELS[s.cameraMode]} lens` : null]
    .filter(Boolean)
    .join(', ');
  return [
    `Room: ${t.envelope.widthCm} x ${t.envelope.depthCm} x ${t.envelope.heightCm} cm, ${t.envelope.presetLabel}${view ? `, ${view}` : ''}`,
    `Power: ${plural(t.modules, 'module')}, ${t.ratedW} W rated on ${t.psu}, drop ${t.bus.dropPct.toFixed(2)}%`,
    `Acoustics: RT60 ${t.acoustics.rt60Sec.toFixed(2)} s, STI ${t.acoustics.stiScore.toFixed(2)} (${t.acoustics.stiGrade}), ${t.light.avgLux} lx floor average`,
  ];
}

function wallBullets(s) {
  const t = s.telemetry;
  return [
    `Wall: ${t.envelope.widthCm} x ${t.envelope.heightCm} cm, ${plural(t.modules, 'module')}${t.conflicts > 0 ? `, ${plural(t.conflicts, 'conflict')}` : ''}`,
    `Power: ${t.ratedW} W rated on ${t.psu}, drop ${t.bus.dropPct.toFixed(2)}%`,
    `Acoustics: RT60 ${t.acoustics.rt60Sec.toFixed(2)} s, ${t.light.avgLux} lx average`,
  ];
}

function cartBullets(s) {
  const t = s.telemetry;
  return [
    `Cart: ${plural(t.lines, 'line')}, ${plural(t.pieces, 'piece')}, gross ${t.gross} incl. VAT`,
    `Power: ${t.ratedW} W connected, ${t.psu}`,
    `Freight: ${plural(t.crates, 'crate')}, ${t.freightClass}, dispatch ${t.dispatch}`,
  ];
}

function plannerMetrics(t) {
  return [
    { label: 'Modules', value: String(t.modules) },
    { label: 'Rated Load', value: `${t.ratedW} W` },
    { label: 'RT60', value: `${t.acoustics.rt60Sec.toFixed(2)} s` },
    { label: 'Floor Lux', value: `${t.light.avgLux} lx` },
  ];
}

function cartMetrics(t) {
  return [
    { label: 'Lines', value: String(t.lines) },
    { label: 'Gross', value: t.gross },
    { label: 'Load', value: `${t.ratedW} W` },
    { label: 'Crates', value: String(t.crates) },
  ];
}

function agentReply(question, ctx, calls) {
  const done = calls.filter((call) => !call.result.isError);
  const failed = calls.find((call) => call.result.isError);
  const citations = calls.map((call) => ({ id: `mcp:${call.name.replaceAll('_', '-')}`, label: `MCP / ${call.name}` }));
  if (done.length === 0) {
    const reason = failed?.result.content?.[0]?.text ?? 'The request could not be applied.';
    return composeReply(
      question,
      { category: 'agent', resolved: true, confidence: 0.7 },
      {
        lead: `I could not apply that change: ${reason.replace(/\.$/, '')}.`,
        bullets: [
          'Nothing changed: your room, wall and cart are exactly as they were',
          'Try: name the part, finish and wall, for example "Mount a Floating Shelf 110 in Walnut on the East Wall"',
        ],
        citations,
      },
    );
  }
  const main = done[0];
  const s = main.result.structuredContent;
  const changed = s.changed !== false;
  let bullets = [];
  let metrics = [];
  if (changed && main.name === 'mutate_3d_room') {
    bullets = roomBullets(s);
    metrics = plannerMetrics(s.telemetry);
  } else if (changed && main.name === 'mutate_2d_wall') {
    bullets = wallBullets(s);
    metrics = plannerMetrics(s.telemetry);
  } else if (changed && main.name === 'manage_cart_bag') {
    bullets = cartBullets(s);
    metrics = cartMetrics(s.telemetry);
  }
  const undo = UNDO_LINE[main.name];
  if (changed && undo) bullets.push(ctx.route === undo[0] ? undo[1] : undo[2]);
  if (failed) bullets.push(`Skipped: ${toolSummary(failed.result)}`);
  return composeReply(
    question,
    { category: 'agent', resolved: true, confidence: 0.92 },
    {
      lead: changed ? `Done: ${s.summary.charAt(0).toLowerCase()}${s.summary.slice(1)}.` : 'Nothing to change: your workspace already matches that request.',
      bullets,
      metrics,
      citations,
      actions: changed && PLANNER_ACTIONS[main.name] ? [PLANNER_ACTIONS[main.name]] : [],
    },
  );
}

/**
 * Answers one question through the MCP pipeline. Returns
 * `{ reply, events }`: the reply with `toolCalls`, `clientActions` and
 * `mcpProtocol`, and the `tool_call` / `tool_result` events in the order the
 * tools ran, for the SSE stream.
 */
export function runDeterministicAgent(question, workspaceContext, { version } = {}) {
  const text = sanitizeQuestion(question);
  let ctx = sanitizeWorkspaceContext(workspaceContext);
  const base = evaluateConciergeQuery(text, ctx);
  const events = [];
  const calls = [];
  const run = (name, args) => {
    events.push({ event: 'tool_call', data: { name, arguments: args } });
    const result = invokeMcpTool(name, args, ctx, { version, id: calls.length + 1 });
    calls.push({ name, arguments: args, result });
    events.push({
      event: 'tool_result',
      data: { name, summary: toolSummary(result), clientActions: result.clientActions ?? [], isError: result.isError === true },
    });
    if (isMutationResult(name, result)) ctx = applyClientActionsToContext(ctx, result.clientActions);
    return result;
  };

  // A bespoke or structural request goes to engineering even when phrased as a command.
  const intent = text && base.category !== 'engineering' ? parseAgentIntent(text, ctx.route) : null;
  let reply;
  if (intent) {
    run(intent.tool, intent.arguments);
    reply = agentReply(text, ctx, calls);
  } else {
    const plan = text ? inspectionPlan(text, ctx, base.category) : null;
    if (plan) run(plan.name, plan.arguments);
    reply = base;
  }
  const clientActions = calls.flatMap((call) => (isMutationResult(call.name, call.result) ? call.result.clientActions : []));
  return {
    reply: {
      ...reply,
      mcpProtocol: MCP_PROTOCOL,
      toolCalls: calls.map((call) => traceEntry(call.name, call.arguments, call.result)),
      clientActions,
    },
    events,
  };
}

/** Splits an answer into word-sized SSE deltas that rejoin to the exact text. */
export function answerDeltas(answer, size = 6) {
  const tokens = answer.match(/\S+\s*|\s+/g) ?? [];
  const out = [];
  for (let i = 0; i < tokens.length; i += size) out.push(tokens.slice(i, i + size).join(''));
  return out;
}

