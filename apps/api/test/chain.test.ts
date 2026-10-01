// Test-plan D19, D20 and D21 over the seeded demo dataset, plus Customer scoping, the release
// lock at the API, the seed's data cap and "GET never writes" for the chain's views. The seed
// drives one Submission through every step as the fictional people, over the doors, with real
// enrolment and re-authentication; the tests assert on what it left behind and drive the two
// refusal paths on the Ready Tests it seeded.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMPANY_LEDGER, ledgerOf, runAudited, seal, verifyChain } from '@lims/db';
import { canonicalBytes } from '@lims/domain/canonical';
import { CHAIN } from '../src/chain/index.ts';
import { readStanding } from '../src/records/standing.ts';
import { acceptAndReceive, assign, idsOf, PASSING, review, runPerformedAndReviewed, submitOne, testPerformedAndReviewed, typeRun, verifyAll, type Tabs } from '../src/seed/chain.ts';
import type { Person } from '../src/seed/drive.ts';
import { preparationSubject, RELEASE_CHECKLIST, resultSubject, RUN_CHECKLIST, TEST_CHECKLIST } from '../src/chain/model.ts';
import { seedCounts, seedDemo, SEED_CAP, type SeedResult } from '../src/seed/index.ts';
import { signAs, testApi, type TestApi } from '../src/testing/harness.ts';

let api: TestApi;
let seed: SeedResult;
let seedWorkstations: string[];

beforeAll(async () => {
  api = await testApi(CHAIN);
  seed = await seedDemo(api, api.deps);
  seedWorkstations = (await api.db.app.selectFrom('session').select('workstation').distinct().execute()).map((s) => s.workstation);
});
afterAll(() => api.close());

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const refusalOf = (r: { body: any }) => r.body.refusal as { kind: string; message: string; reasons?: { code: string; value?: string }[] };
const gaps = (feature: string) => api.db.app.selectFrom('spec_gap').select(['id', 'record_id']).where('feature', '=', feature).execute();

/** A new Test on the LC-MS/MS Method, accepted, received and assigned to Ann. */
async function freshTest(lotNumber: string): Promise<string> {
  const s = await submitOne(seed.tabs.acme, seed.cast.lab.id, seed.reference.products.fic02, lotNumber, [seed.reference.methods.lcms.id]);
  await acceptAndReceive(seed.tabs, s);
  const testId = s.samples[0]!.tests[0]!;
  await assign(seed.tabs, testId, seed.cast.ann);
  return testId;
}

/**
 * A value version written straight through the database doors, as a later module might, so the
 * gates can be proved to hold without the app's writer rule in front of them.
 */
async function plant(person: Person, role: string, parent: string, field: string, subject: string, value: { text: string; unit: string | null; type: 'decimal' | 'boolean' }, existing: string | null = null): Promise<string> {
  const lab = seed.cast.lab.id;
  const session = await api.db.app.selectFrom('session').select('id').where('person_id', '=', person.id).where('ended_at', 'is', null).orderBy('started_at', 'desc').executeTakeFirstOrThrow();
  const out = await runAudited(api.db.app, {
    person: person.id as never, role, actingLab: lab as never, customer: null, action: 'test.plant', reason: existing ? { kind: 'picklist', code: 'transcription-error' } : { kind: 'first_save' },
    appRelease: 'test', session: session.id as never, commitKey: randomUUID() as never, ledgers: [ledgerOf(lab as never), COMPANY_LEDGER],
  }, { kind: 'lab', labId: lab as never }, async (tx) => {
    const id = existing ?? randomUUID();
    if (!existing) {
      await tx.db.insertInto('record').values({ ledger_id: ledgerOf(lab as never), id, kind: 'value', parent_id: parent }).execute();
      await tx.db.insertInto('recorded_value').values({ ledger_id: ledgerOf(lab as never), record_id: id, parent_id: parent, field, subject, critical: value.type === 'decimal', value_type: value.type, unit: value.unit }).execute();
    }
    const canon = value.type === 'decimal' ? { type: 'decimal', value: value.text, unit: value.unit } : { type: 'boolean', value: value.text === 'true' };
    const v = await seal(tx, id as never, canonicalBytes({ schema: 'value@1', parent, field, subject, value: canon }), 'value@1');
    await tx.db.insertInto('recorded_value_version').values({ ledger_id: ledgerOf(lab as never), version_id: v.versionId, value_text: value.text, decimals: value.type === 'decimal' ? (value.text.split('.')[1]?.length ?? 0) : null, blob_hash: null }).execute();
    return { commit: id };
  });
  if (!('commit' in out)) throw new Error('plant rolled back');
  return out.commit;
}

