import { defineConfig, devices } from '@playwright/test';
import { E2E_SERVER_ENV } from './server/config.js';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SERVE = `npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`;

// E2E runs against the production build so the strict CSP in index.html is
// exercised exactly as it ships. The dev server relaxes it for HMR. CI builds
// in its own workflow step, so there the web server only serves dist/.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Every context owns its X-Lumen-Client namespace in the test store, so the
  // workers never share state. CI runs two: the four-vCPU runner has no GPU, so
  // each Chromium rasterises WebGL and canvas through SwiftShader, which spreads
  // over several cores itself. Four workers starved one another (the v7.2.0 run
  // saw the homepage theatre at about 2 fps) for no gain in throughput.
  workers: process.env.CI ? 2 : undefined,
  // Software rasterisation still runs the long 3D scenario tests two to three
  // times slower there than on a local GPU (the v6.1.0 run timed out two of them
  // at 30 s while they were still progressing). These are ceilings, not waits:
  // an assertion returns as soon as its condition holds.
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: process.env.CI ? 10_000 : 5_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: process.env.CI ? SERVE : `npm run build && ${SERVE}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // server/.data/lumen-cloud.test.json: a dev server on the default store can run alongside.
    env: { ...E2E_SERVER_ENV },
  },
});
