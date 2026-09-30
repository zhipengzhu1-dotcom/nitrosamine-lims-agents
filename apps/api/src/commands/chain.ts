// The sample chain's commands, in the order the brief walks them: a Customer submits; the Sample
// Custodian accepts or rejects each Test and receives the Sample; the Lab Manager assigns; the
// Analyst starts, creates the Run and its Preparations; the Reviewer opens a Review and ticks its
// checklist or Returns; a report is drafted, sent to QA and, once Released, downloaded.
// Signings go through signing.prepare and signing.sign; the kinds in records/kinds/chain.ts
// carry the rules and their effects.

import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { ledgerOf, storeBlob } from '@lims/db';
import { uuid } from '@lims/contract';
import { acceptanceGate, assignmentGate, readyGate, toRefusal } from '@lims/domain/gates';
import type { LabId, PersonId, RecordId, Sha256Hex } from '@lims/domain/ids';
import { SampleMachine, TestMachine, TestReportMachine } from '@lims/domain/machines';
import { refuse, type NotBuilt } from '@lims/domain/refusal';
import {
  acceptedSpecificationVersion, adoptionStatus, analystsIn, currentMethodVersion, labOf, loadReport, loadReview, loadTest, performerFacts,
} from '../chain/facts.ts';
import { checklistFor, labNumber, move, REVIEW_FIELDS, RUN_FIELDS, submissionNumber, verdictSubject, yearIn } from '../chain/model.ts';
import { receipt, type CommandTx } from '../commit.ts';
import { defineCommand } from '../doors.ts';
import { LabIdSchema, RecordIdSchema } from '../wire.ts';
import { ReasonSchema, toReason } from './values.ts';

const staffLab = (tx: CommandTx): LabId => {
  const a = tx.actor;
  const lab = a.kind === 'staff' ? a.lab : a.kind === 'service' ? a.lab : null;
  if (!lab) throw new Error('this command acts in a Lab');
  return lab;
};

const person = (tx: CommandTx): PersonId => {
  const a = tx.actor;
  if (a.kind === 'nobody' || a.kind === 'locked') throw new Error('this command acts in a live session');
  return a.person;
};

async function nextNumber(tx: CommandTx, scope: string, kind: string, year: number): Promise<number> {
  const r = await tx.db.selectNoFrom(sql<number>`lims.next_number(${scope}, ${kind}, ${year})`.as('n')).executeTakeFirstOrThrow();
  return Number(r.n);
}

/** Ready is automatic once Accepted and the Sample is Received, re-checking the Adoption (decision 12). */
async function becomeReadyIfDue(tx: CommandTx, testId: string): Promise<void> {
  const t = await loadTest(tx.db, testId);
  if (t.state !== 'Accepted' || t.sample.state !== 'Received' || !t.method) return;
  const adoption = await adoptionStatus(tx.db, t.labId, t.method.id, t.sample.product.id);
  const gate = readyGate({ gxpClass: t.gxpClass, adoption: adoption.status, sampleReceived: true });
  if (!gate.go) return;
  const next = move(TestMachine, t.label, t.state, 'becomeReady', 'system');
  if ('kind' in next) return;
  await tx.db.updateTable('test').set({ state: next.to }).where('id', '=', testId).execute();
}

// ---------------------------------------------------------------------------------------------
// 1. The Customer submits
// ---------------------------------------------------------------------------------------------

