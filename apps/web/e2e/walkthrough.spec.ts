// Test-plan D22 plus the whole sample chain, through the real UI against the real API and
// database. Only reference data and people are seeded (apps/api/test/e2e-chain-server.ts); every
// step of the chain is a person at their own PC: the Customer submits, the Sample Custodian accepts
// and receives, the Lab Manager assigns (and sees an ineligible Analyst refused), the Analyst types
// the Run and Preparations, a second Analyst signs Verified, the Analyst signs the Run Performed,
// the Reviewer reviews the Run, the Analyst signs the Test Performed and is refused reviewing her
// own Test, the Reviewer reviews it, the report is drafted and sent to QA, QA confirms and releases,
// and the Customer downloads the PDF whose SHA-256 the portal shows. A second Test's failing Run
// Check shows the not-built refusal on screen.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { Phone } from './phone';

const out = process.env['E2E_OUT'] as string;

type Carried = { username: string; printedName: string; password: string; secret: string; lastUsedStep: number | null };
type Who = 'cara' | 'sam' | 'lena' | 'ann' | 'dee' | 'bob' | 'cid';
const state = JSON.parse(readFileSync(join(out, 'state.json'), 'utf8')) as { people: Record<Who, Carried> };
const phones = Object.fromEntries(Object.entries(state.people).map(([k, p]) => [k, new Phone(p.secret, p.lastUsedStep)])) as Record<Who, Phone>;

const LOT = 'FIC-26-0501';
const shots: string[] = [];

async function shoot(page: Page, name: string, phone = false) {
  await page.evaluate(() => document.getElementById('view')?.scrollTo(0, 0));
  const wide = join(out, `${name}-1366.png`);
  await page.screenshot({ path: wide });
  shots.push(wide);
  if (phone) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const narrow = join(out, `${name}-390.png`);
    await page.screenshot({ path: narrow, fullPage: true });
    shots.push(narrow);
    await page.setViewportSize({ width: 1366, height: 768 });
  }
}

const rail = (page: Page) => page.getByRole('contentinfo', { name: 'Signed-in person and actions' });

async function typeCredentials(scope: Page | Locator, who: Who, withUser = true) {
  const p = state.people[who];
  if (withUser) await scope.getByLabel('User ID').fill(p.username);
  await scope.getByLabel('Password').fill(p.password);
  await scope.getByLabel('Code', { exact: true }).fill(await phones[who].code());
}

/** A person at their own PC, signed in; a Customer User acting for two Customers picks one. */
async function atPc(browser: Browser, who: Who, pc: string, customer?: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  await context.addInitScript((name) => localStorage.setItem('lims.workstation', name), pc);
  const page = await context.newPage();
  await page.goto('/');
  await typeCredentials(page, who);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (customer) {
    await page.getByRole('radiogroup', { name: 'Sign in for' }).getByRole('radio', { name: customer }).click();
    await typeCredentials(page, who, false);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect(rail(page).getByText(state.people[who].printedName)).toBeVisible();
  return page;
}

/** Presses the rail's primary act and waits for the server's receipt there. */
async function press(page: Page, label: string | RegExp, receipt: string | RegExp) {
  await rail(page).getByRole('button', { name: label }).click();
  await expect(rail(page).getByRole('status').getByText(receipt).first()).toBeVisible();
}

/** Opens the rail's signing prompt, types the credentials in the sheet and signs. */
async function sign(page: Page, who: Who, label: string | RegExp, check?: (sheet: Locator) => Promise<void>) {
  await rail(page).getByRole('button', { name: label }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('region', { name: 'What you are signing' })).toBeVisible();
  if (check) await check(sheet);
  await typeCredentials(sheet, who);
  await sheet.getByRole('button', { name: label }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(rail(page).getByText(/^Signed /).first()).toBeVisible();
}

async function saveValue(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: `Save ${label}` }).click();
  await expect(rail(page).getByRole('status').getByText(/^Recorded /).first()).toBeVisible();
  await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
}

