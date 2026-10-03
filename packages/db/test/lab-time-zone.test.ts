import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { checkoutDatabase, databaseUrl, dbServer } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

const server = dbServer();
const DATABASE = checkoutDatabase('lims_lab_time_zone_test');
const CONTEXT = `select set_config('lims.actor', 'svc:test', true), set_config('lims.role', 'system', true),
                       set_config('lims.reason', 'Write records across a change of the Lab time zone', true),
                       lims.set_this_transaction('lims.numbering', 'on')`;
const id = {
  lab: randomUUID(),
  customer: randomUUID(),
  person: randomUUID(),
  method: randomUUID(),
  submission: randomUUID(),
  receivedInNewYork: randomUUID(),
  receivedInTokyo: randomUUID(),
  unreceived: randomUUID(),
  test: randomUUID(),
  session: randomUUID(),
  reauthentication: randomUUID(),
  signature: randomUUID(),
};
const client = new pg.Client({ connectionString: databaseUrl(server, DATABASE) });
const copies: string[] = [];

async function inTransaction(...statements: [string, unknown[]?][]): Promise<void> {
  await client.query('begin');
  try {
    await client.query(CONTEXT);
    for (const [text, values] of statements) await client.query(text, values);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw new Error('the fixture transaction was refused', { cause: error });
  }
}

const setZone = (zone: string): [string, unknown[]] => [
  'update lims.lab set time_zone = $2 where lab_id = $1',
  [id.lab, zone],
];
const sample = (sampleId: string, number: string, received: boolean): [string, unknown[]] => [
  `insert into lims.sample (lab_id, id, submission_id, number, description, received_at)
   values ($1, $2, $3, $4, 'Tablets (fictional)', case when $5 then clock_timestamp() end)`,
  [id.lab, sampleId, id.submission, number, received],
];

