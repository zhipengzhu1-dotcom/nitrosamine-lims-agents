import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { type RouteReply, routes } from '@lims/domain';
import { expect, type Page, signInByApi, signOutFromRail, test } from './walk.ts';
import { DEMO_PASSWORD, E2E_DATABASE } from '../playwright.config.ts';

const PROBE = 'E2E-INCIDENT-PROBE';
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

test.beforeAll(() => {
  psql(`do $$ begin
          alter table lims.sample add constraint e2e_incident_probe check (description not like '%E2E-INCIDENT-PROBE%');
        exception when duplicate_object then null;
        end $$;`);
});

/** An UnexpectedFailure System Incident of the R&D Lab, opened by a Submit the probe constraint refuses. */
async function failedSubmit(page: Page): Promise<string> {
  await signInByApi(page, 'cora.customer');
  const lookups: RouteReply<typeof routes.lookups> = await (await page.request.get('/api/lookups')).json();
  const [method] = lookups.methods;
  if (!method) throw new Error('the lookups offer no Method to submit a Test under');
  const res = await page.request.post('/api/steps/submit', {
    data: {
      commitKey: randomUUID(),
      input: { methodId: method.id, description: `Metformin HCl tablets (fictional, ${PROBE} ${randomUUID()})` },
    },
  });
  expect(res.status(), 'the probe fails the Submit').toBe(500);
  const reference = /reference (\w{8})/.exec(await res.text())?.[1];
  if (!reference) throw new Error('the failure names no System Incident');
  return reference;
}

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

async function openIncident(page: Page, reference: string) {
  await page.getByRole('link', { name: 'Incidents' }).click();
  await expect(page.getByRole('heading', { name: 'Incidents' })).toBeVisible();
  const open = page.getByRole('link', { name: reference, exact: true });
  expect((await open.boundingBox())?.height, 'a gloved finger can press it').toBeGreaterThanOrEqual(44);
  await open.click();
  await expect(page.getByRole('heading', { name: new RegExp(`^${reference} `) })).toBeVisible();
}

test('QA answers an incident from the list, then the Admin records the actions, signs Acknowledged and closes it', async ({
  page,
}) => {
  const reference = await failedSubmit(page);
  await page.request.post('/api/logout', { data: {} });

  await signIn(page, 'quinn.qa');
  await openIncident(page, reference);
  await expect(page.getByRole('heading', { name: new RegExp(`^${reference} Open`) })).toBeVisible();
  await page.getByRole('button', { name: 'Answer impact' }).click();
  await page.getByLabel('Could this have affected results or records?').selectOption('No');
  await page.locator('form.sheet').getByRole('button', { name: 'Answer impact' }).click();
  await railSays(page, "QA's answer is recorded in the Audit Trail.");
  await sheetGone(page);
  await expect(page.locator(`dl.facts dt:text-is("QA's answer") + dd`)).toContainText('No');
  await expect(page.locator('.rbtn--commit'), 'QA has no further step on the incident').toHaveCount(0);
  await signOutFromRail(page);

  await signIn(page, 'ada.admin');
  await openIncident(page, reference);
  await page.getByRole('button', { name: 'Record immediate action' }).click();
  await page.getByLabel('Immediate action', { exact: true }).fill('Stopped the bench and reran the entry.');
  await page.locator('form.sheet').getByRole('button', { name: 'Record immediate action' }).click();
  await railSays(page, 'The immediate action is recorded in the Audit Trail.');
  await sheetGone(page);

  await page.getByRole('button', { name: 'Record corrective action' }).click();
  await page.getByLabel('Corrective action', { exact: true }).fill('Added a check on the Sample description.');
  await page.locator('form.sheet').getByRole('button', { name: 'Record corrective action' }).click();
  await railSays(page, 'The corrective action is recorded in the Audit Trail.');
  await sheetGone(page);

  await page.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(page.getByRole('heading', { name: 'Sign Acknowledged' })).toBeVisible();
  await expect(page.locator('form.sheet')).toContainText("QA's answer: No");
  await page.getByLabel(/User ID/).fill('ada.admin');
  await page.getByLabel(/Password/).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign as Acknowledged' }).click();
  await railSays(page, 'The System Incident is Acknowledged.');
  await sheetGone(page);
  await expect(page.getByRole('heading', { name: new RegExp(`^${reference} Acknowledged`) })).toBeVisible();
  await expect(page.locator('dl.facts dt:text-is("Acknowledged") + dd')).toContainText('Ada Novak (ada.admin, Admin)');

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await railSays(page, 'The System Incident is Closed.');
  await expect(page.getByRole('heading', { name: new RegExp(`^${reference} Closed`) })).toBeVisible();
  await expect(page.locator('.split__list').getByRole('link', { name: reference, exact: true })).toHaveCount(0);

  expect(
    psql(
      `select i.state || '|' || i.impact_answer || '|' || s.meaning || '|' || s.role
         from lims.system_incident i
         join lims.record_version v on v.record_table = 'system_incident' and v.record_id = i.id
         join lims.signature s on s.lab_id = v.lab_id and s.record_version_id = v.id
        where i.reference = :'reference';`,
      { reference },
    ),
    'the database holds the Closed incident with its Acknowledged Signature',
  ).toBe('Closed|No|Acknowledged|Admin');

  await expect(page.locator('dl.facts dt:text-is("Acknowledged") + dd .status')).toHaveCount(0);
  psql(
    `begin;
     set local session_replication_role = replica;
     update lims.system_incident set corrective_action = 'Altered behind the triggers (e2e)' where reference = :'reference';
     commit;`,
    { reference },
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: new RegExp(`^${reference} `) }).locator('.status')).toHaveText([
    'Closed',
    'Signatures unsigned',
  ]);
  await expect(page.locator('dl.facts dt:text-is("Acknowledged") + dd .status')).toHaveText('Unsigned');
  await railSays(page, 'Unsigned: Acknowledged. The record changed after signing.');
});
