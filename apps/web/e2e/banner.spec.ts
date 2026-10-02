import { SHOTS } from '../playwright.config.ts';
import { expect, type Page, signInByApi, TABLET, test } from './walk.ts';

/** The banner the deployment's data class puts on every screen while it is fictional, as #102 decided. */
const banner = (page: Page) => page.locator('header.top').getByText('Fictional data only');

async function shot(page: Page, what: string) {
  if (SHOTS) await page.screenshot({ path: `test-results/shots/banner-${test.info().project.name}-${what}.png` });
}

test('the sign-in screen carries the fictional-data banner before anyone signs in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(banner(page)).toBeVisible();
  await shot(page, 'sign-in');
});

test('the Bench Rail carries the fictional-data banner for staff', async ({ page }) => {
  await signInByApi(page, 'ana.analyst');
  await page.goto('/#/tests');
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  await expect(banner(page)).toHaveText('Fictional data only');
  await shot(page, 'bench-rail');
});

test('at tablet width the Bench Rail carries the fictional-data banner', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'one tablet-width walk, on the desktop browser');
  await page.setViewportSize(TABLET);
  await signInByApi(page, 'ana.analyst');
  await page.goto('/#/tests');
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  await expect(banner(page)).toHaveText('Fictional data only');
  await shot(page, 'bench-rail-tablet');
});

test('the Customer portal carries the fictional-data banner', async ({ page }) => {
  await signInByApi(page, 'cora.customer');
  await page.goto('/#/tests');
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  await expect(banner(page)).toBeVisible();
  await shot(page, 'portal');
});
