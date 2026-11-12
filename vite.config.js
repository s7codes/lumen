import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

// The CSP in index.html is the production policy. During `vite serve` only,
// React Fast Refresh needs its inline preamble and HMR needs a websocket, so
// the dev server widens exactly those two directives. Builds stay strict.
function devCspRelax() {
  return {
    name: 'lumen:dev-csp-relax',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
        .replace("connect-src 'self';", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*;");
    },
  };
}

// Lumen Cloud runs in-process on the same origin as the app, so the strict
// `connect-src 'self'` policy covers /api/* in dev, in preview and in E2E.
//
// The server modules are never imported statically here: anything this file
// imports becomes a config dependency, and Vite answers an edit to one with a
// full server restart, which can fail half way through a branch switch and
// leave the old process serving the old route table. Instead:
// - `vite serve` loads the API through the dev server's SSR module graph on
//   each request, so an edit under server/ or src/lib/ takes effect on the
//   next call with no restart, and a load that fails mid-edit retries on the
//   next request (the client answers locally meanwhile).
// - `vite preview` serves a fixed build: one cloud for the process, loaded
//   with a dynamic import the config bundler leaves alone.
const ROOT_URL = new URL('./', import.meta.url);
const SERVER_URL = new URL('./server/', import.meta.url);
// Same contract as isApiPath in server/app.js: /api, /api/... or /api?...
const API_PATH = /^\/api(?:$|[/?])/;

function lumenCloudApi() {
  // One HMAC key per dev process (unless LUMEN_SESSION_SECRET pins one), so
  // reloading the API never signs a visitor out.
  const envSecret = process.env.LUMEN_SESSION_SECRET;
  const sessionSecret = envSecret && envSecret.length >= 32 ? undefined : randomBytes(32).toString('hex');

  function configureServer(server) {
    let current = null;
    let loading = null;

    async function resolveCloud() {
      const [config, app] = await Promise.all([server.ssrLoadModule('/server/config.js'), server.ssrLoadModule('/server/app.js')]);
      if (current?.config === config) return current;
      loading ??= (async () => {
        const previous = current;
        // Let the old store finish its queued atomic writes before a new one reads the file.
        if (previous) await previous.cloud.store.flush().catch(() => {});
        current = { config, isApiPath: app.isApiPath, cloud: config.createLumenCloud(ROOT_URL, process.env, { sessionSecret }) };
        if (previous) server.config.logger.info('lumen cloud api reloaded', { timestamp: true });
        return current;
      })().finally(() => {
        loading = null;
      });
      return loading;
    }

    server.middlewares.use(async (req, res, next) => {
      if (typeof req.url !== 'string' || !API_PATH.test(req.url)) return next();
      let api;
      try {
        api = await resolveCloud();
      } catch (error) {
        server.config.logger.error(`lumen cloud api failed to load: ${error?.message ?? error}`, { timestamp: true });
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(JSON.stringify({ error: { code: 'storage', message: 'Lumen Cloud is reloading. Try again in a moment.' } }));
        return;
      }
      if (!api.isApiPath(req.url)) return next();
      api.cloud.handler(req, res);
    });
  }

  async function configurePreviewServer(server) {
    const [{ createLumenCloud }, { isApiPath }] = await Promise.all([
      import(new URL('config.js', SERVER_URL).href),
      import(new URL('app.js', SERVER_URL).href),
    ]);
    const cloud = createLumenCloud(ROOT_URL);
    server.middlewares.use((req, res, next) => (isApiPath(req.url) ? cloud.handler(req, res) : next()));
  }

  return { name: 'lumen:cloud-api', configureServer, configurePreviewServer };
}

// Fonts are requested only once React renders text, so without a hint they
// swap in after first paint and reflow the page. Preloading the three Latin
// faces every view uses starts them alongside the entry script.
const PRELOAD_FONTS = [
  /inter-tight-latin-wght-normal-[\w-]+\.woff2$/,
  /ibm-plex-mono-latin-400-normal-[\w-]+\.woff2$/,
  /ibm-plex-mono-latin-500-normal-[\w-]+\.woff2$/,
];

function fontPreload() {
  return {
    name: 'lumen:font-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {});
        return PRELOAD_FONTS.flatMap((pattern) => files.filter((file) => pattern.test(file))).map((file) => ({
          tag: 'link',
          attrs: { rel: 'preload', href: `/${file}`, as: 'font', type: 'font/woff2', crossorigin: '' },
          injectTo: 'head',
        }));
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), devCspRelax(), fontPreload(), lumenCloudApi()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Bound to the IPv4 loopback so Chromium-based browsers on Windows reach the
  // dev server at both 127.0.0.1 and localhost without an IPv6 mismatch.
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  // three.js and drei ship only in the lazy RoomCanvas chunk (about 260 kB
  // gzip), loaded when the room planner opens. The entry stays under 500 kB.
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1024,
  },
});