export const submit = defineCommand({
  name: 'submission.submit',
  input: z.object({
    labId: LabIdSchema,
    samples: z.array(z.object({
      productId: uuid,
      lotNumber: z.string().min(1).max(64),
      tests: z.array(z.object({ methodId: uuid })).min(1).max(10),
    })).min(1).max(20),
  }),
  acting: { as: 'role', role: 'CustomerUser' },
  reason: { kind: 'first_save' },
  ledgers: (i) => [ledgerOf(i.labId)],
  scope: (i) => ({ kind: 'lab', labId: i.labId }),
  run: async (tx, input) => {
    const a = tx.actor;
    if (a.kind !== 'customer') return { kind: 'not-permitted', message: 'A Submission is made by a Customer User in the portal.' };
    const lab = await labOf(tx.db, input.labId);
    const products = await tx.db.selectFrom('product').select(['id', 'customer_id']).where('id', 'in', input.samples.map((s) => s.productId)).execute();
    if (products.some((p) => p.customer_id !== a.customer) || products.length !== new Set(input.samples.map((s) => s.productId)).size) {
      return { kind: 'not-permitted', message: 'Every Product on a Submission is the Customer\'s own.' };
    }
    const year = yearIn(lab.zone, tx.dbNow);
    const number = submissionNumber(year, await nextNumber(tx, 'company', 'submission', year));
    const submissionId = randomUUID();
    await tx.db.insertInto('submission').values({ id: submissionId, customer_id: a.customer, number, entered_by: a.person, submitted_at: sql`clock_timestamp()` }).execute();
    const samples: { sampleId: string; tests: string[] }[] = [];
    for (const s of input.samples) {
      const sampleId = randomUUID();
      await tx.db.insertInto('sample').values({ lab_id: lab.id, id: sampleId, customer_id: a.customer, submission_id: submissionId, product_id: s.productId, lot_number: s.lotNumber, state: 'Expected' }).execute();
      const tests: string[] = [];
      for (const [i, t] of s.tests.entries()) {
        const testId = randomUUID() as RecordId;
        await tx.db.insertInto('record').values({ ledger_id: ledgerOf(lab.id), id: testId, kind: 'test' }).execute();
        await tx.db.insertInto('test').values({ lab_id: lab.id, id: testId, customer_id: a.customer, sample_id: sampleId, seq: i + 1, method_id: t.methodId, state: 'Requested' }).execute();
        tests.push(testId);
      }
      samples.push({ sampleId, tests });
    }
    return receipt(`Submitted ${number}: ${samples.length} Sample${samples.length === 1 ? '' : 's'} Expected. Audited, not signed.`, 'audited', { submissionId, number, samples });
  },
});

// ---------------------------------------------------------------------------------------------
// 2. Acceptance and receipt (Sample Custodian)
// ---------------------------------------------------------------------------------------------

export const acceptTest = defineCommand({
  name: 'test.accept',
  input: z.object({ testId: RecordIdSchema }),
  acting: { as: 'role', role: 'SampleCustodian' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx, { testId }) => {
    const t = await loadTest(tx.db, testId);
    const next = move(TestMachine, t.label, t.state, 'accept', 'SampleCustodian');
    if ('kind' in next) return next;
    const requested = await tx.db.selectFrom('test').select('method_id').where('id', '=', testId).executeTakeFirstOrThrow();
    const method = await currentMethodVersion(tx.db, requested.method_id);
    if (!method?.ref) return { kind: 'transition', message: `${t.label}: the Method has no Approved version to pin.` };
    const adoption = await adoptionStatus(tx.db, t.labId, method.id, t.sample.product.id);
    const gate = acceptanceGate({ gxpClass: t.gxpClass, adoption: adoption.status });
    if (!gate.go) return toRefusal(gate);
    const specification = await acceptedSpecificationVersion(tx.db, t.sample.product.id, t.customer.id);
    if (!specification) return { kind: 'transition', message: `${t.label}: no Specification for ${t.sample.product.code} is Approved and accepted by the Customer.` };
    await tx.db.updateTable('test').set({ state: next.to, method_version_id: method.id, specification_version_id: specification.versionId }).where('id', '=', testId).execute();
    await becomeReadyIfDue(tx, testId);
    const after = await tx.db.selectFrom('test').select('state').where('id', '=', testId).executeTakeFirstOrThrow();
    return receipt(`Accepted ${t.label} on ${method.number} v${method.version}${after.state === 'Ready' ? '; it is Ready' : ''}.`, 'audited', { testId, state: after.state, methodVersionId: method.id, specificationVersionId: specification.versionId });
  },
});

