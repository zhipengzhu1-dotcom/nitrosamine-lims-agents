import { defineConfig } from '@playwright/test';

export const DEMO_PASSWORD = 'e2e-demo-password';
export const SHOTS = Boolean(process.env.SHOTS);

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:5174', viewport: { width: 1360, height: 900 } },
  webServer: {
    command: '../../scripts/dev.sh --scratch',
    url: 'http://localhost:5174',
    env: { LIMS_DB: 'lims_e2e', PORT: '3100', WEB_PORT: '5174', DEMO_PASSWORD },
    stdout: 'ignore',
  },
});
