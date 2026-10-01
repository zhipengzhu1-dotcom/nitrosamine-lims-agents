import { expect, type Page, test } from '@playwright/test';
import { DEMO_PASSWORD, SHOTS } from '../playwright.config.ts';

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `../../docs/design/thin-slice-shots/${name}.png` });
};

async function signIn(page: Page, username: string) {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

async function openTheTest(page: Page) {
  await page.getByRole('link', { name: /^RD-S\d{5}$/ }).click();
}

const railSays = (page: Page, text: string | RegExp) => expect(page.getByRole('status')).toContainText(text);
const sign = async (page: Page, meaning: string, password = DEMO_PASSWORD) => {
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole('button', { name: `Sign as ${meaning}` }).click();
};

test('the whole chain through the UI, ending in a Test Report with three Signatures', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await shot(page, 'sign-in');

  await signIn(page, 'cora.customer');
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByLabel('Method').selectOption({ index: 1 });
  await page.getByLabel('Sample description').fill('Metformin HCl 500 mg tablets, lot NW-0042 (fictional)');
  await page.getByRole('button', { name: 'Submit' }).click();
  await railSays(page, 'now Requested');
  await expect(page.getByRole('row', { name: /Requested/ })).toBeVisible();
  await signOut(page);

  await signIn(page, 'samir.custodian');
  await openTheTest(page);
  await page.getByRole('button', { name: 'Receive' }).click();
  await railSays(page, 'now Ready');
  await signOut(page);

  await signIn(page, 'lena.manager');
  await shot(page, 'worklist');
  await openTheTest(page);
  await page.getByRole('button', { name: 'Assign' }).click();
  await page.getByLabel('Analyst').selectOption({ label: 'Ana Ferreira' });
  await page.getByRole('button', { name: 'Assign' }).click();
  await railSays(page, 'now Assigned');
  await signOut(page);

  await signIn(page, 'ana.analyst');
  await openTheTest(page);
  await page.getByRole('button', { name: 'Enter Result' }).click();
  const result = {
    Analyte: 'NDMA',
    'Result as written': '0.0300',
    Unit: 'ppm',
    'Injection sequence': 'SEQ-2026-0042',
    'Notebook reference': 'RD-NB-0007-012',
    'Performed on': '2026-09-30',
  };
  for (const [label, value] of Object.entries(result)) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel(/Password/).fill(DEMO_PASSWORD);
  await shot(page, 'test-signature-sheet');
  await sign(page, 'Performed');
  await railSays(page, 'now Submitted For Review');
  await signOut(page);

  await signIn(page, 'rui.reviewer');
  await openTheTest(page);
  await page.getByRole('button', { name: 'Review' }).click();
  await sign(page, 'Reviewed', 'not-the-password');
  await railSays(page, 'Refused: the credentials are not valid. Nothing has been signed.');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Submitted For Review');
  await page.getByRole('button', { name: 'Review' }).click();
  await sign(page, 'Reviewed');
  await railSays(page, 'now Reviewed');
  await signOut(page);

  await signIn(page, 'quinn.qa');
  await openTheTest(page);
  await page.getByRole('button', { name: 'Release' }).click();
  await sign(page, 'Released');
  await railSays(page, 'now Reported');
  await page.getByRole('link', { name: /^RD-R\d{5}$/ }).click();
  await expect(page.getByRole('heading', { name: /Test Report RD-R\d{5}/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: '0.0300', exact: true })).toBeVisible();
  for (const [meaning, signer] of [
    ['Performed', 'Ana Ferreira'],
    ['Reviewed', 'Rui Tanaka'],
    ['Released', 'Quinn Adeyemi'],
  ]) {
    await expect(page.getByRole('row', { name: new RegExp(`^${meaning} ${signer}`) })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Verify Audit Trail' }).click();
  await railSays(
    page,
    'Lab chain internally consistent, company chain internally consistent. Not anchored off-server (demo).',
  );
  await railSays(page, /Recomputed at \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC:/);
  await shot(page, 'test-report');
});
