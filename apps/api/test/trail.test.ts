import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { audited } from '@lims/db';
import {
  auditedRecords,
  auditedTables,
  isAuditedTable,
  routes,
  type StepInput,
  type StepName,
  stepRoute,
  type TrailEntry,
} from '@lims/domain';
import { sql } from 'kysely';
import { type Account, type Client, ok, refusedWith, signatureOf, startApi } from './harness.ts';

const api = await startApi('lims_api_trail_test');
const [cora, samir, lena, ana, rui, quinn] = [
  api.person('cora'),
  api.person('samir'),
  api.person('lena'),
  api.person('ana'),
  api.person('rui'),
  api.person('quinn'),
];
const as = {
  cora: await api.login(cora),
  samir: await api.login(samir),
  lena: await api.login(lena),
  ana: await api.login(ana),
  rui: await api.login(rui),
  quinn: await api.login(quinn),
};

const result = {
  analyte: 'NDMA',
  value: '0.0300',
  unit: 'ppm',
  injectionSequenceRef: 'SEQ-2026-0042',
  notebookRef: 'NB-RD-0001-012',
  performedOn: '2026-09-30',
};

async function take(client: Client, name: StepName, testId: string, input: StepInput<StepName> = {}, signer?: Account) {
  const signature = signer && (await signatureOf(client, testId, signer));
  assert.equal(
    (await client.call(stepRoute(name), { commitKey: randomUUID(), testId, input, ...(signature && { signature }) }))
      .status,
    200,
  );
}

const order = ['Requested', 'Ready', 'Assigned', 'SubmittedForReview', 'Reviewed', 'Reported'] as const;
async function submitTestTo(state: (typeof order)[number]): Promise<string> {
  const { testId: id } = ok(
    await as.cora.call(stepRoute('submit'), {
      commitKey: randomUUID(),
      input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' },
    }),
  );
  const reach = order.indexOf(state);
  if (reach >= 1) await take(as.samir, 'receive', id);
  if (reach >= 2) await take(as.lena, 'assign', id, { assigneeId: ana.id });
  if (reach >= 3) await take(as.ana, 'enterResult', id, result, ana);
  if (reach >= 4) await take(as.rui, 'review', id, {}, rui);
  if (reach >= 5) await take(as.quinn, 'release', id, {}, quinn);
  return id;
}

const trailOf = async (id: string, client = as.rui) => ok(await client.call(routes.testTrail, { id }));
const lastEntryOf = async (chain: string) =>
  (
    await api.db
      .selectFrom('auditEntry')
      .select(sql<string>`max(seq)::text`.as('last'))
      .where('chain', '=', chain)
      .executeTakeFirstOrThrow()
  ).last;

const rename = (table: 'person' | 'customer', id: string, change: Record<string, string>, reason: string) =>
  audited(api.db, { actor: 'svc:test', role: 'system', reason }, (tx) =>
    tx.updateTable(table).set(change).where('id', '=', id).execute(),
  );

it("the Test's trail lists the Test's, its Result's and Signatures' entries with its Sample's and its Submission's, in time order, each marked with its chain", async () => {
  const other = await submitTestTo('Ready');
  const id = await submitTestTo('Reported');
  const { entries, record, labZone } = await trailOf(id);

  assert.deepEqual(record, { table: 'test', id, kind: 'Test', label: entries[1]?.record.label });
  assert.equal(labZone, 'America/New_York');
  const tables = new Set(entries.map((e) => e.record.table));
  assert.deepEqual([...tables].sort(), [
    'record_version',
    'result',
    'sample',
    'signature',
    'submission',
    'test',
    'test_report',
  ]);
  assert.deepEqual(
    entries.filter((e) => e.record.table === 'test').map((e) => e.op),
    ['INSERT', 'UPDATE', 'UPDATE', 'UPDATE', 'UPDATE', 'UPDATE', 'UPDATE'],
    'one entry for the Test itself per step, two for assign (its state, then its Analyst), and none of another Test',
  );
  assert.equal(entries.filter((e) => e.record.table === 'signature').length, 3);
  for (const e of entries)
    assert.equal(e.chain, e.record.table === 'submission' ? 'company' : 'lab', `${e.record.kind} on its chain`);
  for (const [i, e] of entries.entries()) {
    const previous = entries[i - 1];
    if (previous) assert.ok(previous.at <= e.at, `entry ${previous.seq} before ${e.seq} in time`);
  }
  const otherTrail = await trailOf(other);
  assert.ok(!entries.some((e) => otherTrail.entries.some((o) => o.raw.chain === e.raw.chain && o.seq === e.seq)));
});

