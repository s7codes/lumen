import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { asciiAnswer, createConciergeAgent, DEFAULT_MODELS, loadDotEnv, resolveLlmConfig } from '../server/llm-agent.js';
import { parseAgentIntent } from '../src/lib/agent-intent.js';
import { BAG_STORAGE_KEY } from '../src/lib/bag.js';
import {
  conversationalText,
  evaluateConciergeQuery,
  isToolCitation,
  isToolTraceLine,
  MCP_PROTOCOL,
  sanitizeClientActions,
  sanitizeConciergeReply,
} from '../src/lib/concierge-engine.js';
import { answerDeltas, runDeterministicAgent } from '../src/lib/mcp-orchestrator.js';
import { handleMcpRequest, MCP_PROTOCOL_VERSION, MCP_TOOL_NAMES } from '../src/lib/mcp-server.js';
import { createRoomState, mountInRoom, ROOM_STORAGE_KEY, sanitizeRoomState, serializeRoomState } from '../src/lib/room-3d.js';
import { WALL_STORAGE_KEY } from '../src/lib/wall-studio.js';
import { collectRuntimeErrors, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const ROOM_KEY = `lumen:${ROOM_STORAGE_KEY}`;
const WALL_KEY = `lumen:${WALL_STORAGE_KEY}`;
const BAG_KEY = `lumen:${BAG_STORAGE_KEY}`;

const TOOLS = [
  'inspect_workspace',
  'query_catalog',
  'simulate_physics_and_bus',
  'mutate_3d_room',
  'mutate_2d_wall',
  'manage_cart_bag',
  'lookup_studio_guide',
  'unlock_engineering_escalation',
];
const MOUNT_LOFT = 'Mount a Floating Shelf 110 in Walnut on the East Wall and set the room to Grand Loft';
const ADD_LIGHTBARS = 'Add 2 Linear Lightbar 60 in Obsidian to my cart';
const EM_DASH = String.fromCharCode(0x2014);

function liveRoom() {
  let state = createRoomState();
  for (const [productId, wall] of [
    ['linear-lightbar-60', 'north'],
    ['acoustic-art-frame-50x70', 'north'],
    ['wall-sconce-80', 'west'],
  ]) {
    state = mountInRoom(state, productId, wall).state;
  }
  return serializeRoomState(state);
}

const ROOM = liveRoom();

function rpc(method, params, id = 1) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

function parseSse(text) {
  return text
    .split('\n\n')
    .filter((frame) => frame.trim() && !frame.startsWith(':'))
    .map((frame) => {
      const lines = frame.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
      const data = JSON.parse(lines.filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n'));
      return { event, data };
    });
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

/* POST /api/mcp: Model Context Protocol, JSON-RPC 2.0 */

test.describe('MCP server over POST /api/mcp', () => {
  test('initialize, ping and notifications speak protocol 2025-06-18', async ({ request }) => {
    const { version } = await (await request.get('/api/health')).json();
    const init = await request.post('/api/mcp', { data: rpc('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'e2e', version: '1' } }) });
    expect(init.status()).toBe(200);
    expect(init.headers()['content-type']).toMatch(/^application\/json/);
    expect(init.headers()['x-content-type-options']).toBe('nosniff');
    const body = await init.json();
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false }, resources: { subscribe: false }, prompts: { listChanged: false } },
      serverInfo: { name: 'lumen-spatial-mcp', version },
    });

    expect(await (await request.post('/api/mcp', { data: rpc('ping', undefined, 'p-1') })).json()).toEqual({ jsonrpc: '2.0', id: 'p-1', result: {} });

    const note = await request.post('/api/mcp', { data: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    expect(note.status()).toBe(202);
    expect(await note.text()).toBe('');

    const revision = await request.post('/api/mcp', { headers: { 'MCP-Protocol-Version': MCP_PROTOCOL_VERSION }, data: rpc('ping') });
    expect(revision.status()).toBe(200);
  });

  test('tools/list exposes the 8 tools with strict JSON Schema contracts', async ({ request }) => {
    const { result } = await (await request.post('/api/mcp', { data: rpc('tools/list') })).json();
    expect(result.tools.map((tool) => tool.name)).toEqual(TOOLS);
    expect(MCP_TOOL_NAMES).toEqual(TOOLS);
    for (const tool of result.tools) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    }
    const room = result.tools.find((tool) => tool.name === 'mutate_3d_room');
    expect(room.annotations.readOnlyHint).toBe(false);
    expect(room.inputSchema.properties.mount.properties.wall.enum).toEqual(['north', 'east', 'south', 'west']);
    expect(room.inputSchema.properties.scalePreset.enum).toEqual(['compact', 'living', 'gallery', 'loft']);
    expect(room.inputSchema.properties.lightingScene.enum).toEqual(['full', 'morning', 'evening', 'night']);
    expect(room.inputSchema.properties.cameraLens.enum).toEqual(['orbit', 'inside', 'elevation']);
    expect(result.tools.find((tool) => tool.name === 'inspect_workspace').annotations.readOnlyHint).toBe(true);
  });

  test('resources/list and resources/read serve the catalog, bus, acoustics and the caller workspace', async ({ request }) => {
    const { result } = await (await request.post('/api/mcp', { data: rpc('resources/list') })).json();
    expect(result.resources.map((resource) => resource.uri)).toEqual([
      'lumen://catalog/products',
      'lumen://electrical/drivers-and-bus',
      'lumen://acoustics/sabine-6octave',
      'lumen://workspace/live',
    ]);

    const read = async (uri, meta) => {
      const response = await request.post('/api/mcp', { data: rpc('resources/read', { uri, ...(meta ? { _meta: { 'lumen/workspace': meta } } : {}) }) });
      const { result: out } = await response.json();
      expect(out.contents[0]).toMatchObject({ uri, mimeType: 'application/json' });
      return JSON.parse(out.contents[0].text);
    };
    const catalog = await read('lumen://catalog/products');
    expect(catalog.products).toHaveLength(12);
    expect(catalog.products.find((product) => product.id === 'floating-shelf-110')).toMatchObject({ sku: 'LMN-SH-110', watts: 16, finishes: ['walnut', 'oak', 'obsidian', 'chalk'] });
    expect((await read('lumen://electrical/drivers-and-bus')).busVoltage).toBe(24);
    expect((await read('lumen://acoustics/sabine-6octave')).bands).toEqual(['125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz']);

    const live = await read('lumen://workspace/live', { route: '/room-3d', roomDraft: ROOM, bagItems: [{ id: 'floating-shelf-110', finish: 'oak', qty: 2 }] });
    expect(live.room.telemetry).toMatchObject({ modules: 3, perWall: { north: 2, east: 0, south: 0, west: 1 } });
    expect(live.room.state.items).toHaveLength(3);
    expect(live.cart.telemetry).toMatchObject({ lines: 1, pieces: 2, currency: 'USD' });
    expect(live.wall).toBeNull();

    const missing = await (await request.post('/api/mcp', { data: rpc('resources/read', { uri: 'lumen://nope' }) })).json();
    expect(missing.error.code).toBe(-32002);
  });

  test('prompts/list and prompts/get return the three architectural prompts', async ({ request }) => {
    const { result } = await (await request.post('/api/mcp', { data: rpc('prompts/list') })).json();
    expect(result.prompts.map((prompt) => prompt.name)).toEqual(['audit-room-3d', 'size-24v-bus', 'optimize-acoustics-rt60']);
    const got = await (await request.post('/api/mcp', { data: rpc('prompts/get', { name: 'optimize-acoustics-rt60', arguments: { targetSec: '0.5' } }) })).json();
    expect(got.result.messages[0]).toMatchObject({ role: 'user', content: { type: 'text' } });
    expect(got.result.messages[0].content.text).toContain('inspect_workspace');
    expect(got.result.messages[0].content.text).toContain('0.5 s');
  });

  test('tools/call inspects the live room and returns undoable room mutations as client actions', async ({ request }) => {
    const meta = { _meta: { 'lumen/workspace': { route: '/room-3d', roomDraft: ROOM } } };
    const inspect = await (await request.post('/api/mcp', { data: rpc('tools/call', { name: 'inspect_workspace', arguments: { target: 'room' }, ...meta }) })).json();
    expect(inspect.result.isError).toBe(false);
    expect(inspect.result.content[0].type).toBe('text');
    expect(inspect.result.structuredContent.room).toMatchObject({ modules: 3, ratedW: 43 });
    expect(inspect.result.structuredContent.room.acoustics.rt60Sec).toBeGreaterThan(0);
    expect(inspect.result.structuredContent.room.light.peakLux).toBeGreaterThanOrEqual(inspect.result.structuredContent.room.light.avgLux);
    expect(inspect.result.clientActions).toEqual([]);

    const args = { scalePreset: 'loft', mount: { productId: 'floating-shelf-110', wall: 'east', finish: 'walnut' }, lightingScene: 'evening', cameraLens: 'inside' };
    const mutate = await (await request.post('/api/mcp', { data: rpc('tools/call', { name: 'mutate_3d_room', arguments: args, ...meta }) })).json();
    const { result } = mutate;
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ moduleCount: 4, activeWall: 'east', cameraMode: 'inside' });
    expect(result.clientActions).toHaveLength(1);
    const [action] = result.clientActions;
    expect(action).toMatchObject({ type: 'apply_room_state', activeWall: 'east', cameraMode: 'inside' });
    expect(action.state.room).toMatchObject({ widthCm: 800, depthCm: 650, heightCm: 340 });
    expect(action.state.items.filter((item) => item.wall === 'east')).toEqual([
      expect.objectContaining({ productId: 'floating-shelf-110', finish: 'walnut', dimPct: 45 }),
    ]);
    // What the server emits survives the client's own sanitizer unchanged.
    expect(serializeRoomState(sanitizeRoomState(action.state))).toEqual(action.state);
    expect(action.notice).toMatch(/^Lumen AI set the room to Grand Loft/);

    const refused = await (await request.post('/api/mcp', { data: rpc('tools/call', { name: 'mutate_3d_room', arguments: { mount: { productId: 'directional-spot-monopoint', finish: 'walnut' } }, ...meta }) })).json();
    expect(refused.result.isError).toBe(true);
    expect(refused.result.content[0].text).toBe('Directional Spot Monopoint ships in Obsidian and Chalk; Walnut is not offered.');
    expect(refused.result.clientActions).toEqual([]);
  });

  test('malformed messages get the standard JSON-RPC error codes', async ({ request }) => {
    // A Buffer goes out byte for byte; Playwright would JSON-encode a string that does not parse.
    const raw = (data) => request.post('/api/mcp', { headers: { 'Content-Type': 'application/json' }, data: Buffer.from(data) });

    const parse = await raw('{"jsonrpc":"2.0",');
    expect(parse.status()).toBe(400);
    expect(await parse.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: expect.stringMatching(/^Parse error/) } });

    for (const body of ['[{"jsonrpc":"2.0","id":1,"method":"ping"}]', '{"jsonrpc":"1.0","id":1,"method":"ping"}', '{"jsonrpc":"2.0","id":1}', '{"jsonrpc":"2.0","id":{"x":1},"method":"ping"}']) {
      const invalid = await raw(body);
      expect(invalid.status()).toBe(400);
      expect((await invalid.json()).error.code).toBe(-32600);
    }

    const unknown = await request.post('/api/mcp', { data: rpc('tools/explode', {}, 7) });
    expect(unknown.status()).toBe(200);
    expect(await unknown.json()).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32601, message: 'Method not found: tools/explode' } });

    for (const params of [
      { name: 'rm_rf_everything' },
      { name: 'mutate_3d_room', arguments: { scalePreset: 'cathedral' } },
      { name: 'mutate_3d_room', arguments: { mount: { productId: 'floating-shelf-110', wall: 'up' } } },
      { name: 'manage_cart_bag', arguments: { add: { productId: 'linear-lightbar-60', qty: 500 } } },
      { name: 'inspect_workspace', arguments: { target: 'room', __extra: true } },
      { name: 'inspect_workspace', arguments: {}, _meta: { 'lumen/workspace': { roomDraft: { ...ROOM, items: [{ productId: 'evil', finish: 'oak', xCm: 0, yCm: 0 }] } } } },
    ]) {
      const response = await (await request.post('/api/mcp', { data: rpc('tools/call', params, 9) })).json();
      expect(response.error.code, JSON.stringify(params)).toBe(-32602);
    }

    const polluted = await raw('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"query_catalog","arguments":{"__proto__":{"admin":true},"constructor":{"prototype":{"x":1}},"shape":"shelf"}}}');
    const pollutedBody = await polluted.json();
    expect(pollutedBody.result.structuredContent.products.map((product) => product.id)).toEqual(['floating-shelf-110']);

    const crossOrigin = await request.post('/api/mcp', { headers: { Origin: 'https://evil.example' }, data: rpc('ping') });
    expect(crossOrigin.status()).toBe(403);
    expect((await request.post('/api/mcp', { headers: { 'MCP-Protocol-Version': '1999-01-01' }, data: rpc('ping') })).status()).toBe(400);
    expect((await request.get('/api/mcp')).status()).toBe(405);
    expect((await request.post('/api/mcp', { headers: { 'Content-Type': 'text/plain' }, data: JSON.stringify(rpc('ping')) })).status()).toBe(415);
  });
});

