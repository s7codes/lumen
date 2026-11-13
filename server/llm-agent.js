import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  composeReply,
  describeWorkspace,
  ESCALATION_NOTICE,
  evaluateConciergeQuery,
  MCP_PROTOCOL,
  sanitizeQuestion,
  sanitizeWorkspaceContext,
} from '../src/lib/concierge-engine.js';
import { isMutationResult, listMcpTools } from '../src/lib/mcp-server.js';
import {
  answerDeltas,
  applyClientActionsToContext,
  invokeMcpTool,
  runDeterministicAgent,
  toolSummary,
  traceEntry,
} from '../src/lib/mcp-orchestrator.js';
import { safeJsonParse } from '../src/security/sanitize.js';

/**
 * Lumen AI agent: a multi-provider LLM tool-use loop over the MCP server,
 * with the deterministic MCP orchestrator as the key-free path.
 *
 * Environment (process env wins over an optional .env in the repo root):
 *   ANTHROPIC_API_KEY    Claude Messages API with tools
 *   OPENAI_API_KEY       OpenAI Chat Completions with tools
 *   GEMINI_API_KEY       Gemini generateContent with function declarations
 *   LUMEN_LLM_BASE_URL   Ollama or any OpenAI-compatible server, no key needed
 *   OLLAMA_BASE_URL      the conventional Ollama name, read when LUMEN_LLM_BASE_URL is unset
 *   LUMEN_LLM_MODEL      model id override
 *   LUMEN_LLM_PROVIDER   auto (default), deterministic, anthropic, openai, gemini or ollama
 *
 * Every model-requested tool call runs through the same JSON-RPC
 * `tools/call` pipeline as POST /api/mcp. A provider fault or timeout falls
 * back to the deterministic orchestrator, so a visitor always gets an answer.
 */

export const LLM_ENV_KEYS = Object.freeze([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'LUMEN_LLM_BASE_URL',
  'OLLAMA_BASE_URL',
  'LUMEN_LLM_MODEL',
  'LUMEN_LLM_PROVIDER',
]);
export const LLM_PROVIDERS = Object.freeze(['deterministic', 'anthropic', 'openai', 'gemini', 'ollama']);
export const DEFAULT_MODELS = Object.freeze({
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-4.1-mini',
  gemini: 'gemini-2.5-flash',
  ollama: 'llama3.1',
});

const ENV_FILE_MAX_BYTES = 16 * 1024;
const MAX_ROUNDS = 4;
const MAX_CALLS_PER_ROUND = 4;
const MAX_STREAM_BYTES = 2 * 1024 * 1024;
const TOOL_RESULT_CHARS = 6000;
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_TOKENS = 800;

/* Environment */

function unquote(value) {
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed.replace(/\s+#.*$/, '');
}

/** Reads the LLM keys from `.env` in the repo root. Missing, oversized or unreadable files read as empty. */
export function loadDotEnv(rootUrl) {
  const file = join(fileURLToPath(rootUrl), '.env');
  try {
    if (statSync(file).size > ENV_FILE_MAX_BYTES) return {};
    const out = {};
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]{1,64})\s*=(.*)$/.exec(line);
      if (match && LLM_ENV_KEYS.includes(match[1])) out[match[1]] = unquote(match[2]);
    }
    return out;
  } catch {
    return {};
  }
}

/** The LLM keys from one environment object, nothing else. */
export function pickLlmEnv(env = {}) {
  const out = {};
  for (const key of LLM_ENV_KEYS) if (typeof env[key] === 'string' && env[key] !== '') out[key] = env[key];
  return out;
}

function httpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

