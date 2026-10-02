import { expect, type Locator, test } from './walk.ts';
import { DEMO_PASSWORD } from '../playwright.config.ts';

const sideways = (box: Locator) => box.evaluate((e) => e.scrollWidth - e.clientWidth);

test.use({ viewport: { width: 390, height: 844 } });

test('the Submit sheet and its long Method name fit a 390 px phone with no sideways scroll', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone' && info.project.name !== 'pixel', 'a phone-width walk');
  await page.goto('/');
  await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
  await page.getByLabel('Username').fill('cora.customer');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();

  await page.getByRole('button', { name: 'Submit' }).click();
  const sheet = page.locator('form.sheet');
  const method = sheet.locator('select');
  await method.selectOption({ index: 1 });
  await expect(method.locator('option:checked'), 'the full Method name stays in the option').toHaveText(
    /^RD-MTH-\d{4} v\d+ .{30,}/,
  );

  expect(await sideways(sheet), 'the sheet does not scroll sideways').toBe(0);
  expect(await sideways(page.locator('html')), 'the page does not scroll sideways').toBe(0);
  for (const part of [sheet.locator('h2'), method, sheet.getByRole('button', { name: 'Cancel' })]) {
    const box = await part.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390, 'inside the screen').toBe(true);
  }
});
