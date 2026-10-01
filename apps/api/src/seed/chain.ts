// Driving Submissions through the chain as the fictional people, over the doors. Each step is a
// function the seed composes into Submissions in varied states, and the tests reuse for the
// paths they check. Nothing here touches the database directly.

import { RUN_CHECKLIST, RELEASE_CHECKLIST, TEST_CHECKLIST, preparationSubject, resultSubject } from '../chain/model.ts';
import type { Cast } from './cast.ts';
import { mustSign, type Client, type Person } from './drive.ts';
import type { Reference } from './reference.ts';

export type Tabs = { readonly acme: Client; readonly beta: Client; readonly sam: Client; readonly lena: Client; readonly ann: Client; readonly dee: Client; readonly bob: Client; readonly cid: Client };

/** The tabs the seed already opened: every login spends a TOTP step, so nobody signs in twice. */
export const openTabs = (cast: Cast, ref: Reference): Tabs => ({ acme: ref.portal.acme, beta: ref.portal.beta, ...cast.tabs });

export type Submitted = { readonly submissionId: string; readonly number: string; readonly samples: readonly { readonly sampleId: string; readonly tests: readonly string[] }[] };

export const submitOne = (portal: Client, lab: string, productId: string, lotNumber: string, methodIds: readonly string[]): Promise<Submitted> =>
  portal.must('submission.submit', { labId: lab, samples: [{ productId, lotNumber, tests: methodIds.map((methodId) => ({ methodId })) }] });

/** Accept every Test and receive the Sample: the Tests are then Ready. */
export async function acceptAndReceive(tabs: Tabs, s: Submitted): Promise<void> {
  for (const sample of s.samples) {
    for (const test of sample.tests) await tabs.sam.must('test.accept', { testId: test });
    await tabs.sam.must('sample.receive', { sampleId: sample.sampleId });
  }
}

export const assign = (tabs: Tabs, testId: string, analyst: Person): Promise<unknown> => tabs.lena.must('test.assign', { testId, analystId: analyst.id });

export type PreparationEntry = { readonly weightMg: string; readonly dilutionMl: string; readonly results: Readonly<Record<string, string>> };

/** The Analyst's typed Run for one Test: instrument, sequence, True Copy, two Preparations on the balance, and the two Run Checks. */
export async function typeRun(tabs: Tabs, ref: Reference, testId: string, opts: {
  readonly preparations: readonly PreparationEntry[];
  readonly runChecks: Readonly<Record<string, string>>;
  readonly trueCopy?: string;
}): Promise<{ readonly runId: string; readonly values: Record<string, string>; readonly runValues: Record<string, string> }> {
  await tabs.ann.must('test.start', { testId });
  const run = await tabs.ann.must('run.create', {
    methodVersionId: ref.methods.lcms.versionId, equipmentId: ref.equipment.lcms1, sequenceId: `SEQ-${testId.slice(0, 8)}`,
    trueCopy: { mediaType: 'application/pdf', base64: Buffer.from(opts.trueCopy ?? `%PDF-1.7 fictional printout for ${testId}`).toString('base64') },
  });
  await tabs.ann.must('run.linkTest', { runId: run.runId, testId });
  const values: Record<string, string> = {};
  const runValues: Record<string, string> = { ...run.values };
  const record = async (parent: string, field: string, subject: string, value: string, unit: string): Promise<string> =>
    (await tabs.ann.must('value.record', { role: 'Analyst', parent, field, subject, value: { type: 'decimal', value, unit } })).value;
  for (const p of opts.preparations) {
    const prep = await tabs.ann.must('preparation.create', { testId, balanceId: ref.equipment.bal1 });
    const subject = preparationSubject(prep.prepNo);
    values[`balance ${subject}`] = prep.balanceValueId;
    values[`weight ${subject}`] = await record(testId, 'prep.weight', subject, p.weightMg, 'mg');
    values[`dilution ${subject}`] = await record(testId, 'prep.dilution', subject, p.dilutionMl, 'mL');
    for (const [analyte, c] of Object.entries(p.results)) values[`result ${resultSubject(prep.prepNo, analyte)}`] = await record(testId, 'prep.result', resultSubject(prep.prepNo, analyte), c, 'pg/µL');
  }
  for (const [name, value] of Object.entries(opts.runChecks)) {
    runValues[name] = await record(run.runId, 'runcheck.value', name, value, name.includes('recovery') ? '%' : 'ratio');
  }
  return { runId: run.runId, values, runValues };
}

