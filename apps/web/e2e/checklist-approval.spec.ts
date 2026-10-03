import { randomUUID } from 'node:crypto';
import type { ChecklistKind } from '@lims/domain';
import { DEMO_PASSWORD } from '../playwright.config.ts';
import { expect, type Page, signInByApi, test } from './walk.ts';

/**
 * Each project drafts on a checklist of its own, so the parallel walks never approve under one another. Pixel drafts on
 * the Test checklist and stops at the refusal, because approving a Test version changes the version in force under
 * every walk that reviews a Test.
 */
const kindOf: Record<string, ChecklistKind> = { desktop: 'Released', iphone: 'Run', pixel: 'Test' };

async function openChecklists(page: Page, kind: ChecklistKind) {
  await page.goto(`/#/checklists/${kind}`);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Review Checklists' })).toBeVisible();
  await expect(page.getByRole('article', { name: /^Version 1\b/ }), 'the versions are read').toBeVisible();
}

test('QA drafts a Review Checklist version, is refused approving their own draft, and a second QA signs it Approved', async ({
  page,
}) => {
  const kind = kindOf[test.info().project.name] ?? 'Released';
  const added = `Disclaimers checked against the frozen scope (fictional ${randomUUID().slice(0, 8)})`;
  await page.goto('/');
  await signInByApi(page, 'quinn.qa');
  await openChecklists(page, kind);

  const draftStep = page.getByRole('radio', { name: /^Draft version \d+$/ });
  if (await draftStep.isVisible()) await draftStep.check();
  await page.getByRole('button', { name: 'Add item' }).click();
  await page
    .getByRole('textbox', { name: /^Item \d+$/ })
    .last()
    .fill(added);
  const save = page.getByRole('button', { name: /^Save version \d+$/ });
  const next = Number((await save.textContent())?.match(/\d+/)?.[0]);
  await save.click();
  await expect(page.getByRole('status')).toHaveText(
    `Version ${next} of the ${kind} Review Checklist saved as a draft.`,
  );

  const drafted = page.getByRole('article', { name: new RegExp(`^Version ${next}\\b`) });
  await expect(drafted.getByText('Draft', { exact: true })).toBeVisible();
  await expect(drafted.getByText('Drafted by quinn.qa')).toBeVisible();
  await expect(drafted.getByText(added)).toBeVisible();
  const approve = page.getByRole('button', { name: `Approve version ${next}` });
  await expect(approve, 'the QA who drafted the version cannot approve it').toBeDisabled();
  await openChecklists(page, kind);
  await expect(page.locator('.rail__context')).toHaveText(
    `You drafted version ${next} of the ${kind} Review Checklist, so another QA approves it.`,
  );
  if (kind === 'Test') return;

  await signInByApi(page, 'qiu.qa');
  await openChecklists(page, kind);
  await expect(approve).toBeEnabled();
  await approve.click();
  const sheet = page.locator('form.sheet');
  await expect(sheet.getByText(`${kind} Review Checklist, version ${next}, drafted by quinn.qa`)).toBeVisible();
  await expect(sheet.getByText(added, { exact: false })).toBeVisible();
  await page.getByLabel(/User ID/).fill('qiu.qa');
  await page.getByLabel(/Password/).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign as Approved' }).click();
  await expect(page.getByRole('status')).toHaveText(
    `Approved Signature recorded in the Audit Trail. Version ${next} of the ${kind} Review Checklist is in force.`,
  );
  await expect(drafted.getByText('In force', { exact: true })).toBeVisible();
});
