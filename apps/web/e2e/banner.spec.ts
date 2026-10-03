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

test('a deployment whose data class is real shows no banner', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'the class is read the same way on every browser');
  await page.route('**/api/deployment', (route) => route.fulfill({ json: { dataClass: 'real' } }));
  const answered = page.waitForResponse('**/api/deployment');
  await page.goto('/');
  await answered;
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test('a deployment whose data class cannot be read keeps the banner', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'the class is read the same way on every browser');
  await page.route('**/api/deployment', (route) => route.fulfill({ status: 500, json: { reference: 'probe' } }));
  const finished = page.waitForEvent('requestfinished', (request) => request.url().endsWith('/api/deployment'));
  await page.goto('/');
  await finished;
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  // Two frames after the failed answer, so the banner asserted is the one the failure leaves, not the one shown while
  // the class was still loading.
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => done());
        });
      }),
  );
  await expect(banner(page)).toBeVisible();
});
