import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { checkoutDatabase, databaseUrl, dbConfig } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

const { server } = dbConfig();
const DATABASE = checkoutDatabase('lims_counters_test');
const BEFORE_COUNTERS = '0005_counters_and_transaction_ids.sql';

const client = new pg.Client({ connectionString: databaseUrl(server, DATABASE) });
const id = {
  customer: randomUUID(),
  person: randomUUID(),
  lab: randomUUID(),
  first: randomUUID(),
  second: randomUUID(),
};
let folder = '';

async function begin(): Promise<void> {
  await client.query('begin');
  await client.query(`select set_config('lims.actor', 'svc:test', true), set_config('lims.role', 'system', true),
                             set_config('lims.reason', 'Write records made before counters', true)`);
}

async function inTransaction(statements: [string, unknown[]?][]): Promise<void> {
  await begin();
  for (const [statement, values] of statements) await client.query(statement, values);
  await client.query('commit');
}

before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'lims-before-counters-'));
  const repo = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(repo)).filter((f) => f.endsWith('.sql') && f < BEFORE_COUNTERS))
    await cp(new URL(name, repo), join(folder, name));
  const admin = new pg.Client({ connectionString: databaseUrl(server, 'postgres') });
  await admin.connect();
  await admin.query(`drop database if exists ${DATABASE} with (force)`);
  await admin.end();
  await migrate(server, DATABASE, pathToFileURL(`${folder}/`));
  await client.connect();

  await inTransaction([
    ['insert into lims.customer (id, name) values ($1, $2)', [id.customer, 'Legacy Customer (fictional)']],
    [
      `insert into lims.person (id, username, display_name, customer_id, password_hash)
       values ($1, 'legacy.customer', 'Legacy Customer', $2, 'not-a-real-hash')`,
      [id.person, id.customer],
    ],
    [
      'insert into lims.submission (id, customer_id, submitted_by) values ($1, $2, $3)',
      [id.first, id.customer, id.person],
    ],
    ["insert into lims.lab (lab_id, code, name) values ($1, 'LG', 'Legacy Lab')", [id.lab]],
    [
      `insert into lims.sample (lab_id, submission_id, number, description)
       values ($1, $2, 'LG-S00001', 'Legacy tablets')`,
      [id.lab, id.first],
    ],
  ]);
  await inTransaction([
    [
      'insert into lims.submission (id, customer_id, submitted_by) values ($1, $2, $3)',
      [id.second, id.customer, id.person],
    ],
    [
      `insert into lims.sample (lab_id, submission_id, number, description)
       values ($1, $2, 'LG-S00002', 'Legacy capsules')`,
      [id.lab, id.second],
    ],
  ]);
  await migrate(server, DATABASE);
});

after(async () => {
  await client.end();
  await rm(folder, { recursive: true, force: true });
});

it('Submissions made before counters are numbered in the order they were made, and the counter carries on', async () => {
  const { rows } = await client.query<{ id: string; number: string }>(
    'select id, number from lims.submission order by number',
  );
  const { rows: clock } = await client.query<{ year: string }>(
    `select to_char(now() at time zone 'America/New_York', 'YYYY') as year`,
  );
  const year = clock[0]?.year;
  assert.deepEqual(rows, [
    { id: id.first, number: `SUB-${year}-000001` },
    { id: id.second, number: `SUB-${year}-000002` },
  ]);

  await begin();
  const next = await client.query<{ seq: number }>(`select seq from lims.take_number('Submission', $1)`, [id.lab]);
  await client.query('rollback');
  assert.deepEqual(next.rows, [{ seq: 3 }]);
});

it('Samples made before counters keep their numbers, and the Lab keeps US Eastern time', async () => {
  const samples = await client.query<{ number: string }>('select number from lims.sample order by number');
  assert.deepEqual(
    samples.rows.map((r) => r.number),
    ['LG-S00001', 'LG-S00002'],
  );
  const lab = await client.query<{ time_zone: string }>('select time_zone from lims.lab where lab_id = $1', [id.lab]);
  assert.deepEqual(lab.rows, [{ time_zone: 'America/New_York' }]);
});

it('the chains verify across entries written before and after transaction IDs', async () => {
  const { rows } = await client.query<{ company: string | null; lab: string | null; legacy: string; numbered: string }>(
    `select lims.verify_chain('company') as company, lims.verify_chain($1) as lab,
            count(*) filter (where transaction_id is null) as legacy,
            count(*) filter (where transaction_id is not null and table_name = 'submission') as numbered
       from lims.audit_entry`,
    [id.lab],
  );
  assert.deepEqual(rows, [{ company: null, lab: null, legacy: '7', numbered: '2' }]);
});

it("a number takes its Lab's local date, so Labs 25 hours apart number into different dates", async () => {
  const [east, west] = [randomUUID(), randomUUID()];
  await inTransaction([
    [
      `insert into lims.lab (lab_id, code, name, time_zone) values ($1, 'KI', 'East Lab', 'Pacific/Kiritimati')`,
      [east],
    ],
  ]);
  await inTransaction([
    [`insert into lims.lab (lab_id, code, name, time_zone) values ($1, 'PG', 'West Lab', 'Pacific/Pago_Pago')`, [west]],
  ]);
  await begin();
  await client.query('select lims.lock_chains($1, $2)', [east, west]);
  const { rows } = await client.query<{ east: string; west: string; eastNow: string; westNow: string }>(
    `select e.local_date as east, w.local_date as west,
            to_char(now() at time zone 'Pacific/Kiritimati', 'YYYY-MM-DD') as "eastNow",
            to_char(now() at time zone 'Pacific/Pago_Pago', 'YYYY-MM-DD') as "westNow"
       from lims.take_number('Sample', $1) e, lims.take_number('Sample', $2) w`,
    [east, west],
  );
  await client.query('rollback');
  const [taken] = rows;
  assert.ok(taken, 'two numbers were taken');
  assert.deepEqual([taken.east, taken.west], [taken.eastNow, taken.westNow]);
  assert.ok(taken.east > taken.west, `${taken.east} is a later date than ${taken.west}`);
});
