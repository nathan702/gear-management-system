import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests against the local emulators (data is reset each run):
 *   npm run emulators     (terminal 1)
 *   npm run test:e2e      (terminal 2)
 */
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev -w web -- --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    env: { VITE_USE_EMULATORS: 'true' },
  },
});
