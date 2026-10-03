import { randomUUID } from 'node:crypto';
import { DEMO_PASSWORD } from '../playwright.config.ts';
import { expect, type Page, signInByApi, submittedTest, test } from './walk.ts';

const railSays = (page: Page, text: string | RegExp) => expect(page.getByRole('status')).toContainText(text);
const sheet = (page: Page) => page.locator('form.sheet');
/** Shoots once every finite, running, time-based animation and transition has finished, so no opening or closing sheet is caught mid-move; a scroll-driven animation never finishes. */
async function shot(page: Page, name: string) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (a) =>
            a.timeline === document.timeline &&
            a.playState === 'running' &&
            a.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY,
        )
        .map((a) => a.finished.catch(() => null)),
    ),
  );
  await page.screenshot({ path: test.info().outputPath(`${test.info().project.name}-${name}.png`) });
}

async function openTest(page: Page, username: string, testId: string) {
  await signInByApi(page, username);
  await page.goto(`/#/tests/${testId}`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Critical Data Changes' })).toBeVisible();
}

test('the assigned Analyst proposes a change to a saved Result, a Reviewer signs it Approved, a second proposal is withdrawn and a third rejected', async ({
  page,
}) => {
  const testId = await submittedTest(page, `Metformin HCl tablets (fictional, change ${randomUUID()})`);
  const changes = page.locator('ul.changes');

  await openTest(page, 'ana.analyst', testId);
  await page.getByRole('button', { name: 'Propose change' }).click();
  await sheet(page).getByLabel('New value as written').fill('0.0310');
  await sheet(page).getByRole('combobox', { name: 'Reason', exact: true }).selectOption('Other');
  await sheet(page).getByRole('button', { name: 'Propose change' }).click();
  await railSays(page, 'The Critical Data Change was refused: the reason Other needs its text.');
  await shot(page, 'propose-refused');
  await sheet(page).getByRole('combobox', { name: 'Reason', exact: true }).selectOption('Transcription error');
  await shot(page, 'propose-sheet');
  await sheet(page).getByRole('button', { name: 'Propose change' }).click();
  await railSays(page, 'The Critical Data Change is proposed and waits for a Reviewer.');
  await expect(changes).toContainText('Pending');
  await expect(changes).toContainText('Result value: 0.0300 → 0.0310 ppm');
  await changes.scrollIntoViewIfNeeded();
  await shot(page, 'pending');

  await openTest(page, 'rui.reviewer', testId);
  await expect(page.getByRole('button', { name: 'Review' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Approve change' }).click();
  await expect(page.getByRole('heading', { name: 'Sign Approved' })).toBeVisible();
  await expect(sheet(page)).toContainText('Result value: 0.0300 → 0.0310 ppm');
  await shot(page, 'approve-sheet');
  await page.getByLabel(/User ID/).fill('rui.reviewer');
  await page.getByLabel(/Password/).fill(DEMO_PASSWORD);
  await page.getByLabel(/Password/).scrollIntoViewIfNeeded();
  await shot(page, 'approve-sign');
  await page.getByRole('button', { name: 'Sign as Approved' }).click();
  await railSays(page, 'Approved Signature recorded. The Result holds the new value.');
  await expect(changes).toContainText('Approved');
  await expect(page.locator('dd.value')).toContainText('0.0310 ppm');
  await changes.scrollIntoViewIfNeeded();
  await shot(page, 'approved');
  const entries = page.getByRole('region', { name: 'Audit Trail' }).getByRole('listitem');
  await expect(
    entries.filter({ hasText: 'value 0.0300 to 0.0310' }).first(),
    'the proposal is in the Audit Trail',
  ).toBeVisible();
  await expect(
    entries.filter({ hasText: 'Critical Data Change Decision' }).filter({ hasText: 'Approved' }).first(),
    'the approval is in the Audit Trail',
  ).toBeVisible();

  await openTest(page, 'ana.analyst', testId);
  await page.getByRole('button', { name: 'Propose change' }).click();
  await sheet(page).getByLabel('New value as written').fill('0.0320');
  await sheet(page).getByRole('combobox', { name: 'Reason', exact: true }).selectOption('Transcription error');
  await sheet(page).getByRole('button', { name: 'Propose change' }).click();
  await railSays(page, 'waits for a Reviewer');
  await page.getByRole('button', { name: 'Withdraw change' }).click();
  await sheet(page).getByRole('combobox', { name: 'Reason', exact: true }).selectOption('Proposed in error');
  await sheet(page).getByRole('button', { name: 'Withdraw change' }).click();
  await railSays(page, 'The Critical Data Change is withdrawn. The Result is unchanged.');
  await expect(changes).toContainText('Withdrawn');
  await expect(page.locator('dd.value')).toContainText('0.0310 ppm');
  await changes.scrollIntoViewIfNeeded();
  await shot(page, 'withdrawn');

  await page.getByRole('button', { name: 'Propose change' }).click();
  await sheet(page).getByLabel('New value as written').fill('0.0330');
  await sheet(page).getByRole('combobox', { name: 'Reason', exact: true }).selectOption('Calculation error');
  await sheet(page).getByRole('button', { name: 'Propose change' }).click();
  await railSays(page, 'waits for a Reviewer');

  await openTest(page, 'rui.reviewer', testId);
  await expect(page.getByRole('button', { name: 'Approve change' })).toBeVisible();
  await shot(page, 'reject-offered');
  await page.getByRole('button', { name: 'Reject change' }).click();
  await expect(sheet(page).getByLabel(/Password/)).toHaveCount(0);
  await sheet(page)
    .getByRole('combobox', { name: 'Reason', exact: true })
    .selectOption('Not supported by the raw data');
  await shot(page, 'reject-sheet');
  await sheet(page).getByRole('button', { name: 'Reject change' }).click();
  await railSays(page, 'The Critical Data Change is rejected. The Result is unchanged.');
  await expect(changes).toContainText('Rejected by');
  await expect(changes).toContainText('Not supported by the raw data');
  await expect(page.locator('dd.value')).toContainText('0.0310 ppm');
  await changes.scrollIntoViewIfNeeded();
  await shot(page, 'rejected');
});