/* POST /api/concierge/stream: Server-Sent Events */

test.describe('SSE streaming over POST /api/concierge/stream', () => {
  test('streams tool_call, tool_result, delta and complete frames that add up to the /ask reply', async ({ request }) => {
    const workspaceContext = { route: '/room-3d', roomDraft: ROOM };
    const response = await request.post('/api/concierge/stream', { data: { question: MOUNT_LOFT, workspaceContext } });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(response.headers()['cache-control']).toMatch(/no-store/);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    const text = await response.text();
    expect(text.startsWith(': lumen-mcp-stream\n\n')).toBe(true);

    const frames = parseSse(text);
    const order = frames.map((frame) => frame.event);
    expect(order.slice(0, 2)).toEqual(['tool_call', 'tool_result']);
    expect(order.at(-1)).toBe('complete');
    expect(order.slice(2, -1).every((event) => event === 'delta')).toBe(true);
    expect(order.filter((event) => event === 'delta').length).toBeGreaterThan(3);

    const [call, result] = frames;
    expect(call.data).toEqual({ name: 'mutate_3d_room', arguments: { scalePreset: 'loft', mount: { productId: 'floating-shelf-110', finish: 'walnut', wall: 'east' } } });
    expect(result.data).toMatchObject({ name: 'mutate_3d_room', isError: false, summary: expect.stringMatching(/^Set the room to Grand Loft 800 x 650 x 340 cm, mounted Floating Shelf 110 in Walnut on the East Wall/) });
    expect(result.data.clientActions[0]).toMatchObject({ type: 'apply_room_state', activeWall: 'east' });

    const { reply } = frames.at(-1).data;
    expect(frames.filter((frame) => frame.event === 'delta').map((frame) => frame.data.text).join('')).toBe(reply.answer);
    expect(reply).toEqual(runDeterministicAgent(MOUNT_LOFT, workspaceContext).reply);
    expect(reply).toMatchObject({ category: 'agent', resolved: true, mcpProtocol: '2025-06-18' });
    expect(reply.toolCalls).toEqual([expect.objectContaining({ name: 'mutate_3d_room', status: 'completed' })]);

    const ask = await request.post('/api/concierge/ask', { data: { question: MOUNT_LOFT, workspaceContext } });
    expect((await ask.json()).reply).toEqual(reply);
  });

  test('a question streams its inspection tool and the engine answer; bad requests fail before the stream opens', async ({ request }) => {
    const question = 'Audit my live 3D room & RT60';
    const workspaceContext = { route: '/room-3d', roomDraft: ROOM };
    const frames = parseSse(await (await request.post('/api/concierge/stream', { data: { question, workspaceContext } })).text());
    expect(frames[0]).toEqual({ event: 'tool_call', data: { name: 'inspect_workspace', arguments: { target: 'room' } } });
    expect(frames[1].data.clientActions).toEqual([]);
    const { reply } = frames.at(-1).data;
    expect(reply.answer).toBe(evaluateConciergeQuery(question, workspaceContext).answer);
    expect(reply.clientActions).toEqual([]);

    const invalid = await request.post('/api/concierge/stream', { data: { question: 42 } });
    expect(invalid.status()).toBe(400);
    expect(invalid.headers()['content-type']).toMatch(/^application\/json/);
    expect((await invalid.json()).error.code).toBe('invalid');
    expect((await request.post('/api/concierge/stream', { headers: { Origin: 'http://evil.example' }, data: { question } })).status()).toBe(403);
  });
});

