import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page, signOutFromRail, test, utcThenLabClock } from './walk.ts';
import { DEMO_PASSWORD, E2E_DATABASE, SHOTS } from '../playwright.config.ts';

const shot = async (page: Page, name: string) => {
  if (SHOTS && test.info().project.name === 'desktop')
    await page.screenshot({ path: `../../docs/design/thin-slice-shots/${name}.png` });
};

const RD = /R&D Laboratory/;

async function signIn(page: Page, username: string) {
  await page.getByRole('radio', { name: RD }).check();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tests' })).toBeVisible();
}

const signatureRow = (page: Page, meaning: string) =>
  page.locator('tr', { has: page.locator('td[data-label="Meaning"] .sig', { hasText: meaning }) });

async function unsignedBesideMeanings(page: Page) {
  for (const meaning of ['Performed', 'Reviewed', 'Released']) {
    const cell = signatureRow(page, meaning).locator('td[data-label="Meaning"]');
    const mark = cell.locator('.status');
    await expect(mark).toHaveText('Unsigned');
    await expect(mark, `${meaning}'s mark is in the bad tone`).toHaveClass(/\bstatus--bad\b/);
    await expect(mark.locator('svg.glyph')).toHaveCount(1);
    const [word, status] = [await box(cell.locator('.sig')), await box(mark)];
    expect(
      Math.abs(word.y + word.height / 2 - (status.y + status.height / 2)),
      `${meaning} and Unsigned share a line`,
    ).toBeLessThan(word.height / 2);
  }
}

const railSays = (page: Page, text: string | RegExp) => expect(page.getByRole('status')).toContainText(text);
const sign = async (page: Page, meaning: string, password = DEMO_PASSWORD, username?: string) => {
  const typed = username ?? (await page.getByRole('contentinfo').locator('.who code').textContent()) ?? '';
  await page.getByLabel(/User ID/).fill(typed);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole('button', { name: `Sign as ${meaning}` }).click();
};

function changeResult(testId: string, value: string) {
  execFileSync(
    '../../scripts/pg.sh',
    [
      'psql',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '--single-transaction',
      '-d',
      E2E_DATABASE,
      '-v',
      `test=${testId}`,
      '-v',
      `value=${value}`,
    ],
    {
      input: `select set_config('lims.actor', 'svc:e2e', true), set_config('lims.role', 'system', true),
                     set_config('lims.reason', 'Change a signed Result from outside the chain (e2e)', true);
              update lims.result set value = :'value' where test_id = :'test';`,
      stdio: ['pipe', 'ignore', 'inherit'],
    },
  );
}

async function box(target: Locator) {
  const b = await target.boundingBox();
  if (!b) throw new Error('the element is not on screen');
  return b;
}
async function atLeast(target: Locator, width: number, height: number) {
  await target.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const b = await box(target);
  // A box at a fractional position measures up to 0.0001 px short of its CSS size.
  expect(b.width + 0.01, 'touch target width').toBeGreaterThanOrEqual(width);
  expect(b.height + 0.01, 'touch target height').toBeGreaterThanOrEqual(height);
}

const PHONE = { width: 390, height: 844 };
const SIDEWAYS = { width: 844, height: 390 };
const DESKTOP = { width: 1360, height: 900 };

const uncovered = (target: Locator) =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const corners = [
      [r.left + 12, r.top + 12],
      [r.right - 12, r.top + 12],
      [r.left + 12, r.bottom - 12],
      [r.right - 12, r.bottom - 12],
    ] as const;
    return corners.every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
  });

async function typeWhileTheSheetIsStillSlidingIn(page: Page, type: () => Promise<void>) {
  const sheet = page.locator('form.sheet');
  const sliding = await sheet.evaluate((el) => {
    const slide = el.getAnimations();
    for (const a of slide) a.pause();
    return slide.length;
  });
  expect(sliding, 'the sheet is still sliding in').toBeGreaterThan(0);
  await type();
  const rail = await box(page.locator('footer.rail'));
  const height = page.viewportSize()?.height;
  expect(rail.y + rail.height, 'the rail stays at the foot of the screen').toBeCloseTo(height ?? 0, 0);
  await sheet.evaluate((el) =>
    Promise.all(
      el.getAnimations().map((a) => {
        a.play();
        return a.finished;
      }),
    ),
  );
}

