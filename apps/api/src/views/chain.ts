// The sample chain's views: the queue, a Test, a Run, a Review, a Test Report, assignment
// candidates, the Lab's reference lists, the chain verdicts, and the portal. Each runs in a READ
// ONLY transaction on the actor's scope and prints facts; nothing here decides anything.

import { z } from 'zod';
import { verifyChain, COMPANY_LEDGER } from '@lims/db';
import type {
  AssignmentDto, ChainVerdictDto, LabReferenceDto, PortalCatalogueDto, PortalReportDto, PortalSubmissionDto, QueueTestDto, ReportDetailDto,
  ReviewDetailDto, ReviewRefDto, RunDetailDto, SignatureLineDto, TestDetailDto,
} from '@lims/contract';
import { formatWritten } from '@lims/domain/decimal';
import { assignmentGate } from '@lims/domain/gates';
import { describeReasons } from '@lims/domain/refusal';
import { submissionState, TestMachine } from '@lims/domain/machines';
import {
  analystsIn, labOf, loadMethodVersion, loadReport, loadReview, loadRun, loadTest, performerFacts, recordStanding, signedAndStanding,
  type Q, type RecordStanding, type RunFacts, type TestFacts,
} from '../chain/facts.ts';
import { valueDto } from '../records/values.ts';
import { runKind, testKind } from '../records/kinds/chain.ts';
import { STATEMENT } from '@lims/domain/signing';
import { checklistFor, preparationSubject } from '../chain/model.ts';
import { holdsOn, judgementDto, testSteps } from '../chain/steps.ts';
import { defineView } from '../doors.ts';
import { RecordIdSchema } from '../wire.ts';

const signatureLines = (s: RecordStanding): SignatureLineDto[] => s.signatures.map((x) => ({
  id: x.id, meaning: x.meaning, printedName: x.printedName, username: x.username, role: x.role, signedAtUtc: x.signedAt.toISOString(), statement: STATEMENT[x.meaning],
  version: { versionId: s.version!.versionId, versionNo: s.version!.versionNo, hash: s.version!.hash }, stands: s.stands,
}));

async function queueRow(q: Q, t: TestFacts): Promise<QueueTestDto> {
  const analyst = t.assignedAnalyst
    ? await q.selectFrom('person').innerJoin('account', 'account.person_id', 'person.id').select(['person.printed_name', 'account.username']).where('person.id', '=', t.assignedAnalyst).executeTakeFirst()
    : null;
  const requested = t.method ? `${t.method.number} v${t.method.version}` : (await q.selectFrom('test as x').innerJoin('method as m', 'm.id', 'x.method_id').select('m.number').where('x.id', '=', t.id).executeTakeFirstOrThrow()).number;
  const runs: RunFacts[] = [];
  for (const r of t.runs) runs.push(await loadRun(q, r.id));
  const holds = await holdsOn(q, t.id);
  return {
    id: t.id, label: t.label, number: t.number, state: t.state, stateLabel: TestMachine.states[t.state], steps: testSteps(t, runs, holds), holds,
    sampleId: t.sample.id, sampleState: t.sample.state, submissionId: t.submission.id,
    gxpClass: t.gxpClass, customer: t.customer.name, product: t.sample.product.code, lotNumber: t.sample.lotNumber,
    sampleNumber: t.sample.number, submissionNumber: t.submission.number, method: requested,
    assignedAnalyst: t.assignedAnalyst && analyst ? { id: t.assignedAnalyst, printedName: analyst.printed_name, username: analyst.username } : null,
  };
}

async function reviewsOf(q: Q, recordId: string): Promise<ReviewRefDto[]> {
  const rows = await q.selectFrom('review as r').innerJoin('person as p', 'p.id', 'r.reviewer_id').innerJoin('account as a', 'a.person_id', 'p.id')
    .select(['r.id', 'r.checklist_version', 'p.printed_name', 'a.username']).where('r.reviews_record_id', '=', recordId).execute();
  return rows.map((r) => ({ id: r.id, checklistVersion: r.checklist_version, reviewer: { printedName: r.printed_name, username: r.username } }));
}

export const queue = defineView({
  name: 'queue.tests',
  input: z.object({}),
  scope: 'lab',
  read: async (q): Promise<{ tests: QueueTestDto[] }> => {
    const ids = await q.selectFrom('test').select('id').orderBy('number').execute();
    const tests: QueueTestDto[] = [];
    for (const { id } of ids) tests.push(await queueRow(q, await loadTest(q, id)));
    return { tests };
  },
});