export const rejectTest = defineCommand({
  name: 'test.reject',
  input: z.object({ testId: RecordIdSchema, reason: z.string().min(1).max(500) }),
  acting: { as: 'role', role: 'SampleCustodian' },
  reason: (i) => ({ kind: 'picklist', code: 'other', text: i.reason }),
  ledgers: () => [],
  run: async (tx, { testId, reason }) => {
    const t = await loadTest(tx.db, testId);
    const next = move(TestMachine, t.label, t.state, 'reject', 'SampleCustodian');
    if ('kind' in next) return next;
    await tx.db.updateTable('test').set({ state: next.to, acceptance_reason: reason }).where('id', '=', testId).execute();
    return receipt(`Rejected ${t.label}. The Customer sees the reason.`, 'audited', { testId, state: next.to });
  },
});

export const receiveSample = defineCommand({
  name: 'sample.receive',
  input: z.object({ sampleId: uuid }),
  acting: { as: 'role', role: 'SampleCustodian' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx, { sampleId }) => {
    const lab = await labOf(tx.db, staffLab(tx));
    const s = await tx.db.selectFrom('sample').select(['id', 'state', 'lot_number']).where('id', '=', sampleId).executeTakeFirst();
    if (!s) return { kind: 'not-permitted', message: 'No such Sample in this Lab.' };
    const next = move(SampleMachine, `Sample ${s.lot_number}`, s.state, 'receive', 'SampleCustodian');
    if ('kind' in next) return next;
    const year = yearIn(lab.zone, tx.dbNow);
    const number = labNumber(lab.code, 'S', year, await nextNumber(tx, lab.id, 'sample', year));
    await tx.db.updateTable('sample').set({ state: next.to, number, received_at: sql`clock_timestamp()`, received_by: person(tx) }).where('id', '=', sampleId).execute();
    const tests = await tx.db.selectFrom('test').select(['id', 'seq']).where('sample_id', '=', sampleId).orderBy('seq').execute();
    for (const t of tests) {
      await tx.db.updateTable('test').set({ number: `${number}/T${t.seq}` }).where('id', '=', t.id).execute();
      await becomeReadyIfDue(tx, t.id);
    }
    return receipt(`Received ${number} (lot ${s.lot_number}); ${tests.length} Test${tests.length === 1 ? '' : 's'} numbered.`, 'audited', { sampleId, number });
  },
});

// ---------------------------------------------------------------------------------------------
// 3. Assignment (Lab Manager)
// ---------------------------------------------------------------------------------------------

async function assignTo(tx: CommandTx, testId: RecordId, analystId: PersonId, event: 'assign' | 'reassign') {
  const t = await loadTest(tx.db, testId);
  const next = move(TestMachine, t.label, t.state, event, 'LabManager');
  if ('kind' in next) return next;
  if (!t.method) return { kind: 'transition' as const, message: `${t.label} has no pinned Method version.` };
  const candidate = (await analystsIn(tx.db, t.labId)).find((a) => a.id === analystId);
  const gate = assignmentGate({ ...(await performerFacts(tx.db, analystId, t.method, t.labId, tx.dbNow)), holdsAnalystRole: candidate !== undefined });
  if (!gate.go) return toRefusal(gate);
  await tx.db.updateTable('test').set({ state: next.to, assigned_analyst: analystId }).where('id', '=', testId).execute();
  return receipt(`Assigned ${t.label} to ${candidate!.printedName}.`, 'audited', { testId, analystId });
}

