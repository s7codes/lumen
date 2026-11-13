import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createConciergeAgent, loadDotEnv, pickLlmEnv } from './llm-agent.js';
import { createStore } from './store.js';

export const DEFAULT_DATA_FILE = 'server/.data/lumen-cloud.json';
export const TEST_DATA_FILE = 'server/.data/lumen-cloud.test.json';
export const DEFAULT_STATIC_DIR = 'dist';
/** Environment the Playwright web server runs with; specs resolve the same options from it. */
// The deterministic MCP orchestrator answers in E2E even on a machine with an LLM key set, and
// the rate limits stay at their defaults (generous on loopback) whatever the shell exports.
export const E2E_SERVER_ENV = Object.freeze({
  LUMEN_TEST_RESET: '1',
  LUMEN_DATA_FILE: TEST_DATA_FILE,
  LUMEN_LLM_PROVIDER: 'deterministic',
  LUMEN_RATE_LIMIT_MAX: '',
  LUMEN_TRUST_PROXY: '',
});

/**
 * Environment:
 *   LUMEN_DATA_FILE       store path, relative to the repository root
 *   LUMEN_STORAGE=memory  keep state in memory only
 *   LUMEN_TEST_RESET=1    expose POST /api/test/reset and default to the test store
 *   LUMEN_SESSION_SECRET  32+ characters; otherwise a per-process secret
 *   LUMEN_TRUST_PROXY     reverse-proxy hops in front of the server (1 behind
 *                         Caddy or Nginx); client addresses come from
 *                         X-Forwarded-For only when set
 *   LUMEN_RATE_LIMIT_MAX  read budget per client per minute (default 600);
 *                         auth, AI and write budgets scale with it; off disables
 *   LUMEN_STATIC_DIR      built app the standalone server serves beside /api,
 *                         default dist; off serves the API only
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
  const staticDir = (env.LUMEN_STATIC_DIR ?? '').trim();
  return {
    version: pkg.version,
    file: env.LUMEN_STORAGE === 'memory' ? null : resolve(root, env.LUMEN_DATA_FILE || fallback),
    testReset,
    staticDir: staticDir.toLowerCase() === 'off' ? null : resolve(root, staticDir || DEFAULT_STATIC_DIR),
  };
}

/**
 * One store and one handler per process; both Vite hooks and the standalone
 * server share it. `sessionSecret` pins the HMAC key, so a dev server that
 * reloads this module keeps every open session valid.
 */
export function createLumenCloud(rootUrl, env = process.env, { sessionSecret, logger = console } = {}) {
  const { version, file, testReset, staticDir } = resolveServerOptions(rootUrl, env);
  const store = createStore({ file });
  const agent = createConciergeAgent({ version, env: { ...loadDotEnv(rootUrl), ...pickLlmEnv(env) } });
  // Rate limits and proxy trust come from the same env: LUMEN_RATE_LIMIT_MAX and LUMEN_TRUST_PROXY.
  const handler = createApp({ store, version, testReset, sessionSecret, agent, env, logger });
  return { store, handler, version, file, testReset, staticDir, agent };
}
