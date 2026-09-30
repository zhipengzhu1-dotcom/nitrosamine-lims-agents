// Test-plan D19, D20 and D21 over the seeded demo dataset, plus Customer scoping, the release
// lock at the API, the seed's data cap and "GET never writes" for the chain's views. The seed
// drives one Submission through every step as the fictional people, over the doors, with real
// enrolment and re-authentication; the tests assert on what it left behind and drive the two
// refusal paths on the Ready Tests it seeded.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMPANY_LEDGER, ledgerOf, verifyChain } from '@lims/db';
import { CHAIN } from '../src/chain/index.ts';
import { readStanding } from '../src/records/standing.ts';
import { assign, idsOf, PASSING, review, runPerformedAndReviewed, testPerformedAndReviewed, typeRun, verifyAll } from '../src/seed/chain.ts';
import { RELEASE_CHECKLIST } from '../src/chain/model.ts';
import { seedCounts, seedDemo, SEED_CAP, type SeedResult } from '../src/seed/index.ts';
import { signAs, testApi, type TestApi } from '../src/testing/harness.ts';

let api: TestApi;
let seed: SeedResult;

beforeAll(async () => {
  api = await testApi(CHAIN);
  seed = await seedDemo(api, api.deps);
});
afterAll(() => api.close());

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const refusalOf = (r: { body: any }) => r.body.refusal as { kind: string; message: string; reasons?: { code: string }[] };
const gaps = (feature: string) => api.db.app.selectFrom('spec_gap').select('id').where('feature', '=', feature).execute();

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
      const standing = await readStanding(api.db.app, s.record_version_id as never);
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
  it('a change to a value behind a Released report is refused, and so is an in-place change to the Test', async () => {
    const value = await api.db.app.selectFrom('recorded_value').select('record_id').where('parent_id', '=', seed.submissions.released.testId).where('field', '=', 'prep.weight').executeTakeFirstOrThrow();
    const r = await seed.tabs.bob.command('value.change', { role: 'Reviewer', value: value.record_id, to: { type: 'decimal', value: '100.13', unit: 'mg' }, reason: { code: 'transcription-error' } });
    expect(r.status).toBe(409);
    expect(refusalOf(r).message).toMatch(/locked by a Released Test Report/);
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
    expect(run.body.runChecks.find((c: { name: string }) => c.name === 'S/N at LOQ standard')).toMatchObject({ value: '8', criterion: 'NLT 10', source: expect.stringMatching(/<621>/), outcome: 'does-not-conform' });
    expect(run.body.signatures).toEqual([]);
  });
});