export const assignTest = defineCommand({
  name: 'test.assign',
  input: z.object({ testId: RecordIdSchema, analystId: uuid }),
  acting: { as: 'role', role: 'LabManager' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: (tx, i) => assignTo(tx, i.testId, i.analystId as PersonId, 'assign'),
});

export const reassignTest = defineCommand({
  name: 'test.reassign',
  input: z.object({ testId: RecordIdSchema, analystId: uuid, reason: ReasonSchema }),
  acting: { as: 'role', role: 'LabManager' },
  reason: (i) => toReason(i.reason),
  ledgers: () => [],
  run: (tx, i) => assignTo(tx, i.testId, i.analystId as PersonId, 'reassign'),
});

// ---------------------------------------------------------------------------------------------
// 4. The Analyst's work
// ---------------------------------------------------------------------------------------------

export const startTest = defineCommand({
  name: 'test.start',
  input: z.object({ testId: RecordIdSchema }),
  acting: { as: 'role', role: 'Analyst' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx, { testId }) => {
    const t = await loadTest(tx.db, testId);
    if (t.assignedAnalyst !== person(tx)) return { kind: 'not-permitted', message: `${t.label} is assigned to another Analyst.` };
    const next = move(TestMachine, t.label, t.state, 'start', 'assignee');
    if ('kind' in next) return next;
    await tx.db.updateTable('test').set({ state: next.to }).where('id', '=', testId).execute();
    return receipt(`Started ${t.label}.`, 'audited', { testId, state: next.to });
  },
});

export const createRun = defineCommand({
  name: 'run.create',
  input: z.object({
    methodVersionId: uuid,
    equipmentId: uuid,
    sequenceId: z.string().min(1).max(128),
    /** The printout, hashed on arrival and stored content-addressed; the paper is Retained (decision 20 §6). */
    trueCopy: z.object({ mediaType: z.string().min(1).max(100), base64: z.string().min(1).max(4_000_000) }),
  }),
  acting: { as: 'role', role: 'Analyst' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const lab = await labOf(tx.db, staffLab(tx));
    const equipment = await tx.db.selectFrom('equipment').select('id').where('id', '=', input.equipmentId).executeTakeFirst();
    if (!equipment) return { kind: 'not-permitted', message: 'No such Equipment in this Lab.' };
    const year = yearIn(lab.zone, tx.dbNow);
    const number = labNumber(lab.code, 'R', year, await nextNumber(tx, lab.id, 'run', year));
    const id = randomUUID() as RecordId;
    await tx.db.insertInto('record').values({ ledger_id: ledgerOf(lab.id), id, kind: 'run' }).execute();
    await tx.db.insertInto('run').values({ lab_id: lab.id, id, number, method_version_id: input.methodVersionId, acquired_by: person(tx), entry_mode: 'typed' }).execute();
    const bytes = Buffer.from(input.trueCopy.base64, 'base64');
    const sha256 = await storeBlob(tx, tx.deps.reportStore, ledgerOf(lab.id), bytes, input.trueCopy.mediaType);
    const values: Record<string, string> = {};
    for (const v of [
      { field: RUN_FIELDS.instrument, value: { type: 'ref' as const, value: input.equipmentId } },
      { field: RUN_FIELDS.sequence, value: { type: 'text' as const, value: input.sequenceId } },
      { field: RUN_FIELDS.trueCopy, value: { type: 'blob' as const, sha256: sha256 as Sha256Hex, mediaType: input.trueCopy.mediaType } },
    ]) {
      const saved = await tx.records.record({ parent: id, field: v.field, value: v.value });
      if ('kind' in saved) return saved;
      values[v.field] = saved.value;
    }
    return receipt(`Created Run ${number}; the True Copy is stored as ${sha256.slice(0, 8)}. Each value needs a second person's Verified.`, 'audited', { runId: id, number, trueCopySha256: sha256, values });
  },
});

export const linkTest = defineCommand({
  name: 'run.linkTest',
  input: z.object({ runId: RecordIdSchema, testId: RecordIdSchema }),
  acting: { as: 'role', role: 'Analyst' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, { runId, testId }) => {
    const t = await loadTest(tx.db, testId);
    if (t.state !== 'InProgress') return { kind: 'transition', message: `${t.label} is ${TestMachine.states[t.state]}; a Run is linked to a Test In Progress.` };
    const run = await tx.db.selectFrom('run').select(['number', 'method_version_id']).where('id', '=', runId).executeTakeFirst();
    if (!run) return { kind: 'not-permitted', message: 'No such Run in this Lab.' };
    if (run.method_version_id !== t.method?.id) return { kind: 'transition', message: `Run ${run.number} is on another Method version than ${t.label}.` };
    await tx.db.insertInto('run_test').values({ lab_id: t.labId, run_id: runId, test_id: testId }).execute();
    return receipt(`Linked Run ${run.number} to ${t.label}.`);
  },
});

export const createPreparation = defineCommand({
  name: 'preparation.create',
  input: z.object({ testId: RecordIdSchema }),
  acting: { as: 'role', role: 'Analyst' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, { testId }) => {
    const t = await loadTest(tx.db, testId);
    if (t.assignedAnalyst !== person(tx)) return { kind: 'not-permitted', message: `${t.label} is assigned to another Analyst.` };
    if (t.state !== 'InProgress') return { kind: 'transition', message: `${t.label} is ${TestMachine.states[t.state]}; Preparations are made on a Test In Progress.` };
    if (!t.method) return { kind: 'transition', message: `${t.label} has no pinned Method version.` };
    const count = t.method.data.preparations;
    if (t.preparations.length >= Number(count)) return { kind: 'transition', message: `${t.method.number} v${t.method.version} asks for exactly ${count} Preparations, and ${t.label} has them.` };
    const prepNo = t.preparations.length + 1;
    const id = randomUUID();
    await tx.db.insertInto('preparation').values({ lab_id: t.labId, id, test_id: testId, prep_no: prepNo }).execute();
    return receipt(`Added Preparation P${prepNo} to ${t.label}. Record its weight, dilution volume and each result as you make them.`, 'audited', { preparationId: id, prepNo, subject: `P${prepNo}` });
  },
});

// ---------------------------------------------------------------------------------------------
// 5. Review (Reviewer on Runs and Tests, QA on Test Reports)
// ---------------------------------------------------------------------------------------------

const REVIEW_ROLES = ['Reviewer', 'QA'] as const;

export const openReview = defineCommand({
  name: 'review.open',
  input: z.object({ recordId: RecordIdSchema, role: z.enum(REVIEW_ROLES) }),
  acting: { as: 'role-from-input', role: (i) => i.role },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, { recordId }) => {
    const rec = await tx.db.selectFrom('record').select(['kind', 'ledger_id']).where('id', '=', recordId).executeTakeFirst();
    const checklist = rec ? checklistFor(rec.kind) : null;
    if (!rec || !checklist) return { kind: 'not-permitted', message: 'A Review is opened on a Run, a Test or a Test Report.' };
    const lab = staffLab(tx);
    const id = randomUUID() as RecordId;
    await tx.db.insertInto('record').values({ ledger_id: ledgerOf(lab), id, kind: 'review' }).execute();
    await tx.db.insertInto('review').values({ lab_id: lab, id, reviews_record_id: recordId, checklist_version: checklist.version, reviewer_id: person(tx) }).execute();
    return receipt(`Opened your Review on checklist ${checklist.version}.`, 'audited', { reviewId: id, checklistVersion: checklist.version, items: checklist.items });
  },
});

