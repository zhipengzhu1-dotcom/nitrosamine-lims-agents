import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { type Kysely, sql } from 'kysely';
import pg from 'pg';
import { audited, checkoutDatabase, createDb, type DB, databaseUrl, dbConfig } from '../src/db.ts';
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

async function versions(db: Kysely<DB>, recordTable: 'test' | 'test_report', recordId: string) {
  const rows = await db
    .selectFrom('recordVersion')
    .select([
      'version',
      'canonicalForm',
      sql<string>`encode(content_hash, 'hex')`.as('hash'),
      sql<string>`convert_from(content, 'UTF8')`.as('content'),
    ])
    .where('recordTable', '=', recordTable)
    .where('recordId', '=', recordId)
    .orderBy('version')
    .execute();
  return rows.map((row) => ({
    version: row.version,
    canonicalForm: row.canonicalForm,
    hash: row.hash,
    content: JSON.parse(row.content),
  }));
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
      (await versions(app, 'test_report', reportId)).map((v) => [v.version, v.content.test.value]),
      [
        [1, '0.0300'],
        [2, null],
      ],
      'the Test Report built on the Test moves with it',
    );
  });

  it('renaming a Method or a Customer re-versions every Test that names it', async () => {
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
    assert.deepEqual(
      (await versions(app, 'test', testId)).map((v) => [v.version, v.content.methodTitle, v.content.customer]),
      [
        [1, 'NDMA by LC-MS/MS (fictional)', 'Versions Customer (fictional)'],
        [2, 'NDMA by LC-MS/MS, corrected', 'Versions Customer (fictional)'],
        [3, 'NDMA by LC-MS/MS, corrected', 'Versions Customer Ltd (fictional)'],
      ],
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

async function sliceChain(client: pg.Client) {
  const content = '{"id":"slice","value":"0.0300"}';
  const reportContent = '{"id":"slice","value":"0.0300","report":"SL-R00001"}';
  await client.query('begin');
  await client.query(AUDIT_CONTEXT);
  const {
    rows: [lab],
  } = await client.query<{ lab_id: string }>(
    `insert into lims.lab (code, name) values ('SL', 'Slice Lab') returning lab_id`,
  );
  const {
    rows: [customer],
  } = await client.query<{ id: string }>(
    `insert into lims.customer (name) values ('Slice Customer (fictional)') returning id`,
  );
  const {
    rows: [person],
  } = await client.query<{ id: string }>(
    `insert into lims.person (username, display_name, password_hash) values ('slice.person', 'Slice Person', 'x') returning id`,
  );
  const {
    rows: [method],
  } = await client.query<{ id: string }>(
    `insert into lims.method (code, version, title) values ('SL-MTH-0001', '1', 'Slice Method') returning id`,
  );
  const {
    rows: [submission],
  } = await client.query<{ id: string }>(
    `insert into lims.submission (customer_id, submitted_by) values ($1, $2) returning id`,
    [customer?.id, person?.id],
  );
  const {
    rows: [sample],
  } = await client.query<{ id: string }>(
    `insert into lims.sample (lab_id, submission_id, number, description) values ($1, $2, 'SL-S00001', 'Tablets') returning id`,
    [lab?.lab_id, submission?.id],
  );
  const {
    rows: [test],
  } = await client.query<{ id: string }>(
    `insert into lims.test (lab_id, sample_id, method_id, state) values ($1, $2, $3, 'Reported') returning id`,
    [lab?.lab_id, sample?.id, method?.id],
  );
  const {
    rows: [report],
  } = await client.query<{ id: string }>(
    `insert into lims.test_report (lab_id, test_id, number) values ($1, $2, 'SL-R00001') returning id`,
    [lab?.lab_id, test?.id],
  );
  const signed: { meaning: string; record_table: string; record_id: string | undefined; content: string }[] = [
    { meaning: 'Performed', record_table: 'test', record_id: test?.id, content },
    { meaning: 'Reviewed', record_table: 'test', record_id: test?.id, content },
    { meaning: 'Released', record_table: 'test_report', record_id: report?.id, content: reportContent },
  ];
  for (const s of signed)
    await client.query(
      `insert into lims.signature (lab_id, person_id, meaning, record_table, record_id, content) values ($1, $2, $3, $4, $5, $6)`,
      [lab?.lab_id, person?.id, s.meaning, s.record_table, s.record_id, Buffer.from(s.content)],
    );
  await client.query('commit');
  return { testId: test?.id, reportId: report?.id, content, reportContent };
}

describe('the migration moves the thin slice’s signed content onto Record Versions', () => {
  let client: pg.Client;
  let chain: Awaited<ReturnType<typeof sliceChain>>;
  const copies: string[] = [];

  before(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lims-slice-migrations-'));
    copies.push(dir);
    await cp(migrations, dir, { recursive: true });
    for (const name of await readdir(dir)) if (name >= '0004') await rm(join(dir, name));
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

  it('each distinct signed content becomes a Record Version in canonical form 0, bound to its Signatures', async () => {
    const { rows } = await client.query<{
      meaning: string;
      record_table: string;
      record_id: string;
      version: number;
      canonical_form: number;
      content: string;
    }>(
      `select s.meaning, v.record_table, v.record_id, v.version, v.canonical_form, convert_from(v.content, 'UTF8') as content
         from lims.signature s join lims.record_version v on v.lab_id = s.lab_id and v.id = s.record_version_id
        order by s.signed_at`,
    );
    assert.deepEqual(rows, [
      {
        meaning: 'Performed',
        record_table: 'test',
        record_id: chain.testId,
        version: 1,
        canonical_form: 0,
        content: chain.content,
      },
      {
        meaning: 'Reviewed',
        record_table: 'test',
        record_id: chain.testId,
        version: 1,
        canonical_form: 0,
        content: chain.content,
      },
      {
        meaning: 'Released',
        record_table: 'test_report',
        record_id: chain.reportId,
        version: 1,
        canonical_form: 0,
        content: chain.reportContent,
      },
    ]);
    const { rows: count } = await client.query<{ n: string }>('select count(*) as n from lims.record_version');
    assert.equal(count[0]?.n, '2', 'one version per distinct signed content');
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
      { table_name: 'record_version', op: 'INSERT', n: '2' },
      { table_name: 'signature', op: 'UPDATE', n: '3' },
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
