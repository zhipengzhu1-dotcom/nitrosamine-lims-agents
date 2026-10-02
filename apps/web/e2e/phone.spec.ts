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

test('the tabs are 44 px touch targets, the bar fades where more tabs lie beyond, and the last tab scrolls clear of the fade', async ({
  page,
}) => {
  await signInAsCustomer(page);
  const nav = page.locator('.top nav');
  const clearOfFade = () =>
    nav.evaluate((n) => {
      const fade = Number(getComputedStyle(n).getPropertyValue('--more-after').replace('px', ''));
      const last = n.querySelector('a:last-of-type')?.getBoundingClientRect().right ?? Infinity;
      return { fade, room: n.getBoundingClientRect().right - fade - last };
    });
  expect((await clearOfFade()).fade, 'the right edge fades while more tabs lie beyond it').toBeGreaterThan(0);
  for (const tab of await nav.getByRole('link').all())
    expect((await tab.boundingBox())?.height, 'each tab is a 44 px touch target').toBeGreaterThanOrEqual(44);
  await nav.evaluate((n) => n.scrollTo({ left: n.scrollWidth }));
  await expect
    .poll(async () => (await clearOfFade()).room, 'the last tab ends before the fade')
    .toBeGreaterThanOrEqual(0);

  await page.setViewportSize({ width: 1360, height: 900 });
  await expect
    .poll(() => nav.evaluate((n) => getComputedStyle(n).maskImage), 'a desktop tab bar that fits does not fade')
    .toBe('none');
});