export const tickChecklist = defineCommand({
  name: 'review.tick',
  input: z.object({ reviewId: RecordIdSchema, item: z.string().min(1).max(64), role: z.enum(REVIEW_ROLES) }),
  acting: { as: 'role-from-input', role: (i) => i.role },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, { reviewId, item }) => {
    const r = await loadReview(tx.db, reviewId);
    if (r.reviewer !== person(tx)) return { kind: 'not-permitted', message: 'A Review is ticked by the person who opened it.' };
    const checklist = checklistFor(r.reviewsKind);
    if (!checklist?.items.includes(item)) return { kind: 'not-permitted', message: `"${item}" is not on checklist ${r.checklistVersion}.` };
    if (r.ticked.includes(item)) return receipt(`"${item}" was already ticked.`);
    const saved = await tx.records.record({ parent: reviewId, field: REVIEW_FIELDS.tick, subject: item, value: { type: 'boolean', value: true } });
    if ('kind' in saved) return saved;
    return receipt(`Ticked "${item}".`, 'audited', { valueId: saved.value });
  },
});

/** QA confirms or disagrees with each verdict inside the signed hash, nothing pre-ticked (decision 29). */
export const confirmVerdict = defineCommand({
  name: 'review.confirmVerdict',
  input: z.object({ reviewId: RecordIdSchema, testId: RecordIdSchema, jurisdiction: z.enum(['FDA', 'EMA', 'NMPA', 'MHLW']), confirmation: z.enum(['confirmed', 'disagreed']) }),
  acting: { as: 'role', role: 'QA' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, { reviewId, testId, jurisdiction, confirmation }) => {
    const r = await loadReview(tx.db, reviewId);
    if (r.reviewer !== person(tx)) return { kind: 'not-permitted', message: 'A Review is filled by the person who opened it.' };
    if (r.reviewsKind !== 'test_report') return { kind: 'not-permitted', message: 'Verdicts are confirmed on the Review of a Test Report.' };
    const report = await loadReport(tx.db, r.reviews);
    const test = report.tests.find((t) => t.id === testId);
    if (!test) return { kind: 'not-permitted', message: 'That Test is not on this report.' };
    const saved = await tx.records.record({ parent: reviewId, field: REVIEW_FIELDS.verdict, subject: verdictSubject(test.label, jurisdiction), value: { type: 'text', value: confirmation } });
    if ('kind' in saved) return saved;
    return receipt(confirmation === 'confirmed' ? `Confirmed the ${jurisdiction} verdict.` : `Recorded your disagreement with the ${jurisdiction} verdict; release is refused until a Deviation resolves it.`, 'audited', { valueId: saved.value });
  },
});

