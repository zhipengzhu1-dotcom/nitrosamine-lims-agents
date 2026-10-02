import { expect, type Locator, type Page, test } from './walk.ts';
import { DEMO_PASSWORD } from '../playwright.config.ts';

const PHONE = { width: 390, height: 844 };
const sidewaysScroll = (box: Locator) => box.evaluate((e) => e.scrollWidth - e.clientWidth);

test.use({ viewport: PHONE });
// oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern; empty means none.
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'iphone' && info.project.name !== 'pixel', 'a phone-width walk');
});

async function signInAsCustomer(page: Page) {
  await page.goto('/');
  await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
  await page.getByLabel('Username').fill('cora.customer');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
}

test('the Submit sheet and its long Method name fit a 390 px phone with no sideways scroll', async ({ page }) => {
  await signInAsCustomer(page);
  await page.getByRole('button', { name: 'Submit' }).click();
  const sheet = page.locator('form.sheet');
  const method = sheet.locator('select');
  await method.selectOption({ index: 1 });
  await expect(method.locator('option:checked'), 'the full Method name stays in the option').toHaveText(
    /^RD-MTH-\d{4} v\d+ .{30,}/,
  );

  expect(await sidewaysScroll(sheet), 'the sheet does not scroll sideways').toBe(0);
  expect(await sidewaysScroll(page.locator('html')), 'the page does not scroll sideways').toBe(0);
  for (const part of [sheet.locator('h2'), method, sheet.getByRole('button', { name: 'Cancel' })]) {
    const box = await part.boundingBox();
    expect(box?.x, 'starts inside the screen').toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? Infinity), 'ends inside the screen').toBeLessThanOrEqual(PHONE.width);
  }
});

test('an open sheet hides the session buttons and Cancel brings them back', async ({ page }) => {
  await signInAsCustomer(page);
  const signOut = page.getByRole('button', { name: 'Sign out' });
  await expect(signOut, 'the rail offers Sign out before a sheet opens').toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.locator('form.sheet')).toBeVisible();
  await expect(signOut, 'the open sheet hides Sign out').toBeHidden();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(signOut, 'Sign out is back once the sheet closes').toBeVisible();
});
