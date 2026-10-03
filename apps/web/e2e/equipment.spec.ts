import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { expect, type Page, signOutFromRail, test } from './walk.ts';
import { DEMO_PASSWORD, E2E_DATABASE, SHOTS } from '../playwright.config.ts';

const psql = (script: string, variables: Record<string, string>) =>
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

const railSays = (page: Page, text: string) => expect(page.getByRole('status')).toContainText(text);
const sheet = (page: Page) => page.locator('form.sheet');
const logbook = (page: Page) => page.locator('h2:text-is("Logbook") + table tbody tr');
const signatures = (page: Page) => page.locator('h2:text-is("Signatures") + table tbody tr');
/** A shown Signature time: UTC to the second, then the Lab's wall clock with its offset. */
const utcThenLab = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC · \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}/;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A Logbook line's Signature: Meaning, the printed name as signed with username and role, and when. */
const signedBy = (meaning: string, signer: string) =>
  new RegExp(`${meaning}\\s*by ${escaped(signer)}, ${utcThenLab.source}`);

async function openEquipment(page: Page, name: string) {
  await page.getByRole('link', { name: 'Equipment', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Equipment', exact: true })).toBeVisible();
  const open = page.getByRole('link', { name, exact: true });
  expect((await open.boundingBox())?.height, 'a gloved finger can press it').toBeGreaterThanOrEqual(44);
  await open.click();
  await expect(page.getByRole('heading', { name: new RegExp(`^${name} `) })).toBeVisible();
  if (test.info().project.name !== 'desktop') return;
  const beside = page.locator('.row--open').getByRole('link', { name, exact: true });
  expect(
    (await beside.boundingBox())?.height,
    'the list beside the open record keeps gloved-finger rows',
  ).toBeGreaterThanOrEqual(44);
}

/**
 * Every Status in the Logbook keeps its word and glyph together on one line, on a phone's stacked rows too: the row's
 * grid must take the whole line as one cell, or the glyph is squeezed into a column of its own.
 */
async function logbookStatusesHold(page: Page) {
  const statuses = logbook(page).locator('.status');
  expect(await statuses.count(), 'the Logbook shows a Status').toBeGreaterThan(0);
  for (const status of await statuses.all()) {
    await expect(status).toBeVisible();
    const line = await status.boundingBox();
    expect(line?.height, 'the Status word and glyph sit on one line').toBeLessThan(28);
    const glyph = await status.locator('.glyph').boundingBox();
    expect(glyph?.width, 'the glyph keeps its width').toBeGreaterThanOrEqual(12);
  }
}

/** Before a shot: let the sheet finish sliding in and bring the part the shot is about into view. */
async function settle(page: Page, show: string) {
  const open = sheet(page);
  if (await open.count())
    await open.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  await page.locator(show).last().scrollIntoViewIfNeeded();
}

test('the Lab Manager registers a balance, QA approves it, an Analyst records a signed Event, and each Signature shows', async ({
  page,
}) => {
  const project = test.info().project.name;
  const suffix = randomBytes(3).toString('hex');
  const name = `Balance ${project}-${suffix}`;
  const shot = async (what: string, show: string) => {
    if (!SHOTS) return;
    await settle(page, show);
    await page.screenshot({ path: `test-results/shots/equipment-${project}-${what}.png`, fullPage: true });
  };

  await signIn(page, 'lena.manager');
  await page.getByRole('link', { name: 'Equipment', exact: true }).click();
  await page.getByRole('button', { name: 'Register Equipment' }).click();
  await sheet(page).getByLabel('Kind').fill('Analytical balance');
  await sheet(page).getByLabel('Equipment name').fill(name);
  await sheet(page).getByLabel('Manufacturer').fill('Fictional Weighing Co.');
  await sheet(page).getByLabel('Model').fill('FW-220');
  await sheet(page).getByLabel('Serial number').fill(`SN-${suffix}`);
  await sheet(page).getByLabel('Room').selectOption({ label: 'LC-MS/MS Room (fictional)' });
  await sheet(page).getByLabel('Responsible Person').selectOption({ label: 'Lena Varga (lena.manager)' });
  await expect(sheet(page).getByLabel('Equipment name'), 'a field keeps 16px text so a phone does not zoom').toHaveCSS(
    'font-size',
    '16px',
  );
  await shot('register', 'form.sheet .sheet__foot');
  await sheet(page).getByRole('button', { name: 'Register Equipment' }).click();
  await railSays(page, `Equipment ${name} registered in the Audit Trail.`);
  await expect(sheet(page)).toHaveCount(0);

  await openEquipment(page, name);
  await expect(page.getByRole('heading', { name: new RegExp(`^${name} Quarantined`) })).toBeVisible();
  await expect(logbook(page)).toHaveCount(1);
  await expect(logbook(page).first()).toContainText('Registered');
  await expect(logbook(page).first()).toContainText('Lena Varga (lena.manager)');
  await expect(page.locator('.rbtn--commit'), 'only QA approves Equipment for use').not.toHaveText(/Approve/);
  await logbookStatusesHold(page);
  await shot('quarantined', 'h2:text-is("Logbook") + table');
  await signOutFromRail(page);

  await signIn(page, 'quinn.qa');
  await openEquipment(page, name);
  await expect(page.getByRole('radio', { name: 'Approve for use' })).toBeChecked();
  await page.getByRole('button', { name: 'Approve for use' }).click();
  await expect(page.getByRole('heading', { name: 'Sign Approved' })).toBeVisible();
  await expect(sheet(page)).toContainText(`serial SN-${suffix}`);
  await page.getByLabel(/User ID/).fill('quinn.qa');
  await page.getByLabel(/Password/).fill(DEMO_PASSWORD);
  await shot('sign-approved', 'form.sheet input[type=password]');
  await page.getByRole('button', { name: 'Sign as Approved' }).click();
  await railSays(page, 'Approved Signature recorded in the Audit Trail. The Equipment is In use.');
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: new RegExp(`^${name} In use`) })).toBeVisible();
  await expect(logbook(page)).toHaveCount(2);
  await expect(logbook(page).nth(1)).toContainText('Quarantined to In use');
  await expect(logbook(page).nth(1)).toContainText('Quinn Adeyemi (quinn.qa)');
  await expect(logbook(page).nth(1), 'the In use line shows the Approved Signature').toContainText(
    signedBy('Approved', 'Quinn Adeyemi (quinn.qa, QA)'),
  );
  await expect(signatures(page)).toHaveCount(1);
  await expect(signatures(page).first(), 'the Equipment shows its Approved Signature').toContainText('Approved');
  await expect(signatures(page).first()).toContainText('Quinn Adeyemi (quinn.qa, QA)');
  await expect(signatures(page).first()).toContainText(utcThenLab);
  await logbookStatusesHold(page);
  await shot('in-use', 'h2:text-is("Logbook") + table');
  expect(
    psql(
      `select e.fitness_status || '|' || s.meaning || '|' || s.role
         from lims.equipment e
         join lims.record_version v on v.record_table = 'equipment' and v.record_id = e.id
         join lims.signature s on s.lab_id = v.lab_id and s.record_version_id = v.id
        where e.name = :'name';`,
      { name },
    ),
    'the database holds the In use Equipment with its Approved Signature',
  ).toBe('InUse|Approved|QA');

  await signOutFromRail(page);

  await signIn(page, 'ana.analyst');
  await openEquipment(page, name);
  await page.getByRole('radio', { name: 'Record Equipment Event' }).check();
  await page.getByRole('button', { name: 'Record Equipment Event' }).click();
  await sheet(page).getByLabel('Kind').selectOption({ label: 'Firmware Change' });
  await sheet(page).getByLabel('What was done').fill('Flashed the vendor firmware.');
  await sheet(page)
    .getByLabel(/Version now installed/)
    .fill('1.0.7');
  await expect(page.getByRole('heading', { name: 'Sign Performed' })).toBeVisible();
  const signing = sheet(page).locator('section.card').first();
  await expect(signing, 'the sheet names the Equipment Event being signed').toContainText(
    'The Equipment Event this signing records in the Logbook',
  );
  await expect(signing).toContainText('Kind: Firmware Change');
  await expect(signing).toContainText('What was done: Flashed the vendor firmware.');
  await page.getByLabel(/User ID/).fill('ana.analyst');
  await page.getByLabel(/Password/).fill(DEMO_PASSWORD);
  await shot('sign-performed', 'form.sheet section.card');
  await page.getByRole('button', { name: 'Sign as Performed' }).click();
  await railSays(page, 'Performed Signature recorded in the Audit Trail. The Equipment Event is in the Logbook.');
  await expect(sheet(page)).toHaveCount(0);
  const event = logbook(page).filter({ hasText: 'Flashed the vendor firmware.' });
  await expect(event, 'the Event line shows its Performed Signature').toContainText(
    signedBy('Performed', 'Ana Ferreira (ana.analyst, Analyst)'),
  );
  await logbookStatusesHold(page);
  await shot('performed', 'h2:text-is("Logbook") + table');
});