before(async () => {
  const admin = new pg.Client({ connectionString: databaseUrl(server, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${pg.escapeIdentifier(DATABASE)} with (force)`);
  } finally {
    await admin.end();
  }
  const dir = await mkdtemp(join(tmpdir(), 'lims-lab-time-zone-'));
  copies.push(dir);
  await cp(new URL('../migrations/', import.meta.url), dir, { recursive: true });
  const names = await readdir(dir);
  const stamping =
    names.find((name) => name.endsWith('_lab_time_zone.sql')) ?? assert.fail('the Lab time zone migration');
  for (const name of names) if (name >= stamping) await rm(join(dir, name));
  await migrate(server, DATABASE, pathToFileURL(`${dir}/`));
  await client.connect();

  await inTransaction(
    ['insert into lims.customer (id, name) values ($1, $2)', [id.customer, 'Zone Customer (fictional)']],
    [
      `insert into lims.person (id, username, display_name, password_hash)
       values ($1, 'zone.analyst', 'Zone Analyst', 'not-a-real-hash')`,
      [id.person],
    ],
    [
      `insert into lims.method (id, code, version, title) values ($1, 'TZ-MTH-0001', '1', 'NDMA (fictional)')`,
      [id.method],
    ],
    [
      `insert into lims.submission (id, customer_id, submitted_by, number) values ($1, $2, $3, 'SUB-2026-000001')`,
      [id.submission, id.customer, id.person],
    ],
    [
      `insert into lims.lab (lab_id, code, name, time_zone) values ($1, 'TZ', 'Zone Lab (fictional)', 'America/New_York')`,
      [id.lab],
    ],
    sample(id.receivedInNewYork, 'TZ-S-2026-000001', true),
    sample(id.unreceived, 'TZ-S-2026-000003', false),
    [
      'insert into lims.test (lab_id, id, sample_id, method_id) values ($1, $2, $3, $4)',
      [id.lab, id.test, id.receivedInNewYork, id.method],
    ],
    [
      `insert into lims.session (lab_id, id, person_id, token_hash) values ($1, $2, $3, '\\x01'::bytea)`,
      [id.lab, id.session, id.person],
    ],
  );
  await inTransaction(
    [
      `insert into lims.reauthentication (lab_id, id, session_id, person_id, meaning, authenticator)
       values ($1, $2, $3, $4, 'Performed', 'Password')`,
      [id.lab, id.reauthentication, id.session, id.person],
    ],
    ['select lims.set_this_transaction($1, $2)', ['lims.signing', id.reauthentication]],
    [
      `insert into lims.signature (lab_id, id, person_id, role, meaning, record_version_id, content_hash, canonical_form,
                                   statement_version, statement_hash, authenticator, session_id, app_release,
                                   reauthentication_id)
       select v.lab_id, $2, $3, 'Analyst', 'Performed', v.id, v.content_hash, v.canonical_form, s.version,
              s.statement_hash, 'Password', $4, 'zone-test', $5
         from lims.record_version v, lims.signature_statement s
        where v.lab_id = $1 and v.record_id = $6 and s.version = 1
        order by v.version desc limit 1`,
      [id.lab, id.signature, id.person, id.session, id.reauthentication, id.test],
    ],
  );
  await inTransaction(setZone('Asia/Tokyo'));
  await inTransaction(sample(id.receivedInTokyo, 'TZ-S-2026-000002', true));
  await inTransaction(setZone('Europe/Zurich'));
  await migrate(server, DATABASE);
});

after(async () => {
  await client.end();
  for (const dir of copies) await rm(dir, { recursive: true, force: true });
});

describe('the migration that stamps the Lab time zone', () => {
  it('keeps each Signature and Received written before it with the zone its Lab was in when it was written', async () => {
    const { rows: signatures } = await client.query<{ zone: string }>(
      'select signed_time_zone as zone from lims.signature where id = $1',
      [id.signature],
    );
    const { rows: samples } = await client.query<{ id: string; zone: string | null }>(
      'select id, received_time_zone as zone from lims.sample where lab_id = $1 order by number',
      [id.lab],
    );
    assert.deepEqual(signatures, [{ zone: 'America/New_York' }]);
    assert.deepEqual(samples, [
      { id: id.receivedInNewYork, zone: 'America/New_York' },
      { id: id.receivedInTokyo, zone: 'Asia/Tokyo' },
      { id: id.unreceived, zone: null },
    ]);
  });

  it('records each stamp on the Lab chain as a change by the migration, with its reason', async () => {
    const { rows } = await client.query<{ table: string; actor: string; reason: string; zone: string }>(
      `select table_name as table, actor, reason,
              coalesce(new_row ->> 'signed_time_zone', new_row ->> 'received_time_zone') as zone
         from lims.audit_entry
        where chain = $1 and op = 'UPDATE' and table_name in ('signature', 'sample') and actor = 'svc:migrate'
        order by seq`,
      [id.lab],
    );
    assert.deepEqual(
      rows.map(({ table, zone }) => [table, zone]),
      [
        ['signature', 'America/New_York'],
        ['sample', 'America/New_York'],
        ['sample', 'Asia/Tokyo'],
      ],
    );
    assert.ok(
      rows.every(
        (r) => r.reason === 'Keep each Signature and Received with the Lab time zone in force when it was written',
      ),
    );
  });

  it("reads the zone in force at an instant from the Lab's chain: before, between and after its changes", async () => {
    const { rows } = await client.query<{ zone: string }>(
      `select lims.lab_time_zone_at($1::uuid, at) as zone
         from (select e.at - interval '1 microsecond' as at, e.seq from lims.audit_entry e
                where e.chain = $1::text and e.table_name = 'lab'
               union all
               select max(e.at), null from lims.audit_entry e where e.chain = $1::text and e.table_name = 'lab') instants
        order by seq nulls last`,
      [id.lab],
    );
    assert.deepEqual(
      rows.map((r) => r.zone),
      ['America/New_York', 'America/New_York', 'Asia/Tokyo', 'Europe/Zurich'],
      'before the insert, before the Tokyo change, before the Zurich change, and at the last change',
    );
  });
});

describe('the migration that checks each kept time zone', () => {
  it('holds its checks over every Signature and Sample written before it, received or not', async () => {
    const { rows } = await client.query<{ name: string; validated: boolean }>(
      'select conname as name, convalidated as validated from pg_constraint where conname = any($1) order by conname',
      [
        [
          'sample_received_time_zone_check',
          'sample_received_time_zone_received_at_check',
          'signature_signed_time_zone_check',
        ],
      ],
    );
    assert.deepEqual(rows, [
      { name: 'sample_received_time_zone_check', validated: true },
      { name: 'sample_received_time_zone_received_at_check', validated: true },
      { name: 'signature_signed_time_zone_check', validated: true },
    ]);
  });
});
