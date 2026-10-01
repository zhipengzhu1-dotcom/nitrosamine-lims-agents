import { defineConfig, devices } from '@playwright/test';

export const DEMO_PASSWORD = 'e2e-demo-password';
export const SHOTS = Boolean(process.env.SHOTS);

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:5174' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1360, height: 900 } } },
    { name: 'iphone', use: devices['iPhone 16'] },
    { name: 'ipad', use: devices['iPad (gen 11)'] },
    { name: 'pixel', use: devices['Pixel 9'] },
  ],
  webServer: {
    command: '../../scripts/dev.sh --scratch',
    url: 'http://localhost:5174',
    env: { LIMS_DB: 'lims_e2e', PORT: '3100', WEB_PORT: '5174', DEMO_PASSWORD },
    stdout: 'ignore',
  },
});
