import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// The browser end-to-end run (test-plan item 22's session parts): the real API on its own test
// database, the Vite dev server in front of it, one Chromium. Both servers start here and stop
// with the run. E2E_OUT is where the run leaves its state file and screenshots, outside the repo.
const out = process.env['E2E_OUT'] ?? join(tmpdir(), 'lims-web-e2e');
const apiPort = Number(process.env['E2E_API_PORT'] ?? 3107);
const webPort = Number(process.env['E2E_WEB_PORT'] ?? 5187);
process.env['E2E_OUT'] = out;

export default defineConfig({
  testDir: 'e2e',
  outputDir: join(out, 'results'),
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${webPort}`, browserName: 'chromium', viewport: { width: 1366, height: 768 }, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node ../api/test/e2e-server.ts',
      url: `http://127.0.0.1:${apiPort}/api/session`,
      env: { E2E_API_PORT: String(apiPort), E2E_STATE: join(out, 'state.json'), PGPORT: process.env['PGPORT'] ?? '54329' },
      timeout: 240_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: `node node_modules/vite/bin/vite.js --port ${webPort} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${webPort}/`,
      env: { LIMS_API: `http://127.0.0.1:${apiPort}` },
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
