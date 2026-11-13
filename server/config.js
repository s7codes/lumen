import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createConciergeAgent, loadDotEnv, pickLlmEnv } from './llm-agent.js';
import { createStore } from './store.js';

export const DEFAULT_DATA_FILE = 'server/.data/lumen-cloud.json';
export const TEST_DATA_FILE = 'server/.data/lumen-cloud.test.json';
export const DEFAULT_STATIC_DIR = 'dist';
/** Loopback only: a container or a public bind has to ask for it with HOST (the image sets 0.0.0.0). */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8787;
/** Environment the Playwright web server runs with; specs resolve the same options from it. */
// The deterministic MCP orchestrator answers in E2E even on a machine with an LLM key set, the
// rate limits stay at their defaults (generous on loopback) and the test store stays the test
// store, whatever the shell exports.
export const E2E_SERVER_ENV = Object.freeze({
  LUMEN_TEST_RESET: '1',
  LUMEN_DATA_FILE: TEST_DATA_FILE,
  LUMEN_STORE_FILE: '',
  LUMEN_DATA_DIR: '',
  LUMEN_LLM_PROVIDER: 'deterministic',
  LUMEN_RATE_LIMIT_MAX: '',
  LUMEN_TRUST_PROXY: '',
});

function setting(env, key) {
  return typeof env[key] === 'string' ? env[key].trim() : '';
}

/**
 * The store file: LUMEN_STORE_FILE, else LUMEN_DATA_FILE (the same setting
 * under its original name), else the default file name inside LUMEN_DATA_DIR
 * (a mounted volume: LUMEN_DATA_DIR=/data is /data/lumen-cloud.json), else the
 * repository default. Relative paths resolve against the repository root.
 */
function resolveDataFile(root, env, testReset) {
  const fallback = testReset ? TEST_DATA_FILE : DEFAULT_DATA_FILE;
  const file = setting(env, 'LUMEN_STORE_FILE') || setting(env, 'LUMEN_DATA_FILE');
  if (file) return resolve(root, file);
  const dir = setting(env, 'LUMEN_DATA_DIR');
  return dir ? resolve(root, dir, basename(fallback)) : resolve(root, fallback);
}

/**
 * Environment:
 *   LUMEN_STORE_FILE      store path (alias: LUMEN_DATA_FILE), absolute or
 *                         relative to the repository root
 *   LUMEN_DATA_DIR        directory for the default store file, for a mounted
 *                         volume (/data in the container image)
 *   LUMEN_STORAGE=memory  keep state in memory only
 *   LUMEN_TEST_RESET=1    expose POST /api/test/reset and default to the test store
 *   LUMEN_SESSION_SECRET  32+ characters; otherwise a per-process secret
 *   LUMEN_TRUST_PROXY     reverse-proxy hops in front of the server (1 behind
 *                         Caddy or Nginx); X-Forwarded-For, -Proto and -Host
 *                         are read only when set, and only from a private peer
 *   DOMAIN, LUMEN_ALLOWED_HOSTS   hostnames the Host header may name beside
 *                         loopback and the production domains (comma-separated
 *                         in LUMEN_ALLOWED_HOSTS); any other host is refused
 *   LUMEN_RATE_LIMIT_MAX  read budget per client per minute (default 600);
 *                         auth, AI and write budgets scale with it; off disables
 *   LUMEN_STATIC_DIR      built app the standalone server serves beside /api,
 *                         default dist; off serves the API only
 *   HOST, PORT            standalone bind address (resolveListenAddress)
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, LUMEN_LLM_BASE_URL
 *   (or OLLAMA_BASE_URL), LUMEN_LLM_MODEL, LUMEN_LLM_PROVIDER   Lumen AI
 *                         provider (server/llm-agent.js); read from the
 *                         process env first, then from .env
 *
 * Test and preview runs default to their own file, so `npm run dev` and an
 * E2E run started at the same time never write the same store.
 */
export function resolveServerOptions(rootUrl, env = process.env) {
  const root = fileURLToPath(rootUrl);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const testReset = env.LUMEN_TEST_RESET === '1';
  const staticDir = (env.LUMEN_STATIC_DIR ?? '').trim();
  return {
    version: pkg.version,
    file: env.LUMEN_STORAGE === 'memory' ? null : resolveDataFile(root, env, testReset),
    testReset,
    staticDir: staticDir.toLowerCase() === 'off' ? null : resolve(root, staticDir || DEFAULT_STATIC_DIR),
  };
}

/**
 * Where the standalone server listens: HOST (default 127.0.0.1; 0.0.0.0 or ::
 * binds every interface, as the container image does) and PORT (default 8787;
 * 0 takes a free port). A PORT that is not a TCP port fails the start with a
 * clear message instead of falling back silently.
 */
export function resolveListenAddress(env = process.env) {
  const host = setting(env, 'HOST') || DEFAULT_HOST;
  const port = setting(env, 'PORT');
  if (port === '') return { host, port: DEFAULT_PORT };
  if (!/^\d{1,5}$/.test(port) || Number(port) > 65_535) {
    throw new TypeError(`PORT must be a TCP port from 0 to 65535 (0 takes a free one), not "${port.slice(0, 16)}".`);
  }
  return { host, port: Number(port) };
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