/** Verified, value by value, as one group signing by the second Analyst. */
export async function verifyAll(tabs: Tabs, cast: Cast, valueIds: readonly string[]): Promise<void> {
  await mustSign(tabs.dee, cast.dee, 'Verified', 'Analyst', valueIds);
}

export const idsOf = (values: Record<string, string>): string[] => Object.values(values);

/** Opens a Review on the record and ticks every checklist item. */
export async function review(tab: Client, role: 'Reviewer' | 'QA', recordId: string, items: readonly string[]): Promise<string> {
  const opened = await tab.must('review.open', { recordId, role });
  for (const item of items) await tab.must('review.tick', { reviewId: opened.reviewId, item, role });
  return opened.reviewId as string;
}

export async function runPerformedAndReviewed(tabs: Tabs, cast: Cast, runId: string): Promise<void> {
  await mustSign(tabs.ann, cast.ann, 'Performed', 'Analyst', [runId]);
  const reviewId = await review(tabs.bob, 'Reviewer', runId, RUN_CHECKLIST.items);
  await mustSign(tabs.bob, cast.bob, 'Reviewed', 'Reviewer', [runId], reviewId);
}

export async function testPerformedAndReviewed(tabs: Tabs, cast: Cast, testId: string): Promise<void> {
  await mustSign(tabs.ann, cast.ann, 'Performed', 'Analyst', [testId]);
  const reviewId = await review(tabs.bob, 'Reviewer', testId, TEST_CHECKLIST.items);
  await mustSign(tabs.bob, cast.bob, 'Reviewed', 'Reviewer', [testId], reviewId);
}

export async function draftAndRelease(tabs: Tabs, cast: Cast, submissionId: string, testIds: readonly string[], jurisdictions: readonly string[] = ['FDA']): Promise<{ reportId: string; number: string }> {
  const drafted = await tabs.bob.must('report.draft', { submissionId, testIds, role: 'Reviewer' });
  await tabs.bob.must('report.submitToQa', { reportId: drafted.reportId, role: 'Reviewer' });
  const reviewId = await review(tabs.cid, 'QA', drafted.reportId, RELEASE_CHECKLIST.items);
  for (const testId of testIds) {
    for (const jurisdiction of jurisdictions) await tabs.cid.must('review.confirmVerdict', { reviewId, testId, jurisdiction, confirmation: 'confirmed' });
  }
  await mustSign(tabs.cid, cast.cid, 'Released', 'QA', [drafted.reportId], reviewId);
  return { reportId: drafted.reportId, number: drafted.number };
}

/** Values that pass every criterion: two Preparations near 0.12 ppm against NMT 0.30 ppm, S/N 18 against NLT 10, recovery 98.4 % in 80.0–120.0. */
export const PASSING = {
  preparations: [
    { weightMg: '100.12', dilutionMl: '10.0', results: { NDMA: '1.234' } },
    { weightMg: '99.87', dilutionMl: '10.0', results: { NDMA: '1.201' } },
  ],
  runChecks: { 'S/N at LOQ standard': '18', 'Check standard recovery': '98.4' },
} as const;

/** One Submission through every step, to a Released report and its download. */
export async function fullChain(tabs: Tabs, cast: Cast, ref: Reference, portal: Client, productId: string, lotNumber: string): Promise<{
  submitted: Submitted; testId: string; runId: string; report: { reportId: string; number: string }; download: { sha256: string; url: string };
}> {
  const submitted = await submitOne(portal, cast.lab.id, productId, lotNumber, [ref.methods.lcms.id]);
  await acceptAndReceive(tabs, submitted);
  const testId = submitted.samples[0]!.tests[0]!;
  await assign(tabs, testId, cast.ann);
  const typed = await typeRun(tabs, ref, testId, PASSING);
  await verifyAll(tabs, cast, [...idsOf(typed.runValues), ...idsOf(typed.values)]);
  await runPerformedAndReviewed(tabs, cast, typed.runId);
  await testPerformedAndReviewed(tabs, cast, testId);
  const report = await draftAndRelease(tabs, cast, submitted.submissionId, [testId]);
  const r = await portal.command('report.download', { reportId: report.reportId, labId: cast.lab.id });
  if (r.status !== 200) throw new Error(`report.download: ${JSON.stringify(r.body)}`);
  return { submitted, testId, runId: typed.runId, report, download: { sha256: r.body.data.sha256, url: r.body.once.url } };
}