async function wholeOnScreenAtEverySize(page: Page, whole: Locator, commit: Locator) {
  const projectSize = page.viewportSize() ?? DESKTOP;
  for (const size of [projectSize, PHONE, SIDEWAYS, DESKTOP]) {
    const at = `at ${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await whole.scrollIntoViewIfNeeded();
    const edges = await box(whole);
    expect(edges.y, `whole on screen ${at}, to the pixel`).toBeGreaterThan(-1);
    expect(edges.y + edges.height, `whole on screen ${at}, to the pixel`).toBeLessThan(size.height + 1);
    expect(await uncovered(whole), `nothing covers it ${at}`).toBe(true);
    await expect(commit, `the commit button is on screen ${at}`).toBeInViewport({ ratio: 1 });
    await commit.click({ trial: true });
    const bars = await page.evaluate(() => ({
      top: document.querySelector('.top')?.getBoundingClientRect().top,
      rail: document.querySelector('footer.rail')?.getBoundingClientRect().bottom,
    }));
    expect(bars.top, `the top bar holds the first row ${at}`).toBe(0);
    expect(bars.rail, `the rail holds the last row ${at}`).toBeCloseTo(size.height, 0);
    for (const legend of await page.locator('form.sheet fieldset.card > legend').all()) {
      const [heading, card] = [await box(legend), await box(legend.locator('..'))];
      expect(heading.y - card.y, `the field card's heading sits inside its border ${at}`).toBeGreaterThanOrEqual(16);
    }
  }
  await page.setViewportSize(projectSize);
}

const shownOnce = (page: Page, text: string) =>
  expect
    .poll(
      () =>
        page.getByText(text).evaluateAll(
          (copies) =>
            copies.filter((e) => {
              const r = e.getBoundingClientRect();
              return r.width > 1 && r.height > 1;
            }).length,
        ),
      `"${text}" is on screen once`,
    )
    .toBe(1);

