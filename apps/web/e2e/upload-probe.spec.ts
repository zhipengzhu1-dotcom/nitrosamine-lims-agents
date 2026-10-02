import { expect, test } from './walk.ts';

test('a failing walk uploads the API log', async ({ page }) => {
  await page.goto('/');
  expect(false, 'fails on purpose to prove the CI upload').toBe(true);
});
