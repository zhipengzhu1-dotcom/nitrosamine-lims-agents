import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type Page, signOutFromRail, test } from './walk.ts';
import { DEMO_PASSWORD, E2E_DATABASE, SHOTS } from '../playwright.config.ts';

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

/** Signs `meaning` from the rail; `then` is what the rail's answer says of the version afterwards. */
async function sign(page: Page, meaning: string, username: string, then: string) {
  await page.getByRole('button', { name: `Sign ${meaning}` }).click();
  await expect(page.getByRole('heading', { name: `Sign ${meaning}` })).toBeVisible();
  await expect(page.locator('form.sheet')).toContainText('Effective Date: ');
  await page.getByLabel(/User ID/).fill(username);
  await page.getByLabel(/Password/).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: `Sign as ${meaning}` }).click();
  await railSays(page, `${meaning} Signature recorded in the Audit Trail. ${then}`);
  await sheetGone(page);
}

const labToday = () =>
  psql(`select to_char(now() at time zone time_zone, 'YYYY-MM-DD') from lims.lab where code = 'RD';`);

/** Writes a new SOP Draft from the vault's rail and returns the Document's id and number once it is open. */
async function writeDraft(page: Page, title: string, effectiveDate: string) {
  await page.goto('/#/documents');
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await page.getByRole('button', { name: 'New Document' }).click();
  await page.getByRole('combobox', { name: 'Type' }).selectOption('SOP');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Content', exact: true }).fill('Check the seal and the label.');
  await page.getByRole('textbox', { name: 'Effective Date', exact: true }).fill(effectiveDate);
  await page.locator('form.sheet').getByRole('button', { name: 'New Document' }).click();
  const heading = page.getByRole('heading', { name: /^RD-SOP-\d{4} Draft$/ });
  await expect(heading).toBeVisible();
  const id = /#\/documents\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
  const number = /RD-SOP-\d{4}/.exec((await heading.textContent()) ?? '')?.[0];
  if (!id || !number) throw new Error(`the new Document is not open: ${page.url()}`);
  return { id, number };
}

test('a Draft SOP becomes Effective through Authored, Reviewed and Approved by three people', async ({ page }) => {
  const today = labToday();
  const title = `Receiving samples (fictional, ${randomUUID().slice(0, 8)})`;

  await signIn(page, 'lena.manager');
  const { id } = await writeDraft(page, title, today);
  await expect(page.locator('dl.facts dt:text-is("Effective Date") + dd')).toHaveText(today);
  const commit = page.getByRole('button', { name: 'Sign Authored' });
  expect((await commit.boundingBox())?.height, 'a gloved finger can press it').toBeGreaterThanOrEqual(44);
  await sign(page, 'Authored', 'lena.manager', 'The version is now In Review.');
  await expect(page.getByRole('heading', { name: /^RD-SOP-\d{4} In Review$/ })).toBeVisible();
  await signOutFromRail(page);

  await signIn(page, 'rui.reviewer');
  await page.goto(`/#/documents/${id}`);
  await sign(page, 'Reviewed', 'rui.reviewer', "The version stays In Review for QA's Approved.");
  await signOutFromRail(page);

  await signIn(page, 'quinn.qa');
  await page.goto(`/#/documents/${id}`);
  await sign(page, 'Approved', 'quinn.qa', 'The version is now Effective.');
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

test('the author Abandons a Draft with a reason, and the vault keeps its Document number', async ({ page }) => {
  const title = `Weighing standards (fictional, ${randomUUID().slice(0, 8)})`;
  const reason = 'Rewritten as a Work Instruction (fictional).';

  await signIn(page, 'lena.manager');
  const { number } = await writeDraft(page, title, labToday());
  await expect(page.getByRole('button', { name: 'Sign Authored' })).toBeVisible();
  const abandon = page.getByRole('button', { name: 'Abandon', exact: true });
  expect((await abandon.boundingBox())?.height, 'a gloved finger can press it').toBeGreaterThanOrEqual(44);
  if (SHOTS) await page.screenshot({ path: `test-results/shots/documents-${test.info().project.name}-two-steps.png` });
  await abandon.click();
  await page.getByRole('textbox', { name: 'Reason', exact: true }).fill(reason);
  await page.locator('form.sheet').getByRole('button', { name: 'Abandon', exact: true }).click();
  await railSays(page, 'Abandon recorded in the Audit Trail. The version is now Abandoned.');
  await sheetGone(page);
  await expect(page.getByRole('heading', { name: `${number} Abandoned` })).toBeVisible();
  await expect(page.locator('dl.facts dt:text-is("Abandon reason") + dd')).toHaveText(reason);
  await expect(
    page.getByRole('button', { name: 'Abandon', exact: true }),
    'an Abandoned version has no step',
  ).toHaveCount(0);

  await page.goto('/#/documents');
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row.getByRole('link', { name: number })).toBeVisible();
  await expect(row.locator('.status')).toHaveText('Abandoned');
});
