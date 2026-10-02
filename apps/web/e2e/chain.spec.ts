import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { DEMO_PASSWORD, E2E_DATABASE, SHOTS } from '../playwright.config.ts';

const shot = async (page: Page, name: string) => {
  if (SHOTS && test.info().project.name === 'desktop')
    await page.screenshot({ path: `../../docs/design/thin-slice-shots/${name}.png` });
};

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

const railSays = (page: Page, text: string | RegExp) => expect(page.getByRole('status')).toContainText(text);
const sign = async (page: Page, meaning: string, password = DEMO_PASSWORD, username?: string) => {
  const typed = username ?? (await page.getByRole('contentinfo').locator('.who code').textContent()) ?? '';
  await page.getByLabel(/User ID/).fill(typed);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole('button', { name: `Sign as ${meaning}` }).click();
};

function changeResult(testId: string, value: string) {
  execFileSync(
    '../../scripts/pg.sh',
    [
      'psql',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '--single-transaction',
      '-d',
      E2E_DATABASE,
      '-v',
      `test=${testId}`,
      '-v',
      `value=${value}`,
    ],
    {
      input: `select set_config('lims.actor', 'svc:e2e', true), set_config('lims.role', 'system', true),
                     set_config('lims.reason', 'Change a signed Result from outside the chain (e2e)', true);
              update lims.result set value = :'value' where test_id = :'test';`,
      stdio: ['pipe', 'ignore', 'inherit'],
    },
  );
}

async function box(target: Locator) {
  const b = await target.boundingBox();
  if (!b) throw new Error('the element is not on screen');
  return b;
}
async function atLeast(target: Locator, width: number, height: number) {
  await target.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const b = await box(target);
  // A box at a fractional position measures up to 0.0001 px short of its CSS size.
  expect(b.width + 0.01, 'touch target width').toBeGreaterThanOrEqual(width);
  expect(b.height + 0.01, 'touch target height').toBeGreaterThanOrEqual(height);
}