/** `{ provider, model, apiKey, baseUrl }`; anything incomplete resolves to the deterministic provider. */
export function resolveLlmConfig(env = {}) {
  const requested = String(env.LUMEN_LLM_PROVIDER ?? 'auto').trim().toLowerCase();
  const ollamaUrl = env.LUMEN_LLM_BASE_URL || env.OLLAMA_BASE_URL;
  let provider = requested;
  if (requested === 'auto' || requested === '') {
    if (env.ANTHROPIC_API_KEY) provider = 'anthropic';
    else if (env.OPENAI_API_KEY) provider = 'openai';
    else if (env.GEMINI_API_KEY) provider = 'gemini';
    else if (ollamaUrl) provider = 'ollama';
    else provider = 'deterministic';
  }
  const deterministic = { provider: 'deterministic', model: null, apiKey: null, baseUrl: null };
  if (!LLM_PROVIDERS.includes(provider) || provider === 'deterministic') return deterministic;
  const model = typeof env.LUMEN_LLM_MODEL === 'string' && /^[\w.:/-]{1,96}$/.test(env.LUMEN_LLM_MODEL) ? env.LUMEN_LLM_MODEL : DEFAULT_MODELS[provider];
  if (provider === 'ollama') {
    const baseUrl = httpUrl(ollamaUrl ?? '');
    return baseUrl ? { provider, model, apiKey: null, baseUrl: baseUrl.replace(/\/v1$/, '') } : deterministic;
  }
  const apiKey = { anthropic: env.ANTHROPIC_API_KEY, openai: env.OPENAI_API_KEY, gemini: env.GEMINI_API_KEY }[provider];
  if (typeof apiKey !== 'string' || apiKey.length < 8) return deterministic;
  const baseUrl = provider === 'openai' && env.LUMEN_LLM_BASE_URL ? httpUrl(env.LUMEN_LLM_BASE_URL)?.replace(/\/v1$/, '') : null;
  return { provider, model, apiKey, baseUrl: baseUrl ?? null };
}

/* Answer text */

// Typographic characters folded to the platform's plain-ASCII copy, by code point.
const FOLDS = new Map([
  ...[0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((code) => [code, '-']),
  ...[0x2018, 0x2019, 0x201a, 0x2032].map((code) => [code, "'"]),
  ...[0x201c, 0x201d, 0x201e, 0x2033].map((code) => [code, '"']),
  ...[0x00a0, 0x2009, 0x202f].map((code) => [code, ' ']),
  [0x00d7, 'x'],
  [0x2192, 'to'],
  [0x2026, '...'],
  [0x00b0, ' deg'],
  [0x2022, '-'],
]);

/** Plain ASCII, "- " bullets, no markdown emphasis or headings. */
export function asciiAnswer(text) {
  let out = '';
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code === 10 || (code >= 32 && code < 127)) out += ch;
    else if (FOLDS.has(code)) out += FOLDS.get(code);
  }
  return out
    .split('\n')
    .map((line) => line.replace(/^\s*[*+]\s+/, '- ').replace(/^#+\s*/, '').replaceAll('**', '').replace(/`/g, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function systemPrompt(ctx) {
  return [
    'You are Lumen AI, the studio agent of Lumen Spatial Studio: 12 modular 24V DC parts, a four-wall 3D room planner (north, east, south, west), a 2D wall studio and a cart.',
    'Use the MCP tools. Call inspect_workspace or simulate_physics_and_bus before quoting live figures, query_catalog for part data and lookup_studio_guide for how-to questions.',
    'When the visitor asks you to change their room, wall or cart, call mutate_3d_room, mutate_2d_wall or manage_cart_bag; the browser applies the result as one step that Ctrl+Z undoes.',
    'For bespoke fabrication, structural certification, freight claims or onsite installation, call unlock_engineering_escalation.',
    'Never state a figure a tool did not return.',
    'Answer in plain ASCII: one lead sentence, then two to four lines of the form "- Label: detail". No emojis, no headings, at most 90 words.',
    `Live workspace: ${describeWorkspace(ctx)}`,
  ].join('\n');
}

/* Server-Sent Events from a provider */

async function* readSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let total = 0;
  const frame = (text) => {
    let event = 'message';
    const data = [];
    for (const line of text.split('\n')) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    return data.length > 0 ? { event, data: data.join('\n') } : null;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_STREAM_BYTES) throw new Error('provider stream exceeded its size cap');
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n?/g, '\n');
    let cut;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const parsed = frame(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
      if (parsed) yield parsed;
    }
  }
  const rest = frame(buffer.trim());
  if (rest) yield rest;
}

