import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createConciergeAgent, loadDotEnv, pickLlmEnv } from './llm-agent.js';
import { createStore } from './store.js';

export const DEFAULT_DATA_FILE = 'server/.data/lumen-cloud.json';
export const TEST_DATA_FILE = 'server/.data/lumen-cloud.test.json';
/** Environment the Playwright web server runs with; specs resolve the same options from it. */
// The deterministic MCP orchestrator answers in E2E even on a machine with an LLM key set.
export const E2E_SERVER_ENV = Object.freeze({ LUMEN_TEST_RESET: '1', LUMEN_DATA_FILE: TEST_DATA_FILE, LUMEN_LLM_PROVIDER: 'deterministic' });

/**
 * Environment:
 *   LUMEN_DATA_FILE       store path, relative to the repository root
 *   LUMEN_STORAGE=memory  keep state in memory only
 *   LUMEN_TEST_RESET=1    expose POST /api/test/reset and default to the test store
 *   LUMEN_SESSION_SECRET  32+ characters; otherwise a per-process secret
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, LUMEN_LLM_BASE_URL,
 *   LUMEN_LLM_MODEL, LUMEN_LLM_PROVIDER   Lumen AI provider (server/llm-agent.js);
 *                         read from the process env first, then from .env
 *
 * Test and preview runs default to their own file, so `npm run dev` and an
 * E2E run started at the same time never write the same store.
 */
export function resolveServerOptions(rootUrl, env = process.env) {
  const root = fileURLToPath(rootUrl);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const testReset = env.LUMEN_TEST_RESET === '1';
  const fallback = testReset ? TEST_DATA_FILE : DEFAULT_DATA_FILE;
  return {
    version: pkg.version,
    file: env.LUMEN_STORAGE === 'memory' ? null : resolve(root, env.LUMEN_DATA_FILE || fallback),
    testReset,
  };
}

/**
 * One store and one handler per process; both Vite hooks and the standalone
 * server share it. `sessionSecret` pins the HMAC key, so a dev server that
 * reloads this module keeps every open session valid.
 */
export function createLumenCloud(rootUrl, env = process.env, { sessionSecret } = {}) {
  const { version, file, testReset } = resolveServerOptions(rootUrl, env);
  const store = createStore({ file });
  const agent = createConciergeAgent({ version, env: { ...loadDotEnv(rootUrl), ...pickLlmEnv(env) } });
  return { store, handler: createApp({ store, version, testReset, sessionSecret, agent }), version, file, testReset, agent };
}