export const testDetail = defineView({
  name: 'test.detail',
  input: z.object({ testId: RecordIdSchema }),
  scope: 'lab',
  read: async (q, { testId }): Promise<TestDetailDto> => {
    const t = await loadTest(q, testId);
    const standing = await recordStanding(q, t.id);
    const verdicts = standing.version
      ? await q.selectFrom('section_verdict').selectAll().where('test_version_id', '=', standing.version.versionId).orderBy('jurisdiction').orderBy('analyte').execute()
      : [];
    return {
      test: { ...(await queueRow(q, t)), acceptanceReason: t.acceptanceReason, methodVersionId: t.method?.id ?? null, specificationVersionId: t.specification?.ref.versionId ?? null },
      method: t.method ? { number: t.method.number, title: t.method.title, version: t.method.version, analytes: t.method.data.analytes.map((a) => a.key), minimumPreparations: t.method.data.preparations } : null,
      specification: t.specification ? {
        purpose: t.specification.purpose, versionNo: t.specification.ref.versionNo, hash: t.specification.ref.hash,
        sections: t.specification.data.sections.map((s) => ({ jurisdiction: s.jurisdiction, ruleSetVersion: s.ruleSetVersion, lines: s.lines.map((l) => ({ analyte: l.analyte, limit: l.limit, unit: l.unit })) })),
      } : null,
      preparations: t.preparations.map((p) => ({ id: p.id, prepNo: p.prepNo, subject: preparationSubject(p.prepNo) })),
      values: t.values.map((v) => valueDto(testKind.fields, v)),
      missingValues: t.missingValues,
      runs: t.runs.map((r) => ({ id: r.id, number: r.number, state: r.state, version: r.standing.version })),
      version: standing.version,
      signatures: signatureLines(standing),
      verdicts: verdicts.map((v) => ({
        jurisdiction: v.jurisdiction, analyte: v.analyte, limit: v.limit_text, compared: v.compared_text, sharePercent: v.share_percent, outcome: v.outcome,
        ruleSetVersion: v.rule_set_version, calculationVersion: v.calculation_version, preparations: v.preparations as unknown as TestDetailDto['verdicts'][number]['preparations'],
      })),
      judgement: judgementDto(t, t.judgement),
      performedStands: signedAndStanding(standing, 'Performed'),
      reviews: await reviewsOf(q, t.id),
    };
  },
});

const criterionText = (c: { op: string; limit?: { unscaled: bigint; decimals: number }; low?: { unscaled: bigint; decimals: number }; high?: { unscaled: bigint; decimals: number } }): string =>
  c.op === 'range' ? `${formatWritten(c.low!)}–${formatWritten(c.high!)}` : `${c.op} ${formatWritten(c.limit!)}`;

export const runDetail = defineView({
  name: 'run.detail',
  input: z.object({ runId: RecordIdSchema }),
  scope: 'lab',
  read: async (q, { runId }): Promise<RunDetailDto> => {
    const r = await loadRun(q, runId);
    return {
      run: { id: r.id, number: r.number, state: r.state, version: r.standing.version, method: `${r.method.number} v${r.method.version}`, acquiredBy: r.acquiredBy, tests: r.tests },
      values: r.values.map((v) => valueDto(runKind.fields, v)),
      instrument: r.instrument?.equipment ? { code: r.instrument.equipment.code, kind: r.instrument.equipment.kind, fitness: r.instrument.equipment.fitness } : null,
      runChecks: r.runChecks.map((c) => ({
        name: c.check.name, unit: c.unit, criterion: criterionText(c.check.criterion as never),
        source: c.check.criterion.source.kind === 'compendial' ? c.check.criterion.source.citation : c.check.criterion.source.kind === 'method' ? c.check.criterion.source.methodVersion : c.check.criterion.source.sopVersion,
        value: c.value?.effective.text ?? null,
        outcome: c.outcome.kind === 'judged' ? (c.outcome.conforms ? 'conforms' : 'does-not-conform') : c.outcome.kind,
        limit: c.check.criterion.op === 'range'
          ? { op: 'range' as const, low: formatWritten(c.check.criterion.low), high: formatWritten(c.check.criterion.high) }
          : { op: c.check.criterion.op, limit: formatWritten(c.check.criterion.limit) },
      })),
      signatures: signatureLines(r.standing),
      missingValues: r.missingValues,
      reviews: await reviewsOf(q, r.id),
    };
  },
});