test('the whole chain through the UI, ending in a Test Report with three Signatures', async ({ page }) => {
  const description = `Metformin HCl 500 mg tablets, lot NW-0042 (fictional, ${test.info().project.name} ${randomUUID()})`;
  const openTheTest = async () => {
    const link = page.getByRole('row', { name: description }).getByRole('link');
    await atLeast(link, 44, 44);
    await link.click();
  };
  const sheet = page.locator('form.sheet');
  const whatYouAreSigning = sheet
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'What you are signing' }) });
  const signButton = sheet.getByRole('button', { name: /^Sign as / });
  const commitKeys: string[] = [];
  const keysOfStep = new Map<string, Set<string>>();
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !request.url().includes('/api/steps/')) return;
    const { commitKey } = request.postDataJSON();
    commitKeys.push(commitKey);
    const step = new URL(request.url()).pathname;
    keysOfStep.set(step, (keysOfStep.get(step) ?? new Set()).add(commitKey));
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await shot(page, 'sign-in');

  await signIn(page, 'cora.customer');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Submit' }).click();
  expect(await sheet.evaluate((form) => getComputedStyle(form).transform), 'no movement').toBe('none');
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await sheet.count(), 'under reduced motion the sheet leaves at once').toBe(0);
  await page.emulateMedia({ reducedMotion: null });
  await page.getByRole('button', { name: 'Submit' }).click();
  await typeWhileTheSheetIsStillSlidingIn(page, async () => {
    await page.getByLabel('Method').selectOption({ index: 1 });
    await page.getByLabel('Sample description').fill(description);
  });
  await wholeOnScreenAtEverySize(
    page,
    page.getByLabel('Sample description'),
    sheet.getByRole('button', { name: 'Submit' }),
  );
  await page.getByRole('button', { name: 'Submit' }).click();
  await railSays(page, 'now Requested');
  await expect(page.getByRole('row', { name: description })).toContainText('Requested');
  await signOutFromRail(page);

  await signIn(page, 'samir.custodian');
  await openTheTest();
  await page.getByRole('button', { name: 'Receive' }).click();
  await railSays(page, 'now Ready');
  await signOutFromRail(page);

  await signIn(page, 'lena.manager');
  await shot(page, 'worklist');
  await openTheTest();
  const assign = page.getByRole('button', { name: 'Assign' });
  await atLeast(assign, 44, 56);
  await assign.click();
  await page.getByLabel('Analyst').selectOption({ label: 'Ana Ferreira' });
  await atLeast(assign, 44, 56);
  await assign.click();
  await railSays(page, 'now Assigned');
  await signOutFromRail(page);

  await signIn(page, 'ana.analyst');
  await openTheTest();
  await page.getByRole('button', { name: 'Enter Result' }).click();
  const result = {
    Analyte: 'NDMA',
    'Result as written': '0.0300',
    Unit: 'ppm',
    'Injection sequence': 'SEQ-2026-0042',
    'Notebook reference': 'RD-NB-0007-012',
    'Performed on': '2026-09-30',
  };
  await typeWhileTheSheetIsStillSlidingIn(page, async () => {
    for (const [label, value] of Object.entries(result)) await page.getByLabel(label, { exact: true }).fill(value);
  });
  await wholeOnScreenAtEverySize(page, whatYouAreSigning, signButton);
  const signing = page.locator('form.sheet');
  await expect(signing.getByRole('heading', { name: 'What you are signing' })).toBeVisible();
  await expect(signing.locator('.meaning')).toContainText(/Performed.*Signature statement version 1/s);
  await expect(signing.getByText(/^Ana Ferreira may sign Performed as Analyst in R&D Laboratory/)).toBeVisible();
  const hash = signing.locator('code.hash');
  await expect(hash).toHaveText(/^[0-9a-f]{64}$/);
  const userId = page.getByLabel(/User ID/);
  await expect(userId).toHaveValue('');
  expect(
    await signing.evaluate((form) => {
      const [shown, typed] = [form.querySelector('code.hash'), form.querySelector('input[type=text]')];
      return Boolean(shown && typed && shown.compareDocumentPosition(typed) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
    'the record, meaning, eligibility and full hash come before the credential fields',
  ).toBe(true);
  const passwordField = page.getByLabel(/Password/);
  for (const field of [userId, passwordField]) {
    await atLeast(field, 44, 44);
    await expect(field, 'a credential field keeps 16px text so a phone does not zoom').toHaveCSS('font-size', '16px');
  }
  await userId.fill('ana.analyst');
  await passwordField.fill(DEMO_PASSWORD);
  await shot(page, 'test-signature-sheet');
  await sign(page, 'Performed', 'not-the-password');
  await railSays(page, 'Refused: The user ID or password is not valid. Nothing has been signed.');
  await expect(signing.locator('.refusal')).toBeVisible();
  const heldPerformed = Promise.withResolvers<void>();
  await page.route('**/api/steps/enterResult', async (route) => {
    await heldPerformed.promise;
    await route.continue();
  });
  await sign(page, 'Performed');
  await expect(
    signing.locator('.refusal'),
    'a new attempt clears the earlier refusal before the server answers',
  ).toHaveCount(0);
  heldPerformed.resolve();
  await railSays(page, 'Performed Signature recorded in the Audit Trail. The Test is now Submitted For Review.');
  await signOutFromRail(page);

  await signIn(page, 'rui.reviewer');
  await openTheTest();
  const review = page.getByRole('button', { name: 'Review', exact: true });
  await review.click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(review, 'the rail button is back before the sheet has left').toBeVisible({ timeout: 100 });
  await expect(review).toBeFocused();
  await review.click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await sheet.count(), 'Escape closes the sheet at once').toBe(0);
  await expect(review).toBeFocused();

  await review.click();
  await expect(sheet.locator('.meaning'), 'the Reviewed sheet shows its meaning and statement').toContainText(
    /Reviewed.*Signature statement version 1/s,
  );
  await expect(sheet.getByText(/^Rui Tanaka may sign Reviewed as Reviewer in R&D Laboratory/)).toBeVisible();
  await expect(sheet.locator('code.hash')).toHaveText(/^[0-9a-f]{64}$/);
  await typeWhileTheSheetIsStillSlidingIn(page, () => page.getByLabel(/Password/).fill(DEMO_PASSWORD));
  await wholeOnScreenAtEverySize(page, whatYouAreSigning, signButton);
  const height = (await box(sheet)).height;
  await sign(page, 'Reviewed', 'not-the-password');
  await railSays(page, 'Refused: The user ID or password is not valid. Nothing has been signed.');
  await shownOnce(page, 'Refused: The user ID or password is not valid. Nothing has been signed.');
  const refusal = sheet.locator('.refusal');
  await expect(refusal).toBeInViewport({ ratio: 1 });
  const [inSheet, inRefusal] = [await box(sheet), await box(refusal)];
  expect(inRefusal.y >= inSheet.y && inRefusal.y + inRefusal.height <= inSheet.y + inSheet.height).toBe(true);
  const password = page.getByLabel(/Password/);
  await expect(password).toBeFocused();
  const [field, foot] = [await box(password), await box(sheet.locator('.sheet__foot'))];
  expect(field.y + field.height, 'the password field is clear of the sheet foot').toBeLessThanOrEqual(foot.y);
  // A box at a fractional position measures a few ten-thousandths of a pixel differently between runs.
  expect((await box(sheet)).height, 'the sheet keeps its height').toBeCloseTo(height, 2);

  await page.request.post('/api/logout', { data: {} });
  const whoAmI: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/me')) whoAmI.push(request.url());
  });
  await sign(page, 'Reviewed');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('Sign in first.');
  expect(whoAmI, 'the web returned to sign-in by the kind, with no second request to decide it').toHaveLength(0);
  await page.getByRole('radio', { name: RD }).check();
  await page.getByLabel('Username').fill('rui.reviewer');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 }), 'signing in again returns to the Test it left').toContainText(
    'Submitted For Review',
  );

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Submitted For Review');
  await review.click();
  const held = Promise.withResolvers<void>();
  await page.route('**/api/steps/review', async (route) => {
    await held.promise;
    await route.continue();
  });
  const submit = page.getByRole('button', { name: 'Sign as Reviewed' });
  await atLeast(submit, 44, 56);
  const width = (await box(submit)).width;
  await sign(page, 'Reviewed');
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  await expect(submit).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect((await box(submit)).width, 'the busy Sign button keeps its width').toBe(width);
  held.resolve();
  await railSays(page, 'now Reviewed');
  await expect(page.getByRole('status'), 'with no step left, focus goes to the status line').toBeFocused();
  await signOutFromRail(page);

  await signIn(page, 'cora.customer');
  await openTheTest();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Reviewed');
  await expect(page.getByText('The Result is not released yet.')).toBeVisible();
  await expect(page.getByText('The Signatures are not released yet.')).toBeVisible();
  await expect(page.getByText(/No Result entered|No Signatures yet/), 'never that none exists').toHaveCount(0);
  await signOutFromRail(page);

  await signIn(page, 'quinn.qa');
  await openTheTest();
  await page.getByRole('button', { name: 'Release' }).click();
  await typeWhileTheSheetIsStillSlidingIn(page, () => page.getByLabel(/Password/).fill(DEMO_PASSWORD));
  await wholeOnScreenAtEverySize(page, whatYouAreSigning, signButton);
  let dropped = false;
  await page.route('**/api/steps/release', async (route) => {
    if (dropped) return route.continue();
    dropped = true;
    await route.fetch();
    return route.abort('connectionreset');
  });
  await sign(page, 'Released');
  const unanswered =
    'The LIMS did not answer. Type your password again and sign with the same entries; they will not be saved twice.';
  await railSays(page, unanswered);
  await shownOnce(page, unanswered);
  await sign(page, 'Released');
  await railSays(page, 'now Reported');
  await page.getByRole('button', { name: 'Verify chain' }).click();
  await expect(page.locator('.chains li')).toHaveText([
    /^Lab chain Intact verified through entry \d+ (Every entry recomputed\.|Recomputed from entry \d+; entries through \d+ were verified .* by .*\.)$/,
    /^Company chain Intact verified through entry \d+ (Every entry recomputed\.|Recomputed from entry \d+; entries through \d+ were verified .* by .*\.)$/,
  ]);
  const [releaseKey, retryKey] = commitKeys.slice(-2);
  expect(retryKey, 'the press whose reply was dropped is resent with its Commit Key').toBe(releaseKey);
  for (const [step, keys] of keysOfStep)
    expect(keys.size, `${step} resends its Commit Key after a refusal or no answer`).toBe(1);
  const presses = new Set(commitKeys);
  expect(presses.size, 'each step sent a fresh Commit Key').toBe(keysOfStep.size);
  for (const key of presses)
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const reportLink = page.locator('.facts').getByRole('link', { name: /^RD-R-\d{4}-\d{6}$/ });
  await atLeast(reportLink, 44, 44);
  await reportLink.click();
  await expect(page.getByRole('heading', { name: /Test Report RD-R-\d{4}-\d{6}/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: '0.0300', exact: true })).toBeVisible();
  for (const [meaning, signer] of [
    ['Performed', 'Ana Ferreira'],
    ['Reviewed', 'Rui Tanaka'],
    ['Released', 'Quinn Adeyemi'],
  ]) {
    await expect(page.getByRole('row', { name: new RegExp(`${meaning}.*${signer}`) })).toBeVisible();
  }
  const reportVersion = page.locator('dl.facts dt:text-is("Record Version") + dd');
  await expect(reportVersion, "the Test Report's current Record Version, the Released Signature's").toHaveText(
    /^1 · [0-9a-f]{64}$/,
  );
  await expect(signatureRow(page, 'Released').locator('td[data-label="Record Version"]')).toHaveText('1');
  const reportTimes = page.locator('td[data-label="Time"]');
  await expect(reportTimes, 'each Signature time in UTC, then on the Lab wall clock').toHaveText([
    utcThenLabClock,
    utcThenLabClock,
    utcThenLabClock,
  ]);
  await expect(page.locator('dl.facts dt:text-is("Received") + dd')).toHaveText(utcThenLabClock);
  const timesOnReport = await reportTimes.allTextContents();
  const receivedOnReport = await page.locator('dl.facts dt:text-is("Received") + dd').textContent();
  await shot(page, 'test-report');

  const testId = new URL(page.url()).hash.split('/')[2] ?? '';
  expect(testId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.locator('.status--bad')).toHaveCount(0);
  changeResult(testId, '0.0380');
  await page.reload();
  await expect(page.getByRole('cell', { name: '0.0380', exact: true })).toBeVisible();
  await expect(reportVersion).toHaveText(/^2 · [0-9a-f]{64}$/);
  await expect(page.getByRole('heading', { level: 1 }).locator('.status')).toHaveText('Signatures unsigned');
  await unsignedBesideMeanings(page);

  await page.goto(`/#/tests/${testId}`);
  await expect(page.getByRole('heading', { level: 1 }).locator('.status')).toHaveText([
    'Reported',
    'Signatures unsigned',
  ]);
  await expect(page.locator('td[data-label="Time"]'), 'the Test page shows the times the Test Report shows').toHaveText(
    timesOnReport,
  );
  await expect(page.locator('dl.facts').first().locator('dt:text-is("Received") + dd')).toHaveText(
    receivedOnReport ?? '',
  );
  await expect(page.locator('dl.facts').first().locator('dt:text-is("Record Version") + dd')).toContainText('4 ·');
  await unsignedBesideMeanings(page);
  for (const [meaning, record] of [
    ['Performed', 'Test'],
    ['Reviewed', 'Test'],
    ['Released', 'Test Report'],
  ] as const)
    await expect(signatureRow(page, meaning).locator('td[data-label="Record"]')).toHaveText(record);
  await railSays(page, 'Unsigned: Performed, Reviewed, Released. The record changed after signing.');
  await shot(page, 'test-unsigned');
  await page.getByRole('button', { name: 'Verify chain' }).click();
  await expect(page.locator('.chains li')).toHaveText([/^Lab chain Intact /, /^Company chain Intact /]);
});

test('a wrong password and an unknown user ID show the same failure message', async ({ page }) => {
  const attempt = async (username: string, password: string) => {
    await page.goto('/');
    await page.getByRole('radio', { name: RD }).check();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    return alert.textContent();
  };
  const wrongPassword = await attempt('rui.reviewer', 'not-the-password');
  const unknownUserId = await attempt(`nobody-${randomUUID()}`, DEMO_PASSWORD);
  expect(wrongPassword).toBe('The user ID or password is not valid.');
  expect(unknownUserId).toBe(wrongPassword);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
