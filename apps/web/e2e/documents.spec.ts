import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type Page, signOutFromRail, test } from './walk.ts';
import { DEMO_PASSWORD, E2E_DATABASE } from '../playwright.config.ts';

const psql = (script: string, variables: Record<string, string> = {}) =>
  execFileSync(
    '../../scripts/pg.sh',
    [
      'psql',
      '-d',
      E2E_DATABASE,
      '-qtA',
      ...Object.entries(variables).flatMap(([name, value]) => ['-v', `${name}=${value}`]),
    ],
    { input: script, encoding: 'utf8' },
  ).trim();

async function signIn(page: Page, username: string) {
  await page.goto('/');
  await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
}

const railSays = (page: Page, text: string | RegExp) => expect(page.getByRole('status')).toContainText(text);
const sheetGone = (page: Page) => expect(page.locator('form.sheet')).toHaveCount(0);

async function sign(page: Page, meaning: string, username: string, then: string) {
  await page.getByRole('button', { name: `Sign ${meaning}` }).click();
  await expect(page.getByRole('heading', { name: `Sign ${meaning}` })).toBeVisible();
  await expect(page.locator('form.sheet')).toContainText('Effective Date: ');
  await page.getByLabel(/User ID/).fill(username);
  await page.getByLabel(/Password/).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: `Sign as ${meaning}` }).click();
  await railSays(page, `${meaning} Signature recorded in the Audit Trail. The version is now ${then}.`);
  await sheetGone(page);
}

test('a Draft SOP becomes Effective through Authored, Reviewed and Approved by three people', async ({ page }) => {
  const today = psql(`select to_char(now() at time zone time_zone, 'YYYY-MM-DD') from lims.lab where code = 'RD';`);
  const title = `Receiving samples (fictional, ${randomUUID().slice(0, 8)})`;

  await signIn(page, 'lena.manager');
  await page.goto('/#/documents');
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await page.getByRole('button', { name: 'New Document' }).click();
  await page.getByRole('combobox', { name: 'Type' }).selectOption('SOP');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Content', exact: true }).fill('Check the seal and the label.');
  await page.getByRole('textbox', { name: 'Effective Date', exact: true }).fill(today);
  await page.locator('form.sheet').getByRole('button', { name: 'New Document' }).click();
  await expect(page.getByRole('heading', { name: /^RD-SOP-\d{4} Draft$/ })).toBeVisible();
  const id = /#\/documents\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
  if (!id) throw new Error(`the new Document is not open: ${page.url()}`);
  await expect(page.locator('dl.facts dt:text-is("Effective Date") + dd')).toHaveText(today);
  const commit = page.getByRole('button', { name: 'Sign Authored' });
  expect((await commit.boundingBox())?.height, 'a gloved finger can press it').toBeGreaterThanOrEqual(44);
  await sign(page, 'Authored', 'lena.manager', 'In Review');
  await expect(page.getByRole('heading', { name: /^RD-SOP-\d{4} In Review$/ })).toBeVisible();
  await signOutFromRail(page);

  await signIn(page, 'rui.reviewer');
  await page.goto(`/#/documents/${id}`);
  await sign(page, 'Reviewed', 'rui.reviewer', 'In Review');
  await signOutFromRail(page);

  await signIn(page, 'quinn.qa');
  await page.goto(`/#/documents/${id}`);
  await sign(page, 'Approved', 'quinn.qa', 'Effective');
  await expect(page.getByRole('heading', { name: /^RD-SOP-\d{4} Effective$/ })).toBeVisible();

  await page.goto('/#/documents');
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row.locator('.status')).toHaveText('Effective');

  expect(
    psql(
      `select v.status || '|' || to_char(v.effective_date, 'YYYY-MM-DD') || '|' ||
              string_agg(s.meaning || ':' || s.username, ',' order by s.signed_at)
         from lims.document_version v
         join lims.record_version r on r.record_table = 'document_version' and r.record_id = v.id
         join lims.signature s on s.lab_id = r.lab_id and s.record_version_id = r.id
        where v.document_id = :'id' group by v.status, v.effective_date;`,
      { id },
    ),
    'the database holds the Effective version with three Signatures by three people',
  ).toBe(`Effective|${today}|Authored:lena.manager,Reviewed:rui.reviewer,Approved:quinn.qa`);
});