export const reviewDetail = defineView({
  name: 'review.detail',
  input: z.object({ reviewId: RecordIdSchema }),
  scope: 'lab',
  read: async (q, { reviewId }): Promise<ReviewDetailDto> => {
    const r = await loadReview(q, reviewId);
    const label = r.reviewsKind === 'test' ? (await loadTest(q, r.reviews)).label : r.reviewsKind === 'run' ? (await loadRun(q, r.reviews)).label : (await loadReport(q, r.reviews)).label;
    const checklist = checklistFor(r.reviewsKind);
    return {
      reviewId: r.id, reviews: { id: r.reviews, kind: r.reviewsKind, label }, checklistVersion: r.checklistVersion,
      items: (checklist?.items ?? []).map((item) => ({ item, ticked: r.ticked.includes(item) })),
      confirmations: [...r.confirmations].map(([subject, confirmation]) => ({ subject, confirmation })),
    };
  },
});

export const reportDetail = defineView({
  name: 'report.detail',
  input: z.object({ reportId: RecordIdSchema }),
  scope: 'lab',
  read: async (q, { reportId }): Promise<ReportDetailDto> => {
    const r = await loadReport(q, reportId);
    const tests = [];
    for (const t of r.tests) {
      tests.push({
        ...(await queueRow(q, t)), version: t.standing.version,
        performedStands: t.standing.stands && t.standing.signatures.some((s) => s.meaning === 'Performed'),
        reviewedStands: t.standing.stands && t.standing.signatures.some((s) => s.meaning === 'Reviewed'),
        jurisdictions: t.specification?.data.sections.map((s) => s.jurisdiction) ?? [],
        verdicts: t.standing.version
          ? (await q.selectFrom('section_verdict').select(['jurisdiction', 'analyte', 'limit_text', 'compared_text', 'share_percent', 'outcome']).where('test_version_id', '=', t.standing.version.versionId).orderBy('jurisdiction').orderBy('analyte').execute())
            .map((v) => ({ jurisdiction: v.jurisdiction, analyte: v.analyte, limit: v.limit_text, compared: v.compared_text, sharePercent: v.share_percent, outcome: v.outcome }))
          : [],
      });
    }
    return {
      report: { id: r.id, number: r.number, state: r.state, customer: r.customer.name, submissionNumber: r.submission.number, version: r.standing.version },
      tests, signatures: signatureLines(r.standing), issue: r.issue ? { pdfSha256: r.issue.pdfSha256, rendererRelease: r.issue.rendererRelease } : null,
      reviews: await reviewsOf(q, r.id),
    };
  },
});

export const assignment = defineView({
  name: 'test.assignment',
  input: z.object({ testId: RecordIdSchema }),
  scope: 'lab',
  read: async (q, { testId }, actor): Promise<AssignmentDto> => {
    const t = await loadTest(q, testId);
    const test = await queueRow(q, t);
    const analysts = await analystsIn(q, t.labId);
    const method = t.method;
    if (!method) {
      return { test, candidates: analysts.map((a) => ({ ...a, eligible: false, reasons: [`${t.label} is not accepted yet, so no Method version is pinned to be trained on.`] })) };
    }
    const lab = actor.kind === 'staff' ? actor.lab : actor.kind === 'service' ? actor.lab : null;
    const dbNow = new Date();
    const candidates = [];
    for (const a of analysts) {
      const gate = assignmentGate({ ...(await performerFacts(q, a.id, method, lab, dbNow)), holdsAnalystRole: true });
      candidates.push({ ...a, eligible: gate.go, reasons: gate.go ? [] : gate.reasons.map((r) => describeReasons([r])) });
    }
    return { test, candidates };
  },
});

export const labReference = defineView({
  name: 'lab.reference',
  input: z.object({}),
  scope: 'lab',
  read: async (q, _i, actor): Promise<LabReferenceDto> => {
    const labId = actor.kind === 'staff' ? actor.lab : actor.kind === 'service' ? actor.lab : null;
    if (!labId) throw new Error('lab.reference is a Lab view');
    const lab = await labOf(q, labId);
    const equipment = await q.selectFrom('equipment').select(['id', 'code', 'kind', 'fitness_status']).orderBy('code').execute();
    const versions = await q.selectFrom('method_version').select('id').execute();
    const methodVersions = [];
    for (const v of versions) {
      const mv = await loadMethodVersion(q, v.id);
      if (mv.approved) methodVersions.push({ id: mv.id, number: mv.number, version: mv.version, title: mv.title, runChecks: mv.data.runChecks.map((r) => ({ name: r.name, unit: r.unit })) });
    }
    const reports = await q.selectFrom('test_report as r').innerJoin('submission as s', 's.id', 'r.submission_id').select(['r.id', 'r.number', 'r.state', 's.number as submission_number']).orderBy('r.number').execute();
    return {
      lab, equipment: equipment.map((e) => ({ id: e.id, code: e.code, kind: e.kind, fitness: e.fitness_status })),
      methodVersions: methodVersions.sort((a, b) => a.number.localeCompare(b.number)),
      reports: reports.map((r) => ({ id: r.id, number: r.number, state: r.state, submissionNumber: r.submission_number })),
    };
  },
});

