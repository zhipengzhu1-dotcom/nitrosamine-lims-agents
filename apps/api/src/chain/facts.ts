// Fact loaders for the sample chain. Each reads through the scoped handle and returns plain facts:
// a Test with its Recorded Values, Runs and judgement; a Run with its Run Checks judged; a person's
// standing as performer, reviewer or releaser. Kinds build content from them, signing rules feed
// them to the pure gates, and views print them. Nothing here writes.

import { versionStands, type DB, type ReadDb } from '@lims/db';
import { calculatePreparation, type PreparationResults } from '@lims/domain/calculation';
import { written, type Written } from '@lims/domain/decimal';
import type { AdoptionStatusFacts, PerformerFacts, ReleaserFacts, ReviewerFacts, FitnessStatus } from '@lims/domain/gates';
import type { AnalyteKey, LabId, PersonId, PreparationId, RecordId, Sha256Hex, ValueRecordId, VersionId, VersionRef } from '@lims/domain/ids';
import { runState, type RunState, type TestState } from '@lims/domain/machines';
import { nonEmpty } from '@lims/domain/nonempty';
import type { Meaning } from '@lims/domain/signing';
import { judgeRunCheck, judgeTest, type ExportedRunCheck, type RunCheckOutcome, type TestJudgement } from '@lims/domain/verdict';
import { authorisationStanding, signingEnablement, trainingStanding } from '../records/facts.ts';
import { find, valuesUnder, type ValueFact } from '../records/values.ts';
import {
  MethodDataSchema, REVIEW_FIELDS, RUN_FIELDS, SpecificationDataSchema, TEST_FIELDS, methodTrainingDocument, preparationSubject, resultSubject,
  runChecksOf, sectionsOf, variabilityOf, type MethodData, type SpecificationData,
} from './model.ts';

export type Q = ReadDb<DB>;

const hex = (b: Buffer | null | undefined): Sha256Hex => (b as Buffer).toString('hex') as Sha256Hex;

const asWritten = (v: ValueFact): Written => written(v.effective.text);

// ---------------------------------------------------------------------------------------------
// Standing of a signable record: its effective version and the signatures that still stand on it
// ---------------------------------------------------------------------------------------------

export type SignatureFact = { readonly id: string; readonly meaning: Meaning; readonly signer: PersonId; readonly printedName: string; readonly username: string; readonly role: string; readonly signedAt: Date; readonly attestationVersionId: VersionId | null };

export type RecordStanding = {
  readonly version: (VersionRef & { readonly versionNo: number }) | null;
  /** Signatures on the effective version, whether or not it still stands. */
  readonly signatures: readonly SignatureFact[];
  readonly stands: boolean;
};

export async function recordStanding(q: Q, record: RecordId): Promise<RecordStanding> {
  const ev = await q.selectFrom('effective_version').select(['id', 'version_no', 'content_hash']).where('record_id', '=', record).executeTakeFirst();
  if (!ev) return { version: null, signatures: [], stands: false };
  const rows = await q.selectFrom('signature').select(['id', 'meaning', 'signer_person_id', 'printed_name', 'username', 'role', 'signed_at', 'attestation_version_id'])
    .where('record_version_id', '=', ev.id as string).orderBy('signed_at').execute();
  return {
    version: { versionId: ev.id as VersionId, versionNo: ev.version_no as number, hash: hex(ev.content_hash) },
    signatures: rows.map((s) => ({ id: s.id, meaning: s.meaning as Meaning, signer: s.signer_person_id as PersonId, printedName: s.printed_name, username: s.username, role: s.role, signedAt: s.signed_at, attestationVersionId: s.attestation_version_id as VersionId | null })),
    stands: await versionStands(q, ev.id as VersionId),
  };
}

