import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page, signOutFromRail, submittedTest, test, utcThenLabClock } from './walk.ts';
import { DEMO_PASSWORD, E2E_DATABASE } from '../playwright.config.ts';

async function signIn(page: Page, username: string, lab = /R&D Laboratory/) {
  await page.getByRole('radio', { name: lab }).check();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
}

async function atLeast(target: Locator, width: number, height: number) {
  const b = await target.boundingBox();
  if (!b) throw new Error('the element is not on screen');
  expect(b.width + 0.01, 'touch target width').toBeGreaterThanOrEqual(width);
  expect(b.height + 0.01, 'touch target height').toBeGreaterThanOrEqual(height);
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
  const receivedOnWorklist = page.getByRole('row', { name: description }).locator('td[data-label="Received"]');
  await expect(receivedOnWorklist, 'the Worklist shows Received in UTC, then on the Lab wall clock').toHaveText(
    utcThenLabClock,
  );
  const received = await receivedOnWorklist.textContent();
  await openTheTest();
  await expect(
    page.locator('dl.facts dt:text-is("Received") + dd'),
    'the Test page shows the same Received',
  ).toHaveText(received ?? '');
  const trail = page.getByRole('region', { name: 'Audit Trail' });
  const entries = trail.getByRole('listitem');
  await expect(trail.getByRole('heading', { name: 'Audit Trail' })).toBeVisible();
  await expect(
    trail.getByText(
      /\d+ entries\. Times in UTC and on the Lab's zone in force when each was written, now America\/New_York\./,
    ),
  ).toBeVisible();
  const zone = trail.getByRole('link', { name: 'America/New_York' });
  await atLeast(zone, 44, 44);
  await zone.click();
  await expect(page.getByRole('heading', { level: 1 }), "the zone opens the Lab's own trail").toHaveText('Lab RD');
  await expect(
    page.getByRole('region', { name: 'Audit Trail' }).getByRole('listitem').first(),
    'where the Lab and its time zone were recorded',
  ).toContainText(/Time zone\s*America\/New_York/);
  await page.goBack();
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
    'Printed name at signing',
    'Username at signing',
    'Role at signing',
    'Record Version',
    'SHA-256 of the signed content',
    'Canonical form',
    'Signature statement version',
    'Signature statement hash',
    'Authenticator',
    'Session',
    'App release',
    'Re-authentication',
    'Signed at',
    'Signed in time zone',
  ]);
  await expect(signed.locator('dt:text-is("Signed in time zone") + dd')).toHaveText('America/New_York');
  await expect(signed.locator('dt:text-is("Signature statement hash") + dd summary')).toHaveText(/^[0-9a-f]{48}…$/);
  await expect(signed.locator('dt:text-is("Signed at") + dd')).toHaveText(
    /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC · \d{4}-\d\d-\d\d \d\d:\d\d:\d\d -0[45]:00$/,
  );
  const signedAt = await signed.locator('dt:text-is("Signed at") + dd').textContent();
  await expect(
    page.locator('td[data-label="Time"]'),
    "the Signatures table's Time is the Audit Trail's Signed at, in UTC then on the Lab wall clock",
  ).toHaveText([signedAt ?? '']);
  const receipt = entries.filter({ has: page.locator('dt:text-is("Received")') });
  await expect(
    receipt.locator('dt:text-is("Received") + dd'),
    "the trail's Received is the one the Test page shows",
  ).toHaveText(`none → ${received}`);
  await expect(receipt.locator('dt:text-is("Received in time zone") + dd')).toHaveText('none → America/New_York');
  // The Signature entry above it also has long values (its copied hashes), so the Record Version is found by its content.
  const versioned = entries.filter({ has: page.locator('details.long', { hasText: '"analyte"' }) }).first();
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
  await page.getByLabel(/User ID/).fill('rui.reviewer');
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
  await signOutFromRail(page);

  await signIn(page, 'quinn.qa');
  await page.goto(`/#/tests/${testId}`);
  const verify = page.getByRole('button', { name: 'Verify chain' });
  await atLeast(verify, 44, 44);
  await verify.click();
  await expect(page.locator('.verdict p')).toHaveText(
    /^Recomputed at \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\. Not anchored off-server \(demo\)\.$/,
  );
  await expect(page.locator('.chains li')).toHaveText([
    /^Lab chain Intact verified through entry \d+$/,
    /^Company chain Intact verified through entry \d+$/,
  ]);
  for (const status of await page.locator('.chains .status').all()) {
    await expect(status, 'intact reads in the ok colour').toHaveCSS('color', INTACT_COLOUR);
    await expect(status.locator('path'), 'and with the tick glyph').toHaveAttribute('d', TICK);
  }
  await signOutFromRail(page);

  await signIn(page, 'cora.customer');
  await page.goto(`/#/tests/${testId}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Reviewed');
  await expect(page.getByRole('region', { name: 'Audit Trail' })).toHaveCount(0);
});

const INTACT_COLOUR = 'rgb(23, 114, 74)';
const TICK = 'M3 8.5l3.5 3.5L13 4.5';

function giveQaTheQcLabAndAlterItsChain() {
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
  giveQaTheQcLabAndAlterItsChain();
  await page.goto('/');
  await signIn(page, 'quinn.qa', /QC Laboratory/);
  const { methods } = await (await page.request.get('/api/lookups')).json();
  await page.goto(`/#/trails/method/${methods[0].id}`);
  await page.getByRole('button', { name: 'Verify chain' }).click();
  const chains = page.locator('.chains > li');
  await expect(chains).toHaveCount(2);
  await expect(chains.first()).toContainText(/^Lab chain Broken intact through entry 0/);
  await expect(chains.first().locator('.breaks li').first()).toHaveText(
    /^entry 1 fails to verify, recorded as System Incident \w{8} Open$/,
  );
  await expect(chains.last()).toHaveText(/^Company chain Intact verified through entry \d+$/);
  const [broken, intact] = [chains.first().locator('.status').first(), chains.last().locator('.status')];
  await expect(broken).toHaveCSS('color', 'rgb(179, 38, 30)');
  await expect(intact).toHaveCSS('color', INTACT_COLOUR);
  await expect(broken.locator('path')).toHaveAttribute('d', 'M4 4l8 8M12 4l-8 8');
  await expect(intact.locator('path')).toHaveAttribute('d', TICK);
  await signOutFromRail(page);
});