/** QA's "Verify chain": both ledgers this Lab writes, from the stored entry bytes. */
export const chainVerdicts = defineView({
  name: 'audit.chain',
  input: z.object({}),
  scope: 'lab',
  read: async (q, _i, actor): Promise<{ ledgers: ChainVerdictDto[] }> => {
    const labId = actor.kind === 'staff' ? actor.lab : actor.kind === 'service' ? actor.lab : null;
    const out: ChainVerdictDto[] = [];
    for (const ledger of [COMPANY_LEDGER, ...(labId ? [labId] : [])]) {
      const code = (await q.selectFrom('ledger').select('code').where('id', '=', ledger).executeTakeFirstOrThrow()).code;
      out.push({ ledger, code, ...(await verifyChain(q, ledger)) });
    }
    return { ledgers: out };
  },
});

// ---------------------------------------------------------------------------------------------
// The portal (Customer scope: only portal_* views are reachable)
// ---------------------------------------------------------------------------------------------

/** A view's NOT NULL column, which the generated types cannot see through the view. */
const column = <T>(v: T | null): T => {
  if (v === null) throw new Error('a portal view column that is never null was null');
  return v;
};

export const portalSubmissions = defineView({
  name: 'portal.submissions',
  input: z.object({}),
  scope: 'customer',
  read: async (q): Promise<{ submissions: PortalSubmissionDto[] }> => {
    const subs = await q.selectFrom('portal_submission').selectAll().orderBy('number', 'desc').execute();
    const out: PortalSubmissionDto[] = [];
    for (const s of subs) {
      const samples = await q.selectFrom('portal_sample').selectAll().where('submission_id', '=', s.id).execute();
      const tests = await q.selectFrom('portal_test').selectAll().where('submission_id', '=', s.id).execute();
      const status = submissionState({
        submitted: s.submitted_at !== null, cancelled: s.cancelled_at !== null,
        tests: tests.map((t) => (t.internal_state === 'Cancelled' ? { state: 'Cancelled', acceptedBeforeCancel: false } : { state: t.internal_state as never })),
      });
      out.push({
        id: column(s.id), number: column(s.number), labId: s.lab_id, labCode: s.lab_code, submittedAt: s.submitted_at?.toISOString() ?? null, status,
        samples: samples.map((sm) => ({
          id: column(sm.id), lotNumber: column(sm.lot_number), number: sm.number, product: `${sm.product_code} ${sm.product_name}`, status: column(sm.customer_status),
          tests: tests.filter((t) => t.sample_id === sm.id).map((t) => ({ id: column(t.id), method: `${t.method_number} ${t.method_title}`, status: column(t.customer_status), rejectionReason: t.rejection_reason })),
        })),
      });
    }
    return { submissions: out };
  },
});

export const portalReports = defineView({
  name: 'portal.reports',
  input: z.object({}),
  scope: 'customer',
  read: async (q): Promise<{ reports: PortalReportDto[] }> => {
    const rows = await q.selectFrom('portal_report').selectAll().orderBy('number').execute();
    const subs = await q.selectFrom('portal_submission').select(['id', 'number']).execute();
    return {
      reports: rows.map((r) => ({
        id: column(r.id), labId: column(r.lab_id), number: column(r.number), submissionNumber: subs.find((s) => s.id === r.submission_id)?.number ?? '',
        releasedAtUtc: column(r.released_at).toISOString(), pdfSha256: column(r.pdf_sha256),
      })),
    };
  },
});

export const portalCatalogue = defineView({
  name: 'portal.catalogue',
  input: z.object({}),
  scope: 'customer',
  read: async (q): Promise<PortalCatalogueDto> => {
    const rows = await q.selectFrom('portal_catalogue').selectAll().execute();
    const products = await q.selectFrom('portal_product').selectAll().orderBy('code').execute();
    const labs = new Map(rows.map((r) => [column(r.lab_id), { id: column(r.lab_id), code: column(r.lab_code) }]));
    const methods = new Map(rows.map((r) => [column(r.method_id), { id: column(r.method_id), number: column(r.method_number), title: column(r.method_title) }]));
    return {
      labs: [...labs.values()], products: products.map((p) => ({ id: column(p.id), code: column(p.code), name: column(p.name) })),
      methods: [...methods.values()].sort((a, b) => a.number.localeCompare(b.number)),
    };
  },
});

export const chainViews = [queue, testDetail, runDetail, reviewDetail, reportDetail, assignment, labReference, chainVerdicts, portalSubmissions, portalReports, portalCatalogue];