describe('D20: the UNSIGNED path', () => {
  it('an approved Critical Data Change on a Run Check unsigns the Run, the Test version citing it, and blocks Test Performed until the Run is signed again', async () => {
    const testId = seed.submissions.ready.samples[0]!.tests[1]!;
    await assign(seed.tabs, testId, seed.cast.ann);
    const typed = await typeRun(seed.tabs, seed.reference, testId, PASSING);
    await verifyAll(seed.tabs, seed.cast, [...idsOf(typed.runValues), ...idsOf(typed.values)]);
    await runPerformedAndReviewed(seed.tabs, seed.cast, typed.runId);
    const runV1 = (await seed.tabs.ann.view('run.detail', { runId: typed.runId })).body.run.version;
    const prepared = await seed.tabs.ann.must('signing.prepare', { meaning: 'Performed', role: 'Analyst', targets: [testId], attestation: null });
    const testV1 = prepared.items[0].version;
    expect(prepared.items[0].body.runs[0]).toMatchObject({ version: runV1.versionId, sha256: runV1.hash });

    const recovery = typed.runValues['Check standard recovery']!;
    const proposed = await seed.tabs.ann.must('value.change', { role: 'Analyst', value: recovery, to: { type: 'decimal', value: '98.6', unit: '%' }, reason: { code: 'transcription-error' } });
    expect(proposed.standing).toBe('pending');
    expect((await seed.tabs.ann.view('signing.standing', { versionId: runV1.versionId })).body.kind).toBe('signed');
    const approved = await signAs(seed.tabs.bob, seed.cast.bob, 'Approved', 'Reviewer', [recovery]);
    expect(approved.status).toBe(200);

    const runStanding = await seed.tabs.ann.view('signing.standing', { versionId: runV1.versionId });
    expect(runStanding.body).toMatchObject({ kind: 'changed-after-signature', signed: [{ meaning: 'Performed' }, { meaning: 'Reviewed' }] });
    const testStanding = await seed.tabs.ann.view('signing.standing', { versionId: testV1.versionId });
    expect(testStanding.body.kind).toBe('unsigned');
    const stands = await api.db.app.selectNoFrom((eb) => eb.fn<boolean>('lims.version_stands', [eb.val(testV1.versionId)]).as('s')).executeTakeFirstOrThrow();
    expect(stands.s).toBe(false);

    const refused = await signAs(seed.tabs.ann, seed.cast.ann, 'Performed', 'Analyst', [testId]);
    expect(refused.status).toBe(409);
    expect(refusalOf(refused).reasons!.map((r) => r.code)).toContain('unsigned-dependency');

    await runPerformedAndReviewed(seed.tabs, seed.cast, typed.runId);
    const runV2 = (await seed.tabs.ann.view('run.detail', { runId: typed.runId })).body.run.version;
    expect(runV2.versionNo).toBe(runV1.versionNo + 1);
    await testPerformedAndReviewed(seed.tabs, seed.cast, testId);
    const detail = await seed.tabs.ann.view('test.detail', { testId });
    expect(detail.body.test.state).toBe('Reviewed');
    expect(detail.body.runs).toEqual([expect.objectContaining({ state: 'Reviewed', version: runV2 })]);
    expect(detail.body.signatures.map((s: { meaning: string; stands: boolean }) => [s.meaning, s.stands])).toEqual([['Performed', true], ['Reviewed', true]]);
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

  it('the assignment view offers only eligible Analysts', async () => {
    const r = await seed.tabs.lena.view('test.assignment', { testId: seed.submissions.requested.samples[0]!.tests[0]! });
    expect(r.body.eligible).toEqual([]); // not accepted yet: no Method version to be trained on
    const ready = await seed.tabs.lena.view('test.assignment', { testId: seed.submissions.ready.samples[0]!.tests[0]! });
    expect(ready.body.eligible.map((a: { username: string }) => a.username).sort()).toEqual(['ann', 'dee']);
  });
});

describe('review fix 2: a release waits for every pending change behind it', () => {
  it('names the pending change on the Test and the one on its Run, then releases once both are settled', async () => {
    const testId = seed.submissions.ready.samples[0]!.tests[1]!;
    expect((await seed.tabs.ann.view('test.detail', { testId })).body.test.state).toBe('Reviewed');
    const run = await api.db.app.selectFrom('run_test').select('run_id').where('test_id', '=', testId).executeTakeFirstOrThrow();
    const weight = await api.db.app.selectFrom('recorded_value').select('record_id').where('parent_id', '=', testId).where('field', '=', 'prep.weight').orderBy('subject').executeTakeFirstOrThrow();
    const recovery = await api.db.app.selectFrom('recorded_value').select('record_id').where('parent_id', '=', run.run_id).where('subject', 'like', '%recovery%').executeTakeFirstOrThrow();
    const propose = (value: string, to: { value: string; unit: string }) =>
      seed.tabs.bob.must('value.change', { role: 'Reviewer', value, to: { type: 'decimal', ...to }, reason: { code: 'transcription-error' } });
    expect((await propose(weight.record_id, { value: '100.31', unit: 'mg' })).standing).toBe('pending');
    expect((await propose(recovery.record_id, { value: '97.9', unit: '%' })).standing).toBe('pending');

    const drafted = await seed.tabs.bob.must('report.draft', { submissionId: seed.submissions.ready.submissionId, testIds: [testId], role: 'Reviewer' });
    await seed.tabs.bob.must('report.submitToQa', { reportId: drafted.reportId, role: 'Reviewer' });
    const reviewId = await review(seed.tabs.cid, 'QA', drafted.reportId, RELEASE_CHECKLIST.items);
    await seed.tabs.cid.must('review.confirmVerdict', { reviewId, testId, jurisdiction: 'FDA', confirmation: 'confirmed' });
    const refused = await signAs(seed.tabs.cid, seed.cast.cid, 'Released', 'QA', [drafted.reportId], reviewId);
    expect(refused.status).toBe(409);
    const pendingNamed = refusalOf(refused).reasons!.flatMap((r) => (r.code === 'change-pending' ? [(r as { value: string }).value] : []));
    expect(pendingNamed).toEqual([expect.stringMatching(/^prep\.weight/), expect.stringMatching(/^Run .* runcheck\.value/)]);

    for (const value of [weight.record_id, recovery.record_id]) {
      const v = await api.db.app.selectFrom('pending_version').select(['id', 'content_hash']).where('record_id', '=', value).executeTakeFirstOrThrow();
      await seed.tabs.cid.must('value.reject', { role: 'QA', version: { versionId: v.id, hash: v.content_hash!.toString('hex') }, reason: { code: 'wrong-item-selected' } });
    }
    const released = await signAs(seed.tabs.cid, seed.cast.cid, 'Released', 'QA', [drafted.reportId], reviewId);
    expect(released.status).toBe(200);
    expect((await seed.tabs.ann.view('test.detail', { testId })).body.test.state).toBe('Reported');
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