/* Agent intent and the deterministic orchestrator: pure, shared by browser and server */

test.describe('agent intent parser and deterministic MCP orchestrator', () => {
  test('imperative commands map to one mutation tool; questions never do', () => {
    expect(parseAgentIntent('Mount a Floating Shelf 110 in Walnut on the East Wall')).toEqual({
      tool: 'mutate_3d_room',
      arguments: { mount: { productId: 'floating-shelf-110', finish: 'walnut', wall: 'east' } },
    });
    expect(parseAgentIntent('Set my 3D room to Grand Loft and apply the Evening scene')).toEqual({
      tool: 'mutate_3d_room',
      arguments: { scalePreset: 'loft', lightingScene: 'evening' },
    });
    expect(parseAgentIntent('Switch to the 165 cm Inside Room walkthrough lens')).toEqual({ tool: 'mutate_3d_room', arguments: { cameraLens: 'inside' } });
    expect(parseAgentIntent(ADD_LIGHTBARS)).toEqual({
      tool: 'manage_cart_bag',
      arguments: { add: { productId: 'linear-lightbar-60', finish: 'obsidian', qty: 2 } },
    });
    expect(parseAgentIntent('Mount a Linear Pendant 150 on the North Wall').arguments.mount).toEqual({ productId: 'linear-pendant-150', wall: 'north' });
    expect(parseAgentIntent('Clear the East Wall').arguments).toEqual({ clearWall: 'east' });
    expect(parseAgentIntent('Sync my room to the cart').arguments).toEqual({ syncFrom: 'room' });
    expect(parseAgentIntent('Apply the Night Gallery scene').arguments).toEqual({ lightingScene: 'night' });
    expect(parseAgentIntent('Please add a low platform bed').arguments).toEqual({ furniture: 'bed-160' });
    expect(parseAgentIntent('Mount a floating shelf', '/studio-2d')).toEqual({ tool: 'mutate_2d_wall', arguments: { mount: { productId: 'floating-shelf-110' } } });
    expect(parseAgentIntent('Turn the attic slope off', '/studio-2d').arguments).toEqual({ slope: false });

    for (const question of [
      'How do I mount a shelf?',
      'Can I add a shelf to the east wall?',
      'Why cant I open 3D room designer',
      'Floating Shelf 110 specs & anchors',
      'Audit my live 3D room & RT60',
      'Open 3D Spatial Studio',
      'Export a 1:20 DXF blueprint',
      'Compare 60W vs 150W 24V drivers',
      'Make it brighter',
    ]) {
      expect(parseAgentIntent(question, '/room-3d'), question).toBeNull();
    }
  });

  test('runs mutations through tools/call, keeps engine answers for questions and is deterministic', () => {
    const ctx = { route: '/room-3d', roomDraft: ROOM };
    const first = runDeterministicAgent(MOUNT_LOFT, ctx);
    expect(first).toEqual(runDeterministicAgent(MOUNT_LOFT, structuredClone(ctx)));
    expect(first.reply.category).toBe('agent');
    expect(first.reply.answer.split('\n')[0]).toMatch(/^Done: set the room to Grand Loft 800 x 650 x 340 cm, mounted Floating Shelf 110 in Walnut on the East Wall at X \d+ \/ Y \d+ cm\.$/);
    expect(first.reply.answer).toContain('- Undo: press Ctrl+Z in the 3D planner');
    expect(first.reply.metrics.map((metric) => metric.label)).toEqual(['Modules', 'Rated Load', 'RT60', 'Floor Lux']);
    expect(first.events.map((event) => event.event)).toEqual(['tool_call', 'tool_result']);
    expect(/[^\x20-\x7E\n]/.test(first.reply.answer)).toBe(false);

    for (const question of ['Floating Shelf 110 specs & anchors', 'Which PSU driver do I need?', 'Why cant I open 3D room designer', 'Hi']) {
      const { reply } = runDeterministicAgent(question, ctx);
      const engine = evaluateConciergeQuery(question, ctx);
      expect(reply).toMatchObject(engine);
      expect(reply.clientActions).toEqual([]);
    }

    // A bespoke request phrased as a command still goes to studio engineering.
    const bespoke = runDeterministicAgent('Mount a custom 480 cm curved marble shelf with onsite structural welding on the east wall', ctx);
    expect(bespoke.reply).toMatchObject({ category: 'engineering', resolved: false, clientActions: [] });
    expect(bespoke.reply.toolCalls.map((call) => call.name)).toEqual(['unlock_engineering_escalation']);

    const refused = runDeterministicAgent('Mount 3 directional spots in walnut on the south wall', ctx);
    expect(refused.reply.clientActions).toEqual([]);
    expect(refused.reply.toolCalls[0]).toMatchObject({ name: 'mutate_3d_room', status: 'error' });
    expect(refused.reply.answer.split('\n')[0]).toBe('I could not apply that change: Directional Spot Monopoint ships in Obsidian and Chalk; Walnut is not offered.');

    expect(answerDeltas(first.reply.answer).join('')).toBe(first.reply.answer);
  });

  test('the client rebuilds tool traces and client actions from hostile replies', () => {
    const { reply } = runDeterministicAgent(ADD_LIGHTBARS, { route: '/' });
    expect(sanitizeConciergeReply(JSON.parse(JSON.stringify(reply)))).toEqual(reply);

    const hostile = sanitizeClientActions([
      { type: 'apply_bag_items', items: [{ id: 'linear-lightbar-60', finish: 'obsidian', qty: 2 }, { id: 'evil', finish: 'oak', qty: 1 }] },
      { type: 'apply_room_state', state: { ...ROOM, format: 'not-lumen' } },
      { type: 'apply_room_state', state: ROOM, activeWall: 'ceiling', cameraMode: 'drone', selectUid: 'm999' },
      { type: 'run_shell', command: 'rm -rf /' },
      { type: 'apply_wall_state', state: null },
    ]);
    expect(hostile).toEqual([{ type: 'apply_room_state', state: sanitizeRoomState(ROOM), notice: '' }]);

    const traced = sanitizeConciergeReply({
      ...reply,
      toolCalls: [{ name: 'Robert"); DROP', summary: 'x' }, { name: 'query_catalog', arguments: { nested: { deeper: { deepest: { a: { b: { c: 1 } } } } } }, summary: 'ok', status: 'weird' }],
    });
    expect(traced.toolCalls).toEqual([{ name: 'query_catalog', arguments: {}, summary: 'ok', status: 'completed' }]);
  });
});

