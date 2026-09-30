// Test-plan item 22, the session parts, against the real API and database: a deep link opens only
// after sign-in; lock unmounts the record and drops what it read; switch user and a takeover end
// the previous session on every tab; a Recorded Value typed by one person is Verified by another
// through the real SignaturePrompt; a double tap on the sign button leaves one signature row.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, request, test, type Page } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';

const out = process.env['E2E_OUT'] as string;
const shots = join(out, 'shots');
mkdirSync(shots, { recursive: true });

type Carried = { username: string; printedName: string; password: string; secret: string; lastUsedStep: number | null };
type State = { widget: string; people: { ann: Carried; bob: Carried }; enrolmentToken: string };
const state = JSON.parse(readFileSync(join(out, 'state.json'), 'utf8')) as State;

const PERIOD_MS = 30_000;

/** The person's phone: it never repeats a step, and never reuses one the server-side setup spent. */
class Phone {
  readonly #totp: TOTP;
  readonly #used = new Set<number>();
  readonly #floor: number;

  constructor(secret: string, floor: number | null) {
    this.#totp = new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) });
    this.#floor = floor ?? -1;
  }

  async code(): Promise<string> {
    for (;;) {
      const now = Math.floor(Date.now() / PERIOD_MS);
      const step = [now + 1, now, now - 1].find((s) => s > this.#floor && !this.#used.has(s));
      if (step !== undefined) {
        this.#used.add(step);
        return this.#totp.generate({ timestamp: step * PERIOD_MS });
      }
      await new Promise((r) => setTimeout(r, PERIOD_MS - (Date.now() % PERIOD_MS) + 100));
    }
  }
}

const phones = { ann: new Phone(state.people.ann.secret, state.people.ann.lastUsedStep), bob: new Phone(state.people.bob.secret, state.people.bob.lastUsedStep) };

async function typeCredentials(scope: Page | ReturnType<Page['getByRole']>, who: 'ann' | 'bob') {
  const p = state.people[who];
  await scope.getByLabel('User ID').fill(p.username);
  await scope.getByLabel('Password').fill(p.password);
  await scope.getByLabel('Code', { exact: true }).fill(await phones[who].code());
}

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: join(shots, `${name}-1366.png`) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, `${name}-390.png`), fullPage: true });
  await page.setViewportSize({ width: 1366, height: 768 });
}

