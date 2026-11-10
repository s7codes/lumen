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

export default defineConfig({
  plugins: [react(), devCspRelax()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  build: {
    sourcemap: false,
  },
});
