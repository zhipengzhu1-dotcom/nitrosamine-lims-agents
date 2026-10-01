import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { DEMO_PASSWORD, SHOTS } from '../playwright.config.ts';

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
const sign = async (page: Page, meaning: string, password = DEMO_PASSWORD) => {
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole('button', { name: `Sign as ${meaning}` }).click();
};

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
  expect((await box(sheet)).height, 'the sheet keeps its height').toBe(height);

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
  await sign(page, 'Released');
  await railSays(page, 'now Reported');
  await page.getByRole('button', { name: 'Verify chain' }).click();
  await expect(page.locator('.verdict')).toHaveText(
    /^Recomputed at \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC: Lab chain intact through entry \d+; Company chain intact through entry \d+\. Not anchored off-server \(demo\)\.$/,
  );
  const reportLink = page.getByRole('link', { name: /^RD-R\d{5}$/ });
  await atLeast(reportLink, 44, 44);
  await reportLink.click();
  await expect(page.getByRole('heading', { name: /Test Report RD-R\d{5}/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: '0.0300', exact: true })).toBeVisible();
  for (const [meaning, signer] of [
    ['Performed', 'Ana Ferreira'],
    ['Reviewed', 'Rui Tanaka'],
    ['Released', 'Quinn Adeyemi'],
  ]) {
    await expect(page.getByRole('row', { name: new RegExp(`${meaning}.*${signer}`) })).toBeVisible();
  }
  await shot(page, 'test-report');
});