export const returnTest = defineCommand({
  name: 'test.return',
  input: z.object({ testId: RecordIdSchema, reason: ReasonSchema }),
  acting: { as: 'role', role: 'Reviewer' },
  reason: (i) => toReason(i.reason),
  ledgers: () => [],
  run: async (tx, { testId }) => {
    const t = await loadTest(tx.db, testId);
    const next = move(TestMachine, t.label, t.state, 'return', 'Reviewer');
    if ('kind' in next) return next;
    await tx.db.updateTable('test').set({ state: next.to }).where('id', '=', testId).execute();
    return receipt(`Returned ${t.label} to the Analyst. Audited, not signed; the earlier version keeps its signature.`, 'audited', { testId, state: next.to });
  },
});

// ---------------------------------------------------------------------------------------------
// 6. Test Reports
// ---------------------------------------------------------------------------------------------

const DRAFT_ROLES = ['Reviewer', 'LabManager'] as const;

export const draftReport = defineCommand({
  name: 'report.draft',
  input: z.object({ submissionId: uuid, testIds: z.array(RecordIdSchema).min(1).max(50), role: z.enum(DRAFT_ROLES) }),
  acting: { as: 'role-from-input', role: (i) => i.role },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const lab = await labOf(tx.db, staffLab(tx));
    const tests = [];
    for (const id of input.testIds) tests.push(await loadTest(tx.db, id));
    const customerId = tests[0]!.customer.id;
    for (const t of tests) {
      if (t.submission.id !== input.submissionId) return { kind: 'not-permitted', message: `${t.label} is not on that Submission.` };
      if (t.state !== 'Reviewed') return { kind: 'transition', message: `${t.label} is ${TestMachine.states[t.state]}; only Reviewed Tests go on a report.` };
    }
    const year = yearIn(lab.zone, tx.dbNow);
    const number = labNumber(lab.code, 'TR', year, await nextNumber(tx, lab.id, 'report', year));
    const id = randomUUID() as RecordId;
    await tx.db.insertInto('record').values({ ledger_id: ledgerOf(lab.id), id, kind: 'test_report' }).execute();
    await tx.db.insertInto('test_report').values({ lab_id: lab.id, id, customer_id: customerId, submission_id: input.submissionId, number, state: 'Draft' }).execute();
    await tx.db.insertInto('test_report_test').values(input.testIds.map((t) => ({ lab_id: lab.id, report_id: id, test_id: t }))).execute();
    return receipt(`Drafted Test Report ${number} with ${tests.length} Test${tests.length === 1 ? '' : 's'}.`, 'audited', { reportId: id, number });
  },
});

