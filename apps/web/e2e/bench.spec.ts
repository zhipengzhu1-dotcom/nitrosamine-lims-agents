import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from './walk.ts';
import { DEMO_PASSWORD } from '../playwright.config.ts';

async function signIn(page: Page, username: string) {
  await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
}

const railSays = (page: Page, text: string | RegExp) => expect(page.getByRole('status')).toContainText(text);

async function atLeast44(page: Page, name: string) {
  const b = await page.getByRole('button', { name, exact: true }).boundingBox();
  if (!b) throw new Error(`${name} is not on screen`);
  expect(b.width + 0.01, `${name} width`).toBeGreaterThanOrEqual(44);
  expect(b.height + 0.01, `${name} height`).toBeGreaterThanOrEqual(44);
}

test('on an enrolled bench browser, Lock hides the records until the same person unlocks, and Switch user hands the screen to a second person', async ({
  page,
}) => {
  const bench = `RD-BENCH-${test.info().project.name}-${randomUUID().slice(0, 8)}`;
  const sheet = page.locator('form.sheet');

  const description = `Metformin HCl tablets (fictional, bench ${test.info().project.name} ${randomUUID()})`;
  const record = page.getByText(description);

  await page.goto('/');
  await signIn(page, 'cora.customer');
  await page.getByRole('button', { name: 'Submit' }).click();
  await sheet.getByLabel('Method').selectOption({ index: 1 });
  await sheet.getByLabel('Sample description').fill(description);
  await sheet.getByRole('button', { name: 'Submit' }).click();
  await railSays(page, 'now Requested');
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(page, 'ada.admin');
  await expect(page.locator('.rail')).toContainText('Unregistered device');
  await page.getByRole('link', { name: 'Workstations' }).click();
  await page.getByRole('button', { name: 'Register Workstation' }).click();
  await sheet.getByLabel('Workstation name').fill(bench);
  await sheet.getByLabel('Room').selectOption({ label: 'LC-MS/MS Room (fictional)' });
  await sheet.getByLabel('Browser policy').fill('Managed Chrome; no saved passwords');
  await sheet.getByLabel('Reason').fill('New bench PC in the LC-MS/MS Room');
  await sheet.getByRole('button', { name: 'Register Workstation' }).click();
  await railSays(page, `Workstation ${bench} registered`);
  const row = page.getByRole('row', { name: new RegExp(bench) });
  await expect(row).toContainText('Not enrolled');

  await row.getByRole('button', { name: 'Choose to enrol' }).click();
  await page.getByRole('button', { name: 'Enrol this browser', exact: true }).click();
  await sheet.getByLabel('Reason').fill('Enrol the bench PC browser');
  await sheet.getByRole('button', { name: 'Enrol this browser' }).click();
  await railSays(page, `This browser is enrolled as ${bench}`);
  await expect(row).toContainText('Enrolled');
  await expect(page.getByText(`This browser is enrolled as Workstation ${bench}`)).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(page, 'ana.analyst');
  await expect(page.locator('.rail')).toContainText(`${bench} · LC-MS/MS Room (fictional)`);
  for (const name of ['Switch user', 'Lock', 'Sign out']) await atLeast44(page, name);
  await expect(record, 'the Test is on screen before the lock').toBeVisible();

  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Locked' })).toBeVisible();
  await expect(page.getByText(/this screen is locked; Ana Ferreira unlocks it/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tests' })).toHaveCount(0);
  await expect(record, 'no record content while locked').toHaveCount(0);
  await expect(page.locator('.rail')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Locked' }), 'a reload stays locked').toBeVisible();
  await expect(record, 'no record content after a reload while locked').toHaveCount(0);

  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toContainText('the credentials are not valid');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  await expect(page.locator('.rail')).toContainText('Ana Ferreira');

  await page.getByRole('button', { name: 'Switch user' }).click();
  await expect(page.getByRole('heading', { name: 'Switch user' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tests' })).toHaveCount(0);
  await expect(record, 'no record content while switching').toHaveCount(0);
  await expect(page.getByRole('radio'), 'on the Workstation only its Lab is offered').toHaveCount(1);
  await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
  await page.getByLabel('Username').fill('rui.reviewer');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in on this screen' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
  await expect(page.locator('.rail')).toContainText('Rui Tanaka');
  await expect(page.locator('.rail')).not.toContainText('Ana Ferreira');
  await expect(page.locator('.rail')).toContainText(bench);
});