test('the whole chain through the UI, ending in a Test Report with three Signatures', async ({ page }) => {
  const description = `Metformin HCl 500 mg tablets, lot NW-0042 (fictional, ${test.info().project.name} ${randomUUID()})`;
  const openTheTest = async () => {
    const link = page.getByRole('row', { name: description }).getByRole('link');
    await atLeast(link, 44, 44);
    await link.click();
  };
  const sheet = page.locator('form.sheet');
  const commitKeys: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/steps/'))
      commitKeys.push(request.postDataJSON().commitKey);
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await shot(page, 'sign-in');

  await signIn(page, 'cora.customer');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Submit' }).click();
  expect(await sheet.evaluate((form) => getComputedStyle(form).transform), 'no movement').toBe('none');
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await sheet.count(), 'under reduced motion the sheet leaves at once').toBe(0);
  await page.emulateMedia({ reducedMotion: null });
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByLabel('Method').selectOption({ index: 1 });
  await page.getByLabel('Sample description').fill(description);
  await page.getByRole('button', { name: 'Submit' }).click();
  await railSays(page, 'now Requested');
  await expect(page.getByRole('row', { name: description })).toContainText('Requested');
  await signOut(page);

  await signIn(page, 'samir.custodian');
  await openTheTest();
  await page.getByRole('button', { name: 'Receive' }).click();
  await railSays(page, 'now Ready');
  await signOut(page);

  await signIn(page, 'lena.manager');
  await shot(page, 'worklist');
  await openTheTest();
  const assign = page.getByRole('button', { name: 'Assign' });
  await atLeast(assign, 44, 56);
  await assign.click();
  await page.getByLabel('Analyst').selectOption({ label: 'Ana Ferreira' });
  await atLeast(assign, 44, 56);
  await assign.click();
  await railSays(page, 'now Assigned');
  await signOut(page);

  await signIn(page, 'ana.analyst');
  await openTheTest();
  await page.getByRole('button', { name: 'Enter Result' }).click();
  const result = {
    Analyte: 'NDMA',
    'Result as written': '0.0300',
    Unit: 'ppm',
    'Injection sequence': 'SEQ-2026-0042',
    'Notebook reference': 'RD-NB-0007-012',
    'Performed on': '2026-09-30',
  };
  for (const [label, value] of Object.entries(result)) await page.getByLabel(label, { exact: true }).fill(value);
  const signing = page.locator('form.sheet');
  await expect(signing.getByRole('heading', { name: 'What you are signing' })).toBeVisible();
  await expect(signing.locator('.meaning')).toContainText(/Performed.*Signature statement version 1/s);
  await expect(signing.getByText(/^Ana Ferreira may sign Performed as Analyst in R&D Laboratory/)).toBeVisible();
  const hash = signing.locator('code.hash');
  await expect(hash).toHaveText(/^[0-9a-f]{64}$/);
  const userId = page.getByLabel(/User ID/);
  await expect(userId).toHaveValue('');
  expect(
    await signing.evaluate((form) => {
      const [shown, typed] = [form.querySelector('code.hash'), form.querySelector('input[type=text]')];
      return Boolean(shown && typed && shown.compareDocumentPosition(typed) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
    'the record, meaning, eligibility and full hash come before the credential fields',
  ).toBe(true);
  await atLeast(userId, 44, 44);
  await userId.fill('ana.analyst');
  await page.getByLabel(/Password/).fill(DEMO_PASSWORD);
  await shot(page, 'test-signature-sheet');
  await sign(page, 'Performed');
  await railSays(page, 'now Submitted For Review');
  await signOut(page);

  await signIn(page, 'rui.reviewer');
  await openTheTest();
  const review = page.getByRole('button', { name: 'Review', exact: true });
  await review.click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(review, 'the rail button is back before the sheet has left').toBeVisible({ timeout: 100 });
  await expect(review).toBeFocused();
  await review.click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await sheet.count(), 'Escape closes the sheet at once').toBe(0);
  await expect(review).toBeFocused();

  await review.click();
  await expect(sheet.locator('.meaning'), 'the Reviewed sheet shows its meaning and statement').toContainText(
    /Reviewed.*Signature statement version 1/s,
  );
  await expect(sheet.getByText(/^Rui Tanaka may sign Reviewed as Reviewer in R&D Laboratory/)).toBeVisible();
  await expect(sheet.locator('code.hash')).toHaveText(/^[0-9a-f]{64}$/);
  const height = (await box(sheet)).height;
  await sign(page, 'Reviewed', 'not-the-password');
  await railSays(page, 'Refused: the credentials are not valid. Nothing has been signed.');
  const refusal = sheet.locator('.refusal');
  await expect(refusal).toBeInViewport({ ratio: 1 });
  const [inSheet, inRefusal] = [await box(sheet), await box(refusal)];
  expect(inRefusal.y >= inSheet.y && inRefusal.y + inRefusal.height <= inSheet.y + inSheet.height).toBe(true);
  const password = page.getByLabel(/Password/);
  await expect(password).toBeFocused();
  const [field, foot] = [await box(password), await box(sheet.locator('.sheet__foot'))];
  expect(field.y + field.height, 'the password field is clear of the sheet foot').toBeLessThanOrEqual(foot.y);
  // A box at a fractional position measures a few ten-thousandths of a pixel differently between runs.
  expect((await box(sheet)).height, 'the sheet keeps its height').toBeCloseTo(height, 2);

  await page.request.post('/api/logout', { data: {} });
  const whoAmI: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/me')) whoAmI.push(request.url());
  });
  await sign(page, 'Reviewed');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('sign in first');
  expect(whoAmI, 'the web returned to sign-in by the kind, with no second request to decide it').toHaveLength(0);
  await page.getByLabel('Username').fill('rui.reviewer');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 }), 'signing in again returns to the Test it left').toContainText(
    'Submitted For Review',
  );

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Submitted For Review');
  await review.click();
  const held = Promise.withResolvers<void>();
  await page.route('**/api/steps/review', async (route) => {
    await held.promise;
    await route.continue();
  });
  const submit = page.getByRole('button', { name: 'Sign as Reviewed' });
  await atLeast(submit, 44, 56);
  const width = (await box(submit)).width;
  await sign(page, 'Reviewed');
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  await expect(submit).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect((await box(submit)).width, 'the busy Sign button keeps its width').toBe(width);
  held.resolve();
  await railSays(page, 'now Reviewed');
  await expect(page.getByRole('status'), 'with no step left, focus goes to the status line').toBeFocused();
  await signOut(page);

  await signIn(page, 'quinn.qa');
  await openTheTest();
  await page.getByRole('button', { name: 'Release' }).click();
  let dropped = false;
  await page.route('**/api/steps/release', async (route) => {
    if (dropped) return route.continue();
    dropped = true;
    await route.fetch();
    return route.abort('connectionreset');
  });
  await sign(page, 'Released');
  await railSays(
    page,
    'The LIMS did not answer. Type your password again and sign with the same entries; they will not be saved twice.',
  );
  await sign(page, 'Released');
  await railSays(page, 'now Reported');
  await page.getByRole('button', { name: 'Verify chain' }).click();
  await expect(page.locator('.verdict')).toHaveText(
    /^Recomputed at \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC: Lab chain intact through entry \d+; Company chain intact through entry \d+\. Not anchored off-server \(demo\)\.$/,
  );
  const [releaseKey, retryKey] = commitKeys.slice(-2);
  expect(retryKey, 'the press whose reply was dropped is resent with its Commit Key').toBe(releaseKey);
  const presses = new Set(commitKeys);
  expect(presses.size, 'every other press sent a fresh Commit Key').toBe(commitKeys.length - 1);
  for (const key of presses)
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const reportLink = page.locator('.facts').getByRole('link', { name: /^RD-R-\d{4}-\d{6}$/ });
  await atLeast(reportLink, 44, 44);
  await reportLink.click();
  await expect(page.getByRole('heading', { name: /Test Report RD-R-\d{4}-\d{6}/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: '0.0300', exact: true })).toBeVisible();
  for (const [meaning, signer] of [
    ['Performed', 'Ana Ferreira'],
    ['Reviewed', 'Rui Tanaka'],
    ['Released', 'Quinn Adeyemi'],
  ]) {
    await expect(page.getByRole('row', { name: new RegExp(`${meaning}.*${signer}`) })).toBeVisible();
  }
  await shot(page, 'test-report');

  const testId = new URL(page.url()).hash.split('/')[2] ?? '';
  expect(testId).toMatch(/^[0-9a-f-]{36}$/);
  const signed = page.getByRole('row', { name: /unsigned/ });
  await expect(signed).toHaveCount(0);
  changeResult(testId, '0.0380');
  await page.reload();
  await expect(page.getByRole('cell', { name: '0.0380', exact: true })).toBeVisible();
  for (const meaning of ['Performed', 'Reviewed', 'Released'])
    await expect(page.getByRole('row', { name: new RegExp(`${meaning} unsigned`) })).toBeVisible();

  await page.goto(`/#/tests/${testId}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Reported');
  await expect(page.locator('dl.facts').first().locator('dt:text-is("Record Version") + dd')).toContainText('4 ·');
  await expect(page.getByRole('row', { name: /unsigned/ })).toHaveCount(3);
  await railSays(page, 'Unsigned: Performed, Reviewed, Released. The record changed after signing.');
  await shot(page, 'test-unsigned');
  await page.getByRole('button', { name: 'Verify chain' }).click();
  await expect(page.locator('.verdict')).toHaveText(
    /Lab chain intact through entry \d+; Company chain intact through entry \d+/,
  );
});

test('a wrong password and an unknown user ID show the same failure message', async ({ page }) => {
  const attempt = async (username: string, password: string) => {
    await page.goto('/');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    return alert.textContent();
  };
  const wrongPassword = await attempt('rui.reviewer', 'not-the-password');
  const unknownUserId = await attempt(`nobody-${randomUUID()}`, DEMO_PASSWORD);
  expect(wrongPassword).toBe('the credentials are not valid');
  expect(unknownUserId).toBe(wrongPassword);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
