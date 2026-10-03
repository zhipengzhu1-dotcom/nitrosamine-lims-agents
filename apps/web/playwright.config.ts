import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

export const DEMO_PASSWORD = 'e2e-demo-password';
export const SHOTS = Boolean(process.env.SHOTS);

// The web imports only @lims/domain, so ask the checkout CLI for the ports, as scripts/dev.sh does.
const checkout = fileURLToPath(new URL('../../packages/db/src/checkout.ts', import.meta.url));
const printed = execFileSync(process.execPath, [checkout, 'e2e-ports'], { encoding: 'utf8' }).trim();
const [apiPort, webPort, decidedApiPort, decidedWebPort] = printed.split(' ');
if (!apiPort || !webPort || !decidedApiPort || !decidedWebPort)
  throw new Error(`checkout.ts e2e-ports printed "${printed}", not two API and web port pairs`);
export const WEB_URL = `http://localhost:${webPort}`;
/** A second LIMS under the decided login, with its own database, for the walks that need an authenticator code. */
export const DECIDED_URL = `http://localhost:${decidedWebPort}`;
const E2E_DB = 'lims_e2e';
const DECIDED_DB = 'lims_e2e_decided';
const databaseNamed = (name: string) =>
  execFileSync(process.execPath, [checkout, 'database', name], { encoding: 'utf8' }).trim();
export const E2E_DATABASE = databaseNamed(E2E_DB);
/** The decided LIMS's database, which a walk reaches as its owner for what no Admin can do before one has enrolled. */
export const DECIDED_DATABASE = databaseNamed(DECIDED_DB);
export const API_LOG = fileURLToPath(new URL('api-log/api.log', import.meta.url));

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: WEB_URL },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1360, height: 900 } } },
    { name: 'iphone', use: devices['iPhone 16'] },
    { name: 'pixel', use: devices['Pixel 9'] },
  ],
  webServer: [
    {
      command: '../../scripts/dev.sh --scratch',
      url: `${WEB_URL}/api/me`,
      env: { LIMS_DB: E2E_DB, LIMS_LOG_FILE: API_LOG, PORT: apiPort, WEB_PORT: webPort, DEMO_PASSWORD },
      stdout: 'ignore',
    },
    {
      command: '../../scripts/dev.sh --scratch',
      url: `${DECIDED_URL}/api/me`,
      env: {
        LIMS_DB: DECIDED_DB,
        LIMS_LOGIN: 'decided',
        LIMS_LOG_FILE: fileURLToPath(new URL('api-log/decided.log', import.meta.url)),
        PORT: decidedApiPort,
        WEB_PORT: decidedWebPort,
        DEMO_PASSWORD,
      },
      stdout: 'ignore',
    },
  ],
});
