// The sample chain's signable kinds: Test, Run, Review and Test Report. Each builds its content
// from the effective state in chain/facts.ts, cites every child value and every version it
// depends on by (id, hash), and feeds the same facts to the pure gates at signing.

import { ledgerOf, lockReleased, storeBlob, type AuditedTx } from '@lims/db';
import { cite, type Canon } from '@lims/domain/canonical';
import { releasedGate, reviewedGate, runPerformedGate, testPerformedGate, type GateResult } from '@lims/domain/gates';
import type { PersonId, RecordId, VersionId, VersionRef } from '@lims/domain/ids';
import { TestMachine, TestReportMachine } from '@lims/domain/machines';
import type { Refusal } from '@lims/domain/refusal';
import type { Meaning } from '@lims/domain/signing';
import {
  labOf, loadReport, loadReview, loadRun, loadTest, performerFacts, recordStanding, releaserFacts, reviewerFacts, signedAndStanding, signersOf, valueRef,
  type ReviewFacts, type RunFacts, type TestFacts, type ValueFact,
} from '../../chain/facts.ts';
import { RELEASE_CHECKLIST, RUN_CHECKLIST, TEST_CHECKLIST, move, verdictSubject, type Checklist } from '../../chain/model.ts';
import { renderReportPdf } from '../../chain/pdf.ts';
import { judgementCanon, storeSectionVerdicts } from '../../chain/verdicts.ts';
import type { Sealed } from '../index.ts';
import type { KindDef, RuleContext, Signer } from '../kinds.ts';

const valueCanon = (v: ValueFact): Canon => ({ field: v.field, subject: v.subject, ...(cite(valueRef(v)) as object) });
const labelOf = (v: ValueFact): string => `${v.field}${v.subject ? ` (${v.subject})` : ''}`;
const unverified = (values: readonly ValueFact[]): string[] => values.filter((v) => !v.verified).map(labelOf);
const pendingOf = (values: readonly ValueFact[]): string[] => values.filter((v) => v.pending !== null).map(labelOf);

/** The attestation a Reviewed or Released signing cites must be this signer's Review of this record, on the named checklist. */
async function attestationOf(ctx: RuleContext, signer: Signer, record: RecordId, attestation: Sealed | null, checklist: Checklist): Promise<ReviewFacts | Refusal> {
  if (!attestation) return { kind: 'not-permitted', message: 'This signing needs its Review Checklist as attestation.' };
  const review = await loadReview(ctx.q, attestation.record);
  if (review.reviews !== record) return { kind: 'not-permitted', message: 'The Review cited is of another record.' };
  if (review.reviewer !== signer.person) return { kind: 'not-permitted', message: "The Review cited is another person's." };
  if (review.checklistVersion !== checklist.version) return { kind: 'not-permitted', message: `The Review uses checklist ${review.checklistVersion}, not ${checklist.version}.` };
  return review;
}

const oneTarget = (sealed: readonly Sealed[]): Refusal | null =>
  sealed.length === 1 ? null : { kind: 'not-permitted', message: 'This meaning is signed one record at a time.' };

async function updateTestState(tx: AuditedTx, test: RecordId, to: string): Promise<void> {
  await tx.db.updateTable('test').set({ state: to }).where('id', '=', test).execute();
}

// ---------------------------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------------------------

async function testPerformedCheck(ctx: RuleContext, signer: Signer, t: TestFacts): Promise<GateResult | Refusal> {
  const next = move(TestMachine, t.label, t.state, 'submitForReview', 'assignee');
  if ('kind' in next) return next;
  if (!t.method || !t.specification) return { kind: 'not-permitted', message: `${t.label} has no pinned Method version and Specification.` };
  // With a value missing there is no judgement yet; the gate then reports the missing values.
  const judgement = t.judgement ?? { kind: 'result-missing' as const, preparation: t.preparations[0]?.id ?? ('' as never), analyte: t.method.data.analytes[0]!.key as never };
  return testPerformedGate({
    test: t.label,
    signer: await performerFacts(ctx.q, signer.person, t.method, ctx.lab, ctx.dbNow),
    isAssignee: t.assignedAnalyst === signer.person,
    valuesByOthers: t.values.filter((v) => v.authors[0] !== signer.person).map(labelOf),
    missingValues: t.missingValues,
    unverifiedValues: unverified(t.values),
    pendingChanges: pendingOf(t.values),
    runs: t.runs.map((r) => ({ run: r.number, performedStands: signedAndStanding(r.standing, 'Performed') })),
    judgement,
    blockingHolds: t.holds,
  });
}