function parseJson(text) {
  return safeJsonParse(text, { fallback: null, maxDepth: 16 });
}

function toolArguments(text) {
  const parsed = parseJson(text && text.trim() ? text : '{}');
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

/* Provider adapters: request body, stream parser and transcript append */

function geminiSchema(schema) {
  const out = {};
  if (schema.type) out.type = schema.type.toUpperCase();
  for (const key of ['description', 'enum', 'required', 'minimum', 'maximum', 'minItems', 'maxItems']) {
    if (schema[key] !== undefined) out[key] = schema[key];
  }
  if (schema.properties) out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, geminiSchema(value)]));
  if (schema.items) out.items = geminiSchema(schema.items);
  return out;
}

const ADAPTERS = {
  anthropic: {
    init: (system, question) => ({ system, messages: [{ role: 'user', content: question }] }),
    request: (config, state, tools) => ({
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
      body: {
        model: config.model,
        max_tokens: MAX_TOKENS,
        system: state.system,
        messages: state.messages,
        tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })),
        stream: true,
      },
    }),
    async parse(events, onDelta) {
      const blocks = [];
      for await (const { data } of events) {
        const msg = parseJson(data);
        if (!msg) continue;
        if (msg.type === 'error') throw new Error('provider reported an error');
        if (msg.type === 'content_block_start') {
          const block = msg.content_block ?? {};
          blocks[msg.index] = block.type === 'tool_use' ? { type: 'tool_use', id: block.id, name: block.name, json: '' } : { type: block.type, text: block.text ?? '' };
        } else if (msg.type === 'content_block_delta' && blocks[msg.index]) {
          if (msg.delta?.type === 'text_delta' && typeof msg.delta.text === 'string') {
            blocks[msg.index].text += msg.delta.text;
            onDelta(msg.delta.text);
          } else if (msg.delta?.type === 'input_json_delta' && typeof msg.delta.partial_json === 'string') {
            blocks[msg.index].json += msg.delta.partial_json;
          }
        }
      }
      const content = [];
      const calls = [];
      let text = '';
      for (const block of blocks.filter(Boolean)) {
        if (block.type === 'text' && block.text) {
          text += block.text;
          content.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          const input = toolArguments(block.json) ?? {};
          content.push({ type: 'tool_use', id: block.id, name: block.name, input });
          calls.push({ id: block.id, name: block.name, arguments: toolArguments(block.json) });
        }
      }
      return { text, calls, assistant: { role: 'assistant', content } };
    },
    append: (state, turn, results) => ({
      ...state,
      messages: [
        ...state.messages,
        turn.assistant,
        {
          role: 'user',
          content: results.map((entry) => ({ type: 'tool_result', tool_use_id: entry.id, content: entry.payload, ...(entry.isError ? { is_error: true } : {}) })),
        },
      ],
    }),
  },

  openai: {
    init: (system, question) => ({ messages: [{ role: 'system', content: system }, { role: 'user', content: question }] }),
    request: (config, state, tools) => ({
      url: `${config.baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      body: {
        model: config.model,
        messages: state.messages,
        tools: tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })),
        stream: true,
      },
    }),
    async parse(events, onDelta) {
      let text = '';
      const slots = [];
      for await (const { data } of events) {
        if (data === '[DONE]') break;
        const msg = parseJson(data);
        if (!msg) continue;
        if (msg.error) throw new Error('provider reported an error');
        const delta = msg.choices?.[0]?.delta;
        if (typeof delta?.content === 'string' && delta.content) {
          text += delta.content;
          onDelta(delta.content);
        }
        for (const part of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
          const index = Number.isInteger(part.index) && part.index >= 0 && part.index < 16 ? part.index : 0;
          const slot = (slots[index] ??= { id: '', name: '', json: '' });
          if (typeof part.id === 'string') slot.id = part.id;
          if (typeof part.function?.name === 'string') slot.name += part.function.name;
          if (typeof part.function?.arguments === 'string') slot.json += part.function.arguments;
        }
      }
      const calls = slots.filter(Boolean).map((slot, i) => ({ id: slot.id || `call_${i}`, name: slot.name, arguments: toolArguments(slot.json), json: slot.json || '{}' }));
      const assistant = { role: 'assistant', content: text || null };
      if (calls.length > 0) assistant.tool_calls = calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.json } }));
      return { text, calls, assistant };
    },
    append: (state, turn, results) => ({
      ...state,
      messages: [...state.messages, turn.assistant, ...results.map((entry) => ({ role: 'tool', tool_call_id: entry.id, content: entry.payload }))],
    }),
  },

  gemini: {
    init: (system, question) => ({ system, contents: [{ role: 'user', parts: [{ text: question }] }] }),
    request: (config, state, tools) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`,
      headers: { 'x-goog-api-key': config.apiKey },
      body: {
        systemInstruction: { parts: [{ text: state.system }] },
        contents: state.contents,
        tools: [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: geminiSchema(tool.inputSchema) })) }],
        generationConfig: { maxOutputTokens: MAX_TOKENS },
      },
    }),
    async parse(events, onDelta) {
      let text = '';
      const parts = [];
      const calls = [];
      for await (const { data } of events) {
        const msg = parseJson(data);
        if (!msg) continue;
        if (msg.error) throw new Error('provider reported an error');
        for (const part of msg.candidates?.[0]?.content?.parts ?? []) {
          if (typeof part.text === 'string' && part.text) {
            text += part.text;
            onDelta(part.text);
            parts.push({ text: part.text });
          } else if (part.functionCall && typeof part.functionCall.name === 'string') {
            const args = part.functionCall.args && typeof part.functionCall.args === 'object' ? part.functionCall.args : {};
            parts.push({ functionCall: { name: part.functionCall.name, args } });
            calls.push({ id: `fc_${calls.length}`, name: part.functionCall.name, arguments: toolArguments(JSON.stringify(args)) });
          }
        }
      }
      return { text, calls, assistant: { role: 'model', parts } };
    },
    append: (state, turn, results) => ({
      ...state,
      contents: [
        ...state.contents,
        turn.assistant,
        { role: 'user', parts: results.map((entry) => ({ functionResponse: { name: entry.name, response: { result: parseJson(entry.payload) ?? { text: entry.payload } } } })) },
      ],
    }),
  },
};
ADAPTERS.ollama = ADAPTERS.openai;