function onLabClock(at: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
    // oxlint-disable-next-line no-restricted-globals -- parses an instant to render it; reads no clock
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === type)?.value ?? '';
  const offset = part('timeZoneName').replace(/^GMT$/, 'GMT+00:00').slice(3);
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}${at.slice(19, 26)}${offset}`;
}

it("each entry carries the actor's label and role, the field's glossary name, old and new value, the reason, and UTC plus Lab-zone time; company-chain entries carry UTC only", async () => {
  const id = await submitTestTo('Assigned');
  const { entries } = await trailOf(id);
  const [moved, assign] = entries.filter((e) => e.reason === 'assign');
  assert.ok(moved && assign, 'the two assign entries');
  assert.deepEqual(
    [moved, assign].map((e) => ({ actor: e.actor, reason: e.reason, op: e.op, changes: e.changes })),
    [
      {
        actor: { label: 'Lena Varga', role: 'LabManager' },
        reason: 'assign',
        op: 'UPDATE',
        changes: [
          {
            field: 'state',
            label: 'State',
            old: { text: 'Ready', ref: null, instant: null },
            new: { text: 'Assigned', ref: null, instant: null },
          },
        ],
      },
      {
        actor: { label: 'Lena Varga', role: 'LabManager' },
        reason: 'assign',
        op: 'UPDATE',
        changes: [
          {
            field: 'assignee_id',
            label: 'Analyst',
            old: null,
            new: { text: 'Ana Ferreira', ref: { table: 'person', id: ana.id }, instant: null },
          },
        ],
      },
    ],
  );
  assert.equal(
    assign.atLab,
    onLabClock(assign.at),
    'the same instant on the Lab wall clock, ISO 8601 with the offset, as Intl renders it',
  );
  assert.match(assign.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/, 'UTC to the microsecond, as hashed');

  const submission = entries.find((e) => e.record.table === 'submission') ?? assert.fail('the Submission entry');
  assert.deepEqual(
    { chain: submission.chain, atLab: submission.atLab, actor: submission.actor },
    { chain: 'company', atLab: null, actor: { label: 'Cora Lindqvist', role: 'Customer' } },
  );
  const received = entries.find((e) => e.reason === 'receive' && e.record.table === 'sample');
  assert.deepEqual(
    received?.changes.map((c) => [c.label, c.old, c.new?.text === received.raw.newRow?.received_at]),
    [['Received', null, true]],
    'the Sample receipt reads as Received with the stored time',
  );
});

it("after a person's printed name or a record's label changes, an earlier entry still shows the label as it stood at that entry's time", async () => {
  const id = await submitTestTo('Assigned');
  const before = await trailOf(id);
  const submission = before.entries.find((e) => e.record.table === 'submission')?.record ?? assert.fail();
  const customerId = before.entries[0]?.changes.find((c) => c.field === 'customer_id')?.new?.ref?.id ?? assert.fail();
  await rename('person', ana.id, { displayName: 'Ana Ferreira-Souza' }, 'Correct a printed name');
  await rename('customer', customerId, { name: 'Northwind Generics Ltd (fictional)' }, 'Correct a Customer name');
  await take(as.ana, 'enterResult', id, result, ana);
  const { entries } = await trailOf(id);
  const submissionTrail = ok(await as.rui.call(routes.recordTrail, { table: 'submission', id: submission.id }));
  await rename('person', ana.id, { displayName: 'Ana Ferreira' }, 'Restore a printed name');
  await rename('customer', customerId, { name: 'Northwind Generics (fictional)' }, 'Restore a Customer name');

  const assign =
    entries.find((e) => e.changes.some((c) => c.field === 'assignee_id')) ?? assert.fail('the assign entry');
  const performed = entries.find((e) => e.reason === 'enterResult' && e.record.table === 'signature');
  assert.equal(assign.changes[0]?.new?.text, 'Ana Ferreira', 'the assignee as named when assigned');
  assert.equal(
    entries.find((e) => e.record.table === 'submission')?.record.label,
    'from Northwind Generics (fictional)',
    'the Submission labelled by its Customer as named at the time',
  );
  assert.deepEqual(
    [performed?.actor.label, performed?.changes.find((c) => c.field === 'person_id')?.new?.text],
    ['Ana Ferreira-Souza', 'Ana Ferreira-Souza'],
    'the signer as named when signing',
  );
  assert.deepEqual(
    [submissionTrail.record.label, submissionTrail.entries[0]?.record.label],
    ['from Northwind Generics Ltd (fictional)', 'from Northwind Generics (fictional)'],
    "the heading follows the latest image even after the record's last entry; the entry keeps the label of its time",
  );
});

it("a record's trail labels a reference two deep, such as a Sample's Submission by its Customer", async () => {
  const id = await submitTestTo('SubmittedForReview');
  const trail = await trailOf(id);
  const sample = trail.entries.find((e) => e.record.table === 'sample')?.record ?? assert.fail();
  const result = trail.entries.find((e) => e.record.table === 'result')?.record ?? assert.fail();
  const sampleTrail = ok(await as.rui.call(routes.recordTrail, { table: 'sample', id: sample.id }));
  assert.equal(
    sampleTrail.entries[0]?.changes.find((c) => c.field === 'submission_id')?.new?.text,
    'from Northwind Generics (fictional)',
  );
  const resultTrail = ok(await as.rui.call(routes.recordTrail, { table: 'result', id: result.id }));
  assert.equal(resultTrail.entries[0]?.changes.find((c) => c.field === 'test_id')?.new?.text, sample.label);
});

it("a company record out of this Lab's sight is not found: a person of another Lab, a Customer with no Sample here", async () => {
  const other = await audited(
    api.superuser,
    { actor: 'svc:test', role: 'system', reason: 'Add another Lab' },
    async (tx) => {
      // Company rows first: a transaction locks the company chain before any Lab's (lims.lock_chains).
      const { id: personId } = await tx
        .insertInto('person')
        .values({ username: 'olaf.other-lab', displayName: 'Olaf Other', passwordHash: 'not-a-real-hash' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const { id: customerId } = await tx
        .insertInto('customer')
        .values({ name: 'Unseen Customer (fictional)' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const { id: submissionId } = await tx
        .insertInto('submission')
        .values({ customerId, submittedBy: personId, number: 'SUB-2026-900002' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const { labId } = await tx
        .insertInto('lab')
        .values({ code: 'OL', name: 'Other Lab', timeZone: 'Europe/Zurich' })
        .returning('labId')
        .executeTakeFirstOrThrow();
      await tx.insertInto('membership').values({ labId, personId, role: 'Analyst' }).execute();
      const { id: sampleId } = await tx
        .insertInto('sample')
        .values({ labId, submissionId, number: 'OL-S-2026-000001', description: 'Capsules (fictional)' })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { personId, customerId, submissionId, sampleId };
    },
  );
  refusedWith(await as.rui.call(routes.recordTrail, { table: 'person', id: other.personId }), 'notFound');
  refusedWith(await as.rui.call(routes.recordTrail, { table: 'customer', id: other.customerId }), 'notFound');
  refusedWith(await as.rui.call(routes.recordTrail, { table: 'submission', id: other.submissionId }), 'notFound');
  refusedWith(await as.rui.call(routes.recordTrail, { table: 'sample', id: other.sampleId }), 'notFound');
  assert.ok(ok(await as.rui.call(routes.recordTrail, { table: 'person', id: ana.id })).entries.length > 0);
  const customerId = (
    await api.db.selectFrom('customer').select('id').where('name', 'like', 'Northwind%').executeTakeFirstOrThrow()
  ).id;
  assert.ok(ok(await as.rui.call(routes.recordTrail, { table: 'customer', id: customerId })).entries.length > 0);
});

it('every column a row snapshot stores has a glossary label in the registry, other than the id and the Lab', async () => {
  await submitTestTo('Reported');
  const { rows } = await sql<{ table: string; column: string }>`
    select distinct table_name as "table", jsonb_object_keys(coalesce(new_row, old_row)) as "column"
      from lims.audit_entry where table_name = any(${auditedTables}::text[])`.execute(api.db);
  assert.deepEqual(
    rows.filter(
      ({ table, column }) =>
        !['id', 'lab_id'].includes(column) &&
        !(isAuditedTable(table) && Object.hasOwn(auditedRecords[table].fields, column)),
    ),
    [],
  );
});

it("the registry's chain for each audited table matches whether the table carries a lab_id column", async () => {
  const { rows } = await sql<{ table: string }>`
    select table_name as "table" from information_schema.columns
     where table_schema = 'lims' and column_name = 'lab_id'`.execute(api.db);
  const labTables = new Set(rows.map((r) => r.table));
  assert.deepEqual(
    Object.fromEntries(auditedTables.map((t) => [t, auditedRecords[t].chain])),
    Object.fromEntries(auditedTables.map((t) => [t, labTables.has(t) ? 'lab' : 'company'])),
  );
});

it("a cited record's own trail holds only that record's entries, and a record out of reach is not found", async () => {
  const id = await submitTestTo('Requested');
  const { entries } = ok(await as.rui.call(routes.recordTrail, { table: 'method', id: api.methodId }));
  assert.ok(entries.length > 0);
  assert.deepEqual(
    [...new Set(entries.map((e) => `${e.chain} ${e.record.kind} ${e.record.id}`))],
    [`company Method ${api.methodId}`],
  );
  refusedWith(await as.rui.call(routes.recordTrail, { table: 'sample', id }), 'notFound');
});

it("QA's Verify chain on an untouched chain replies Intact, verified through entry N, with N the chain's last entry; another role is refused", async () => {
  await submitTestTo('Ready');
  const verified = ok(await as.quinn.call(routes.verifyAuditTrail));
  const [labLast, companyLast] = [await lastEntryOf(api.labId), await lastEntryOf('company')];
  assert.deepEqual(verified.chains, [
    {
      chain: 'lab',
      lastEntry: labLast,
      intactThrough: labLast,
      firstFailure: null,
      incident: null,
      verdict: 'Intact',
      report: `verified through entry ${labLast}`,
    },
    {
      chain: 'company',
      lastEntry: companyLast,
      intactThrough: companyLast,
      firstFailure: null,
      incident: null,
      verdict: 'Intact',
      report: `verified through entry ${companyLast}`,
    },
  ]);
  assert.equal(
    refusedWith(await as.rui.call(routes.verifyAuditTrail), 'role'),
    'verifying the Audit Trail is a QA action',
  );
  refusedWith(await as.lena.call(routes.verifyAuditTrail), 'role');
});

it('a Customer User asking for any trail is refused', async () => {
  const id = await submitTestTo('Reported');
  ok(await as.cora.call(routes.test, { id }));
  assert.equal(
    refusedWith(await as.cora.call(routes.testTrail, { id }), 'role'),
    'the Audit Trail is not shown to a Customer User',
  );
  refusedWith(await as.cora.call(routes.recordTrail, { table: 'test', id }), 'role');
  refusedWith(await as.cora.call(routes.recordTrail, { table: 'method', id: api.methodId }), 'role');
});

it('a stored instant carries its UTC and Lab-zone renderings, a Record kind reads as its glossary noun, and a hash as hex', async () => {
  const id = await submitTestTo('SubmittedForReview');
  const { entries } = await trailOf(id);
  const changeOf = (table: string, field: string) =>
    entries.flatMap((e) => (e.record.table === table ? e.changes : [])).find((c) => c.field === field)?.new ??
    assert.fail(`the ${table} ${field} change`);
  for (const [table, field] of [
    ['sample', 'received_at'],
    ['signature', 'signed_at'],
    ['record_version', 'saved_at'],
  ] as const) {
    const { instant } = changeOf(table, field);
    assert.match(instant?.at ?? '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/, `${field} in UTC to the microsecond`);
    assert.equal(instant?.atLab, onLabClock(instant?.at ?? ''), `${field} on the Lab wall clock`);
  }
  assert.equal(changeOf('record_version', 'record_table').text, 'Test');
  assert.match(changeOf('record_version', 'content_hash').text, /^[0-9a-f]{64}$/);
});

it('the raw entry under each readable entry keeps the stored values and hashes', async () => {
  const id = await submitTestTo('SubmittedForReview');
  const { entries } = await trailOf(id);
  const signature = entries.find((e) => e.record.table === 'signature') ?? assert.fail('the Signature entry');
  const stored = await api.db
    .selectFrom('auditEntry')
    .select([sql<string>`encode(hash, 'hex')`.as('hash'), 'newRow'])
    .where('chain', '=', api.labId)
    .where('seq', '=', signature.seq)
    .executeTakeFirstOrThrow();
  assert.deepEqual([signature.raw.hash, signature.raw.newRow], [stored.hash, stored.newRow]);
  assert.equal(signature.changes.find((c) => c.field === 'record_version_id')?.label, 'Record Version');
  const version =
    entries.findLast((e) => e.record.table === 'record_version') ?? assert.fail('the Record Version entry');
  const content = version.changes.find((c) => c.field === 'content');
  assert.equal(content?.label, 'Canonical content');
  assert.equal(JSON.parse(content?.new?.text ?? '').analyte, 'NDMA', 'the signed bytes read as the Record Version');
});

const chainIncidents = (chain: string) =>
  api.db
    .selectFrom('systemIncident')
    .select(['reference', 'firstFailure'])
    .where('kind', '=', 'ChainVerifyFailure')
    .where('chain', '=', chain)
    .execute();

it('after an entry is altered by the database owner, Verify chain names it as the first failure, reports intact only through the entry before it, and opens one System Incident naming the chain and that entry, requested by the QA; verifying again, by the same QA or another, at once or later, opens no other; and a verification whose System Incident cannot be written shows no verdict', async () => {
  await submitTestTo('Ready');
  const last = BigInt(await lastEntryOf(api.labId));
  const altered = last - 2n;
  await api.superuser.transaction().execute(async (tx) => {
    await sql`set local session_replication_role = replica`.execute(tx);
    await sql`update lims.audit_entry set reason = 'Routine update' where chain = ${api.labId} and seq = ${String(altered)}`.execute(
      tx,
    );
  });

  const probe = sql`check (kind::text <> 'ChainVerifyFailure' or first_failure <> ${sql.lit(Number(altered))})`;
  await sql`alter table lims.system_incident add constraint unwritable_probe ${probe}`.execute(api.superuser);
  const unwritten = refusedWith(await as.quinn.call(routes.verifyAuditTrail), 'failure');
  await sql`alter table lims.system_incident drop constraint unwritable_probe`.execute(api.superuser);
  const failure = /reference (\w+)/.exec(unwritten)?.[1] ?? assert.fail(`no reference in ${unwritten}`);
  assert.partialDeepStrictEqual(ok(await as.quinn.call(routes.incident, { reference: failure })), {
    kind: 'UnexpectedFailure',
    step: 'verifyAuditTrail',
    requestedBy: quinn.id,
  });
  assert.deepEqual(await chainIncidents(api.labId), [], 'no verdict and no chain-verify System Incident');

  const verified = ok(await as.quinn.call(routes.verifyAuditTrail));
  const incident = verified.chains[0]?.incident ?? assert.fail('the break names a System Incident');
  assert.deepEqual(verified.chains[0], {
    chain: 'lab',
    lastEntry: String(last),
    intactThrough: String(altered - 1n),
    firstFailure: String(altered),
    incident,
    verdict: 'Broken',
    report: `entry ${altered} fails to verify; intact through entry ${altered - 1n}; recorded as System Incident ${incident}`,
  });

  assert.partialDeepStrictEqual(ok(await as.quinn.call(routes.incident, { reference: incident })), {
    reference: incident,
    kind: 'ChainVerifyFailure',
    state: 'Open',
    chain: api.labId,
    firstFailure: String(altered),
    requestedBy: quinn.id,
    sessionLabId: api.labId,
    step: null,
    errorClass: null,
  });
  const written = await api.db
    .selectFrom('auditEntry')
    .select(['chain', 'actor'])
    .where('tableName', '=', 'system_incident')
    .where(sql<string>`new_row->>'reference'`, '=', incident)
    .executeTakeFirstOrThrow();
  assert.deepEqual(written, { chain: 'company', actor: 'svc:incident' }, 'the incident is a company record');

  const other = await api.login(await api.addPerson('chain.verifier', ['QA']));
  await submitTestTo('Ready');
  for (const qa of [as.quinn, other])
    assert.equal(ok(await qa.call(routes.verifyAuditTrail)).chains[0]?.incident, incident);
  const concurrent = await Promise.all([as.quinn, other].map((qa) => qa.call(routes.verifyAuditTrail)));
  assert.deepEqual(
    concurrent.map((answer) => ok(answer).chains[0]?.incident),
    [incident, incident],
  );
  assert.deepEqual(await chainIncidents(api.labId), [{ reference: incident, firstFailure: String(altered) }]);

  const entry: TrailEntry | undefined = (
    await trailOf((await api.db.selectFrom('test').select('id').executeTakeFirstOrThrow()).id)
  ).entries[0];
  assert.ok(entry, 'the trail still reads after a break; the break is reported by Verify chain');
});

it("after the company chain's head is moved, two QAs verifying at once open one System Incident naming the entry after the last that verifies, and the entries written since, its own among them, open no other", async () => {
  const last = await lastEntryOf('company');
  await api.superuser.transaction().execute(async (tx) => {
    await sql`set local session_replication_role = replica`.execute(tx);
    await sql`update lims.audit_chain set head = sha256(head) where chain = 'company'`.execute(tx);
  });
  const other = await api.login(await api.addPerson('head.verifier', ['QA']));
  const raced = await Promise.all([as.quinn, other].map((qa) => qa.call(routes.verifyAuditTrail)));
  const [first, second] = raced.map((answer) => ok(answer).chains[1] ?? assert.fail('the company chain'));
  assert.ok(first && second);
  assert.equal(second.incident, first.incident, 'two QAs verifying at once share one System Incident');
  const incident = first.incident ?? assert.fail('the moved head names a System Incident');
  const after = String(BigInt(last) + 1n);
  assert.deepEqual(
    [first.firstFailure, second.firstFailure],
    [after, after],
    'whichever verification reads the other one incident written on the moved head, the failing entry is the same',
  );
  for (const { report } of [first, second])
    assert.ok(report.endsWith(`intact through entry ${last}; recorded as System Incident ${incident}`), report);

  await submitTestTo('Ready');
  const again = ok(await as.quinn.call(routes.verifyAuditTrail)).chains[1];
  assert.equal(again?.firstFailure, after, 'the first entry written on the moved head is the one that fails');
  assert.equal(again?.incident, incident);
  assert.deepEqual(await chainIncidents('company'), [{ reference: incident, firstFailure: after }]);
});
