import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from './walk.ts';
import { DEMO_PASSWORD, E2E_DATABASE } from '../playwright.config.ts';

const sample = (which: string) =>
  `Metformin HCl tablets, ${which} (fictional, ${test.info().project.name} ${randomUUID()})`;

async function fillSubmitSheet(page: Page, description: string, order: 'method first' | 'description first') {
  await page.getByRole('button', { name: 'Submit' }).click();
  const method = () => page.getByLabel('Method').selectOption({ index: 1 });
  const fillDescription = () => page.getByLabel('Sample description').fill(description);
  if (order === 'method first') await method().then(fillDescription);
  else await fillDescription().then(method);
}

async function signInAsCora(page: Page) {
  await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
  await page.getByLabel('Username').fill('cora.customer');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
}

async function signInAndDropOneSubmit(page: Page, description: string) {
  const commitKeys: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/steps/submit'))
      commitKeys.push(request.postDataJSON().commitKey);
  });
  await page.goto('/');
  await signInAsCora(page);

  await page.route('**/api/steps/submit', async (route) => {
    await route.fetch();
    return route.abort('connectionreset');
  });
  await fillSubmitSheet(page, description, 'description first');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('status')).toContainText('The LIMS did not answer.');
  await page.unroute('**/api/steps/submit');
  return commitKeys;
}

async function signInDropOneSubmitAndReload(page: Page, description: string) {
  const commitKeys = await signInAndDropOneSubmit(page, description);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  return commitKeys;
}

function countSubmissionsInTheAuditTrail(description: string) {
  const count = execFileSync(
    '../../scripts/pg.sh',
    ['psql', '-qtA', '-v', 'ON_ERROR_STOP=1', '-d', E2E_DATABASE, '-v', `description=${description}`],
    {
      input: `select count(*) from lims.audit_entry
               where table_name = 'submission' and op = 'INSERT'
                 and new_row ->> 'id' in (select submission_id::text from lims.sample where description = :'description');`,
      encoding: 'utf8',
    },
  );
  return Number(count.trim());
}

test('a Submission with other entries after a dropped Submit and a reload is recorded at the first press', async ({
  page,
}) => {
  const dropped = sample('dropped reply');
  const other = sample('other entries');
  const commitKeys = await signInDropOneSubmitAndReload(page, dropped);

  await fillSubmitSheet(page, other, 'method first');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('status')).toContainText('now Requested');
  await expect(page.getByRole('row', { name: other })).toContainText('Requested');
  await expect(page.getByRole('row', { name: dropped }), 'the dropped press was saved once').toHaveCount(1);
  expect(commitKeys, 'one press each, the second with a fresh Commit Key').toHaveLength(2);
  expect(new Set(commitKeys).size).toBe(2);
});

test('the same entries typed in another order after a dropped Submit and a reload resend the press', async ({
  page,
}) => {
  const dropped = sample('dropped reply');
  const commitKeys = await signInDropOneSubmitAndReload(page, dropped);

  await fillSubmitSheet(page, dropped, 'method first');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('status')).toContainText('now Requested');
  await expect(page.getByRole('row', { name: dropped }), 'the Submission is saved once').toHaveCount(1);
  expect(commitKeys, 'the press is resent with its Commit Key').toHaveLength(2);
  expect(new Set(commitKeys).size).toBe(1);
});

test('the same entries after a dropped Submit, a sign-out and a sign-in are refused as already saved at every press until the tab closes', async ({
  page,
}) => {
  const dropped = sample('dropped reply');
  const commitKeys = await signInAndDropOneSubmit(page, dropped);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signInAsCora(page);
  await expect(page.getByRole('row', { name: dropped }), 'the sign-in shows the saved Submission').toHaveCount(1);

  await fillSubmitSheet(page, dropped, 'method first');
  const submit = page.getByRole('button', { name: 'Submit' });
  const press = async () => {
    const answered = page.waitForResponse('**/api/steps/submit');
    await submit.click();
    expect((await answered).status()).toBe(422);
    await expect(submit, 'the rail has shown the answer').toHaveAttribute('aria-busy', 'false');
    return (await page.getByRole('status').textContent()) ?? '';
  };
  const first = await press();
  expect(first).toContain('This press was already saved before the latest sign-in. Reload to see what was saved.');
  expect(await press(), 'the second press is refused with the same message').toBe(first);
  expect(commitKeys, 'both presses resend the Commit Key of the saved press').toHaveLength(3);
  expect(new Set(commitKeys).size).toBe(1);
  expect(countSubmissionsInTheAuditTrail(dropped), 'the Audit Trail holds one Submission for the entries').toBe(1);
  await page.reload();
  await expect(page.getByRole('row', { name: dropped }), 'the Submission is saved once').toHaveCount(1);

  await fillSubmitSheet(page, dropped, 'description first');
  expect(await press(), 'a reload keeps the Commit Key until the tab closes').toBe(first);
  expect(new Set(commitKeys).size).toBe(1);
  expect(countSubmissionsInTheAuditTrail(dropped)).toBe(1);
});

test('the same entries pressed into an ended session after a dropped Submit, then after a sign-in, are told the press was already saved', async ({
  page,
}) => {
  const dropped = sample('dropped reply');
  const commitKeys = await signInAndDropOneSubmit(page, dropped);
  const out = await page.request.post('/api/logout', { data: {} });
  expect(out.status(), await out.text()).toBe(200);

  const ended = page.waitForResponse('**/api/steps/submit');
  await page.getByRole('button', { name: 'Submit' }).click();
  expect((await ended).status(), 'the session that held the press has ended').toBe(401);
  await signInAsCora(page);
  await fillSubmitSheet(page, dropped, 'method first');
  const answered = page.waitForResponse('**/api/steps/submit');
  await page.getByRole('button', { name: 'Submit' }).click();
  expect((await answered).status(), 'the press is refused as already saved').toBe(422);
  expect(commitKeys).toHaveLength(3);
  expect(new Set(commitKeys).size, 'every press resends the Commit Key of the saved press').toBe(1);
  expect(countSubmissionsInTheAuditTrail(dropped), 'the Audit Trail holds one Submission for the entries').toBe(1);
});