/** What the model sees of a tool result: the text and structured data, never the full client state. */
function toolPayload(result) {
  const { clientActions, ...rest } = result;
  const payload = JSON.stringify({
    text: rest.content?.map((part) => part.text).join('\n') ?? '',
    structuredContent: rest.structuredContent ?? null,
    isError: rest.isError === true,
    appliedInBrowser: Array.isArray(clientActions) && clientActions.length > 0,
  });
  return payload.length > TOOL_RESULT_CHARS ? `${payload.slice(0, TOOL_RESULT_CHARS - 3)}...` : payload;
}

async function providerTurn({ config, adapter, state, tools, fetchImpl, signal, timeoutMs, onDelta }) {
  const { url, headers, body } = adapter.request(config, state, tools);
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok || !response.body) throw new Error(`provider answered HTTP ${response.status}`);
    return await adapter.parse(readSse(response), onDelta);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function runLlm({ config, question, ctx, version, fetchImpl, signal, timeoutMs, emit }) {
  const adapter = ADAPTERS[config.provider];
  const tools = listMcpTools();
  let state = adapter.init(systemPrompt(ctx), question);
  let working = ctx;
  const calls = [];
  let answer = '';
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const turn = await providerTurn({ config, adapter, state, tools, fetchImpl, signal, timeoutMs, onDelta: (text) => emit('delta', { text }) });
    if (turn.text.trim()) answer = turn.text;
    if (turn.calls.length === 0) break;
    const results = [];
    for (const call of turn.calls.slice(0, MAX_CALLS_PER_ROUND)) {
      const args = call.arguments ?? {};
      emit('tool_call', { name: call.name, arguments: args });
      const result =
        call.arguments === null
          ? { content: [{ type: 'text', text: 'Tool arguments were not valid JSON.' }], structuredContent: null, clientActions: [], isError: true }
          : invokeMcpTool(call.name, args, working, { version, id: calls.length + 1 });
      calls.push({ name: call.name, arguments: args, result });
      emit('tool_result', { name: call.name, summary: toolSummary(result), clientActions: result.clientActions ?? [], isError: result.isError === true });
      if (isMutationResult(call.name, result)) working = applyClientActionsToContext(working, result.clientActions);
      results.push({ id: call.id, name: call.name, payload: toolPayload(result), isError: result.isError === true });
    }
    state = adapter.append(state, turn, results);
  }
  const text = asciiAnswer(answer);
  if (!text) throw new Error('provider returned no answer text');

  // Resolution stays decided by the question alone, so the escalation gate replays it.
  const base = evaluateConciergeQuery(question, ctx);
  const mutated = calls.some((call) => isMutationResult(call.name, call.result));
  const verdict = mutated ? { category: 'agent', resolved: true, confidence: 0.9 } : base;
  const reply = composeReply(question, verdict, {
    lead: text,
    tail: verdict.resolved ? [] : [ESCALATION_NOTICE],
    metrics: mutated ? [] : base.metrics,
    citations: [...calls.map((call) => ({ id: `mcp:${call.name.replaceAll('_', '-').slice(0, 60)}`, label: `MCP / ${call.name}` })), ...base.citations],
    actions: base.suggestedActions,
  });
  return {
    ...reply,
    mcpProtocol: MCP_PROTOCOL,
    provider: config.provider,
    toolCalls: calls.map((call) => traceEntry(call.name, call.arguments, call.result)),
    clientActions: calls.flatMap((call) => (isMutationResult(call.name, call.result) ? call.result.clientActions : [])),
  };
}

