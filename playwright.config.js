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
  // Every context owns its X-Lumen-Client namespace in the test store, so CI
  // runs four isolated workers in parallel.
  workers: process.env.CI ? 4 : undefined,
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