/** Writes one more entry on the QC Lab's chain and alters it, so this run has a break of its own; returns its entry. */
function breakANewQcEntry(): string {
  giveQaTheQcLabAndAlterItsChain();
  const printed = execFileSync(
    '../../scripts/pg.sh',
    ['psql', '-qAt', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-d', E2E_DATABASE],
    {
      input: `select set_config('lims.actor', 'svc:e2e', true), set_config('lims.role', 'system', true),
                     set_config('lims.reason', 'Write an entry on the QC Lab chain to break (e2e)', true);
              update lims.lab set name = name where code = 'QC';
              set local session_replication_role = replica;
              update lims.audit_entry set reason = 'Altered behind the chain (e2e)'
               where chain = (select lab_id::text from lims.lab where code = 'QC')
                 and seq = (select max(seq) from lims.audit_entry
                             where chain = (select lab_id::text from lims.lab where code = 'QC'))
              returning seq;`,
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  );
  return printed.toString().trim().split('\n').at(-1) ?? '';
}

function closeQcIncidentAt(entry: string) {
  execFileSync(
    '../../scripts/pg.sh',
    ['psql', '-q', '-v', 'ON_ERROR_STOP=1', '-v', `entry=${entry}`, '--single-transaction', '-d', E2E_DATABASE],
    {
      input: `select set_config('lims.actor', 'svc:e2e', true), set_config('lims.role', 'system', true),
                     set_config('lims.reason', 'Close a System Incident (e2e)', true);
              update lims.system_incident set state = 'Closed'
               where chain = (select lab_id::text from lims.lab where code = 'QC') and first_failure = :entry;`,
      stdio: ['pipe', 'ignore', 'inherit'],
    },
  );
}

test('QA verifying a chain whose break has a Closed System Incident still sees Broken, with that incident marked Closed', async ({
  page,
}) => {
  const entry = breakANewQcEntry();
  expect(entry).toMatch(/^\d+$/);
  await page.goto('/');
  await signIn(page, 'quinn.qa', /QC Laboratory/);
  const { methods } = await (await page.request.get('/api/lookups')).json();
  await page.goto(`/#/trails/method/${methods[0].id}`);
  const verify = page.getByRole('button', { name: 'Verify chain' });
  const own = page
    .locator('.chains > li')
    .first()
    .locator('.breaks li', { hasText: `entry ${entry} fails` });

  await verify.click();
  await expect(own).toHaveText(new RegExp(`^entry ${entry} fails to verify, recorded as System Incident \\w{8} Open$`));
  const incident = /System Incident (\w{8})/.exec((await own.textContent()) ?? '')?.[1];

  closeQcIncidentAt(entry);
  await verify.click();
  await expect(own).toHaveText(`entry ${entry} fails to verify, recorded as System Incident ${incident} Closed`);
  await expect(page.locator('.chains > li').first().locator('.status').first()).toHaveText('Broken');
  await signOutFromRail(page);
});
