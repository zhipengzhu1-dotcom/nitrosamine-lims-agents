import { expect, type Page, test } from './walk.ts';
import { DEMO_PASSWORD } from '../playwright.config.ts';

async function credentials(page: Page, lab: RegExp, password = DEMO_PASSWORD) {
  await page.getByRole('radio', { name: lab }).check();
  await page.getByLabel('Username').fill('lena.manager');
  await page.getByLabel('Password').fill(password);
}

test('the sign-in screen offers each Lab with none selected, and the rail switches Lab only after the credentials', async ({
  page,
}) => {
  await page.goto('/');
  const choice = page.getByRole('group', { name: 'Lab' }).getByRole('radio');
  await expect(choice).toHaveCount(2);
  for (const radio of await choice.all()) await expect(radio).not.toBeChecked();
  for (const option of await page.locator('.labs__option').all()) {
    const box = await option.boundingBox();
    expect(box?.height ?? 0, 'a Lab option is a 44 px touch target').toBeGreaterThanOrEqual(44);
  }

  await credentials(page, /R&D Laboratory/);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  const rail = page.getByRole('contentinfo');
  await expect(rail).toContainText('RD · Lab Manager');

  await rail.getByRole('button', { name: 'Switch Lab' }).click();
  const form = page.locator('form.signin');
  await expect(form.getByRole('heading', { name: 'Switch Lab' })).toBeVisible();
  await expect(form.getByRole('radio')).toHaveCount(1);
  await expect(form.getByRole('radio', { name: /QC Laboratory/ })).not.toBeChecked();

  await credentials(page, /QC Laboratory/, 'not-the-password');
  await form.getByRole('button', { name: 'Switch Lab' }).click();
  await expect(form.getByRole('alert')).toHaveText('the user ID or password is not valid');
  await expect(rail, 'a refused switch leaves the session in its Lab').toContainText('RD · Lab Manager');

  await credentials(page, /QC Laboratory/);
  await form.getByRole('button', { name: 'Switch Lab' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  await expect(rail).toContainText('QC · Lab Manager');
  await expect(page.getByRole('banner')).toContainText('QC');

  await page.reload();
  await expect(rail, 'the switch is held by the server, not the page').toContainText('QC · Lab Manager');
});
