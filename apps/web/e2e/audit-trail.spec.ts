import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page, test } from './walk.ts';
import { DEMO_PASSWORD, E2E_DATABASE } from '../playwright.config.ts';

async function signIn(page: Page, username: string, lab = /R&D Laboratory/) {
  await page.getByRole('radio', { name: lab }).check();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

async function atLeast(target: Locator, width: number, height: number) {
  const b = await target.boundingBox();
  if (!b) throw new Error('the element is not on screen');
  expect(b.width + 0.01, 'touch target width').toBeGreaterThanOrEqual(width);
  expect(b.height + 0.01, 'touch target height').toBeGreaterThanOrEqual(height);
}

async function submittedTest(page: Page, description: string): Promise<string> {
  const labs: { id: string; code: string }[] = await (await page.request.get('/api/labs')).json();
  const labId = labs.find((lab) => lab.code === 'RD')?.id;
  const as = async (username: string) => {
    await page.request.post('/api/logout', { data: {} });
    const res = await page.request.post('/api/login', { data: { username, password: DEMO_PASSWORD, labId } });
    expect(res.ok(), `sign in as ${username}: ${res.status()} ${await res.text()}`).toBe(true);
  };
  const step = async (name: string, body: object) => {
    const res = await page.request.post(`/api/steps/${name}`, { data: { commitKey: randomUUID(), ...body } });
    expect(res.ok(), `${name}: ${await res.text()}`).toBe(true);
    return res.json();
  };
  await as('cora.customer');
  const { methods } = await (await page.request.get('/api/lookups')).json();
  const { testId } = await step('submit', { input: { methodId: methods[0].id, description } });
  await as('samir.custodian');
  await step('receive', { testId, input: {} });
  await as('lena.manager');
  const { analysts } = await (await page.request.get('/api/lookups')).json();
  const ana = analysts.find((a: { displayName: string }) => a.displayName === 'Ana Ferreira');
  await step('assign', { testId, input: { assigneeId: ana.id } });
  await as('ana.analyst');
  await step('enterResult', {
    testId,
    input: {
      analyte: 'NDMA',
      value: '0.0300',
      unit: 'ppm',
      injectionSequenceRef: 'SEQ-2026-0042',
      notebookRef: 'RD-NB-0007-012',
      performedOn: '2026-09-30',
    },
    signature: { password: DEMO_PASSWORD },
  });
  await page.request.post('/api/logout', { data: {} });
  return testId;
}

test('a Reviewer reads, filters and expands a Test trail and opens a raw entry; QA verifies the chain', async ({
  page,
}) => {
  const description = `Metformin HCl 500 mg tablets, lot NW-0043 (fictional, ${test.info().project.name} ${randomUUID()})`;
  await page.goto('/');
  const testId = await submittedTest(page, description);
  const openTheTest = async () => {
    await page.getByRole('row', { name: description }).getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Submitted For Review');
  };

  await page.reload();
  await signIn(page, 'rui.reviewer');
  await openTheTest();
  const trail = page.getByRole('region', { name: 'Audit Trail' });
  const entries = trail.getByRole('listitem');
  await expect(trail.getByRole('heading', { name: 'Audit Trail' })).toBeVisible();
  await expect(trail.getByText(/\d+ entries\. Times in UTC and in the Lab's zone, America\/New_York\./)).toBeVisible();
  await expect(entries.first()).toContainText('Company chain');
  await expect(entries.first()).toContainText('Cora Lindqvist (Customer) created the Submission');
  await expect(entries.first().locator('.entry__time')).toHaveText(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC$/);
  const assigned = entries.filter({ hasText: 'Analyst' }).filter({ hasText: 'Lena Varga' });
  await expect(assigned).toContainText('Lab chain');
  await expect(assigned).toContainText('Lena Varga (Lab Manager) changed the Test RD-S');
  await expect(assigned).toContainText('reason: assign');
  await expect(assigned.locator('.changes dt')).toHaveText(['Analyst']);
  await expect(assigned.locator('.changes dd')).toHaveText(['none → Ana Ferreira']);
  await expect(assigned.locator('.entry__time')).toHaveText(/UTC · \d{4}-\d\d-\d\d \d\d:\d\d:\d\d -0[45]:00$/);
  const total = await entries.count();

  const search = page.getByLabel('Search the trail');
  await atLeast(search, 44, 44);
  await search.fill('Lena Varga');
  await expect(entries).toHaveCount(2);
  await expect(trail.getByText(`2 of ${total} entries. Times in UTC`)).toBeVisible();
  await expect(entries.first().locator('.changes')).toContainText(/State\s*Ready → Assigned/);
  await search.fill('');
  await expect(entries).toHaveCount(total);
  await expect(trail.getByText(`${total} entries. Times in UTC`)).toBeVisible();
  await expect(
    page.locator('td[data-label="Record"]'),
    'the Signatures table names the signed record by its glossary noun',
  ).toHaveText(['Test']);

  await page.getByLabel('Order').selectOption('Newest first');
  await expect(entries.first()).toContainText('Signature Performed');
  const signed = entries.first();
  await expect(signed.locator('.changes dt')).toHaveText([
    'Meaning',
    'Signer',
    'Username',
    'Printed name',
    'Record Version',
    'Signed at',
  ]);
  await expect(signed.locator('dt:text-is("Signed at") + dd')).toHaveText(
    /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC · \d{4}-\d\d-\d\d \d\d:\d\d:\d\d -0[45]:00$/,
  );
  const versioned = entries.filter({ has: page.locator('details.long') }).first();
  await expect(versioned).toContainText('Record Version');
  await expect(versioned.locator('dt:text-is("Record kind") + dd')).toHaveText('Test');
  await expect(versioned.locator('dt:text-is("Saved at") + dd')).toHaveText(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC · /);
  await expect(versioned.locator('dt:text-is("SHA-256 of the content") + dd summary')).toHaveText(/^[0-9a-f]{48}…$/);
  await expect(versioned.locator('details.long'), 'the signed Record Version and its SHA-256 are long').toHaveCount(2);
  const long = versioned.locator('details.long').first();
  await expect(long.locator('summary')).toContainText('…');
  await atLeast(long.locator('summary'), 44, 44);
  await long.locator('summary').click();
  await expect(long).toContainText(`"analyte": "NDMA"`);
  await expect(long).toContainText(`"description": "${description}"`);

  const rawButton = signed.getByRole('button', { name: /^Raw entry \d+$/ });
  await atLeast(rawButton, 44, 44);
  await rawButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /^Raw entry \d+, Lab chain$/ })).toBeVisible();
  await expect(dialog.locator('pre')).toContainText(/"hash": "[0-9a-f]{64}"/);
  await expect(dialog.locator('pre')).toContainText('"record_version_id": "');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();

  await expect(trail.getByRole('button', { name: 'Verify chain' })).toHaveCount(0);
  await page.getByLabel('Order').selectOption('Oldest first');
  await search.fill('Reviewed');
  await expect(entries).toHaveCount(0);
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByLabel(/Password/).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign as Reviewed' }).click();
  await expect(page.getByRole('status')).toContainText('now Reviewed');
  await expect(entries, 'the Test state move and the Reviewed Signature arrive without a reload').toHaveCount(2);
  await expect(entries.last()).toContainText('Rui Tanaka (Reviewer) created the Signature Reviewed');
  await expect(entries.last()).toHaveClass(/entry--fresh/);
  await search.fill('');
  await entries
    .filter({ hasText: 'created the Test RD-S' })
    .getByRole('link', { name: /^RD-MTH-0001 v1$/ })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Method RD-MTH-0001 v1');
  await expect(page.getByRole('region', { name: 'Audit Trail' }).getByRole('listitem')).toHaveCount(1);
  await signOut(page);

  await signIn(page, 'quinn.qa');
  await page.goto(`/#/tests/${testId}`);
  const verify = page.getByRole('button', { name: 'Verify chain' });
  await atLeast(verify, 44, 44);
  await verify.click();
  await expect(page.locator('.verdict p')).toHaveText(
    /^Recomputed at \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\. Not anchored off-server \(demo\)\.$/,
  );
  await expect(page.locator('.chains li')).toHaveText([
    /^Lab chain Intact intact through entry \d+$/,
    /^Company chain Intact intact through entry \d+$/,
  ]);
  for (const status of await page.locator('.chains .status').all()) {
    await expect(status, 'intact reads in the ok colour').toHaveCSS('color', INTACT_COLOUR);
    await expect(status.locator('path'), 'and with the tick glyph').toHaveAttribute('d', TICK);
  }
  await signOut(page);

  await signIn(page, 'cora.customer');
  await page.goto(`/#/tests/${testId}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Reviewed');
  await expect(page.getByRole('region', { name: 'Audit Trail' })).toHaveCount(0);
});

const INTACT_COLOUR = 'rgb(23, 114, 74)';
const TICK = 'M3 8.5l3.5 3.5L13 4.5';

/** Gives quinn.qa QA in the QC Lab and alters the QC chain's first entry behind the chain. Repeating it changes nothing more. */
function breakTheQcChain() {
  execFileSync(
    '../../scripts/pg.sh',
    ['psql', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-d', E2E_DATABASE],
    {
      input: `select set_config('lims.actor', 'svc:e2e', true), set_config('lims.role', 'system', true),
                   set_config('lims.reason', 'Give QA a Membership in the QC Lab (e2e)', true);
            insert into lims.membership (lab_id, person_id, role)
              select lab.lab_id, person.id, 'QA' from lims.lab, lims.person
               where lab.code = 'QC' and person.username = 'quinn.qa'
            on conflict do nothing;
            set local session_replication_role = replica;
            update lims.audit_entry set reason = 'Altered behind the chain (e2e)'
             where seq = 1 and chain = (select lab_id::text from lims.lab where code = 'QC');`,
      stdio: ['pipe', 'ignore', 'inherit'],
    },
  );
}

test('QA verifying a broken chain sees Broken beside that chain, in its own glyph and colour, and Intact beside the other', async ({
  page,
}) => {
  breakTheQcChain();
  await page.goto('/');
  await signIn(page, 'quinn.qa', /QC Laboratory/);
  const { methods } = await (await page.request.get('/api/lookups')).json();
  await page.goto(`/#/trails/method/${methods[0].id}`);
  await page.getByRole('button', { name: 'Verify chain' }).click();
  const chains = page.locator('.chains li');
  await expect(chains).toHaveText([
    /^Lab chain Broken entry 1 fails to verify; intact through entry 0$/,
    /^Company chain Intact intact through entry \d+$/,
  ]);
  const [broken, intact] = [chains.first().locator('.status'), chains.last().locator('.status')];
  await expect(broken).toHaveCSS('color', 'rgb(179, 38, 30)');
  await expect(intact).toHaveCSS('color', INTACT_COLOUR);
  await expect(broken.locator('path')).toHaveAttribute('d', 'M4 4l8 8M12 4l-8 8');
  await expect(intact.locator('path')).toHaveAttribute('d', TICK);
  await signOut(page);
});
