import { randomUUID } from 'node:crypto';
import { expect, test } from './walk.ts';
import { DEMO_PASSWORD } from '../playwright.config.ts';

test('a Submission with other entries after a dropped Submit and a reload is recorded at the first press', async ({
  page,
}) => {
  const sample = (which: string) =>
    `Metformin HCl tablets, ${which} (fictional, ${test.info().project.name} ${randomUUID()})`;
  const dropped = sample('dropped reply');
  const other = sample('other entries');
  const commitKeys: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/steps/submit'))
      commitKeys.push(request.postDataJSON().commitKey);
  });
  const submit = async (description: string) => {
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.getByLabel('Method').selectOption({ index: 1 });
    await page.getByLabel('Sample description').fill(description);
    await page.getByRole('button', { name: 'Submit' }).click();
  };

  await page.goto('/');
  await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
  await page.getByLabel('Username').fill('cora.customer');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();

  await page.route('**/api/steps/submit', async (route) => {
    await route.fetch();
    return route.abort('connectionreset');
  });
  await submit(dropped);
  await expect(page.getByRole('status')).toContainText('The LIMS did not answer.');
  await page.unroute('**/api/steps/submit');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();

  await submit(other);
  await expect(page.getByRole('status')).toContainText('now Requested');
  await expect(page.getByRole('row', { name: other })).toContainText('Requested');
  await expect(page.getByRole('row', { name: dropped }), 'the dropped press was saved once').toHaveCount(1);
  expect(commitKeys, 'one press each, the second with a fresh Commit Key').toHaveLength(2);
  expect(new Set(commitKeys).size).toBe(2);
});
