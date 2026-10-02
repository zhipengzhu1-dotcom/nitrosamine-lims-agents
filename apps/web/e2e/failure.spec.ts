import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD } from '../playwright.config.ts';

const PROBE = 'E2E-FAILURE-PROBE';
const database = execFileSync(process.execPath, ['../../packages/db/src/checkout.ts', 'database', 'lims_e2e'], {
  encoding: 'utf8',
}).trim();
const psql = (script: string, variables: Record<string, string> = {}) =>
  execFileSync(
    '../../scripts/pg.sh',
    [
      'psql',
      '-d',
      database,
      '-qtA',
      ...Object.entries(variables).flatMap(([name, value]) => ['-v', `${name}=${value}`]),
    ],
    { input: script, encoding: 'utf8' },
  ).trim();

test.beforeAll(() => {
  psql(`do $$ begin
          alter table lims.sample add constraint e2e_failure_probe check (description not like '%E2E-FAILURE-PROBE%');
        exception when duplicate_object then null;
        end $$;`);
});

test('an unexpected failure shows its reference on the Bench Rail and plays no success motion', async ({ page }) => {
  const description = `Metformin HCl tablets (fictional, ${PROBE} ${test.info().project.name} ${randomUUID()})`;
  await page.goto('/');
  await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
  await page.getByLabel('Username').fill('cora.customer');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();

  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByLabel('Method').selectOption({ index: 1 });
  await page.getByLabel('Sample description').fill(description);
  await page.getByRole('button', { name: 'Submit' }).click();

  const status = page.getByRole('status');
  await expect(status).toContainText(/^Not finished: .* reference [0-9A-HJKMNP-TV-Z]{8}\.$/);
  const reference = /reference (\w{8})/.exec(await status.innerText())?.[1] ?? '';
  expect(
    psql(`select step from lims.system_incident where reference = :'reference';`, { reference }),
    'the reference names a System Incident',
  ).toBe('submit');
  await expect(page.locator('form.sheet .refusal'), 'the sheet stays open with the reference').toContainText(reference);
  await expect(page.locator('.note--ok, .status--fresh, .row--fresh'), 'no success motion plays').toHaveCount(0);
  await expect(page.getByRole('row', { name: description }), 'no row claims the Test exists').toHaveCount(0);
});