/** True when a signature of the meaning stands on the record's effective version. */
export const signedAndStanding = (s: RecordStanding, meaning: Meaning): boolean => s.stands && s.signatures.some((x) => x.meaning === meaning);
export const signersOf = (s: RecordStanding, meaning: Meaning): PersonId[] => s.signatures.filter((x) => x.meaning === meaning).map((x) => x.signer);

// ---------------------------------------------------------------------------------------------
// Reference records
// ---------------------------------------------------------------------------------------------

export type MethodVersionFacts = {
  readonly id: RecordId;
  readonly methodId: string;
  readonly number: string;
  readonly title: string;
  readonly version: number;
  readonly data: MethodData;
  readonly trainingDocument: string;
  /** The effective (sealed) version, null until the version is sealed. */
  readonly ref: VersionRef | null;
  readonly approved: boolean;
};

export async function loadMethodVersion(q: Q, id: string): Promise<MethodVersionFacts> {
  const mv = await q.selectFrom('method_version as mv').innerJoin('method as m', 'm.id', 'mv.method_id')
    .select(['mv.id', 'mv.method_id', 'mv.version', 'mv.data', 'm.number', 'm.title']).where('mv.id', '=', id).executeTakeFirstOrThrow();
  const standing = await recordStanding(q, mv.id as RecordId);
  return {
    id: mv.id as RecordId, methodId: mv.method_id, number: mv.number, title: mv.title, version: mv.version,
    data: MethodDataSchema.parse(mv.data), trainingDocument: methodTrainingDocument(mv.number, mv.version),
    ref: standing.version, approved: signedAndStanding(standing, 'Approved'),
  };
}

export type SpecificationVersionFacts = {
  readonly specificationId: RecordId;
  readonly productId: string;
  readonly purpose: string;
  readonly ref: VersionRef & { readonly versionNo: number };
  readonly data: SpecificationData;
};

export async function loadSpecificationVersion(q: Q, versionId: string): Promise<SpecificationVersionFacts> {
  const v = await q.selectFrom('record_version as v').innerJoin('specification as s', 's.id', 'v.record_id')
    .select(['v.id', 'v.version_no', 'v.content_hash', 'v.content', 's.id as specification_id', 's.product_id', 's.purpose'])
    .where('v.id', '=', versionId).executeTakeFirstOrThrow();
  const body = JSON.parse(v.content.toString('utf8')) as { data: unknown };
  return {
    specificationId: v.specification_id as RecordId, productId: v.product_id, purpose: v.purpose,
    ref: { versionId: v.id as VersionId, versionNo: v.version_no, hash: hex(v.content_hash) }, data: SpecificationDataSchema.parse(body.data),
  };
}

/** The Specification version a Test may pin at Acceptance: Approved by QA, standing, and accepted by the Customer (decision 22). */
export async function acceptedSpecificationVersion(q: Q, productId: string, customerId: string): Promise<(VersionRef & { readonly versionNo: number }) | null> {
  const rows = await q.selectFrom('specification_acceptance as a').innerJoin('record_version as v', 'v.id', 'a.specification_version_id')
    .innerJoin('specification as s', 's.id', 'v.record_id')
    .select(['v.id', 'v.version_no', 'v.content_hash']).where('s.product_id', '=', productId).where('a.customer_id', '=', customerId)
    .orderBy('a.at', 'desc').execute();
  for (const r of rows) {
    const approved = await q.selectFrom('signature').select('id').where('record_version_id', '=', r.id).where('meaning', '=', 'Approved').executeTakeFirst();
    if (approved && (await versionStands(q, r.id as VersionId))) return { versionId: r.id as VersionId, versionNo: r.version_no, hash: hex(r.content_hash) };
  }
  return null;
}

export type AdoptionStatusOf = 'in-development' | 'validated-here' | 'transferred-in' | 'verified' | 'verified-basic-compendial' | 'retired' | 'none';

