import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { type Kysely, sql } from 'kysely';
import pg from 'pg';
import {
  audited,
  checkoutDatabase,
  createDb,
  type DB,
  databaseUrl,
  dbConfig,
  type Json,
  type JsonObject,
} from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

const { server } = dbConfig();

const DATABASE = checkoutDatabase('lims_record_version_test');
const SLICE = checkoutDatabase('lims_record_version_slice_test');
const migrations = new URL('../migrations/', import.meta.url);

const app = createDb(databaseUrl(server, DATABASE, 'lims_app'));
const superuser = createDb(databaseUrl(server, DATABASE)).withSchema('lims');
const svc = { actor: 'svc:test', role: 'system', reason: 'Change a record' };

const fixture = { labId: '', customerId: '', personId: '', methodId: '', submissionId: '' };
let sampleCount = 0;

async function dropDatabase(database: string): Promise<void> {
  const admin = new pg.Client({ connectionString: databaseUrl(server, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${pg.escapeIdentifier(database)} with (force)`);
  } finally {
    await admin.end();
  }
}

before(async () => {
  await dropDatabase(DATABASE);
  await migrate(server, DATABASE);
  await audited(app, { ...svc, reason: 'Set up the Lab' }, async (tx) => {
    ({ labId: fixture.labId } = await tx
      .insertInto('lab')
      .values({ code: 'RV', name: 'Versions Lab' })
      .returning('labId')
      .executeTakeFirstOrThrow());
    ({ id: fixture.customerId } = await tx
      .insertInto('customer')
      .values({ name: 'Versions Customer (fictional)' })
      .returning('id')
      .executeTakeFirstOrThrow());
    ({ id: fixture.personId } = await tx
      .insertInto('person')
      .values({ username: 'versions.person', displayName: 'Versions Person', passwordHash: 'not-a-real-hash' })
      .returning('id')
      .executeTakeFirstOrThrow());
    ({ id: fixture.methodId } = await tx
      .insertInto('method')
      .values({ code: 'RV-MTH-0001', version: '1', title: 'NDMA by LC-MS/MS (fictional)' })
      .returning('id')
      .executeTakeFirstOrThrow());
    ({ id: fixture.submissionId } = await tx
      .insertInto('submission')
      .values({ customerId: fixture.customerId, submittedBy: fixture.personId })
      .returning('id')
      .executeTakeFirstOrThrow());
  });
});

after(async () => {
  await app.destroy();
  await superuser.destroy();
});

async function submitTest(): Promise<{ sampleId: string; testId: string; number: string }> {
  const number = `RV-S${String(++sampleCount).padStart(5, '0')}`;
  return audited(app, { ...svc, reason: 'submit' }, async (tx) => {
    const { id: sampleId } = await tx
      .insertInto('sample')
      .values({ labId: fixture.labId, submissionId: fixture.submissionId, number, description: 'Tablets' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { id: testId } = await tx
      .insertInto('test')
      .values({ labId: fixture.labId, sampleId, methodId: fixture.methodId })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { sampleId, testId, number };
  });
}

const result = {
  analyte: 'NDMA',
  value: '0.0300',
  unit: 'ppm',
  injectionSequenceRef: 'SEQ-2026-0001',
  notebookRef: 'NB-RV-0001-001',
  performedOn: '2026-09-30',
};

/** Narrows a canonical content value to the object it is, so a test reads its fields without a cast. */
function object(json: Json | undefined): JsonObject {
  return typeof json === 'object' && json !== null && !Array.isArray(json) ? json : assert.fail('not an object');
}

function versions(db: Kysely<DB>, recordTable: 'test' | 'test_report', recordId: string) {
  return db
    .selectFrom('recordVersion')
    .select([
      'version',
      'canonicalForm',
      sql<string>`encode(content_hash, 'hex')`.as('hash'),
      sql<JsonObject>`convert_from(content, 'UTF8')::jsonb`.as('content'),
    ])
    .where('recordTable', '=', recordTable)
    .where('recordId', '=', recordId)
    .orderBy('version')
    .execute();
}

describe('the database writes a Record Version whenever a signable record changes', () => {
  it('a Test gets Record Version 1 at its first save, and a change to its Sample writes version 2', async () => {
    const { sampleId, testId, number } = await submitTest();
    const [first] = await versions(app, 'test', testId);
    assert.deepEqual(first?.content, {
      id: testId,
      customer: 'Versions Customer (fictional)',
      sample: number,
      description: 'Tablets',
      receivedAt: null,
      method: 'RV-MTH-0001',
      methodVersion: '1',
      methodTitle: 'NDMA by LC-MS/MS (fictional)',
      gxpClass: 'GMP',
      analyte: null,
      value: null,
      unit: null,
      injectionSequenceRef: null,
      notebookRef: null,
      performedOn: null,
    });
    assert.deepEqual([first?.version, first?.canonicalForm], [1, 1]);
    const { bytes } = await app
      .selectFrom('recordVersion')
      .select(sql<string>`convert_from(content, 'UTF8')`.as('bytes'))
      .where('recordId', '=', testId)
      .where('version', '=', 1)
      .executeTakeFirstOrThrow();
    assert.equal(
      bytes,
      `{"id": "${testId}", "unit": null, "value": null, "method": "RV-MTH-0001", "sample": "${number}", "analyte": null, ` +
        '"customer": "Versions Customer (fictional)", "gxpClass": "GMP", "receivedAt": null, "description": "Tablets", ' +
        '"methodTitle": "NDMA by LC-MS/MS (fictional)", "notebookRef": null, "performedOn": null, "methodVersion": "1", ' +
        '"injectionSequenceRef": null}',
      'canonical form 1 is these bytes, so a change to the rendering is a new form, not a silent change of every hash',
    );

    await audited(app, { ...svc, reason: 'receive' }, (tx) =>
      tx.updateTable('sample').set({ receivedAt: '2026-09-30T08:15:00.123456Z' }).where('id', '=', sampleId).execute(),
    );
    const after = await versions(app, 'test', testId);
    assert.deepEqual(
      after.map((v) => [v.version, v.content.receivedAt]),
      [
        [1, null],
        [2, '2026-09-30T08:15:00.123456Z'],
      ],
      'the earlier version is kept, and the time is rendered in UTC with its microseconds',
    );
    assert.notEqual(after[0]?.hash, after[1]?.hash);
  });

  it('a change that leaves the canonical content as it was, such as a state move, writes no Record Version', async () => {
    const { testId } = await submitTest();
    await audited(app, { ...svc, reason: 'receive' }, (tx) =>
      tx.updateTable('test').set({ state: 'Ready' }).where('id', '=', testId).execute(),
    );
    assert.deepEqual(
      (await versions(app, 'test', testId)).map((v) => v.version),
      [1],
    );
  });

  it('a Result removed from a Test, and a Test Report issued on it, each write the versions that changed', async () => {
    const { testId } = await submitTest();
    const { id: reportId } = await audited(app, { ...svc, reason: 'enterResult and release' }, async (tx) => {
      await tx
        .insertInto('result')
        .values({ labId: fixture.labId, testId, enteredBy: fixture.personId, ...result })
        .execute();
      return tx
        .insertInto('testReport')
        .values({ labId: fixture.labId, testId, number: `RV-R${testId.slice(0, 5)}` })
        .returning('id')
        .executeTakeFirstOrThrow();
    });
    const testAfterResult = await versions(app, 'test', testId);
    const [report] = await versions(app, 'test_report', reportId);
    assert.deepEqual(
      testAfterResult.map((v) => [v.version, v.content.value]),
      [
        [1, null],
        [2, '0.0300'],
      ],
    );
    assert.deepEqual(report?.content, {
      id: reportId,
      number: `RV-R${testId.slice(0, 5)}`,
      test: testAfterResult[1]?.content,
    });

    await audited(superuser, { ...svc, reason: 'Remove the Result' }, (tx) =>
      tx.deleteFrom('result').where('testId', '=', testId).execute(),
    );
    assert.deepEqual(
      (await versions(app, 'test', testId)).map((v) => [v.version, v.content.value]),
      [
        [1, null],
        [2, '0.0300'],
        [3, null],
      ],
    );
    assert.deepEqual(
      (await versions(app, 'test_report', reportId)).map((v) => [v.version, object(v.content.test).value]),
      [
        [1, '0.0300'],
        [2, null],
      ],
      'the Test Report built on the Test moves with it',
    );
  });

  it('renaming a Method or a Customer, or moving a Submission, re-versions every Test that names it', async () => {
    const { testId } = await submitTest();
    await audited(superuser, { ...svc, reason: 'Correct the Method title' }, (tx) =>
      tx
        .updateTable('method')
        .set({ title: 'NDMA by LC-MS/MS, corrected' })
        .where('id', '=', fixture.methodId)
        .execute(),
    );
    await audited(superuser, { ...svc, reason: 'Correct the Customer name' }, (tx) =>
      tx
        .updateTable('customer')
        .set({ name: 'Versions Customer Ltd (fictional)' })
        .where('id', '=', fixture.customerId)
        .execute(),
    );
    await audited(app, { ...svc, reason: 'Move the Submission to another Customer' }, async (tx) => {
      const other = await tx
        .insertInto('customer')
        .values({ name: 'Other Customer (fictional)' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx.updateTable('submission').set({ customerId: other.id }).where('id', '=', fixture.submissionId).execute();
    });
    assert.deepEqual(
      (await versions(app, 'test', testId)).map((v) => [v.version, v.content.methodTitle, v.content.customer]),
      [
        [1, 'NDMA by LC-MS/MS (fictional)', 'Versions Customer (fictional)'],
        [2, 'NDMA by LC-MS/MS, corrected', 'Versions Customer (fictional)'],
        [3, 'NDMA by LC-MS/MS, corrected', 'Versions Customer Ltd (fictional)'],
        [4, 'NDMA by LC-MS/MS, corrected', 'Other Customer (fictional)'],
      ],
    );
  });

  it('two transactions that change one Test at the same time take turns, so the versions are numbered in order', async () => {
    const { sampleId, testId } = await submitTest();
    await audited(app, { ...svc, reason: 'enterResult' }, (tx) =>
      tx
        .insertInto('result')
        .values({ labId: fixture.labId, testId, enteredBy: fixture.personId, ...result })
        .execute(),
    );
    const slow = audited(superuser, { ...svc, reason: 'Change the Result slowly' }, async (tx) => {
      await tx.updateTable('result').set({ value: '0.0310' }).where('testId', '=', testId).execute();
      await sql`select pg_sleep(0.4)`.execute(tx);
    });
    await sql`select pg_sleep(0.1)`.execute(app);
    const quick = audited(app, { ...svc, reason: 'Describe the Sample' }, (tx) =>
      tx.updateTable('sample').set({ description: 'Coated tablets' }).where('id', '=', sampleId).execute(),
    );
    await Promise.all([slow, quick]);
    assert.deepEqual(
      (await versions(app, 'test', testId)).map((v) => [v.version, v.content.value, v.content.description]),
      [
        [1, null, 'Tablets'],
        [2, '0.0300', 'Tablets'],
        [3, '0.0310', 'Tablets'],
        [4, '0.0310', 'Coated tablets'],
      ],
      'the second writer waited on the Lab chain lock the first one held, then saw its version',
    );
  });

  it('lims_app cannot write a Record Version by hand', async () => {
    const { testId } = await submitTest();
    await assert.rejects(
      audited(app, svc, (tx) =>
        tx
          .insertInto('recordVersion')
          .values({
            labId: fixture.labId,
            recordTable: 'test',
            recordId: testId,
            version: 9,
            canonicalForm: 1,
            content: Buffer.from('{}'),
          })
          .execute(),
      ),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === '42501',
    );
    await assert.rejects(
      audited(app, svc, (tx) => sql`select lims.save_record_version(${fixture.labId}, 'test', ${testId})`.execute(tx)),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === '42501',
    );
  });
});

const AUDIT_CONTEXT = `select set_config('lims.actor', 'svc:test', true), set_config('lims.role', 'system', true),
                              set_config('lims.reason', 'Walk the thin slice', true)`;

interface SliceTest {
  testId: string;
  reportId: string | null;
  signedTest: string;
  signedReport: string | null;
}

/**
 * The thin slice's chain as it wrote it, with Signatures carrying the API's own rendering of the content. Three Tests:
 * a Reported one whose content still holds, a Performed one whose Result changed after signing, and an unsigned one.
 */
async function sliceChain(client: pg.Client) {
  await client.query('begin');
  await client.query(AUDIT_CONTEXT);
  const one = async <R extends pg.QueryResultRow>(statement: string, values: unknown[] = []) =>
    (await client.query<R>(statement, values)).rows[0] ?? assert.fail(statement);
  const { lab_id: lab } = await one<{ lab_id: string }>(
    `insert into lims.lab (code, name) values ('SL', 'Slice Lab') returning lab_id`,
  );
  const { id: customer } = await one<{ id: string }>(
    `insert into lims.customer (name) values ('Slice Customer (fictional)') returning id`,
  );
  const { id: person } = await one<{ id: string }>(
    `insert into lims.person (username, display_name, password_hash) values ('slice.person', 'Slice Person', 'x') returning id`,
  );
  const { id: method } = await one<{ id: string }>(
    `insert into lims.method (code, version, title) values ('SL-MTH-0001', '1', 'Slice Method') returning id`,
  );
  const { id: submission } = await one<{ id: string }>(
    `insert into lims.submission (customer_id, submitted_by) values ($1, $2) returning id`,
    [customer, person],
  );
  const signedContent = (testId: string, sample: string, value: string, report: string | null) =>
    JSON.stringify({
      id: testId,
      customer: 'Slice Customer (fictional)',
      sample,
      description: 'Tablets',
      receivedAt: '2026-09-30T08:15:00.123Z',
      method: 'SL-MTH-0001',
      methodVersion: '1',
      methodTitle: 'Slice Method',
      gxpClass: 'GMP',
      analyte: 'NDMA',
      value,
      unit: 'ppm',
      injectionSequenceRef: 'SEQ-2026-0001',
      notebookRef: 'NB-SL-0001-001',
      performedOn: '2026-09-30',
      report,
    });
  const sign = (meaning: string, table: string, recordId: string, content: string) =>
    client.query(
      `insert into lims.signature (lab_id, person_id, meaning, record_table, record_id, content)
       values ($1, $2, $3, $4, $5, $6)`,
      [lab, person, meaning, table, recordId, Buffer.from(content)],
    );
  const tests: SliceTest[] = [];
  for (const [n, kind] of (['reported', 'changed', 'unsigned'] as const).entries()) {
    const sample = `SL-S0000${n + 1}`;
    const { id: sampleId } = await one<{ id: string }>(
      `insert into lims.sample (lab_id, submission_id, number, description, received_at)
       values ($1, $2, $3, 'Tablets', '2026-09-30T08:15:00.123456Z') returning id`,
      [lab, submission, sample],
    );
    const { id: testId } = await one<{ id: string }>(
      `insert into lims.test (lab_id, sample_id, method_id, state) values ($1, $2, $3, $4) returning id`,
      [lab, sampleId, method, kind === 'reported' ? 'Reported' : kind === 'changed' ? 'SubmittedForReview' : 'Ready'],
    );
    if (kind === 'unsigned') {
      tests.push({ testId, reportId: null, signedTest: '', signedReport: null });
      continue;
    }
    await client.query(
      `insert into lims.result (lab_id, test_id, analyte, value, unit, injection_sequence_ref, notebook_ref, performed_on, entered_by)
       values ($1, $2, 'NDMA', $3, 'ppm', 'SEQ-2026-0001', 'NB-SL-0001-001', '2026-09-30', $4)`,
      [lab, testId, kind === 'changed' ? '0.0310' : '0.0300', person],
    );
    const signedTest = signedContent(testId, sample, '0.0300', null);
    await sign('Performed', 'test', testId, signedTest);
    if (kind === 'changed') {
      tests.push({ testId, reportId: null, signedTest, signedReport: null });
      continue;
    }
    await sign('Reviewed', 'test', testId, signedTest);
    const { id: reportId } = await one<{ id: string }>(
      `insert into lims.test_report (lab_id, test_id, number) values ($1, $2, 'SL-R00001') returning id`,
      [lab, testId],
    );
    const signedReport = signedContent(testId, sample, '0.0300', 'SL-R00001');
    await sign('Released', 'test_report', reportId, signedReport);
    tests.push({ testId, reportId, signedTest, signedReport });
  }
  await client.query('commit');
  const [reported, changed, unsigned] = tests;
  return {
    reported: reported ?? assert.fail(),
    changed: changed ?? assert.fail(),
    unsigned: unsigned ?? assert.fail(),
  };
}

describe('the migration moves the thin slice’s signed content onto Record Versions', () => {
  let client: pg.Client;
  let chain: Awaited<ReturnType<typeof sliceChain>>;
  const copies: string[] = [];

  before(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lims-slice-migrations-'));
    copies.push(dir);
    await cp(migrations, dir, { recursive: true });
    for (const name of await readdir(dir)) if (name >= '0005') await rm(join(dir, name));
    await dropDatabase(SLICE);
    await migrate(server, SLICE, pathToFileURL(`${dir}/`));
    client = new pg.Client({ connectionString: databaseUrl(server, SLICE) });
    await client.connect();
    chain = await sliceChain(client);
    await migrate(server, SLICE);
  });

  after(async () => {
    await client.end();
    await Promise.all(copies.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  const versionsOf = async (table: string, recordId: string) =>
    (
      await client.query<{ version: number; canonical_form: number; content: string }>(
        `select version, canonical_form, convert_from(content, 'UTF8') as content from lims.record_version
          where record_table = $1 and record_id = $2 order by version`,
        [table, recordId],
      )
    ).rows;

  interface Bound {
    meaning: string;
    record_id: string;
    version: number;
    canonical_form: number;
    unsigned: boolean;
  }
  const bound = async (...recordIds: (string | null)[]) =>
    (
      await client.query<Bound>(
        `select s.meaning, v.record_id, v.version, v.canonical_form,
                exists (select from lims.record_version later
                         where later.lab_id = v.lab_id and later.record_table = v.record_table
                           and later.record_id = v.record_id and later.version > v.version) as unsigned
           from lims.signature s join lims.record_version v on v.lab_id = s.lab_id and v.id = s.record_version_id
          where v.record_id = any($1) order by s.signed_at`,
        [recordIds.filter((id) => id !== null)],
      )
    ).rows;

  it('a Signature whose signed content still holds binds to the form-1 version of what the record holds now, and stays signed', async () => {
    const { testId, reportId, signedTest, signedReport } = chain.reported;
    assert.deepEqual(
      (await versionsOf('test', testId)).map((v) => [v.version, v.canonical_form, v.content === signedTest]),
      [
        [1, 0, true],
        [2, 1, false],
      ],
      'the signed bytes are kept as version 1 in form 0, and the current content is version 2 in form 1',
    );
    assert.deepEqual(
      (await versionsOf('test_report', reportId ?? assert.fail())).map((v) => [
        v.version,
        v.canonical_form,
        v.content === signedReport,
      ]),
      [
        [1, 0, true],
        [2, 1, false],
      ],
    );
    assert.deepEqual(await bound(testId, reportId), [
      { meaning: 'Performed', record_id: testId, version: 2, canonical_form: 1, unsigned: false },
      { meaning: 'Reviewed', record_id: testId, version: 2, canonical_form: 1, unsigned: false },
      { meaning: 'Released', record_id: reportId, version: 2, canonical_form: 1, unsigned: false },
    ]);
  });

  it('a Signature whose signed content no longer holds binds to its own form-0 version and shows unsigned', async () => {
    const { testId } = chain.changed;
    assert.deepEqual(await bound(testId), [
      { meaning: 'Performed', record_id: testId, version: 1, canonical_form: 0, unsigned: true },
    ]);
    assert.deepEqual(
      (await versionsOf('test', testId)).map((v) => [v.version, v.canonical_form, object(JSON.parse(v.content)).value]),
      [
        [1, 0, '0.0300'],
        [2, 1, '0.0310'],
      ],
    );
  });

  it('a Test that was never signed gets version 1 in form 1, and a step after the migration writes no version', async () => {
    assert.deepEqual(
      (await versionsOf('test', chain.unsigned.testId)).map((v) => [v.version, v.canonical_form]),
      [[1, 1]],
    );
    await client.query('begin');
    await client.query(AUDIT_CONTEXT);
    await client.query(`update lims.test set state = 'Assigned' where id = $1`, [chain.unsigned.testId]);
    await client.query(`update lims.test set state = 'Reported' where id = $1`, [chain.reported.testId]);
    await client.query('commit');
    assert.deepEqual(
      (await versionsOf('test', chain.unsigned.testId)).map((v) => v.version),
      [1],
    );
    assert.deepEqual(
      (await versionsOf('test', chain.reported.testId)).map((v) => v.version),
      [1, 2],
    );
    assert.ok((await bound(chain.reported.testId)).every((b) => !b.unsigned));
  });

  it('the Signatures are locked again once they are bound', async () => {
    await client.query('begin');
    try {
      await client.query(AUDIT_CONTEXT);
      await assert.rejects(
        client.query(`update lims.signature set meaning = 'Released'`),
        (error: unknown) => error instanceof pg.DatabaseError && error.code === 'LA002',
      );
    } finally {
      await client.query('rollback');
    }
  });

  it('the Audit Trail records the move under svc:migrate and both chains still verify', async () => {
    const { rows } = await client.query<{ table_name: string; op: string; n: string }>(
      `select table_name, op, count(*) as n from lims.audit_entry where actor = 'svc:migrate' group by 1, 2 order by 1, 2`,
    );
    assert.deepEqual(rows, [
      { table_name: 'record_version', op: 'INSERT', n: '7' },
      { table_name: 'signature', op: 'UPDATE', n: '4' },
    ]);
    const { rows: chains } = await client.query<{ chain: string; broken: string | null }>(
      'select chain, lims.verify_chain(chain) as broken from lims.audit_chain order by chain',
    );
    assert.deepEqual(
      chains.map((c) => c.broken),
      chains.map(() => null),
    );
  });
});