/* Multi-provider LLM agent against scripted provider streams */

function sseResponse(text, chunk = 23) {
  const encoder = new TextEncoder();
  const parts = text.match(new RegExp(`[\\s\\S]{1,${chunk}}`, 'g')) ?? [];
  const body = new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function scriptedFetch(rounds) {
  const requests = [];
  const impl = async (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const next = rounds[requests.length - 1];
    if (next === undefined) throw new Error('unexpected provider round');
    return typeof next === 'function' ? next(init) : sseResponse(next);
  };
  return { impl, requests };
}

const anthropic = (data) => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
const openai = (data) => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\r\n\r\n`;
const gemini = (data) => `data: ${JSON.stringify(data)}\n\n`;

function recorder() {
  const events = [];
  return { events, onEvent: (event, data) => events.push({ event, data }) };
}

const silent = { warn() {} };

test.describe('multi-provider LLM agent with MCP tool calling', () => {
  test('resolves providers from the environment and reads only LLM keys from .env', () => {
    expect(resolveLlmConfig({}).provider).toBe('deterministic');
    expect(resolveLlmConfig({ ANTHROPIC_API_KEY: 'sk-ant-1234567890' })).toEqual({ provider: 'anthropic', model: DEFAULT_MODELS.anthropic, apiKey: 'sk-ant-1234567890', baseUrl: null });
    expect(resolveLlmConfig({ OPENAI_API_KEY: 'sk-openai-123456', LUMEN_LLM_MODEL: 'gpt-test' })).toMatchObject({ provider: 'openai', model: 'gpt-test' });
    expect(resolveLlmConfig({ GEMINI_API_KEY: 'gm-1234567890' }).provider).toBe('gemini');
    expect(resolveLlmConfig({ LUMEN_LLM_BASE_URL: 'http://127.0.0.1:11434/v1/' })).toMatchObject({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', apiKey: null });
    expect(resolveLlmConfig({ ANTHROPIC_API_KEY: 'sk-ant-1234567890', LUMEN_LLM_PROVIDER: 'deterministic' }).provider).toBe('deterministic');
    expect(resolveLlmConfig({ LUMEN_LLM_BASE_URL: 'file:///etc/passwd' }).provider).toBe('deterministic');
    expect(resolveLlmConfig({ LUMEN_LLM_PROVIDER: 'anthropic' }).provider).toBe('deterministic');

    const missing = pathToFileURL(join(tmpdir(), `lumen-no-env-${process.pid}-${Date.now()}`, '/'));
    expect(loadDotEnv(missing)).toEqual({});
    const dir = mkdtempSync(join(tmpdir(), 'lumen-env-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.env'), '# keys\nANTHROPIC_API_KEY="sk-ant-from-file"\nexport LUMEN_LLM_MODEL=claude-test # comment\nPATH=/evil\nNODE_OPTIONS=--inspect\n');
    expect(loadDotEnv(pathToFileURL(`${dir}/`))).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-from-file', LUMEN_LLM_MODEL: 'claude-test' });
  });

  test('Anthropic: streams a tool_use, runs it through tools/call and folds the answer to ASCII', async () => {
    const round1 = [
      anthropic({ type: 'message_start', message: { id: 'msg_1', role: 'assistant' } }),
      anthropic({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      anthropic({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'On it.' } }),
      anthropic({ type: 'content_block_stop', index: 0 }),
      anthropic({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_01', name: 'mutate_3d_room', input: {} } }),
      anthropic({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"mount":{"productId":"floating-shelf-110",' } }),
      anthropic({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"wall":"east","finish":"walnut"},"scalePreset":"loft"}' } }),
      anthropic({ type: 'content_block_stop', index: 1 }),
      anthropic({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }),
      anthropic({ type: 'message_stop' }),
    ].join('');
    const answer = `Done ${EM_DASH} the Floating Shelf 110 hangs on the East Wall of your Grand Loft.\n* Power: 16 W on one 60W driver\n- Undo: **Ctrl+Z** in the planner`;
    const round2 = [
      anthropic({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      anthropic({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer.slice(0, 30) } }),
      anthropic({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer.slice(30) } }),
      anthropic({ type: 'content_block_stop', index: 0 }),
      anthropic({ type: 'message_stop' }),
    ].join('');
    const { impl, requests } = scriptedFetch([round1, round2]);
    const agent = createConciergeAgent({ version: '6.3.0', env: { ANTHROPIC_API_KEY: 'sk-ant-test-key-0001' }, fetchImpl: impl, logger: silent });
    expect(agent.provider).toBe('anthropic');
    const { events, onEvent } = recorder();
    const reply = await agent.ask('Put the walnut shelf on the east wall of a grand loft', { route: '/room-3d', roomDraft: ROOM }, { onEvent });

    expect(reply.answer).toBe('Done - the Floating Shelf 110 hangs on the East Wall of your Grand Loft.\n- Power: 16 W on one 60W driver\n- Undo: Ctrl+Z in the planner');
    expect(reply).toMatchObject({ category: 'agent', resolved: true, mcpProtocol: MCP_PROTOCOL, provider: 'anthropic' });
    expect(reply.toolCalls).toEqual([
      { name: 'mutate_3d_room', arguments: { mount: { productId: 'floating-shelf-110', wall: 'east', finish: 'walnut' }, scalePreset: 'loft' }, summary: expect.stringMatching(/Grand Loft/), status: 'completed' },
    ]);
    expect(reply.clientActions[0].state.room).toMatchObject({ widthCm: 800, depthCm: 650, heightCm: 340 });
    expect(sanitizeConciergeReply(JSON.parse(JSON.stringify(reply)))).not.toBeNull();
    expect(events.map((entry) => entry.event)).toEqual(['delta', 'tool_call', 'tool_result', 'delta', 'delta']);

    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(requests[0].headers).toMatchObject({ 'x-api-key': 'sk-ant-test-key-0001', 'anthropic-version': '2023-06-01' });
    expect(requests[0].body).toMatchObject({ model: DEFAULT_MODELS.anthropic, stream: true });
    expect(requests[0].body.tools.map((tool) => tool.name)).toEqual(TOOLS);
    expect(requests[0].body.tools[3].input_schema.type).toBe('object');
    expect(requests[0].body.system).toContain('3D room');
    const [, assistantTurn, toolTurn] = requests[1].body.messages;
    expect(assistantTurn.content[1]).toEqual({ type: 'tool_use', id: 'toolu_01', name: 'mutate_3d_room', input: { mount: { productId: 'floating-shelf-110', wall: 'east', finish: 'walnut' }, scalePreset: 'loft' } });
    expect(toolTurn.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_01' });
    const fed = JSON.parse(toolTurn.content[0].content);
    expect(fed).toMatchObject({ isError: false, appliedInBrowser: true, structuredContent: { moduleCount: 4 } });
    expect(toolTurn.content[0].content).not.toContain('"items"');
  });

  test('OpenAI-compatible: assembles streamed tool_call fragments and feeds the tool message back', async () => {
    const round1 = [
      openai({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'manage_cart_bag', arguments: '' } }] } }] }),
      openai({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"add":{"productId":"linear-lightbar-60",' } }] } }] }),
      openai({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"finish":"obsidian","qty":2}}' } }] } }] }),
      openai({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      openai('[DONE]'),
    ].join('');
    const round2 = [openai({ choices: [{ delta: { content: 'Added 2 x Linear Lightbar 60 in Obsidian to your cart.' } }] }), openai('[DONE]')].join('');
    const { impl, requests } = scriptedFetch([round1, round2]);
    const agent = createConciergeAgent({ env: { OPENAI_API_KEY: 'sk-test-openai-0001' }, fetchImpl: impl, logger: silent });
    const reply = await agent.ask(ADD_LIGHTBARS, { route: '/catalog' });
    expect(reply.answer).toBe('Added 2 x Linear Lightbar 60 in Obsidian to your cart.');
    expect(reply.clientActions).toEqual([expect.objectContaining({ type: 'apply_bag_items', items: [{ id: 'linear-lightbar-60', finish: 'obsidian', qty: 2 }] })]);
    expect(requests[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(requests[0].headers.Authorization).toBe('Bearer sk-test-openai-0001');
    expect(requests[0].body.tools[0]).toMatchObject({ type: 'function', function: { name: 'inspect_workspace' } });
    const messages = requests[1].body.messages;
    expect(messages[2]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'manage_cart_bag' } }] });
    expect(messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
  });

  test('Gemini and Ollama: function calls and plain answers run the same MCP pipeline', async () => {
    const round1 = gemini({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'inspect_workspace', args: { target: 'room' } } }] } }] });
    const round2 = gemini({ candidates: [{ content: { parts: [{ text: 'Your room holds 3 modules at 43 W.' }] } }] });
    const geminiFetch = scriptedFetch([round1, round2]);
    const geminiAgent = createConciergeAgent({ env: { GEMINI_API_KEY: 'gm-test-key-0001' }, fetchImpl: geminiFetch.impl, logger: silent });
    const audit = await geminiAgent.ask('Audit my live 3D room & RT60', { route: '/room-3d', roomDraft: ROOM });
    expect(audit).toMatchObject({ category: 'workspace', resolved: true, answer: 'Your room holds 3 modules at 43 W.', clientActions: [] });
    expect(audit.toolCalls.map((call) => call.name)).toEqual(['inspect_workspace']);
    expect(geminiFetch.requests[0].url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODELS.gemini}:streamGenerateContent?alt=sse`);
    expect(geminiFetch.requests[0].headers['x-goog-api-key']).toBe('gm-test-key-0001');
    const declarations = geminiFetch.requests[0].body.tools[0].functionDeclarations;
    expect(declarations[0].parameters.type).toBe('OBJECT');
    expect(JSON.stringify(declarations)).not.toContain('additionalProperties');
    expect(geminiFetch.requests[1].body.contents[2].parts[0].functionResponse.name).toBe('inspect_workspace');

    const ollamaFetch = scriptedFetch([[openai({ choices: [{ delta: { content: 'The 150W driver feeds up to 150 W on one bus.' } }] }), openai('[DONE]')].join('')]);
    const ollama = createConciergeAgent({ env: { LUMEN_LLM_BASE_URL: 'http://127.0.0.1:11434' }, fetchImpl: ollamaFetch.impl, logger: silent });
    const drivers = await ollama.ask('Compare 60W vs 150W 24V drivers', { route: '/' });
    expect(drivers.answer).toBe('The 150W driver feeds up to 150 W on one bus.');
    expect(drivers.category).toBe(evaluateConciergeQuery('Compare 60W vs 150W 24V drivers').category);
    expect(ollamaFetch.requests[0].url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(ollamaFetch.requests[0].headers.Authorization).toBeUndefined();
    expect(ollamaFetch.requests[0].body.model).toBe(DEFAULT_MODELS.ollama);
  });

  test('a provider fault or timeout falls back to the deterministic orchestrator without leaking the key', async () => {
    const warnings = [];
    const logger = { warn: (line) => warnings.push(line) };
    const ctx = { route: '/room-3d', roomDraft: ROOM };
    const failing = createConciergeAgent({ env: { ANTHROPIC_API_KEY: 'sk-ant-secret-9999' }, fetchImpl: async () => new Response('overloaded', { status: 529 }), logger });
    const { events, onEvent } = recorder();
    const reply = await failing.ask(MOUNT_LOFT, ctx, { onEvent });
    expect(reply).toEqual(runDeterministicAgent(MOUNT_LOFT, ctx).reply);
    expect(events[0]).toEqual({ event: 'fallback', data: { provider: 'anthropic' } });
    expect(events.at(-1).event).toBe('delta');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('HTTP 529');
    expect(warnings.join('')).not.toContain('sk-ant-secret-9999');

    const hanging = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const slow = createConciergeAgent({ env: { OPENAI_API_KEY: 'sk-test-openai-0002' }, fetchImpl: hanging, timeoutMs: 50, logger: silent });
    expect(await slow.ask('Hi', {})).toEqual(runDeterministicAgent('Hi', {}).reply);

    expect(asciiAnswer(`### Lead\n${String.fromCharCode(0x2022)} 3 ${String.fromCharCode(0x00d7)} 2 ${String.fromCharCode(0x2192)} 6 at 90${String.fromCharCode(0x00b0)}`)).toBe('Lead\n- 3 x 2 to 6 at 90 deg');
  });
});