const notPermitted = (r: { status: number; body: any }, message: RegExp) => {
  expect(r.status).toBe(403);
  expect(refusalOf(r).message).toMatch(message);
};

describe('the seed', () => {
  it('signs everyone in on workstation seed-script, so no seeded session looks like a bench PC or the portal', () => {
    expect(seedWorkstations).toEqual(['seed-script']);
  });
});

describe('D19: the whole chain', () => {
  it('the Customer downloads the PDF and its SHA-256 equals the one stored with the Released signature', async () => {
    const { report, download } = seed.submissions.released;
    const issue = await api.db.app.selectFrom('report_issue').select('pdf_sha256').where('released_signature', 'in',
      api.db.app.selectFrom('signature').select('id').where('meaning', '=', 'Released')).executeTakeFirstOrThrow();
    expect(download.sha256).toBe(issue.pdf_sha256.toString('hex'));
    const file = await seed.tabs.acme.file(download.url);
    expect(file.status).toBe(200);
    expect(sha256(file.bytes)).toBe(download.sha256);
    expect(file.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(file.headers['content-disposition']).toBe(`attachment; filename="${report.number}.pdf"`);
    expect((await seed.tabs.acme.file(download.url)).status).toBe(404);
    const audited = await api.db.app.selectFrom('audit_entry').select('table_name').where('table_name', '=', 'report_download').where('person_id', '=', seed.cast.cara.id).execute();
    expect(audited).toHaveLength(1);
  });

  it('both audit chains verify intact from their stored bytes', async () => {
    for (const ledger of [COMPANY_LEDGER, ledgerOf(seed.cast.lab.id)]) {
      const v = await verifyChain(api.db.app, ledger);
      expect(v.firstBreak, ledger).toBeNull();
      expect(v.headMatches, ledger).toBe(true);
      expect(v.intactThrough).toBeGreaterThan(50);
    }
    const view = await seed.tabs.cid.view('audit.chain');
    expect(view.status).toBe(200);
    expect(view.body.ledgers.map((l: { code: string; headMatches: boolean }) => [l.code, l.headMatches])).toEqual([['CO', true], ['RD', true]]);
  });

  it('the Test version carries its Run Version id and hash, in its bytes and in the cite table', async () => {
    const { testId, runId } = seed.submissions.released;
    const test = await api.db.app.selectFrom('effective_version').select(['id', 'content']).where('record_id', '=', testId).executeTakeFirstOrThrow();
    const run = await api.db.app.selectFrom('effective_version').select(['id', 'content_hash']).where('record_id', '=', runId).executeTakeFirstOrThrow();
    const body = JSON.parse(test.content!.toString('utf8')) as { runs: { run: string; version: string; sha256: string }[]; judgement: { outcome: string } };
    expect(body.runs).toEqual([{ run: runId, number: expect.stringMatching(/^RD-R-\d{4}-\d{6}$/), version: run.id, sha256: run.content_hash!.toString('hex') }]);
    expect(body.judgement.outcome).toBe('conforms');
    const cites = await api.db.app.selectFrom('record_version_cite').select('cited_version').where('version_id', '=', test.id!).execute();
    expect(cites.map((c) => c.cited_version)).toContain(run.id);
  });

  it('every signature on the released chain stands, and the Test is Reported behind a Released report', async () => {
    const signatures = await api.db.app.selectFrom('signature').select(['record_version_id', 'meaning']).execute();
    expect(signatures.map((s) => s.meaning)).toEqual(expect.arrayContaining(['Acknowledged', 'Approved', 'Verified', 'Performed', 'Reviewed', 'Released']));
    for (const s of signatures) {
      const standing = await readStanding(api.db.app, s.record_version_id as never, api.deps.kinds);
      expect(standing.kind, `${s.meaning} on ${s.record_version_id}`).toBe('signed');
    }
    const test = await api.db.app.selectFrom('test').select('state').where('id', '=', seed.submissions.released.testId).executeTakeFirstOrThrow();
    expect(test.state).toBe('Reported');
    const verdicts = await api.db.app.selectFrom('section_verdict').select(['jurisdiction', 'analyte', 'limit_text', 'compared_text', 'outcome', 'calculation_version']).execute();
    expect(verdicts).toEqual([{ jurisdiction: 'FDA', analyte: 'NDMA', limit_text: '0.30', compared_text: '0.12', outcome: 'conforms', calculation_version: 'calc-2026.1' }]);
  });

  it('the seed stays within the owner\'s cap', async () => {
    const counts = await seedCounts(api.db.app);
    for (const [k, cap] of Object.entries(SEED_CAP)) expect(counts[k as keyof typeof SEED_CAP], k).toBeLessThanOrEqual(cap);
    expect(counts.people).toBe(8);
  });
});

describe('Customer scoping', () => {
  it('a Customer User sees only its own Submissions and released reports, per Customer acted for', async () => {
    const acme = await seed.tabs.acme.view('portal.submissions');
    const beta = await seed.tabs.beta.view('portal.submissions');
    expect(acme.status).toBe(200);
    const acmeNumbers = acme.body.submissions.map((s: { number: string }) => s.number).sort();
    const betaNumbers = beta.body.submissions.map((s: { number: string }) => s.number).sort();
    expect(acmeNumbers).toHaveLength(4);
    expect(betaNumbers).toEqual([seed.submissions.inProgress.number]);
    expect(acmeNumbers).not.toContain(seed.submissions.inProgress.number);
    const rejected = acme.body.submissions.find((s: { number: string }) => s.number === seed.submissions.rejected.number);
    expect(rejected.samples[0].tests[0]).toMatchObject({ status: 'Rejected', rejectionReason: expect.stringMatching(/in development/) });
    expect(rejected.status).toBe('Rejected');
    const reports = await seed.tabs.acme.view('portal.reports');
    expect(reports.body.reports).toEqual([expect.objectContaining({ number: seed.submissions.released.report.number, pdfSha256: seed.submissions.released.download.sha256 })]);
    expect((await seed.tabs.beta.view('portal.reports')).body.reports).toEqual([]);
    expect((await seed.tabs.beta.command('report.download', { reportId: seed.submissions.released.report.reportId, labId: seed.cast.lab.id })).status).toBe(403);
    expect((await seed.tabs.acme.view('queue.tests')).status).toBe(403);
  });
});

describe('the release lock at the API', () => {
  it('a change to a value behind a Released report is refused by the writer rule, then by the lock when written past it; so is an in-place change to the Test', async () => {
    const value = await api.db.app.selectFrom('recorded_value').select(['record_id', 'parent_id', 'field', 'subject']).where('parent_id', '=', seed.submissions.released.testId).where('field', '=', 'prep.weight').executeTakeFirstOrThrow();
    notPermitted(await seed.tabs.ann.command('value.change', { role: 'Analyst', value: value.record_id, to: { type: 'decimal', value: '100.13', unit: 'mg' }, reason: { code: 'transcription-error' } }), /is Reported; its values are recorded while it is In Progress/);
    await expect(plant(seed.cast.ann, 'Analyst', value.parent_id, value.field, value.subject, { text: '100.13', unit: 'mg', type: 'decimal' }, value.record_id)).rejects.toMatchObject({ code: 'LR001' });
    const reassign = await seed.tabs.lena.command('test.reassign', { testId: seed.submissions.released.testId, analystId: seed.cast.dee.id, reason: { code: 'other', text: 'try' } });
    expect(reassign.status).toBe(409);
  });
});

describe('D21: the not-built path', () => {
  it('a failing Run Check value saves; Run Performed is refused with the Deviation message and one spec_gap row', async () => {
    const testId = seed.submissions.ready.samples[0]!.tests[0]!; // assigned to ann by the seed
    const typed = await typeRun(seed.tabs, seed.reference, testId, { ...PASSING, runChecks: { ...PASSING.runChecks, 'S/N at LOQ standard': '8' } });
    await verifyAll(seed.tabs, seed.cast, [...idsOf(typed.runValues), ...idsOf(typed.values)]);
    const before = (await gaps('deviation-workflow')).length;
    const r = await signAs(seed.tabs.ann, seed.cast.ann, 'Performed', 'Analyst', [typed.runId]);
    expect(r.status).toBe(409);
    expect(refusalOf(r).message).toBe('Deviation workflow not built in the skeleton: Run Check S/N at LOQ standard does not conform (8 against NLT 10).');
    expect((await gaps('deviation-workflow')).length).toBe(before + 1);
    const run = await seed.tabs.ann.view('run.detail', { runId: typed.runId });
    expect(run.body.runChecks.find((c: { name: string }) => c.name === 'S/N at LOQ standard')).toMatchObject({ value: '8', criterion: 'NLT 10', source: 'NA-LCMS-001@1', outcome: 'does-not-conform' });
    expect(run.body.signatures).toEqual([]);
    const test = await seed.tabs.ann.view('test.detail', { testId });
    const runStep = test.body.test.steps.find((s: { name: string }) => s.name === 'Run');
    expect(runStep).toMatchObject({ state: 'blocked', reasons: [expect.stringMatching(/Run Check S\/N at LOQ standard failed \(8 against NLT 10\)\. The Deviation workflow is not built/)] });
    expect(test.body.judgement.sections[0].lines[0].outcome).toBe('conforms');
    expect(test.body.performedStands).toBe(false);
  });
});

describe('D20: the UNSIGNED path', () => {
  it('an approved Critical Data Change on a returned Test unsigns its Performed version; the Test is signed again on the next one', async () => {
    const testId = seed.submissions.ready.samples[0]!.tests[1]!;
    await assign(seed.tabs, testId, seed.cast.ann);
    const typed = await typeRun(seed.tabs, seed.reference, testId, PASSING);
    await verifyAll(seed.tabs, seed.cast, [...idsOf(typed.runValues), ...idsOf(typed.values)]);
    await runPerformedAndReviewed(seed.tabs, seed.cast, typed.runId);
    expect((await signAs(seed.tabs.ann, seed.cast.ann, 'Performed', 'Analyst', [testId])).status).toBe(200);
    const testV1 = await api.db.app.selectFrom('effective_version').select(['id', 'version_no']).where('record_id', '=', testId).executeTakeFirstOrThrow();
    const standingOf = async (versionId: string) => (await seed.tabs.ann.view('signing.standing', { versionId })).body;

    const returned = await seed.tabs.bob.command('test.return', { testId, reason: { code: 'other', text: 'P1 weight does not match the printout.' } });
    expect(returned.status).toBe(200);
    const weight = typed.values['weight P1']!;
    const proposed = await seed.tabs.ann.must('value.change', { role: 'Analyst', value: weight, to: { type: 'decimal', value: '100.13', unit: 'mg' }, reason: { code: 'transcription-error' } });
    expect(proposed.standing).toBe('pending');
    expect((await standingOf(testV1.id!)).kind).toBe('signed');
    const approved = await signAs(seed.tabs.bob, seed.cast.bob, 'Approved', 'Reviewer', [weight]);
    expect(approved.status).toBe(200);

    expect(await standingOf(testV1.id!)).toMatchObject({ kind: 'changed-after-signature', signed: [{ meaning: 'Performed' }] });
    const stands = await api.db.app.selectNoFrom((eb) => eb.fn<boolean>('lims.version_stands', [eb.val(testV1.id!)]).as('s')).executeTakeFirstOrThrow();
    expect(stands.s).toBe(false);

    await testPerformedAndReviewed(seed.tabs, seed.cast, testId);
    const testV2 = await api.db.app.selectFrom('effective_version').select('version_no').where('record_id', '=', testId).executeTakeFirstOrThrow();
    expect(testV2.version_no).toBe(testV1.version_no! + 1);
    const detail = await seed.tabs.ann.view('test.detail', { testId });
    expect(detail.body.test.state).toBe('Reviewed');
    expect(detail.body.signatures.map((s: { meaning: string; stands: boolean }) => [s.meaning, s.stands])).toEqual([['Performed', true], ['Reviewed', true]]);
  });
});

describe('review fix 4: each field names its writer and the states it is written in', () => {
  let testId: string;
  let typed: Awaited<ReturnType<typeof typeRun>>;
  const decimal = (value: string, unit: string) => ({ type: 'decimal' as const, value, unit });
  const reason = { code: 'transcription-error' as const };

  beforeAll(async () => {
    testId = await freshTest('FIC-26-0430');
    typed = await typeRun(seed.tabs, seed.reference, testId, PASSING);
  });

  it("a Test's values are written by the assigned Analyst as an Analyst, not by another Analyst or a Reviewer", async () => {
    notPermitted(await seed.tabs.dee.command('value.record', { role: 'Analyst', parent: testId, field: 'prep.weight', subject: 'P3', value: decimal('1.00', 'mg') }), /assigned to another Analyst/);
    notPermitted(await seed.tabs.ann.command('value.record', { role: 'Reviewer', parent: testId, field: 'prep.weight', subject: 'P3', value: decimal('1.00', 'mg') }), /recorded as an Analyst/);
    notPermitted(await seed.tabs.dee.command('value.change', { role: 'Analyst', value: typed.values['weight P1'], to: decimal('100.13', 'mg'), reason }), /assigned to another Analyst/);
    notPermitted(await seed.tabs.bob.command('value.change', { role: 'Reviewer', value: typed.values['weight P1'], to: decimal('100.13', 'mg'), reason }), /assigned to another Analyst/);
  });

  it("a Run's values are written by the Analyst who acquired it", async () => {
    notPermitted(await seed.tabs.dee.command('value.change', { role: 'Analyst', value: typed.runValues['Check standard recovery'], to: decimal('98.5', '%'), reason }), /acquired by another Analyst/);
  });

  it('a Review is filled by the person who opened it, through value.record as well', async () => {
    const opened = await seed.tabs.bob.must('review.open', { recordId: typed.runId, role: 'Reviewer' });
    notPermitted(await seed.tabs.dee.command('value.record', { role: 'Analyst', parent: opened.reviewId, field: 'checklist.item', subject: RUN_CHECKLIST.items[0], value: { type: 'boolean', value: true } }), /opened by another person/);
  });

  it('once Performed, the acquirer changes nothing on the Run and the assignee nothing on the Test', async () => {
    await verifyAll(seed.tabs, seed.cast, [...idsOf(typed.runValues), ...idsOf(typed.values)]);
    await runPerformedAndReviewed(seed.tabs, seed.cast, typed.runId);
    notPermitted(await seed.tabs.ann.command('value.change', { role: 'Analyst', value: typed.runValues['Check standard recovery'], to: decimal('98.5', '%'), reason }), /is Performed; its values are recorded while it is Open/);
    expect((await signAs(seed.tabs.ann, seed.cast.ann, 'Performed', 'Analyst', [testId])).status).toBe(200);
    notPermitted(await seed.tabs.ann.command('value.change', { role: 'Analyst', value: typed.values['weight P1'], to: decimal('100.13', 'mg'), reason }), /is Submitted for Review; its values are recorded while it is In Progress/);
  });

  it("the Reviewed gate counts only the Reviewer's own ticks, and a Review closes once a signature cites it", async () => {
    const [first, ...rest] = TEST_CHECKLIST.items;
    const stranger = (await seed.tabs.bob.must('review.open', { recordId: testId, role: 'Reviewer' })).reviewId as string;
    await plant(seed.cast.dee, 'Analyst', stranger, 'checklist.item', first!, { text: 'true', unit: null, type: 'boolean' });
    for (const item of rest) await seed.tabs.bob.must('review.tick', { reviewId: stranger, item, role: 'Reviewer' });
    const refused = await signAs(seed.tabs.bob, seed.cast.bob, 'Reviewed', 'Reviewer', [testId], stranger);
    expect(refused.status).toBe(409);
    expect(refusalOf(refused).reasons!.map((r) => r.code)).toContain('checklist-incomplete');

    const own = await review(seed.tabs.bob, 'Reviewer', testId, TEST_CHECKLIST.items);
    expect((await signAs(seed.tabs.bob, seed.cast.bob, 'Reviewed', 'Reviewer', [testId], own)).status).toBe(200);
    notPermitted(await seed.tabs.bob.command('value.record', { role: 'Reviewer', parent: own, field: 'verdict.confirmation', subject: 'late', value: { type: 'text', value: 'confirmed' } }), /A signature cites this Review/);
  });
});

describe('the chain\'s views', () => {
  it('every chain view runs over the door with no row inserted, updated or deleted', async () => {
    const t = seed.submissions.released;
    const review = await api.db.app.selectFrom('review').select('id').executeTakeFirstOrThrow();
    const inputs: Record<string, [tab: 'ann' | 'acme', query: Record<string, string>]> = {
      'queue.tests': ['ann', {}], 'test.detail': ['ann', { testId: t.testId }], 'run.detail': ['ann', { runId: t.runId }], 'review.detail': ['ann', { reviewId: review.id }],
      'report.detail': ['ann', { reportId: t.report.reportId }], 'test.assignment': ['ann', { testId: seed.submissions.ready.samples[0]!.tests[0]! }], 'lab.reference': ['ann', {}], 'audit.chain': ['ann', {}],
      'portal.submissions': ['acme', {}], 'portal.reports': ['acme', {}], 'portal.catalogue': ['acme', {}],
    };
    expect(CHAIN.views.map((v) => v.name).filter((n) => !(n in inputs))).toEqual([]);
    const before = await tableState();
    for (const [name, [tab, query]] of Object.entries(inputs)) {
      const r = await seed.tabs[tab].view(name, query);
      expect(r.status, name).toBe(200);
    }
    expect(await tableState()).toEqual(before);
  });

  it('the assignment view answers for every Analyst: the eligible, and the others with the gate\'s reasons', async () => {
    type Candidate = { username: string; eligible: boolean; reasons: string[] };
    const r = await seed.tabs.lena.view('test.assignment', { testId: seed.submissions.requested.samples[0]!.tests[0]! });
    expect(r.body.candidates.every((c: Candidate) => !c.eligible && /not accepted yet/.test(c.reasons.join(' ')))).toBe(true);
    const ready = await seed.tabs.lena.view('test.assignment', { testId: seed.submissions.ready.samples[0]!.tests[0]! });
    const candidates = ready.body.candidates as Candidate[];
    expect(candidates.filter((c) => c.eligible).map((c) => c.username).sort()).toEqual(['ann', 'dee']);
    const bob = candidates.find((c) => c.username === 'bob')!;
    expect(bob.eligible).toBe(false);
    expect(bob.reasons.join(' ')).toMatch(/Performed/);
  });

  it('the Test screen prints the judgement by Section at full precision, the value rounded once and the share of the limit', async () => {
    const r = await seed.tabs.ann.view('test.detail', { testId: seed.submissions.released.testId });
    expect(r.body.performedStands).toBe(true);
    expect(r.body.judgement.sections).toEqual([expect.objectContaining({
      jurisdiction: 'FDA', ruleSetVersion: 'FDA-RS@1', outcome: 'conforms',
      lines: [expect.objectContaining({
        analyte: 'NDMA', limit: '0.30', unit: 'ppm', fullPrecision: expect.stringMatching(/^0\.121754\d*…$/), compared: '0.12', sharePercent: '40.6', outcome: 'conforms',
        preparations: [
          expect.objectContaining({ preparation: 'P1', fullPrecision: expect.stringMatching(/^0\.123252\d*…$/), compared: '0.12', sharePercent: '41.1', conforms: true }),
          expect.objectContaining({ preparation: 'P2', fullPrecision: expect.stringMatching(/^0\.120256\d*…$/), compared: '0.12', sharePercent: '40.1', conforms: true }),
        ],
      })],
    })]);
    expect(r.body.reviews).toEqual([expect.objectContaining({ reviewer: { printedName: 'Bob Achebe', username: 'bob' }, checklistVersion: 'CL-TEST@2' })]);
    expect(r.body.test.steps.map((s: { state: string }) => s.state)).toEqual(Array(7).fill('done'));
    expect(r.body.test.stateLabel).toBe('Reported');
  });

  it('the queue\'s step model starts a Requested Test at Acceptance and ends a rejected one there with the reason', async () => {
    const q = await seed.tabs.sam.view('queue.tests');
    type Row = { id: string; steps: { name: string; state: string; reasons: string[] }[] };
    const requested = (q.body.tests as Row[]).find((t) => t.id === seed.submissions.requested.samples[0]!.tests[0]!)!;
    expect(requested.steps[0]).toMatchObject({ name: 'Accepted', state: 'current', reasons: [] });
    const rejected = (q.body.tests as Row[]).find((t) => t.id === seed.submissions.rejected.samples[0]!.tests[0]!)!;
    expect(rejected.steps[0]).toMatchObject({ name: 'Accepted', state: 'blocked', reasons: [expect.stringMatching(/Rejected at Acceptance: .*in development/)] });
  });
});

describe('review fix 2: a release waits for every pending change behind it', () => {
  it('names the pending change on the Test and the one on its Run, then releases once both are settled', async () => {
    const testId = seed.submissions.ready.samples[0]!.tests[1]!;
    expect((await seed.tabs.ann.view('test.detail', { testId })).body.test.state).toBe('Reviewed');
    const run = await api.db.app.selectFrom('run_test').select('run_id').where('test_id', '=', testId).executeTakeFirstOrThrow();
    const weight = await api.db.app.selectFrom('recorded_value').select(['record_id', 'parent_id', 'field', 'subject']).where('parent_id', '=', testId).where('field', '=', 'prep.weight').orderBy('subject').executeTakeFirstOrThrow();
    const recovery = await api.db.app.selectFrom('recorded_value').select(['record_id', 'parent_id', 'field', 'subject']).where('parent_id', '=', run.run_id).where('subject', 'like', '%recovery%').executeTakeFirstOrThrow();
    // Nobody may write these through the app once the Test is Reviewed (fix 4), so the pending changes are planted past it.
    await plant(seed.cast.bob, 'Reviewer', weight.parent_id, weight.field, weight.subject, { text: '100.31', unit: 'mg', type: 'decimal' }, weight.record_id);
    await plant(seed.cast.bob, 'Reviewer', recovery.parent_id, recovery.field, recovery.subject, { text: '97.9', unit: '%', type: 'decimal' }, recovery.record_id);
    expect((await api.db.app.selectFrom('pending_version').select('id').where('record_id', 'in', [weight.record_id, recovery.record_id]).execute()).length).toBe(2);

    const drafted = await seed.tabs.bob.must('report.draft', { submissionId: seed.submissions.ready.submissionId, testIds: [testId], role: 'Reviewer' });
    await seed.tabs.bob.must('report.submitToQa', { reportId: drafted.reportId, role: 'Reviewer' });
    const reviewId = await review(seed.tabs.cid, 'QA', drafted.reportId, RELEASE_CHECKLIST.items);
    await seed.tabs.cid.must('review.confirmVerdict', { reviewId, testId, jurisdiction: 'FDA', confirmation: 'confirmed' });
    const refused = await signAs(seed.tabs.cid, seed.cast.cid, 'Released', 'QA', [drafted.reportId], reviewId);
    expect(refused.status).toBe(409);
    const pendingNamed = refusalOf(refused).reasons!.flatMap((r) => (r.code === 'change-pending' ? [r.value] : []));
    expect(pendingNamed).toEqual(['P1 weight', expect.stringMatching(/^Run .* Run Check /)]);

    for (const value of [weight.record_id, recovery.record_id]) {
      const v = await api.db.app.selectFrom('pending_version').select(['id', 'content_hash']).where('record_id', '=', value).executeTakeFirstOrThrow();
      await seed.tabs.cid.must('value.reject', { role: 'QA', version: { versionId: v.id, hash: v.content_hash!.toString('hex') }, reason: { code: 'wrong-item-selected' } });
    }
    const released = await signAs(seed.tabs.cid, seed.cast.cid, 'Released', 'QA', [drafted.reportId], reviewId);
    expect(released.status).toBe(200);
    expect((await seed.tabs.ann.view('test.detail', { testId })).body.test.state).toBe('Reported');
  });
});

describe('review fixes 1, 8 and 26: results integrity', () => {
  it('refuses Performed on a Test with no Run, a Preparation beyond the Method\'s count, and a padded decimal', async () => {
    const submitted = await submitOne(seed.tabs.acme, seed.cast.lab.id, seed.reference.products.fic02, 'FIC-26-0777', [seed.reference.methods.lcms.id]);
    await acceptAndReceive(seed.tabs, submitted);
    const testId = submitted.samples[0]!.tests[0]!;
    await assign(seed.tabs, testId, seed.cast.ann);
    await seed.tabs.ann.must('test.start', { testId });
    const values: string[] = [];
    for (const p of PASSING.preparations) {
      const prep = await seed.tabs.ann.must('preparation.create', { testId, balanceId: seed.reference.equipment.bal1 });
      values.push(prep.balanceValueId);
      const subject = preparationSubject(prep.prepNo);
      const entries = [['prep.weight', subject, p.weightMg, 'mg'], ['prep.dilution', subject, p.dilutionMl, 'mL'], ['prep.result', resultSubject(prep.prepNo, 'NDMA'), p.results.NDMA, 'pg/µL']] as const;
      for (const [field, s, value, unit] of entries) {
        values.push((await seed.tabs.ann.must('value.record', { role: 'Analyst', parent: testId, field, subject: s, value: { type: 'decimal', value, unit } })).value);
      }
    }
    const third = await seed.tabs.ann.command('preparation.create', { testId, balanceId: seed.reference.equipment.bal1 });
    expect(third.status).toBe(409);
    expect(refusalOf(third).message).toMatch(/asks for exactly 2 Preparations/);
    expect((await seed.tabs.ann.view('test.detail', { testId })).body.preparations).toHaveLength(2);
    const padded = await seed.tabs.ann.command('value.record', { role: 'Analyst', parent: testId, field: 'prep.weight', subject: 'P1', value: { type: 'decimal', value: '010', unit: 'mg' } });
    expect(padded.status).toBe(400);
    await verifyAll(seed.tabs, seed.cast, values);
    const refused = await signAs(seed.tabs.ann, seed.cast.ann, 'Performed', 'Analyst', [testId]);
    expect(refused.status).toBe(409);
    expect(refusalOf(refused).reasons!.map((r) => r.code)).toEqual(['no-run-linked']);
    expect(refusalOf(refused).message).toMatch(/^No Run is linked to Test RD-S-\d{4}-\d{6}\/T1; its results come from a Run\.$/);
  });

  it('a Preparation names the balance it was weighed on (fix 12): required, a Balance, and carried in the Test version', async () => {
    const testId = seed.submissions.requested.samples[0]!.tests[0]!;
    await seed.tabs.sam.must('test.accept', { testId });
    await seed.tabs.sam.must('sample.receive', { sampleId: seed.submissions.requested.samples[0]!.sampleId });
    await assign(seed.tabs, testId, seed.cast.ann);
    await seed.tabs.ann.must('test.start', { testId });
    expect((await seed.tabs.ann.command('preparation.create', { testId })).status).toBe(400);
    const lcms = await seed.tabs.ann.command('preparation.create', { testId, balanceId: seed.reference.equipment.lcms1 });
    expect(lcms.status).toBe(403);
    expect(refusalOf(lcms).message).toBe('LCMS-01 is registered as LC-MS/MS, not a Balance.');
    const prep = await seed.tabs.ann.must('preparation.create', { testId, balanceId: seed.reference.equipment.bal1 });
    const detail = await seed.tabs.ann.view('test.detail', { testId });
    expect(detail.body.preparations).toEqual([{ id: prep.preparationId, prepNo: 1, subject: 'P1', balance: { code: 'BAL-01', kind: 'Balance', fitness: 'In use' } }]);
    expect(detail.body.values.find((v: { field: string }) => v.field === 'prep.balance')).toMatchObject({ label: 'P1 balance', subject: 'P1', verified: false });

    const released = await api.db.app.selectFrom('effective_version').select('content').where('record_id', '=', seed.submissions.released.testId).executeTakeFirstOrThrow();
    const body = JSON.parse(released.content!.toString('utf8')) as { preparations: { prepNo: string; balance: { equipment: string; version: string; sha256: string } }[] };
    expect(body.preparations.map((p) => [p.prepNo, p.balance.equipment])).toEqual([['1', 'BAL-01'], ['2', 'BAL-01']]);
    expect(body.preparations[0]!.balance.sha256).toMatch(/^[0-9a-f]{64}$/);

    const asInstrument = await seed.tabs.ann.command('run.create', {
      methodVersionId: seed.reference.methods.lcms.versionId, equipmentId: seed.reference.equipment.bal1, sequenceId: 'SEQ-BAL',
      trueCopy: { mediaType: 'application/pdf', base64: Buffer.from('%PDF-1.7 fictional').toString('base64') },
    });
    expect(asInstrument.status).toBe(403);
    expect(refusalOf(asInstrument).message).toBe('BAL-01 is a Balance, so it cannot be the Run\'s instrument.');

    const changed = await seed.tabs.ann.must('value.change', { role: 'Analyst', value: detail.body.values.find((v: { field: string }) => v.field === 'prep.balance').valueId, to: { type: 'ref', value: seed.reference.equipment.lcms1 }, reason: { code: 'wrong-item-selected' } });
    expect(changed.standing).toBe('pending');
    expect((await signAs(seed.tabs.bob, seed.cast.bob, 'Approved', 'Reviewer', [changed.value])).status).toBe(200);
    const refused = await signAs(seed.tabs.ann, seed.cast.ann, 'Performed', 'Analyst', [testId]);
    expect(refused.status).toBe(409);
    expect(refusalOf(refused).reasons!.map((r) => r.code)).toContain('equipment-wrong-kind');
    expect(refusalOf(refused).message).toMatch(/P1 balance LCMS-01 is registered as LC-MS\/MS, not a Balance\./);
  });

  it('a balance that is not In use is refused when the Preparation is made (decision 15: judged per step)', async () => {
    const testId = seed.submissions.requested.samples[0]!.tests[0]!;
    const made = await seed.tabs.lena.must('reference.equipment', { code: 'BAL-02', kind: 'Balance' });
    await api.db.superuser.query('set session_replication_role = replica');
    await api.db.superuser.query("update lims.equipment set fitness_status = 'Suspended' where id = $1", [made.equipmentId]);
    await api.db.superuser.query('set session_replication_role = default');
    const r = await seed.tabs.ann.command('preparation.create', { testId, balanceId: made.equipmentId });
    expect(r.status).toBe(403);
    expect(refusalOf(r).message).toBe('BAL-02 is Suspended, not In use.');
  });
});

async function tableState(): Promise<Record<string, [number, number]>> {
  const tables = await api.db.superuser.query<{ t: string }>(`select tablename as t from pg_tables where schemaname = 'lims' order by 1`);
  const out: Record<string, [number, number]> = {};
  for (const { t } of tables.rows) {
    const r = await api.db.superuser.query<{ n: string; newest: string }>(`select count(*)::text as n, coalesce(max(xmin::text::bigint), 0)::text as newest from lims.${t}`);
    out[t] = [Number(r.rows[0]!.n), Number(r.rows[0]!.newest)];
  }
  return out;
}