async function testReviewedCheck(ctx: RuleContext, signer: Signer, t: TestFacts, attestation: Sealed | null): Promise<GateResult | Refusal> {
  const next = move(TestMachine, t.label, t.state, 'review', 'Reviewer');
  if ('kind' in next) return next;
  if (!t.method) return { kind: 'not-permitted', message: `${t.label} has no pinned Method version.` };
  const review = await attestationOf(ctx, signer, t.id, attestation, TEST_CHECKLIST);
  if ('kind' in review) return review;
  const own = await recordStanding(ctx.q, t.id);
  return reviewedGate({
    record: t.label,
    signer: await reviewerFacts(ctx.q, signer.person, t.method, ctx.lab, ctx.dbNow),
    performedStands: signedAndStanding(own, 'Performed'),
    performedSigners: [...signersOf(own, 'Performed'), ...t.runs.flatMap((r) => signersOf(r.standing, 'Performed'))],
    feedingRuns: t.runs.map((r) => ({ run: r.number, reviewedStands: signedAndStanding(r.standing, 'Reviewed') })),
    pendingChanges: pendingOf(t.values),
    checklist: { required: TEST_CHECKLIST.items, ticked: review.ticked },
    blockingHolds: t.holds,
  });
}

export const testKind: KindDef = {
  kind: 'test',
  fields: {
    'prep.weight': { critical: true, type: 'decimal', unit: 'mg', subject: 'preparation', verifiedEach: true },
    'prep.dilution': { critical: true, type: 'decimal', unit: 'mL', subject: 'preparation', verifiedEach: true },
    'prep.result': { critical: true, type: 'decimal', unit: 'pg/µL', subject: 'preparation+analyte', verifiedEach: true },
  },
  label: async (q, record) => (await loadTest(q, record)).label,
  authorisationScope: async (q, record) => {
    const t = await q.selectFrom('test as t').innerJoin('method as m', 'm.id', 't.method_id').select('m.number').where('t.id', '=', record).executeTakeFirstOrThrow();
    return t.number;
  },
  content: async (q, record) => {
    const t = await loadTest(q, record);
    if (!t.method?.ref || !t.specification) throw new Error(`${t.label} is not accepted: no Method version or Specification is pinned`);
    const runRefs: VersionRef[] = t.runs.flatMap((r) => (r.standing.version ? [{ versionId: r.standing.version.versionId, hash: r.standing.version.hash }] : []));
    const cites: VersionRef[] = [...t.values.map(valueRef), ...runRefs, t.method.ref, { versionId: t.specification.ref.versionId, hash: t.specification.ref.hash }];
    const body = {
      schema: 'test@1',
      test: t.id, number: t.number, gxpClass: t.gxpClass,
      customer: { id: t.customer.id, code: t.customer.code, name: t.customer.name },
      product: { id: t.sample.product.id, code: t.sample.product.code, name: t.sample.product.name },
      sample: { id: t.sample.id, number: t.sample.number, lotNumber: t.sample.lotNumber },
      method: { number: t.method.number, version: String(t.method.version), ...(cite(t.method.ref) as object) },
      specification: { purpose: t.specification.purpose, versionNo: String(t.specification.ref.versionNo), ...(cite(t.specification.ref) as object) },
      preparations: t.preparations.map((p): Canon => ({
        preparation: p.id, prepNo: String(p.prepNo),
        weight: p.weight ? cite(valueRef(p.weight)) : null, dilution: p.dilution ? cite(valueRef(p.dilution)) : null,
        results: Object.fromEntries([...p.results].map(([a, v]) => [a, v ? cite(valueRef(v)) : null])),
      })),
      values: t.values.map(valueCanon),
      runs: t.runs.map((r): Canon => ({ run: r.id, number: r.number, ...(r.standing.version ? (cite(r.standing.version) as object) : { version: null, sha256: null }) })),
      judgement: t.judgement ? judgementCanon(t.judgement, t.preparations) : null,
    } as const;
    return { body, cites };
  },
  signing: {
    Performed: {
      consequence: 'The Test moves to Submitted for Review, its Reportable Results and verdicts fixed in this version.',
      check: async (ctx, signer, sealed) => oneTarget(sealed) ?? testPerformedCheck(ctx, signer, await loadTest(ctx.q, sealed[0]!.record)),
      after: async (tx, _deps, sealed) => {
        const t = await loadTest(tx.db, sealed.record);
        await updateTestState(tx, t.id, 'SubmittedForReview');
        if (t.judgement && t.specification) await storeSectionVerdicts(tx, t.labId, sealed.version.versionId, t.specification.ref.versionId, t.judgement, t.preparations);
      },
    },
    Reviewed: {
      consequence: 'The Test is Reviewed and may go on a Test Report.',
      check: async (ctx, signer, sealed, attestation) => oneTarget(sealed) ?? testReviewedCheck(ctx, signer, await loadTest(ctx.q, sealed[0]!.record), attestation),
      after: async (tx, _deps, sealed) => updateTestState(tx, sealed.record, 'Reviewed'),
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

async function runPerformedCheck(ctx: RuleContext, signer: Signer, r: RunFacts): Promise<GateResult | Refusal> {
  if (r.state !== 'Open') return { kind: 'transition', message: `${r.label} is already ${r.state}.` };
  return runPerformedGate({
    run: r.label,
    signer: await performerFacts(ctx.q, signer.person, r.method, ctx.lab, ctx.dbNow),
    isAcquirer: r.acquiredBy === signer.person,
    missingValues: [...r.missingValues, ...r.runChecks.filter((c) => !c.value).map((c) => `Run Check ${c.check.name}`)],
    unverifiedValues: unverified(r.values),
    pendingChanges: pendingOf(r.values),
    equipment: r.instrument?.equipment ? { code: r.instrument.equipment.code, fitness: r.instrument.equipment.fitness } : { code: '(none)', fitness: 'Quarantined' },
    runChecks: r.runChecks.map((c) => ({ check: c.check.name, outcome: c.outcome })),
  });
}

async function runReviewedCheck(ctx: RuleContext, signer: Signer, r: RunFacts, attestation: Sealed | null): Promise<GateResult | Refusal> {
  if (r.state !== 'Performed') return { kind: 'transition', message: `${r.label} is ${r.state}; Reviewed follows a standing Performed.` };
  const review = await attestationOf(ctx, signer, r.id, attestation, RUN_CHECKLIST);
  if ('kind' in review) return review;
  return reviewedGate({
    record: r.label,
    signer: await reviewerFacts(ctx.q, signer.person, r.method, ctx.lab, ctx.dbNow),
    performedStands: signedAndStanding(r.standing, 'Performed'),
    performedSigners: signersOf(r.standing, 'Performed'),
    feedingRuns: [],
    pendingChanges: pendingOf(r.values),
    checklist: { required: RUN_CHECKLIST.items, ticked: review.ticked },
    blockingHolds: [],
  });
}

export const runKind: KindDef = {
  kind: 'run',
  fields: {
    'run.instrument': { critical: true, type: 'ref', subject: 'none', verifiedEach: true },
    'run.sequence': { critical: false, type: 'text', subject: 'none', verifiedEach: true },
    'run.trueCopy': { critical: true, type: 'blob', subject: 'none', verifiedEach: true },
    'runcheck.value': { critical: true, type: 'decimal', subject: 'run-check', verifiedEach: true },
  },
  label: async (q, record) => (await loadRun(q, record)).label,
  authorisationScope: async (q, record) => (await loadRun(q, record)).method.number,
  content: async (q, record) => {
    const r = await loadRun(q, record);
    if (!r.method.ref) throw new Error(`${r.label}: its Method version is not sealed`);
    return {
      body: {
        schema: 'run@1',
        run: r.id, number: r.number, acquiredBy: r.acquiredBy, entryMode: 'typed',
        method: { number: r.method.number, version: String(r.method.version), ...(cite(r.method.ref) as object) },
        instrument: r.instrument ? { ...(cite(valueRef(r.instrument.value)) as object), equipment: r.instrument.equipment?.code ?? null } : null,
        sequence: r.sequence ? cite(valueRef(r.sequence)) : null,
        trueCopy: r.trueCopy ? { ...(cite(valueRef(r.trueCopy)) as object), fileSha256: r.trueCopy.effective.text } : null,
        runChecks: r.runChecks.map((c): Canon => ({ name: c.check.name, unit: c.unit, value: c.value ? cite(valueRef(c.value)) : null, outcome: c.outcome.kind === 'judged' ? (c.outcome.conforms ? 'conforms' : 'does-not-conform') : c.outcome.kind })),
        values: r.values.map(valueCanon),
        tests: r.tests.map((t) => t.id),
      },
      cites: [...r.values.map(valueRef), r.method.ref],
    };
  },
  signing: {
    Performed: {
      consequence: 'The Run is Performed; Tests may cite this Run Version.',
      check: async (ctx, signer, sealed) => oneTarget(sealed) ?? runPerformedCheck(ctx, signer, await loadRun(ctx.q, sealed[0]!.record)),
    },
    Reviewed: {
      consequence: 'The Run is Reviewed; the Tests it feeds may be Reviewed.',
      check: async (ctx, signer, sealed, attestation) => oneTarget(sealed) ?? runReviewedCheck(ctx, signer, await loadRun(ctx.q, sealed[0]!.record), attestation),
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Review: the attestation. Its ticks and confirmations are its values; it carries no meaning.
// ---------------------------------------------------------------------------------------------

export const reviewKind: KindDef = {
  kind: 'review',
  fields: {
    'checklist.item': { critical: false, type: 'boolean', subject: 'checklist-item', verifiedEach: false },
    'verdict.confirmation': { critical: false, type: 'text', subject: 'checklist-item', verifiedEach: false },
  },
  label: async (q, record) => {
    const r = await loadReview(q, record);
    const reviewed = await q.selectFrom('record').select('kind').where('id', '=', r.reviews).executeTakeFirstOrThrow();
    const label = reviewed.kind === 'test' ? (await loadTest(q, r.reviews)).label : reviewed.kind === 'run' ? (await loadRun(q, r.reviews)).label : (await loadReport(q, r.reviews)).label;
    return `Review of ${label}`;
  },
  authorisationScope: async () => 'review',
  content: async (q, record) => {
    const r = await loadReview(q, record);
    return {
      body: { schema: 'review@1', review: r.id, reviews: r.reviews, checklistVersion: r.checklistVersion, reviewer: r.reviewer, values: r.values.map(valueCanon) },
      cites: r.values.map(valueRef),
    };
  },
  signing: {},
};

// ---------------------------------------------------------------------------------------------
// Test Report
// ---------------------------------------------------------------------------------------------

/** The Review each Test's Reviewed signature cited, so the report's bytes carry it. */
async function reviewedAttestation(q: Parameters<typeof loadReport>[0], test: TestFacts & { standing: { signatures: readonly { meaning: Meaning; attestationVersionId: VersionId | null }[] } }): Promise<VersionRef | null> {
  const sig = test.standing.signatures.find((s) => s.meaning === 'Reviewed' && s.attestationVersionId);
  if (!sig?.attestationVersionId) return null;
  const v = await q.selectFrom('record_version').select('content_hash').where('id', '=', sig.attestationVersionId).executeTakeFirstOrThrow();
  return { versionId: sig.attestationVersionId, hash: v.content_hash.toString('hex') as VersionRef['hash'] };
}

export const testReportKind: KindDef = {
  kind: 'test_report',
  fields: {},
  label: async (q, record) => (await loadReport(q, record)).label,
  authorisationScope: async () => 'test_report',
  content: async (q, record) => {
    const r = await loadReport(q, record);
    const lab = await labOf(q, r.labId);
    const tests: Canon[] = [];
    const cites: VersionRef[] = [];
    for (const t of r.tests) {
      if (!t.standing.version) throw new Error(`${t.label} has no version to report`);
      const review = await reviewedAttestation(q, t);
      cites.push({ versionId: t.standing.version.versionId, hash: t.standing.version.hash });
      if (review) cites.push(review);
      tests.push({ test: t.id, number: t.number, ...(cite(t.standing.version) as object), review: review ? cite(review) : null });
    }
    return {
      body: {
        schema: 'test_report@1', report: r.id, number: r.number, lab: { id: lab.id, code: lab.code, zone: lab.zone },
        customer: { id: r.customer.id, code: r.customer.code, name: r.customer.name }, submission: { id: r.submission.id, number: r.submission.number },
        tests, fictional: true,
      },
      cites,
    };
  },
  signing: {
    Released: {
      consequence: 'The Test Report is Released: its Tests are Reported, the data behind it locks, and the PDF is issued to the Customer.',
      check: async (ctx, signer, sealed, attestation) => {
        const one = oneTarget(sealed);
        if (one) return one;
        const r = await loadReport(ctx.q, sealed[0]!.record);
        const next = move(TestReportMachine, r.label, r.state, 'release', 'QA');
        if ('kind' in next) return next;
        const review = await attestationOf(ctx, signer, r.id, attestation, RELEASE_CHECKLIST);
        if ('kind' in review) return review;
        const tests = r.tests.map((t) => ({
          test: t.label,
          performedStands: signedAndStanding(t.standing, 'Performed'),
          reviewedStands: signedAndStanding(t.standing, 'Reviewed'),
          performedBy: [...(t.assignedAnalyst ? [t.assignedAnalyst] : []), ...signersOf(t.standing, 'Performed'), ...t.runs.flatMap((x) => signersOf(x.standing, 'Performed'))] as PersonId[],
          reviewedBy: [...signersOf(t.standing, 'Reviewed'), ...t.runs.flatMap((x) => signersOf(x.standing, 'Reviewed'))],
          blockingHolds: t.holds,
          verdicts: (t.specification?.data.sections ?? []).map((s) => ({ jurisdiction: s.jurisdiction, confirmation: review.confirmations.get(verdictSubject(t.id, s.jurisdiction)) ?? 'none' as const })),
        }));
        const [first, ...rest] = tests;
        if (!first) return { kind: 'not-permitted', message: `${r.label} holds no Test.` };
        return releasedGate({ report: r.label, signer: await releaserFacts(ctx.q, signer.person, ctx.lab, ctx.dbNow), tests: [first, ...rest], checklist: { required: RELEASE_CHECKLIST.items, ticked: review.ticked } });
      },
      after: async (tx, deps, sealed, signature) => {
        const r = await loadReport(tx.db, sealed.record);
        await tx.db.updateTable('test_report').set({ state: 'Released' }).where('id', '=', r.id).execute();
        for (const t of r.tests) await updateTestState(tx, t.id, 'Reported');
        await lockReleased(tx, signature.id);
        const lab = await labOf(tx.db, r.labId);
        const pdf = await renderReportPdf(tx.db, { report: r, lab, releasedSignature: signature, body: sealed.body });
        const sha = await storeBlob(tx, deps.reportStore, ledgerOf(r.labId), pdf, 'application/pdf');
        await tx.db.insertInto('report_issue').values({
          lab_id: r.labId, report_version_id: sealed.version.versionId, released_signature: signature.id, pdf_sha256: Buffer.from(sha, 'hex'), renderer_release: deps.release,
        }).execute();
      },
    },
  },
};

export const CHAIN_KINDS: readonly KindDef[] = [testKind, runKind, reviewKind, testReportKind];