/* Live agentic workspace from the Lumen AI panel */

async function openConcierge(page) {
  await page.getByTestId('concierge-trigger').click();
  const panel = page.getByTestId('concierge-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-mcp', '2025-06-18');
  return panel;
}

async function ask(page, question) {
  const replies = page.getByTestId('concierge-reply');
  const before = await replies.count();
  await page.getByTestId('concierge-input').fill(question);
  await page.getByTestId('concierge-send').click();
  await expect(replies).toHaveCount(before + 1);
  await expect(page.getByTestId('concierge-panel')).toHaveAttribute('data-state', 'idle');
  return replies.nth(before);
}

async function closeConcierge(page) {
  await page.getByTestId('concierge-close').click();
  await expect(page.getByTestId('concierge-panel')).toBeHidden();
}

function roomModules(page, productId) {
  return page.locator(`[data-testid="room-module"][data-product="${productId}"]`);
}

test.describe('Lumen AI agentic workspace execution', () => {
  test('a chat command mounts a part and resizes the live 3D room in one undoable step', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/room-3d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    const viewport = page.getByTestId('room-viewport');
    await expect(viewport).toHaveAttribute('data-room-width', '320');
    await expect(viewport).toHaveAttribute('data-active-wall', 'north');
    await expect(roomModules(page, 'floating-shelf-110')).toHaveCount(0);

    await openConcierge(page);
    const reply = await ask(page, MOUNT_LOFT);
    await expect(reply).toHaveAttribute('data-category', 'agent');
    await expect(reply).toHaveAttribute('data-client-actions', '1');
    const tool = reply.getByTestId('concierge-tool-call');
    await expect(tool).toHaveCount(1);
    await expect(tool).toHaveAttribute('data-tool-name', 'mutate_3d_room');
    await expect(tool).toHaveAttribute('data-status', 'completed');
    // The trace is data for automation, never conversation: nothing of it is painted or announced.
    await expect(reply.getByTestId('concierge-tool-calls')).toBeHidden();
    await expect(tool).toHaveText('');
    await expect(reply).not.toContainText('MCP //');
    await expect(reply).not.toContainText('mutate_3d_room');
    await expect(reply.locator('.concierge-msg__lead')).toContainText('Grand Loft');

    // The live viewport and scene graph took the mutation without a reload.
    await expect(viewport).toHaveAttribute('data-room-width', '800');
    await expect(viewport).toHaveAttribute('data-room-depth', '650');
    await expect(viewport).toHaveAttribute('data-room-height', '340');
    await expect(viewport).toHaveAttribute('data-active-wall', 'east');
    const shelf = roomModules(page, 'floating-shelf-110');
    await expect(shelf).toHaveCount(1);
    await expect(shelf).toHaveAttribute('data-finish', 'walnut');
    await expect(shelf).toHaveAttribute('data-wall', 'east');
    await expect(page.getByTestId('room-notice')).toContainText('Lumen AI set the room to Grand Loft');
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROOM_KEY);
    expect(stored.room).toMatchObject({ widthCm: 800, depthCm: 650, heightCm: 340 });

    const lens = await ask(page, 'Switch to the 165 cm Inside Room walkthrough lens');
    await expect(lens.getByTestId('concierge-tool-call')).toHaveAttribute('data-tool-name', 'mutate_3d_room');
    await expect(viewport).toHaveAttribute('data-camera-mode', 'inside');

    // Ctrl+Z reverses the AI edit whole; Ctrl+Shift+Z brings it back.
    await closeConcierge(page);
    await page.keyboard.press('Control+z');
    await expect(viewport).toHaveAttribute('data-room-width', '320');
    await expect(viewport).toHaveAttribute('data-room-height', '250');
    await expect(roomModules(page, 'floating-shelf-110')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(viewport).toHaveAttribute('data-room-width', '800');
    await expect(roomModules(page, 'floating-shelf-110')).toHaveCount(1);

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('the room wall and the cart follow chat commands live, and offline the device runs the same tools', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/room-3d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    const shelves = roomModules(page, 'floating-shelf-110');
    const before = await shelves.count();

    // In the planner a bare "mount" lands on the room's active wall.
    await openConcierge(page);
    const mounted = await ask(page, 'Mount a Floating Shelf 110 in Oak');
    await expect(mounted.getByTestId('concierge-tool-call')).toHaveAttribute('data-tool-name', 'mutate_3d_room');
    await expect(shelves).toHaveCount(before + 1);
    await expect(shelves.last()).toHaveAttribute('data-finish', 'oak');
    await expect(page.getByTestId('room-notice')).toContainText('Lumen AI mounted Floating Shelf 110 in Oak');

    const cart = await ask(page, ADD_LIGHTBARS);
    await expect(cart.getByTestId('concierge-tool-call')).toHaveAttribute('data-tool-name', 'manage_cart_bag');
    await expect(page.getByRole('button', { name: 'Cart (2)' })).toBeVisible();
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), BAG_KEY)).toEqual([{ id: 'linear-lightbar-60', finish: 'obsidian', qty: 2 }]);

    await closeConcierge(page);
    await page.keyboard.press('Control+z');
    await expect(shelves).toHaveCount(before);

    // With the API unreachable the device runs the same orchestrator and tools.
    await page.route('**/api/concierge/ask', (route) => route.abort());
    await page.getByTestId('concierge-trigger').click();
    const offline = await ask(page, 'Mount a Floating Shelf 110 in Walnut');
    await expect(offline).toHaveAttribute('data-transport', 'local');
    await expect(offline.getByTestId('concierge-tool-call')).toHaveAttribute('data-tool-name', 'mutate_3d_room');
    await expect(shelves).toHaveCount(before + 1);
    await expect(shelves.last()).toHaveAttribute('data-finish', 'walnut');
    expect((await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROOM_KEY)).items.at(-1)).toMatchObject({
      productId: 'floating-shelf-110',
      finish: 'walnut',
    });

    expect(errors.filter((line) => !/ERR_FAILED|net::/.test(line))).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});