export const submitReportToQa = defineCommand({
  name: 'report.submitToQa',
  input: z.object({ reportId: RecordIdSchema, role: z.enum(DRAFT_ROLES) }),
  acting: { as: 'role-from-input', role: (i) => i.role },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx, { reportId, role }) => {
    const r = await loadReport(tx.db, reportId);
    const next = move(TestReportMachine, r.label, r.state, 'submitToQa', role);
    if ('kind' in next) return next;
    await tx.db.updateTable('test_report').set({ state: next.to }).where('id', '=', reportId).execute();
    return receipt(`${r.label} is In QA Review.`, 'audited', { reportId, state: next.to });
  },
});

export const returnReport = defineCommand({
  name: 'report.return',
  input: z.object({ reportId: RecordIdSchema, reason: ReasonSchema }),
  acting: { as: 'role', role: 'QA' },
  reason: (i) => toReason(i.reason),
  ledgers: () => [],
  run: async (tx, { reportId }) => {
    const r = await loadReport(tx.db, reportId);
    const next = move(TestReportMachine, r.label, r.state, 'return', 'QA');
    if ('kind' in next) return next;
    await tx.db.updateTable('test_report').set({ state: next.to }).where('id', '=', reportId).execute();
    return receipt(`Returned ${r.label} to Draft.`, 'audited', { reportId, state: next.to });
  },
});

/** The Customer's download: audited as a row, answered with a 60-second single-use link (never stored). */
export const downloadReport = defineCommand({
  name: 'report.download',
  input: z.object({ reportId: RecordIdSchema, labId: LabIdSchema }),
  acting: { as: 'role', role: 'CustomerUser' },
  reason: { kind: 'action' },
  ledgers: (i) => [ledgerOf(i.labId)],
  scope: (i) => ({ kind: 'lab', labId: i.labId }),
  run: async (tx, { reportId, labId }) => {
    const a = tx.actor;
    if (a.kind !== 'customer') return { kind: 'not-permitted', message: 'Reports are downloaded by the Customer in the portal.' };
    const r = await tx.db.selectFrom('test_report as r').innerJoin('record_version as v', 'v.record_id', 'r.id').innerJoin('report_issue as i', 'i.report_version_id', 'v.id')
      .select(['r.number', 'r.customer_id', 'v.id as version_id', 'i.pdf_sha256']).where('r.id', '=', reportId).where('r.state', '=', 'Released').executeTakeFirst();
    if (!r || r.customer_id !== a.customer) return { kind: 'not-permitted', message: 'No released Test Report of yours has that id.' };
    await tx.db.insertInto('report_download').values({ lab_id: labId, id: randomUUID(), customer_id: a.customer, report_version_id: r.version_id, person_id: a.person }).execute();
    const sha256 = r.pdf_sha256.toString('hex') as Sha256Hex;
    const token = tx.deps.fileTokens.mint({ ledger: ledgerOf(labId), sha256, mediaType: 'application/pdf', filename: `${r.number}.pdf` }, tx.dbNow);
    return receipt(`Download of ${r.number} recorded. The link works once, for 60 seconds.`, 'audited', { reportId, number: r.number, sha256 }, { data: { url: `/files/${token}` } });
  },
});

// ---------------------------------------------------------------------------------------------
// Out of the slice: refused with its reason, logged as a spec gap (rule 2: never faked).
// ---------------------------------------------------------------------------------------------

const NOT_BUILT: readonly NotBuilt[] = [
  'hold-release', 'amended-report', 'invalidation', 'non-gmp-marking', 'raise-to-gmp', 'retest', 'receipt-discrepancy', 'sample-return', 'sample-disposal',
  'import', 'passkey', 'anchoring', 'below-loq-reporting', 'multiple-nitrosamine-sum', 'basis-correction', 'deviation-workflow',
];

export const notBuilt = defineCommand({
  name: 'chain.notBuilt',
  input: z.object({ feature: z.enum(NOT_BUILT as [NotBuilt, ...NotBuilt[]]), recordId: uuid.optional() }),
  acting: { as: 'session' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (_tx, { feature }) => refuse.notBuilt(feature),
});

export const chainCommands = [
  submit, acceptTest, rejectTest, receiveSample, assignTest, reassignTest, startTest, createRun, linkTest, createPreparation,
  openReview, tickChecklist, confirmVerdict, returnTest, draftReport, submitReportToQa, returnReport, downloadReport, notBuilt,
];

