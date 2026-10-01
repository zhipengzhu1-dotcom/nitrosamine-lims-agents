import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

export const DEMO_PASSWORD = 'e2e-demo-password';
export const SHOTS = Boolean(process.env.SHOTS);

const checkout = fileURLToPath(new URL('../../packages/db/src/checkout.ts', import.meta.url));
const printed = execFileSync(process.execPath, [checkout, 'e2e-ports'], { encoding: 'utf8' }).trim();
const [apiPort, webPort] = printed.split(' ');
if (!apiPort || !webPort) throw new Error(`checkout.ts e2e-ports printed "${printed}", not an API and a web port`);
const webURL = `http://localhost:${webPort}`;

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: webURL },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1360, height: 900 } } },
    { name: 'iphone', use: devices['iPhone 16'] },
    { name: 'ipad', use: devices['iPad (gen 11)'] },
    { name: 'pixel', use: devices['Pixel 9'] },
  ],
  webServer: {
    command: '../../scripts/dev.sh --scratch',
    url: webURL,
    env: { LIMS_DB: 'lims_e2e', PORT: apiPort, WEB_PORT: webPort, DEMO_PASSWORD },
    stdout: 'ignore',
  },
});
