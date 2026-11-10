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
  plugins: [react(), devCspRelax(), fontPreload()],
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
  build: {
    sourcemap: false,
  },
});
