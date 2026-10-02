import { randomBytes } from 'node:crypto';
import { expect, signInByApi, test } from './walk.ts';
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
  await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
  await page.getByLabel('Username').fill('ada.admin');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Staff' }).click();
  await expect(page.getByRole('heading', { name: 'Staff accounts' })).toBeVisible();
  await shot('01-staff');

  await page.getByLabel('Printed name', { exact: true }).fill(printedName);
  await page.getByLabel('What was checked').fill('Passport seen in person (fictional)');
  await page.getByRole('button', { name: 'Record the Identity Verification' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: `Identity Verification of ${printedName} recorded` }),
    'a company record time shows in UTC only',
  ).toHaveText(/ recorded at \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\.$/);

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
  await expect(link, 'the next press takes the one-time link off the screen').toHaveCount(0);
  await shot('04-granted');

  await grant.getByLabel('Person').selectOption({ label: `${printedName} (${username})` });
  await grant.getByLabel('Role').selectOption('Admin');
  await grant.getByLabel('Reason').fill('Try to make an Analyst an Admin');
  await grant.getByRole('button', { name: 'Grant' }).click();
  await expect(grant.getByRole('alert')).toHaveText(
    'Refused: A person who holds Admin or Platform Operator holds no business role, in any Lab.',
  );
  await shot('05-refused-admin-apart');

  await row.getByRole('button', { name: 'Enrolment link' }).click();
  await expect(row.getByRole('alert'), 'the Admin who created the account cannot be the second person').toHaveText(
    'Refused: An enrolment grant comes from a second Admin: not the person, and not an Admin who created the account or issued its one-time link.',
  );
  await shot('05b-refused-enrolment-grant');

  await page.context().clearCookies();
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('nell-chose-this');
  await page.getByLabel('New password again').fill('nell-chose-this');
  await shot('06-welcome');
  await page.getByRole('button', { name: 'Set my password' }).click();
  await expect(page.getByRole('status')).toContainText(`Your password is set for ${username}`);
  await shot('07-password-set');

  const signIn = page.getByRole('link', { name: 'Sign in' });
  expect((await signIn.boundingBox())?.height, 'a gloved finger can press it').toBeGreaterThanOrEqual(44);
  await signIn.click();
  await page.getByRole('radio', { name: /R&D Laboratory/ }).check();
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
    'Refused: This link has been used, replaced or has expired. Ask the Admin for a new one.',
  );
  await shot('08-link-used');

  await page.context().clearCookies();
  await signInByApi(page, 'bea.admin');
  await page.goto('/#/staff');
  await page
    .getByRole('row', { name: new RegExp(username) })
    .getByRole('button', { name: 'Enrolment link' })
    .click();
  const enrolment = page.getByRole('region', { name: 'Enrolment link' });
  await expect(enrolment).toContainText(`Give this link to ${printedName} in person`);
  expect((await enrolment.locator('code').innerText()).trim(), 'the enrolment link carries a token').toMatch(
    /#\/authenticator\?grant=[A-Za-z0-9_-]{43}$/,
  );
  await shot('09-enrolment-link');
});

/** The wrong passwords in a row that lock an account, as the API counts them. */
const LOCKOUT_AFTER_FAILURES = 20;

test('the Admin opens a locked-out person’s Access Events and sees, under the Lockout, the session it ended', async ({
  page,
  playwright,
  baseURL,
}) => {
  const project = test.info().project.name;
  const suffix = randomBytes(3).toString('hex');
  const printedName = `Lou Lockedout ${suffix}`;
  const username = `lou.${project}-${suffix}`;
  const shot = async (what: string) => {
    if (SHOTS)
      await page.screenshot({ path: `test-results/shots/access-events-${project}-${what}.png`, fullPage: true });
  };
  const posted = async (url: string, data: object) => {
    const res = await page.request.post(url, { data });
    expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
    return res.json();
  };

  await signInByApi(page, 'ada.admin');
  const labs: { id: string; code: string }[] = await (await page.request.get('/api/labs')).json();
  const labId = labs.find((lab) => lab.code === 'RD')?.id;
  const verification = await posted('/api/staff/identity-verifications', {
    printedName,
    evidence: 'Passport seen in person (fictional)',
  });
  const { person, link } = await posted('/api/staff/accounts', { identityVerificationId: verification.id, username });
  await posted('/api/staff/memberships', { personId: person.id, role: 'Analyst', reason: 'New starter (fictional)' });

  if (!baseURL) throw new Error('the walk has no baseURL');
  const lou = await playwright.request.newContext({ baseURL });
  const set = await lou.post('/api/credentials', { data: { token: link.token, password: 'lou-chose-this' } });
  expect(set.ok(), 'Lou sets a password').toBe(true);
  const signedIn = await lou.post('/api/login', { data: { username, password: 'lou-chose-this', labId } });
  expect(signedIn.ok(), 'Lou signs in').toBe(true);
  const stranger = await playwright.request.newContext({ baseURL });
  for (let i = 0; i < LOCKOUT_AFTER_FAILURES; i++)
    expect((await stranger.post('/api/login', { data: { username, password: 'not-it', labId } })).status()).toBe(401);

  await page.goto('/');
  await page.getByRole('link', { name: 'Staff' }).click();
  await expect(page.getByRole('heading', { name: 'Staff accounts' })).toBeVisible();
  const open = page.getByRole('link', { name: `Access Events of ${printedName}` });
  expect((await open.boundingBox())?.height, 'a gloved finger can press it').toBeGreaterThanOrEqual(44);
  await open.click();
  await expect(page.getByRole('heading', { name: `Access Events of ${printedName}` })).toBeVisible();
  const lockout = page.getByRole('row').filter({ hasText: 'Lockout' });
  await expect(lockout).toHaveCount(1);
  await expect(lockout).toContainText('Ended this session at the Lockout:');
  await expect(lockout.getByRole('listitem')).toHaveText([/^Signed in \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC$/]);
  await expect(page.getByRole('row').filter({ hasText: 'Sign In Succeeded' })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'Wrong Password' })).toHaveCount(LOCKOUT_AFTER_FAILURES);
  await shot('01-lockout');
  await lou.dispose();
  await stranger.dispose();
});