test('the whole sample chain through the real UI, with a refusal on screen and a not-built refusal', async ({ browser }) => {
  test.setTimeout(1_500_000);

  // 1. The Customer submits a Submission of one Sample with two Tests.
  const cara = await atPc(browser, 'cara', 'Customer laptop', 'Acme Pharma (fictional)');
  await cara.getByRole('link', { name: 'New Submission', exact: true }).click();
  await cara.getByLabel('Product').selectOption({ label: 'FIC-01 Fictionib API, route A' });
  await cara.getByLabel('Lot number').fill(LOT);
  await cara.getByLabel('Test 1 on Sample 1: Method').selectOption({ label: 'NA-LCMS-001 Nitrosamines in APIs by LC-MS/MS' });
  await cara.getByRole('button', { name: 'Add a Test to Sample 1' }).click();
  await cara.getByLabel('Test 2 on Sample 1: Method').selectOption({ label: 'NA-LCMS-001 Nitrosamines in APIs by LC-MS/MS' });
  await rail(cara).getByRole('button', { name: 'Submit the Submission' }).click();
  await expect(cara.getByRole('heading', { name: 'Submissions' })).toBeVisible();
  const submission = cara.getByRole('region', { name: /^Submission SUB-/ }).first();
  await expect(submission.getByText(`lot ${LOT}`)).toBeVisible();
  const submissionNumber = ((await submission.getAttribute('aria-label')) ?? '').replace('Submission ', '');
  await shoot(cara, 'portal-customer', true);

  // 2. The Sample Custodian accepts both Tests and receives the Sample; the Tests are Ready.
  const sam = await atPc(browser, 'sam', 'Receiving bench RD-101');
  await sam.getByRole('link', { name: 'Intake', exact: true }).click();
  const sample = sam.getByRole('region', { name: `Sample lot ${LOT}` });
  for (const t of ['T1', 'T2']) {
    await sample.getByRole('button', { name: new RegExp(`^Test ${LOT}/${t}`) }).click();
    await press(sam, `Accept Test ${LOT}/${t}`, /^Accepted Test/);
  }
  await sample.getByRole('button', { name: new RegExp(`^Sample lot ${LOT}`) }).click();
  await shoot(sam, 'intake-sample-custodian');
  await press(sam, `Receive Sample lot ${LOT}`, /^Received RD-S-/);

  // 3. The Lab Manager assigns both to Ann; Bob, an Analyst with no Performed Authorisation, is refused.
  const lena = await atPc(browser, 'lena', 'Office PC RD-110');
  await lena.getByRole('link', { name: 'Assignment', exact: true }).click();
  const ready = lena.getByRole('region', { name: 'Ready Tests' });
  await expect(ready.getByRole('button')).toHaveCount(2);
  const labels: string[] = [];
  for (let i = 0; i < 2; i++) {
    const pick = ready.getByRole('button').first();
    const label = (await pick.locator('b').innerText()).trim();
    labels.push(label);
    await pick.click();
    const analysts = lena.getByRole('radiogroup', { name: `Analysts for ${label}` });
    await expect(analysts.getByLabel('Bob Achebe is not eligible')).toContainText(/Performed/);
    await expect(analysts.getByRole('radio', { name: /Bob Achebe/ })).toHaveCount(0);
    if (i === 0) await shoot(lena, 'assignment-lab-manager');
    await analysts.getByRole('radio', { name: /Ann Kowalczyk/ }).click();
    await press(lena, `Assign ${label} to Ann Kowalczyk`, `Assigned ${label} to Ann Kowalczyk.`);
  }
  const [t1, t2] = labels.sort() as [string, string];

  // 4. Ann starts the first Test, creates the typed Run and records every value as she makes it.
  const ann = await atPc(browser, 'ann', 'Bench PC RD-102-02');
  await expect(ann.getByRole('heading', { name: 'Work' })).toBeVisible();
  await ann.getByRole('link', { name: t1, exact: true }).click();
  const testUrl = ann.url();
  await press(ann, `Start ${t1}`, `Started ${t1}.`);
  const newRun = ann.getByRole('region', { name: 'New typed Run' });
  await newRun.getByLabel('Instrument').selectOption({ index: 1 });
  await newRun.getByLabel('Sequence ID').fill('SEQ-0501-A');
  await newRun.getByLabel('True Copy (the printout)').setInputFiles({ name: 'printout-SEQ-0501-A.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 fictional instrument printout for SEQ-0501-A') });
  await press(ann, 'Create the typed Run', /^Linked Run RD-R-/);
  const runRegion = ann.getByRole('region', { name: /^Run RD-R-/ });
  const runNumber = ((await runRegion.getAttribute('aria-label')) ?? '').replace('Run ', '');
  await saveValue(ann, 'Run Check S/N at LOQ standard', '18');
  await saveValue(ann, 'Run Check Check standard recovery', '98.4');
  const preps: [string, string, string][] = [['100.12', '10.0', '1.234'], ['99.87', '10.0', '1.201']];
  for (const [i, [w, d, c]] of preps.entries()) {
    await ann.getByRole('button', { name: `Add Preparation P${i + 1}` }).click();
    await expect(ann.getByLabel(`P${i + 1} weight`, { exact: true })).toBeVisible();
    await saveValue(ann, `P${i + 1} weight`, w);
    await saveValue(ann, `P${i + 1} dilution volume`, d);
    await saveValue(ann, `P${i + 1} NDMA result`, c);
  }
  await expect(ann.getByRole('region', { name: 'Results' }).getByText('Provisional until the Test is signed Performed')).toBeVisible();
  await expect(ann.getByRole('region', { name: 'Results' }).getByText('Conforms', { exact: true })).toHaveCount(0);
  await shoot(ann, 'workbench-analyst');
  // A blocked act is aria-disabled but still pressable: pressing it says why (rule 15).
  await rail(ann).getByRole('button', { name: `Sign Run ${runNumber} as Performed` }).click({ force: true });
  await expect(rail(ann).getByText(/not yet Verified by a second person/)).toBeVisible();

  // 4b. The second Test: a failing Run Check is recorded, and the step bar and rail refuse Performed as not built.
  await ann.goto('/');
  await ann.getByRole('link', { name: t2, exact: true }).click();
  await press(ann, `Start ${t2}`, `Started ${t2}.`);
  const newRun2 = ann.getByRole('region', { name: 'New typed Run' });
  await newRun2.getByLabel('Instrument').selectOption({ index: 1 });
  await newRun2.getByLabel('Sequence ID').fill('SEQ-0501-B');
  await newRun2.getByLabel('True Copy (the printout)').setInputFiles({ name: 'printout-SEQ-0501-B.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 fictional instrument printout for SEQ-0501-B') });
  await press(ann, 'Create the typed Run', /^Linked Run RD-R-/);
  await saveValue(ann, 'Run Check S/N at LOQ standard', '8');
  const steps2 = ann.getByRole('list', { name: `Steps of ${t2}` });
  await expect(steps2.getByText(/^Blocked/).first()).toBeVisible();
  await expect(steps2.getByText(/Run Check S\/N at LOQ standard failed \(8 against NLT 10\)\. The Deviation workflow is not built/)).toBeVisible();
  await rail(ann).getByRole('button', { name: /^Sign Run RD-R-.* as Performed$/ }).click({ force: true });
  await expect(rail(ann).getByText(/The Deviation workflow is not built/)).toBeVisible();
  await shoot(ann, 'workbench-not-built-refusal');

  // 5. Dee, a second Analyst, signs every value of the first Test and its Run Verified in one group.
  const dee = await atPc(browser, 'dee', 'Bench PC RD-102-03');
  await dee.goto(testUrl);
  await sign(dee, 'dee', 'Sign 11 values as Verified', async (sheet) => {
    await expect(sheet.getByRole('region', { name: 'What you are signing' }).getByText('P1 weight on').first()).toBeVisible();
    await shoot(dee, 'verified-prompt-second-analyst');
  });

  // 6. Ann signs the Run Performed.
  await ann.goto(testUrl);
  await sign(ann, 'ann', `Sign Run ${runNumber} as Performed`);

  // 7. Bob reviews the Run: his own Review, every checklist item ticked, then Reviewed.
  const bob = await atPc(browser, 'bob', 'Review desk RD-120');
  await bob.goto(testUrl);
  await bob.getByRole('link', { name: `Review Run ${runNumber}` }).click();
  await reviewAndSign(bob, 'bob', `Run ${runNumber}`, 4);

  // 7b. Ann signs the Test Performed; its verdicts stop being Provisional.
  await ann.goto(testUrl);
  await sign(ann, 'ann', `Sign ${t1} as Performed`, async (sheet) => {
    await expect(sheet.getByRole('region', { name: 'What you are signing' }).getByText(`Run ${runNumber}`)).toBeVisible();
  });
  await expect(ann.getByRole('region', { name: 'Results' }).getByText('Conforms', { exact: true }).first()).toBeVisible();

  // 8. Ann, who also holds Reviewer, may not review the Test she performed: the prompt says why.
  await ann.goto(testUrl);
  await ann.getByRole('link', { name: `Review ${t1}` }).click();
  await press(ann, `Open a Review of ${t1}`, 'Opened your Review on checklist CL-TEST@1.');
  await tickAll(ann, 4);
  await rail(ann).getByRole('button', { name: `Sign ${t1} as Reviewed` }).click();
  const refusedSheet = ann.getByRole('dialog');
  await expect(refusedSheet.getByRole('alert')).toContainText(/cannot sign this as Reviewed/);
  await expect(refusedSheet.getByRole('alert')).toContainText(/performed/i);
  await expect(refusedSheet.getByLabel('Password')).toHaveCount(0);
  await shoot(ann, 'review-refused-reviewer-performed');
  await refusedSheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(ann.getByRole('dialog')).toHaveCount(0);

  // 9. Bob reviews the Test with the inline Audit Trail, and signs it Reviewed.
  await bob.goto(testUrl);
  await bob.getByRole('link', { name: `Review ${t1}` }).click();
  const trail = bob.getByRole('region', { name: `Audit Trail of ${t1}` });
  await expect(trail.getByText('P1 weight', { exact: true }).first()).toBeVisible();
  await reviewAndSign(bob, 'bob', t1, 4);
  await shoot(bob, 'review-reviewer');

  // 10. Bob drafts the report and sends it to QA.
  await bob.getByRole('link', { name: 'Reports', exact: true }).click();
  await bob.getByRole('button', { name: new RegExp(submissionNumber) }).click();
  await rail(bob).getByRole('button', { name: `Draft a Test Report for ${submissionNumber}` }).click();
  await expect(bob.getByRole('heading', { name: /^Test Report RD-TR-/ })).toBeVisible();
  const reportUrl = bob.url();
  const reportNumber = ((await bob.getByRole('heading', { name: /^Test Report RD-TR-/ }).innerText()) ?? '').replace('Test Report ', '');
  await press(bob, `Send Test Report ${reportNumber} to QA`, `Test Report ${reportNumber} is In QA Review.`);

  // 11. QA ticks the release checklist, confirms the verdict and signs Released.
  const cid = await atPc(browser, 'cid', 'QA office RD-130');
  await cid.goto(reportUrl);
  await press(cid, `Open the release Review of Test Report ${reportNumber}`, /^Opened your Review on checklist CL-RELEASE@1/);
  await tickAll(cid, 3);
  await cid.getByRole('button', { name: `Confirm the FDA verdict of ${t1}` }).click();
  await expect(cid.getByText('Confirmed by you')).toBeVisible();
  await sign(cid, 'cid', `Sign Test Report ${reportNumber} as Released`, async (sheet) => {
    const attested = sheet.getByRole('region', { name: 'The Review you attest' });
    await expect(attested).toContainText('Checklist: audit trail reviewed');
    await expect(attested).toContainText(`Verdict: ${t1}, FDA Section`);
    await expect(attested).toContainText('by Cid Marchetti (cid)');
    await shoot(cid, 'release-prompt-qa');
  });
  await expect(cid.getByRole('region', { name: 'Issued PDF' })).toBeVisible();
  await shoot(cid, 'report-released-qa');

  // 12. The Customer downloads the PDF, and its SHA-256 is the one the portal shows.
  const cara2 = await atPc(browser, 'cara', 'Customer laptop', 'Acme Pharma (fictional)');
  const released = cara2.getByRole('listitem', { name: `Test Report ${reportNumber}` });
  const shown = (await released.locator('.hash').innerText()).replace(/\s/g, '');
  expect(shown).toMatch(/^[0-9a-f]{64}$/);
  const [download] = await Promise.all([cara2.waitForEvent('download'), released.getByRole('button', { name: `Download the PDF of ${reportNumber}` }).click()]);
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(shown);
  await expect(rail(cara2).getByText(`Download of ${reportNumber} recorded. The link works once, for 60 seconds.`)).toBeVisible();
  await shoot(cara2, 'portal-released-customer', true);

  console.log(`Screenshots:\n${shots.join('\n')}`);
});

async function tickAll(page: Page, n: number) {
  for (let i = 0; i < n; i++) {
    const tick = page.getByRole('button', { name: /^Tick: / }).first();
    await tick.click();
    await expect(page.getByRole('button', { name: /^Tick: / })).toHaveCount(n - i - 1);
  }
}

async function reviewAndSign(page: Page, who: Who, label: string, items: number) {
  await press(page, `Open a Review of ${label}`, /^Opened your Review on checklist/);
  await tickAll(page, items);
  await sign(page, who, `Sign ${label} as Reviewed`, async (sheet) => {
    await expect(sheet.getByRole('region', { name: 'The Review you attest' })).toContainText('audit trail reviewed');
  });
}