/** The Lab's Approved, standing Adoption of a Method version covering a Product: its status, else 'none'. */
export async function adoptionStatus(q: Q, lab: LabId, methodVersionId: string, productId: string): Promise<{ status: AdoptionStatusOf; adoptionId: RecordId | null }> {
  const rows = await q.selectFrom('method_adoption as a').innerJoin('method_adoption_scope as sc', (j) => j.onRef('sc.adoption_id', '=', 'a.id').onRef('sc.lab_id', '=', 'a.lab_id'))
    .select(['a.id', 'a.status']).where('a.lab_id', '=', lab).where('a.method_version_id', '=', methodVersionId).where('sc.product_id', '=', productId).execute();
  for (const r of rows) {
    const s = await recordStanding(q, r.id as RecordId);
    if (signedAndStanding(s, 'Approved')) return { status: r.status as AdoptionStatusOf, adoptionId: r.id as RecordId };
  }
  return { status: 'none', adoptionId: null };
}

const NITROSAMINE_KINDS = ['small-nitrosamine', 'ndsri'] as const;

/** What decision 36 §4 checks of a status on a Method version: its basis and which Analytes are nitrosamines. */
export async function adoptionStatusFacts(q: Q, method: MethodVersionFacts, status: AdoptionStatusFacts['status']): Promise<AdoptionStatusFacts> {
  const ids = method.data.analytes.map((a) => a.substanceId);
  const nitrosamines = new Set(ids.length === 0 ? [] : (await q.selectFrom('substance').select('id')
    .where('id', 'in', ids).where('kind', 'in', NITROSAMINE_KINDS).execute()).map((s) => s.id));
  return { status, basis: method.data.basis, nitrosamineAnalytes: method.data.analytes.filter((a) => nitrosamines.has(a.substanceId)).map((a) => a.key) };
}

/** The current Approved Method version of a Method, for a Test being accepted. */
export async function currentMethodVersion(q: Q, methodId: string): Promise<MethodVersionFacts | null> {
  const rows = await q.selectFrom('method_version').select('id').where('method_id', '=', methodId).orderBy('version', 'desc').execute();
  for (const r of rows) {
    const mv = await loadMethodVersion(q, r.id);
    if (mv.approved) return mv;
  }
  return null;
}

export async function labOf(q: Q, lab: LabId): Promise<{ readonly id: LabId; readonly code: string; readonly zone: string }> {
  const l = await q.selectFrom('lab').select(['id', 'code', 'iana_zone']).where('id', '=', lab).executeTakeFirstOrThrow();
  return { id: l.id as LabId, code: l.code, zone: l.iana_zone };
}

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------

export async function performerFacts(q: Q, person: PersonId, method: MethodVersionFacts, lab: LabId | null, dbNow: Date): Promise<PerformerFacts> {
  return {
    person,
    methodTraining: await trainingStanding(q, person, method.trainingDocument),
    prerequisiteTraining: await Promise.all(method.data.prerequisiteDocuments.map((d) => trainingStanding(q, person, d))),
    authorisation: await authorisationStanding(q, person, 'Performed', method.number, lab, dbNow),
    signing: await signingEnablement(q, person),
  };
}

export async function reviewerFacts(q: Q, person: PersonId, method: MethodVersionFacts, lab: LabId | null, dbNow: Date): Promise<ReviewerFacts> {
  return {
    person,
    methodTraining: await trainingStanding(q, person, method.trainingDocument),
    authorisation: await authorisationStanding(q, person, 'Reviewed', method.number, lab, dbNow),
    signing: await signingEnablement(q, person),
  };
}

export const RELEASE_SCOPE = 'test_report';
export const CONFORMITY_SCOPE = 'conformity-statements';

export async function releaserFacts(q: Q, person: PersonId, lab: LabId | null, dbNow: Date): Promise<ReleaserFacts> {
  return {
    person,
    authorisation: await authorisationStanding(q, person, 'Released', RELEASE_SCOPE, lab, dbNow),
    conformityAuthorisation: await authorisationStanding(q, person, 'Released', CONFORMITY_SCOPE, lab, dbNow),
    signing: await signingEnablement(q, person),
  };
}

