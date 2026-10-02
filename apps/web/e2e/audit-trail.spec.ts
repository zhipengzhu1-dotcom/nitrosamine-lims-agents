import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page, test } from './walk.ts';
import { DEMO_PASSWORD } from '../playwright.config.ts';

async function signIn(page: Page, username: string) {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

async function atLeast(target: Locator, width: number, height: number) {
  const b = await target.boundingBox();
  if (!b) throw new Error('the element is not on screen');
  expect(b.width + 0.01, 'touch target width').toBeGreaterThanOrEqual(width);
  expect(b.height + 0.01, 'touch target height').toBeGreaterThanOrEqual(height);
}

async function submittedTest(page: Page, description: string): Promise<string> {
  const as = async (username: string) => {
    await page.request.post('/api/logout', { data: {} });
    const res = await page.request.post('/api/login', { data: { username, password: DEMO_PASSWORD } });
    expect(res.ok(), `sign in as ${username}: ${res.status()} ${await res.text()}`).toBe(true);
  };
  const step = async (name: string, body: object) => {
    const res = await page.request.post(`/api/steps/${name}`, { data: { commitKey: randomUUID(), ...body } });
    expect(res.ok(), `${name}: ${await res.text()}`).toBe(true);
    return res.json();
  };
  await as('cora.customer');
  const { methods } = await (await page.request.get('/api/lookups')).json();
  const { testId } = await step('submit', { input: { methodId: methods[0].id, description } });
  await as('samir.custodian');
  await step('receive', { testId, input: {} });
  await as('lena.manager');
  const { analysts } = await (await page.request.get('/api/lookups')).json();
  const ana = analysts.find((a: { displayName: string }) => a.displayName === 'Ana Ferreira');
  await step('assign', { testId, input: { assigneeId: ana.id } });
  await as('ana.analyst');
  await step('enterResult', {
    testId,
    input: {
      analyte: 'NDMA',
      value: '0.0300',
      unit: 'ppm',
      injectionSequenceRef: 'SEQ-2026-0042',
      notebookRef: 'RD-NB-0007-012',
      performedOn: '2026-09-30',
    },
    signature: { password: DEMO_PASSWORD },
  });
  await page.request.post('/api/logout', { data: {} });
  return testId;
}

test('a Reviewer reads, filters and expands a Test trail and opens a raw entry; QA verifies the chain', async ({
  page,
}) => {
  const description = `Metformin HCl 500 mg tablets, lot NW-0043 (fictional, ${test.info().project.name} ${randomUUID()})`;
  await page.goto('/');
  const testId = await submittedTest(page, description);
  const openTheTest = async () => {
    await page.getByRole('row', { name: description }).getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Submitted For Review');
  };

  await page.reload();
  await signIn(page, 'rui.reviewer');
  await openTheTest();
  const trail = page.getByRole('region', { name: 'Audit Trail' });
  const entries = trail.getByRole('listitem');
  await expect(trail.getByRole('heading', { name: 'Audit Trail' })).toBeVisible();
  await expect(trail.getByText(/\d+ entries\. Times in UTC and in the Lab's zone, America\/New_York\./)).toBeVisible();
  await expect(entries.first()).toContainText('Company chain');
  await expect(entries.first()).toContainText('Cora Lindqvist (Customer) created the Submission');
  await expect(entries.first().locator('.entry__time')).toHaveText(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC$/);
  const assigned = entries.filter({ hasText: 'Analyst' }).filter({ hasText: 'Lena Varga' });
  await expect(assigned).toContainText('Lab chain');
  await expect(assigned).toContainText('Lena Varga (Lab Manager) changed the Test RD-S');
  await expect(assigned).toContainText('reason: assign');
  await expect(assigned.locator('.changes dt')).toHaveText(['Analyst']);
  await expect(assigned.locator('.changes dd')).toHaveText(['none → Ana Ferreira']);
  await expect(assigned.locator('.entry__time')).toHaveText(/UTC · \d{4}-\d\d-\d\d \d\d:\d\d:\d\d -0[45]:00$/);
  const total = await entries.count();

  const search = page.getByLabel('Search the trail');
  await atLeast(search, 44, 44);
  await search.fill('Lena Varga');
  await expect(entries).toHaveCount(2);
  await expect(entries.first().locator('.changes')).toContainText(/State\s*Ready → Assigned/);
  await search.fill('');
  await expect(entries).toHaveCount(total);

  await page.getByLabel('Order').selectOption('Newest first');
  await expect(entries.first()).toContainText('Signature Performed');
  const signed = entries.first();
  const versioned = entries.filter({ has: page.locator('details.long') }).first();
  await expect(versioned).toContainText('Record Version');
  await expect(versioned.locator('details.long'), 'the signed Record Version and its SHA-256 are long').toHaveCount(2);
  const long = versioned.locator('details.long').first();
  await expect(long.locator('summary')).toContainText('…');
  await atLeast(long.locator('summary'), 44, 44);
  await long.locator('summary').click();
  await expect(long).toContainText(`"analyte": "NDMA"`);
  await expect(long).toContainText(`"description": "${description}"`);

  const rawButton = signed.getByRole('button', { name: /^Raw entry \d+$/ });
  await atLeast(rawButton, 44, 44);
  await rawButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /^Raw entry \d+, Lab chain$/ })).toBeVisible();
  await expect(dialog.locator('pre')).toContainText(/"hash": "[0-9a-f]{64}"/);
  await expect(dialog.locator('pre')).toContainText('"record_version_id": "');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();

  await expect(trail.getByRole('button', { name: 'Verify chain' })).toHaveCount(0);
  await page.getByLabel('Order').selectOption('Oldest first');
  await search.fill('Reviewed');
  await expect(entries).toHaveCount(0);
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByLabel(/Password/).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign as Reviewed' }).click();
  await expect(page.getByRole('status')).toContainText('now Reviewed');
  await expect(entries, 'the Test state move and the Reviewed Signature arrive without a reload').toHaveCount(2);
  await expect(entries.last()).toContainText('Rui Tanaka (Reviewer) created the Signature Reviewed');
  await expect(entries.last()).toHaveClass(/entry--fresh/);
  await search.fill('');
  await entries
    .filter({ hasText: 'created the Test RD-S' })
    .getByRole('link', { name: /^RD-MTH-0001 v1$/ })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Method RD-MTH-0001 v1');
  await expect(page.getByRole('region', { name: 'Audit Trail' }).getByRole('listitem')).toHaveCount(1);
  await signOut(page);

  await signIn(page, 'quinn.qa');
  await page.goto(`/#/tests/${testId}`);
  const verify = page.getByRole('button', { name: 'Verify chain' });
  await atLeast(verify, 44, 44);
  await verify.click();
  await expect(page.locator('.verdict')).toHaveText(
    /^Recomputed at \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC: Lab chain intact through entry \d+; Company chain intact through entry \d+\. Not anchored off-server \(demo\)\.$/,
  );
  await signOut(page);

  await signIn(page, 'cora.customer');
  await page.goto(`/#/tests/${testId}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Reviewed');
  await expect(page.getByRole('region', { name: 'Audit Trail' })).toHaveCount(0);
});
