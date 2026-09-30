import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// The walkthrough of the whole sample chain through the real UI (test-plan D22 plus the chain):
// the real API on its own database with only reference data and people seeded, the Vite dev
// server in front of it, one Chromium. Screenshots and the state file land in E2E_OUT, outside
// the repo.
const out = process.env['E2E_OUT'] ?? '/tmp/claude-501/walkthrough';
const apiPort = Number(process.env['E2E_API_PORT'] ?? 3108);
const webPort = Number(process.env['E2E_WEB_PORT'] ?? 5188);
process.env['E2E_OUT'] = out;
mkdirSync(out, { recursive: true });

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'walkthrough.spec.ts',
  outputDir: join(out, 'results'),
  fullyParallel: false,
  workers: 1,
  timeout: 1_500_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${webPort}`, browserName: 'chromium', viewport: { width: 1366, height: 768 }, trace: 'retain-on-failure', acceptDownloads: true, actionTimeout: 30_000, navigationTimeout: 30_000 },
  webServer: [
    {
      command: 'node ../api/test/e2e-chain-server.ts',
      url: `http://127.0.0.1:${apiPort}/api/session`,
      env: { E2E_API_PORT: String(apiPort), E2E_STATE: join(out, 'state.json'), PGPORT: process.env['PGPORT'] ?? '54329' },
      timeout: 600_000,
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