/**
 * `ask(question, context, { onEvent, signal })` resolves with the reply and
 * reports `tool_call`, `tool_result` and `delta` events as they happen.
 */
export function createConciergeAgent({ version, env = {}, fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS, logger = console } = {}) {
  const config = resolveLlmConfig(env);

  function deterministic(question, ctx, emit) {
    const { reply, events } = runDeterministicAgent(question, ctx, { version });
    for (const { event, data } of events) emit(event, data);
    for (const text of answerDeltas(reply.answer)) emit('delta', { text });
    return reply;
  }

  return {
    provider: config.provider,
    model: config.model,
    async ask(question, workspaceContext, { onEvent, signal } = {}) {
      const text = sanitizeQuestion(question);
      const ctx = sanitizeWorkspaceContext(workspaceContext);
      const emit = (event, data) => {
        if (typeof onEvent === 'function' && !signal?.aborted) onEvent(event, data);
      };
      if (config.provider === 'deterministic' || typeof fetchImpl !== 'function' || !text) return deterministic(text, ctx, emit);
      try {
        return await runLlm({ config, question: text, ctx, version, fetchImpl, signal, timeoutMs, emit });
      } catch (error) {
        if (signal?.aborted) throw error;
        logger?.warn?.(`[lumen-agent] ${config.provider} unavailable (${error?.message ?? 'fault'}); answering with the deterministic MCP orchestrator.`);
        emit('fallback', { provider: config.provider });
        return deterministic(text, ctx, emit);
      }
    },
  };
}
