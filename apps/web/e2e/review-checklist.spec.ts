import { randomUUID } from 'node:crypto';
import { expect, signInByApi, submittedTest, test, tickChecklist } from './walk.ts';
import { DEMO_PASSWORD } from '../playwright.config.ts';

test('a Reviewer sees the Test Review Checklist, ticks every item including audit trail reviewed, and signs Reviewed', async ({
  page,
}) => {
  const description = `Metformin HCl tablets, lot NW-0110 (fictional, ${test.info().project.name} ${randomUUID()})`;
  await page.goto('/');
  const testId = await submittedTest(page, description);
  await signInByApi(page, 'rui.reviewer');
  await page.goto(`/#/tests/${testId}`);
  await page.reload();

  const checklist = page.getByRole('region', { name: 'Test Review Checklist, version 1' });
  await expect(checklist).toBeVisible();
  const boxes = checklist.getByRole('checkbox');
  await expect(boxes).toHaveCount(9);
  for (const box of await boxes.all()) await expect(box).not.toBeChecked();

  const review = page.getByRole('button', { name: 'Review', exact: true });
  await tickChecklist(page);
  await checklist.getByRole('checkbox', { name: 'Audit trail reviewed' }).uncheck();
  await expect(review, 'an unticked item keeps the Review press disabled').toBeDisabled();
  await expect(page.locator('.rail__context')).toHaveText('Tick “Audit trail reviewed” before signing Reviewed.');

  await checklist.getByRole('checkbox', { name: 'Audit trail reviewed' }).check();
  await expect(review).toBeEnabled();
  await review.click();
  const sheet = page.locator('form.sheet');
  await expect(sheet.getByText('Test Review Checklist, version 1, all 9 items ticked')).toBeVisible();
  await expect(
    sheet.getByText('Flags acknowledged with a comment: No flags raised (fictional).', { exact: true }),
  ).toBeVisible();
  await expect(sheet.locator('code.hash')).toHaveText(/^[0-9a-f]{64}$/);
  await page.getByLabel(/User ID/).fill('rui.reviewer');
  await page.getByLabel(/Password/).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign as Reviewed' }).click();
  await expect(page.getByRole('status')).toContainText('now Reviewed');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Reviewed');
  await expect(checklist, 'the checklist leaves once the Test is reviewed').toHaveCount(0);
});
