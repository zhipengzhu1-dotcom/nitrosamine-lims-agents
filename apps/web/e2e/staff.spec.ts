import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, SHOTS } from '../playwright.config.ts';

test('the Admin records an Identity Verification, creates the account and grants a Membership; the person sets their own password', async ({
  page,
}) => {
  const project = test.info().project.name;
  const suffix = randomBytes(3).toString('hex');
  const printedName = `Nell Newcomer ${suffix}`;
  const username = `nell.${project}-${suffix}`;
  const shot = async (what: string) => {
    if (SHOTS) await page.screenshot({ path: `test-results/shots/staff-${project}-${what}.png`, fullPage: true });
  };

  await page.goto('/');
  await page.getByLabel('Username').fill('ada.admin');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Staff' }).click();
  await expect(page.getByRole('heading', { name: 'Staff accounts' })).toBeVisible();
  await shot('01-staff');

  await page.getByLabel('Printed name', { exact: true }).fill(printedName);
  await page.getByLabel('What was checked').fill('Passport seen in person (fictional)');
  await page.getByRole('button', { name: 'Record the check' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: `Identity Verification of ${printedName} recorded` }),
  ).toBeVisible();

  const account = page.getByRole('form', { name: `Account for ${printedName}` });
  await account.getByLabel('Username').fill(username);
  await shot('02-before-create');
  await account.getByRole('button', { name: 'Create the account' }).click();
  const link = page.getByRole('region', { name: 'One-time link' });
  await expect(link).toContainText(`Give this link to ${printedName} in person`);
  await shot('03-link');
  const url = (await link.locator('code').innerText()).trim();
  expect(url, 'the link carries a token, not a password').toMatch(/#\/welcome\/[A-Za-z0-9_-]{43}$/);
  const row = page.getByRole('row', { name: new RegExp(username) });
  await expect(row).toContainText('No Membership yet');
  await expect(row).toContainText('Not set yet');

  const grant = page.locator('form').filter({ has: page.getByRole('heading', { name: /Grant a Membership/ }) });
  await grant.getByLabel('Person').selectOption({ label: `${printedName} (${username})` });
  await grant.getByLabel('Role').selectOption('Analyst');
  await grant.getByLabel('Reason').fill('New starter in the LC-MS/MS team');
  await grant.getByRole('button', { name: 'Grant' }).click();
  await expect(grant.getByRole('status')).toHaveText(`${printedName} holds Analyst in R&D Laboratory (fictional).`);
  await expect(row).toContainText('Analyst');
  await shot('04-granted');

  await grant.getByLabel('Person').selectOption({ label: `${printedName} (${username})` });
  await grant.getByLabel('Role').selectOption('Admin');
  await grant.getByLabel('Reason').fill('Try to make an Analyst an Admin');
  await grant.getByRole('button', { name: 'Grant' }).click();
  await expect(grant.getByRole('alert')).toHaveText(
    'Refused: a person who holds Admin or Platform Operator holds no business role, in any Lab.',
  );
  await shot('05-refused-admin-apart');

  await page.context().clearCookies();
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('nell-chose-this');
  await page.getByLabel('New password again').fill('nell-chose-this');
  await shot('06-welcome');
  await page.getByRole('button', { name: 'Set my password' }).click();
  await expect(page.getByRole('status')).toContainText(`Your password is set for ${username}`);
  await shot('07-password-set');

  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill('nell-chose-this');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();

  await page.context().clearCookies();
  await page.goto(url);
  await page.getByLabel('New password', { exact: true }).fill('someone-else');
  await page.getByLabel('New password again').fill('someone-else');
  await page.getByRole('button', { name: 'Set my password' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Refused: this link has been used or has expired; ask the Admin for a new one.',
  );
  await shot('08-link-used');
});