test.describe('Lumen AI chat shows only the conversation', () => {
  const TRACE = 'MCP // lookup_studio_guide: Studio Guide & Troubleshooting';

  test('trace lines and tool sources are told apart from studio copy by their shape alone', () => {
    expect(isToolTraceLine(TRACE)).toBe(true);
    expect(isToolTraceLine('mcp//query_catalog')).toBe(true);
    expect(isToolTraceLine('query_catalog({"query":"shelf"})')).toBe(true);
    expect(isToolTraceLine('- inspect_workspace: 3 modules on the north wall')).toBe(true);
    // Studio labels are Title Case words and part ids use hyphens: never mistaken for a trace.
    expect(isToolTraceLine('- Open the editor: click 3D Room in the top bar')).toBe(false);
    expect(isToolTraceLine('- Parts: floating-shelf-110 in Walnut')).toBe(false);
    expect(isToolTraceLine('Clicking 3D Room in the top navigation bar opens the 3D Room Planner (/room-3d) directly.')).toBe(false);
    expect(conversationalText(`${TRACE}\n\nClicking 3D Room opens the planner.\n- Open the editor: click 3D Room\nquery_catalog: 12 parts`)).toBe(
      'Clicking 3D Room opens the planner.\n- Open the editor: click 3D Room',
    );
    expect(conversationalText(42)).toBe('');
    expect(isToolCitation({ id: 'mcp:lookup-studio-guide', label: 'MCP / lookup_studio_guide' })).toBe(true);
    expect(isToolCitation({ id: 'guide:room-planner', label: 'Studio Guide' })).toBe(false);

    // Every reply the device composes reads clean, whatever tool it ran.
    const { reply } = runDeterministicAgent('How do I open the 3D room?', { route: '/' });
    expect(reply.toolCalls.map((call) => call.name)).toEqual(['lookup_studio_guide']);
    expect(conversationalText(reply.answer)).toBe(reply.answer);
  });

  test('a how-to answer shows the reply alone: no MCP trace and no tool name, the trace kept as hidden data', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await openConcierge(page);
    const reply = await ask(page, 'How do I open the 3D room?');
    await expect(reply).toHaveAttribute('data-category', 'guide');
    await expect(reply.locator('.concierge-msg__lead')).toContainText('Clicking 3D Room');
    await expect(reply.getByTestId('concierge-tool-call')).toHaveAttribute('data-tool-name', 'lookup_studio_guide');
    await expect(reply.getByTestId('concierge-tool-calls')).toBeHidden();
    const shown = await reply.evaluate((el) => el.innerText);
    expect(shown).not.toContain('MCP');
    expect(shown).not.toContain('lookup_studio_guide');
    expect(await reply.locator('[title]').count()).toBe(0);
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('a reply that carries trace lines and tool sources reaches the visitor as conversation only, Specs mode included', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/room-3d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    await page.getByTestId('studio-header').getByTestId('mode-switch').getByRole('button', { name: /^Specs/ }).click();
    const leaky = {
      id: 'LMN-C-0A1B2C3D',
      question: 'How do I open the 3D room?',
      answer: `${TRACE}\n\nClicking 3D Room in the top bar opens the planner.\n- Open the editor: click 3D Room\nlookup_studio_guide: matched the planner guide`,
      confidence: 0.92,
      category: 'guide',
      resolved: true,
      citations: [
        { id: 'mcp:lookup-studio-guide', label: 'MCP / lookup_studio_guide' },
        { id: 'guide:room-planner', label: 'Studio Guide' },
      ],
      suggestedActions: [],
      metrics: [],
      mcpProtocol: MCP_PROTOCOL,
      toolCalls: [{ name: 'lookup_studio_guide', arguments: {}, summary: 'Studio Guide & Troubleshooting', status: 'completed' }],
      clientActions: [],
    };
    await page.route('**/api/concierge/ask', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: leaky }) }));
    await openConcierge(page);
    const reply = await ask(page, 'How do I open the 3D room?');
    await expect(reply).toHaveAttribute('data-transport', 'http');
    await expect(reply).toHaveAttribute('data-reply-id', 'LMN-C-0A1B2C3D');
    await expect(reply.locator('.concierge-msg__lead')).toHaveText('Clicking 3D Room in the top bar opens the planner.');
    await expect(reply.locator('.concierge-msg__list li')).toHaveText(['Open the editor: click 3D Room']);
    // Specs mode shows provenance, never a tool as a source.
    const sources = reply.getByTestId('concierge-citations');
    await expect(sources).toBeVisible();
    await expect(sources).toHaveText('Sources: Studio Guide');
    const shown = await reply.evaluate((el) => el.innerText);
    expect(shown).not.toContain('MCP');
    expect(shown).not.toContain('lookup_studio_guide');
    expect(shown).not.toContain('matched the planner guide');
    await expect(reply.getByTestId('concierge-tool-call')).toHaveAttribute('data-tool-name', 'lookup_studio_guide');
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});
