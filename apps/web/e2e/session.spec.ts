import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD } from '../playwright.config.ts';

test('the Bench Rail counts down to the idle end, restarts on activity, and returns to sign-in when the session ends', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  await page.getByLabel('Username').fill('quinn.qa');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const countdown = page.locator('.rail .who__clock');
  // The walk runs on the demo login, whose idle limit is 8 hours.
  await expect(countdown).toHaveText(/^Session ends in (8:00:00|7:59:5\d)$/);
  await expect(countdown).toBeVisible();

  await page.clock.fastForward('01:00:00');
  await expect(countdown).toHaveText(/^Session ends in 6:59:\d\d$/);
  await page.getByRole('link', { name: 'Equipment' }).click();
  await page.getByRole('link', { name: 'Tests' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  await expect(countdown, 'a request restarts the idle count').toHaveText(/^Session ends in (8:00:00|7:59:\d\d)$/);

  await page.clock.fastForward('08:00:00');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('the session has ended; sign in again');
});