/** Everyone holding the Analyst role in the Lab, as candidates for assignment. */
export async function analystsIn(q: Q, lab: LabId): Promise<readonly { id: PersonId; printedName: string; username: string }[]> {
  const rows = await q.selectFrom('role_grant as g').innerJoin('person as p', 'p.id', 'g.person_id').innerJoin('account as a', 'a.person_id', 'p.id')
    .select(['p.id', 'p.printed_name', 'a.username']).where('g.role', '=', 'Analyst').where('g.lab_id', '=', lab).where('g.revoked_at', 'is', null)
    .orderBy('p.printed_name').execute();
  return rows.map((r) => ({ id: r.id as PersonId, printedName: r.printed_name, username: r.username }));
}

// ---------------------------------------------------------------------------------------------
// Holds (a stub: nothing opens one yet)
// ---------------------------------------------------------------------------------------------

export async function openHolds(q: Q, testId: string): Promise<readonly string[]> {
  const rows = await q.selectFrom('hold').select('id').where('test_id', '=', testId).where('released_at', 'is', null).execute();
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------------------------
// The Test
// ---------------------------------------------------------------------------------------------

export type PreparationFacts = {
  readonly id: PreparationId;
  readonly prepNo: number;
  readonly weight: ValueFact | null;
  readonly dilution: ValueFact | null;
  readonly results: ReadonlyMap<AnalyteKey, ValueFact | null>;
};

export type RunLinkFacts = { readonly id: RecordId; readonly number: string; readonly standing: RecordStanding; readonly state: RunState };

export type TestFacts = {
  readonly id: RecordId;
  readonly labId: LabId;
  readonly label: string;
  readonly number: string | null;
  readonly seq: number;
  readonly state: TestState;
  readonly gxpClass: 'GMP' | 'non-GMP';
  readonly customer: { readonly id: string; readonly code: string; readonly name: string };
  readonly submission: { readonly id: string; readonly number: string };
  readonly sample: { readonly id: string; readonly number: string | null; readonly lotNumber: string; readonly state: string; readonly product: { readonly id: string; readonly code: string; readonly name: string } };
  readonly acceptanceReason: string | null;
  readonly assignedAnalyst: PersonId | null;
  readonly method: MethodVersionFacts | null;
  readonly specification: SpecificationVersionFacts | null;
  readonly values: readonly ValueFact[];
  readonly preparations: readonly PreparationFacts[];
  readonly runs: readonly RunLinkFacts[];
  /** Fields with no value yet, as the gate names them. */
  readonly missingValues: readonly string[];
  readonly judgement: TestJudgement | null;
  /** Each Preparation's results at full precision, where every input is in. */
  readonly calculated: readonly PreparationResults[];
  readonly holds: readonly string[];
};

export const testLabel = (t: { number: string | null; seq: number; lotNumber: string }): string => `Test ${t.number ?? `${t.lotNumber}/T${t.seq}`}`;

export async function loadTest(q: Q, id: string): Promise<TestFacts> {
  const t = await q.selectFrom('test as t')
    .innerJoin('sample as s', (j) => j.onRef('s.id', '=', 't.sample_id').onRef('s.lab_id', '=', 't.lab_id'))
    .innerJoin('submission as sb', 'sb.id', 's.submission_id')
    .innerJoin('customer as c', 'c.id', 't.customer_id')
    .innerJoin('product as p', 'p.id', 's.product_id')
    .select(['t.id', 't.lab_id', 't.number', 't.seq', 't.state', 't.gxp_class', 't.acceptance_reason', 't.assigned_analyst', 't.method_version_id', 't.specification_version_id',
      's.id as sample_id', 's.number as sample_number', 's.lot_number', 's.state as sample_state', 'sb.id as submission_id', 'sb.number as submission_number',
      'c.id as customer_id', 'c.code as customer_code', 'c.name as customer_name', 'p.id as product_id', 'p.code as product_code', 'p.name as product_name'])
    .where('t.id', '=', id).executeTakeFirstOrThrow();
  const method = t.method_version_id ? await loadMethodVersion(q, t.method_version_id) : null;
  const specification = t.specification_version_id ? await loadSpecificationVersion(q, t.specification_version_id) : null;
  const values = await valuesUnder(q, t.id as RecordId);
  const prepRows = await q.selectFrom('preparation').select(['id', 'prep_no']).where('test_id', '=', t.id).orderBy('prep_no').execute();
  const analytes = method ? method.data.analytes.map((a) => a.key as AnalyteKey) : [];
  const preparations: PreparationFacts[] = prepRows.map((p) => ({
    id: p.id as PreparationId, prepNo: p.prep_no,
    weight: find(values, TEST_FIELDS.weight, preparationSubject(p.prep_no)),
    dilution: find(values, TEST_FIELDS.dilution, preparationSubject(p.prep_no)),
    results: new Map(analytes.map((a) => [a, find(values, TEST_FIELDS.result, resultSubject(p.prep_no, a))])),
  }));
  const runRows = await q.selectFrom('run_test as rt').innerJoin('run as r', (j) => j.onRef('r.id', '=', 'rt.run_id').onRef('r.lab_id', '=', 'rt.lab_id'))
    .select(['r.id', 'r.number']).where('rt.test_id', '=', t.id).orderBy('r.number').execute();
  const runs: RunLinkFacts[] = [];
  for (const r of runRows) {
    const standing = await recordStanding(q, r.id as RecordId);
    runs.push({ id: r.id as RecordId, number: r.number, standing, state: runState({ performed: signedAndStanding(standing, 'Performed'), reviewed: signedAndStanding(standing, 'Reviewed') }) });
  }

  const missing: string[] = [];
  const minimum = method ? Number(method.data.preparations) : 0;
  if (preparations.length < minimum) missing.push(`Preparations (${preparations.length} of ${minimum})`);
  const inputs: PreparationResults[] = [];
  for (const p of preparations) {
    const label = preparationSubject(p.prepNo);
    if (!p.weight) missing.push(`${label} weight`);
    if (!p.dilution) missing.push(`${label} dilution volume`);
    for (const [a, v] of p.results) if (!v) missing.push(`${label} ${a} result`);
    if (!method || !p.weight || !p.dilution || [...p.results.values()].some((v) => v === null)) continue;
    const calculated = calculatePreparation({
      preparation: p.id, weightMg: asWritten(p.weight), dilutionVolumeMl: asWritten(p.dilution), dilutionFactor: written(method.data.dilutionFactor),
      concentrations: new Map([...p.results].map(([a, v]) => [a, asWritten(v!)])),
    });
    if (calculated.kind === 'weight-not-positive') missing.push(`${label} weight (not positive)`);
    else inputs.push(calculated.results);
  }
  const prepInputs = nonEmpty(inputs);
  const judgement = method && specification && missing.length === 0 && prepInputs
    ? judgeTest({ sections: sectionsOf(specification.data), preparations: prepInputs, variability: variabilityOf(method.data) })
    : null;

  return {
    id: t.id as RecordId, labId: t.lab_id as LabId, label: testLabel({ number: t.number, seq: t.seq, lotNumber: t.lot_number }), number: t.number, seq: t.seq,
    state: t.state as TestState, gxpClass: t.gxp_class as 'GMP' | 'non-GMP',
    customer: { id: t.customer_id, code: t.customer_code, name: t.customer_name },
    submission: { id: t.submission_id, number: t.submission_number },
    sample: { id: t.sample_id, number: t.sample_number, lotNumber: t.lot_number, state: t.sample_state, product: { id: t.product_id, code: t.product_code, name: t.product_name } },
    acceptanceReason: t.acceptance_reason, assignedAnalyst: t.assigned_analyst as PersonId | null,
    method, specification, values, preparations, runs, missingValues: missing, judgement, calculated: inputs, holds: await openHolds(q, t.id),
  };
}

// ---------------------------------------------------------------------------------------------
// The Run
// ---------------------------------------------------------------------------------------------

export type RunCheckFacts = { readonly check: ExportedRunCheck; readonly unit: string; readonly value: ValueFact | null; readonly outcome: RunCheckOutcome };

export type RunFacts = {
  readonly id: RecordId;
  readonly labId: LabId;
  readonly number: string;
  readonly label: string;
  readonly acquiredBy: PersonId;
  readonly method: MethodVersionFacts;
  readonly values: readonly ValueFact[];
  readonly instrument: { readonly value: ValueFact; readonly equipment: { readonly id: string; readonly code: string; readonly kind: string; readonly fitness: FitnessStatus } | null } | null;
  readonly sequence: ValueFact | null;
  readonly trueCopy: ValueFact | null;
  readonly runChecks: readonly RunCheckFacts[];
  readonly tests: readonly { readonly id: RecordId; readonly label: string }[];
  readonly standing: RecordStanding;
  readonly state: RunState;
  readonly missingValues: readonly string[];
};

export async function loadRun(q: Q, id: string): Promise<RunFacts> {
  const r = await q.selectFrom('run').select(['id', 'lab_id', 'number', 'acquired_by', 'method_version_id']).where('id', '=', id).executeTakeFirstOrThrow();
  const method = await loadMethodVersion(q, r.method_version_id);
  const values = await valuesUnder(q, r.id as RecordId);
  const instrumentValue = find(values, RUN_FIELDS.instrument);
  const equipment = instrumentValue
    ? await q.selectFrom('equipment').select(['id', 'code', 'kind', 'fitness_status']).where('id', '=', instrumentValue.effective.text).executeTakeFirst()
    : undefined;
  const runChecks: RunCheckFacts[] = method.data.runChecks.map((rc, i) => {
    const check = runChecksOf(method.data)[i]!;
    const value = find(values, RUN_FIELDS.runCheck, rc.name);
    return { check, unit: rc.unit, value, outcome: judgeRunCheck({ check, typed: value ? asWritten(value) : null }) };
  });
  const testRows = await q.selectFrom('run_test as rt').innerJoin('test as t', (j) => j.onRef('t.id', '=', 'rt.test_id').onRef('t.lab_id', '=', 'rt.lab_id'))
    .innerJoin('sample as s', (j) => j.onRef('s.id', '=', 't.sample_id').onRef('s.lab_id', '=', 't.lab_id'))
    .select(['t.id', 't.number', 't.seq', 's.lot_number']).where('rt.run_id', '=', r.id).execute();
  const standing = await recordStanding(q, r.id as RecordId);
  const missing = [
    ...(instrumentValue ? [] : ['instrument']),
    ...(find(values, RUN_FIELDS.sequence) ? [] : ['sequence ID']),
    ...(find(values, RUN_FIELDS.trueCopy) ? [] : ['True Copy']),
  ];
  return {
    id: r.id as RecordId, labId: r.lab_id as LabId, number: r.number, label: `Run ${r.number}`, acquiredBy: r.acquired_by as PersonId, method, values,
    instrument: instrumentValue ? { value: instrumentValue, equipment: equipment ? { id: equipment.id, code: equipment.code, kind: equipment.kind, fitness: equipment.fitness_status as FitnessStatus } : null } : null,
    sequence: find(values, RUN_FIELDS.sequence), trueCopy: find(values, RUN_FIELDS.trueCopy), runChecks,
    tests: testRows.map((t) => ({ id: t.id as RecordId, label: testLabel({ number: t.number, seq: t.seq, lotNumber: t.lot_number }) })),
    standing, state: runState({ performed: signedAndStanding(standing, 'Performed'), reviewed: signedAndStanding(standing, 'Reviewed') }),
    missingValues: missing,
  };
}

// ---------------------------------------------------------------------------------------------
// The Review
// ---------------------------------------------------------------------------------------------

export type ReviewFacts = {
  readonly id: RecordId;
  readonly reviews: RecordId;
  readonly reviewsKind: string;
  readonly checklistVersion: string;
  readonly reviewer: PersonId;
  readonly ticked: readonly string[];
  readonly confirmations: ReadonlyMap<string, 'confirmed' | 'disagreed'>;
  readonly values: readonly ValueFact[];
};

export async function loadReview(q: Q, id: string): Promise<ReviewFacts> {
  const r = await q.selectFrom('review as rv').innerJoin('record as rec', 'rec.id', 'rv.reviews_record_id')
    .select(['rv.id', 'rv.reviews_record_id', 'rv.checklist_version', 'rv.reviewer_id', 'rec.kind']).where('rv.id', '=', id).executeTakeFirstOrThrow();
  const values = await valuesUnder(q, r.id as RecordId);
  return {
    id: r.id as RecordId, reviews: r.reviews_record_id as RecordId, reviewsKind: r.kind, checklistVersion: r.checklist_version, reviewer: r.reviewer_id as PersonId,
    ticked: values.filter((v) => v.field === REVIEW_FIELDS.tick && v.effective.text === 'true').map((v) => v.subject),
    confirmations: new Map(values.filter((v) => v.field === REVIEW_FIELDS.verdict).map((v) => [v.subject, v.effective.text as 'confirmed' | 'disagreed'])),
    values,
  };
}

// ---------------------------------------------------------------------------------------------
// The Test Report
// ---------------------------------------------------------------------------------------------

export type ReportFacts = {
  readonly id: RecordId;
  readonly labId: LabId;
  readonly number: string;
  readonly label: string;
  readonly state: 'Draft' | 'InQaReview' | 'Released' | 'Superseded';
  readonly customer: { readonly id: string; readonly code: string; readonly name: string };
  readonly submission: { readonly id: string; readonly number: string };
  readonly tests: readonly (TestFacts & { readonly standing: RecordStanding })[];
  readonly standing: RecordStanding;
  readonly issue: { readonly pdfSha256: Sha256Hex; readonly releasedSignature: string; readonly rendererRelease: string } | null;
};

export async function loadReport(q: Q, id: string): Promise<ReportFacts> {
  const r = await q.selectFrom('test_report as r').innerJoin('customer as c', 'c.id', 'r.customer_id').innerJoin('submission as sb', 'sb.id', 'r.submission_id')
    .select(['r.id', 'r.lab_id', 'r.number', 'r.state', 'c.id as customer_id', 'c.code', 'c.name', 'sb.id as submission_id', 'sb.number as submission_number'])
    .where('r.id', '=', id).executeTakeFirstOrThrow();
  const testRows = await q.selectFrom('test_report_test').select('test_id').where('report_id', '=', r.id).execute();
  const tests = [];
  for (const t of testRows) tests.push({ ...(await loadTest(q, t.test_id)), standing: await recordStanding(q, t.test_id as RecordId) });
  tests.sort((a, b) => (a.number ?? '').localeCompare(b.number ?? ''));
  const standing = await recordStanding(q, r.id as RecordId);
  const issue = standing.version
    ? await q.selectFrom('report_issue').select(['pdf_sha256', 'released_signature', 'renderer_release']).where('report_version_id', '=', standing.version.versionId).executeTakeFirst()
    : undefined;
  return {
    id: r.id as RecordId, labId: r.lab_id as LabId, number: r.number, label: `Test Report ${r.number}`, state: r.state as ReportFacts['state'],
    customer: { id: r.customer_id, code: r.code, name: r.name }, submission: { id: r.submission_id, number: r.submission_number },
    tests, standing, issue: issue ? { pdfSha256: hex(issue.pdf_sha256), releasedSignature: issue.released_signature, rendererRelease: issue.renderer_release } : null,
  };
}