test('sessions, a Recorded Value Verified by a second person, and one signature from a double tap', async ({ browser, baseURL }) => {
  const pc = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await pc.addInitScript(() => localStorage.setItem('lims.workstation', 'Bench PC RD-102-02'));
  const tab1 = await pc.newPage();
  const views: string[] = [];
  tab1.on('request', (r) => {
    if (r.url().includes('/api/views/')) views.push(r.url());
  });

  // A deep link opens only after sign-in.
  await tab1.goto(`/dev/bench?parent=${state.widget}`);
  await expect(tab1.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(tab1.getByText('After you sign in, the record bench opens.')).toBeVisible();
  await expect(tab1.getByText('Fictional data')).toBeVisible();
  await shoot(tab1, 'sign-in');
  await expect(tab1.getByText('Fictional data'), 'the banner shows at phone width too').toBeVisible();
  expect(views, 'nothing record-shaped is read before sign-in').toEqual([]);
  await typeCredentials(tab1, 'ann');
  await tab1.getByRole('button', { name: 'Sign in' }).click();
  await expect(tab1.getByRole('heading', { name: 'Record bench' })).toBeVisible();
  await expect(tab1.getByRole('contentinfo').getByText('Ann Analyst')).toBeVisible();
  expect(new URL(tab1.url()).pathname).toBe('/dev/bench');

  // Ann types the value; it saves as it is made and the rail shows the server's receipt.
  await tab1.getByLabel('Preparation P1 weight').fill('100.12');
  await tab1.getByRole('button', { name: 'Save Preparation P1 weight' }).click();
  await expect(tab1.getByRole('status').getByText('Recorded prep.weight (P1).')).toBeVisible();
  await expect(tab1.getByText('Recorded in the audit trail at')).toBeVisible();
  const valueId = new URL(tab1.url()).searchParams.get('value');
  expect(valueId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(tab1.getByRole('region', { name: 'Audit Trail of prep.weight (P1)' }).getByText('prep.weight').first()).toBeVisible();

  // A second tab of the same PC.
  const tab2 = await pc.newPage();
  await tab2.goto('/');
  await expect(tab2.getByRole('heading', { name: 'Work' })).toBeVisible();

  // Lock hides everything, on every tab, and what the screen read is gone.
  await tab1.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(tab1.getByRole('heading', { name: 'Locked' })).toBeVisible();
  await expect(tab2.getByRole('heading', { name: 'Locked' })).toBeVisible();
  for (const tab of [tab1, tab2]) {
    const text = await tab.locator('body').innerText();
    expect(text).not.toContain('100.12');
    expect(text).not.toContain(valueId);
    expect(text).not.toContain('prep.weight');
    expect(text).not.toContain('Record bench');
  }
  await shoot(tab1, 'lock');
  await typeCredentials(tab1, 'ann');
  await tab1.getByRole('button', { name: 'Unlock as Ann Analyst' }).click();
  await expect(tab1.getByRole('heading', { name: 'Record bench' })).toBeVisible();
  await expect(tab2.getByRole('heading', { name: 'Work' })).toBeVisible();
  await expect(tab1.getByRole('region', { name: 'Audit Trail of prep.weight (P1)' }).getByText('prep.weight').first(), 'the remounted screen reads again').toBeVisible();

  // Switch user locks at once; Bob's takeover ends Ann's session on the server and on every tab.
  const annCookie = (await pc.cookies()).find((c) => c.name === 'lims_session')?.value;
  expect(annCookie).toBeTruthy();
  await tab1.getByRole('button', { name: 'Switch user' }).click();
  await expect(tab1.getByText(/Ann Analyst handed this PC over at/)).toBeVisible();
  await expect(tab2.getByRole('heading', { name: 'Locked' })).toBeVisible();
  await typeCredentials(tab1, 'bob');
  await tab1.getByRole('button', { name: "Sign in and end Ann Analyst's session" }).click();
  await expect(tab1.getByRole('contentinfo').getByText('Bob Reviewer')).toBeVisible();
  await expect(tab1.getByRole('heading', { name: 'Record bench' })).toBeVisible();
  await expect(tab2.getByRole('contentinfo').getByText('Bob Reviewer')).toBeVisible();
  await expect(tab2.getByText('Ann Analyst')).toHaveCount(0);
  const annTab = await request.newContext({ baseURL: baseURL as string, extraHTTPHeaders: { cookie: `lims_session=${annCookie}` } });
  expect(await (await annTab.get('/api/session')).json(), "Ann's session ended with the takeover").toEqual({ state: 'none', dataClass: 'fictional' });
  expect((await annTab.get(`/api/views/record.audit?recordId=${valueId}`)).status()).toBe(401);
  await annTab.dispose();

  // Bob Verifies Ann's value through the real prompt: eligibility before credentials, full hash.
  await tab1.getByRole('button', { name: 'Sign prep.weight (P1) as Verified' }).click();
  const sheet = tab1.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Sign as Verified' })).toBeVisible();
  await expect(sheet.getByRole('region', { name: 'What you are signing' }).getByText('100.12 mg')).toBeVisible();
  await expect(sheet.getByText(/for METHOD-W, valid until 2027-01-01/)).toBeVisible();
  const hash = await sheet.locator('.manifest__hash .hash').innerText();
  expect(hash.replace(/\s/g, '')).toMatch(/^[0-9a-f]{64}$/);
  await shoot(tab1, 'signature-prompt');
  const signs: string[] = [];
  tab1.on('request', (r) => {
    if (r.url().endsWith('/api/commands/signing.sign')) signs.push(r.postData() ?? '');
  });
  await typeCredentials(sheet, 'bob');
  const signed = tab1.waitForResponse((r) => r.url().endsWith('/api/commands/signing.sign'));
  await sheet.getByRole('button', { name: 'Sign prep.weight (P1) as Verified' }).dblclick();
  const receipt = (await (await signed).json()) as { kind: string; data: { signatures: { version: { versionId: string } }[] } };
  expect(receipt.kind).toBe('receipt');
  await expect(tab1.getByRole('dialog')).toHaveCount(0);
  await expect(tab1.getByRole('status').getByText('Signed Verified: 1 record.')).toBeVisible();
  await tab1.waitForTimeout(500);
  expect(signs, 'the double tap sent one signing').toHaveLength(1);
  const versionId = receipt.data.signatures[0]?.version.versionId as string;
  const standing = (await (await tab1.request.get(`/api/views/signing.standing?versionId=${versionId}`)).json()) as { kind: string; signatures: { meaning: string; username: string }[] };
  expect(standing).toMatchObject({ kind: 'signed', signatures: [{ meaning: 'Verified', username: 'bob' }] });
  expect(standing.signatures, 'one signature row').toHaveLength(1);
  await expect(tab1.getByRole('region', { name: 'Signatures' }).getByRole('button', { name: /Verified.*Bob Reviewer/ })).toBeVisible();
  await pc.close();
});

test('the one-time enrolment link: QR code drawn in the browser, password to the rules, a live code', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  await page.goto(`/enrol#${state.enrolmentToken}`);
  await expect(page.getByRole('heading', { name: 'Set up your account' })).toBeVisible();
  const started = page.waitForResponse((r) => r.url().endsWith('/api/commands/identity.enrolStart'));
  await page.getByRole('button', { name: 'Show the code to scan' }).click();
  const body = (await (await started).json()) as { once: { otpauthUri: string } };
  const secret = new URL(body.once.otpauthUri).searchParams.get('secret') as string;
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  expect(await page.locator('body').innerText(), 'the secret is never printed').not.toContain(secret);
  await shoot(page, 'enrolment');
  await page.getByLabel('Password', { exact: true }).fill('Quartz-Ledger-2026!');
  await page.getByLabel('Type it again').fill('Quartz-Ledger-2026!');
  await page.getByLabel('Code', { exact: true }).fill(await new Phone(secret, null).code());
  await page.getByRole('button', { name: 'Finish setting up' }).click();
  await expect(page.getByRole('heading', { name: 'Your account is ready' })).toBeVisible();
  await expect(page.getByText('Enrolled. Sign in as fay.')).toBeVisible();
});
