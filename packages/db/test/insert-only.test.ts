// Test-plan A1: insert-only holds, and the grant audit.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { runAudited } from '../src/audited.ts';
import { sign } from '../src/doors.ts';
import { seedFixture, type Fixture } from '../src/testing/fixture.ts';
import { testDatabase, type TestDb } from '../src/testing/harness.ts';
import { DOOR_ONLY_TABLES, INSERT_ONLY_TABLES } from '../src/tables.generated.ts';
import { expectSqlState, installWidget, newValue, newWidget, reauth } from './support.ts';

let db: TestDb;
let fx: Fixture;

/** Each table with a column an UPDATE can name without tripping an identity or generated-column rule first. */
const TABLES = { audit_entry: 'ledger_id', signature: 'ledger_id', record_version: 'ledger_id', recorded_value_version: 'ledger_id', auth_event: 'kind' } as const;

beforeAll(async () => {
  db = await testDatabase();
  fx = await seedFixture(db.app);
  await installWidget(db);
  await runAudited(db.app, fx.ctx(fx.ann, 'Analyst'), { kind: 'lab', labId: fx.labA }, async (tx) => {
    const w = await newWidget(tx, fx.labA, 'W');
    await newValue(tx, fx.labA, w, 'prep.weight', true, '100.12');
    await tx.db.insertInto('auth_event').values({ person_id: fx.ann.id, kind: 'login_ok', counts_toward_lockout: false }).execute();
    return { commit: null };
  });
  await runAudited(db.app, fx.ctx(fx.bob, 'Reviewer'), { kind: 'lab', labId: fx.labA }, async (tx) => {
    const v = await tx.db.selectFrom('record_version').select(['id', 'content_hash']).executeTakeFirstOrThrow();
    await reauth(tx, fx.bob.id);
    await sign(tx, { signer: fx.bob.id, target: { versionId: v.id as never, hash: v.content_hash.toString('hex') as never }, meaning: 'Verified', authenticator: 'totp', group: randomUUID() });
    return { commit: null };
  });
});
afterAll(() => db.close());

describe('insert-only tables', () => {
  for (const [t, col] of Object.entries(TABLES)) {
    it(`${t}: UPDATE, DELETE and TRUNCATE are refused for lims_app by privilege`, async () => {
      await expectSqlState(sql`update lims.${sql.raw(t)} set ${sql.raw(col)} = ${sql.raw(col)}`.execute(db.app), '42501');
      await expectSqlState(sql`delete from lims.${sql.raw(t)}`.execute(db.app), '42501');
      await expectSqlState(sql`truncate lims.${sql.raw(t)}`.execute(db.app), '42501');
    });

    it(`${t}: the blocking trigger refuses UPDATE, DELETE and TRUNCATE even for a superuser`, async () => {
      const count = await db.superuser.query(`select count(*)::int as n from lims.${t}`);
      expect(count.rows[0].n, `${t} needs a row for the row trigger to fire`).toBeGreaterThan(0);
      await expectSqlState(db.superuser.query(`update lims.${t} set ${col} = ${col}`), 'LA008');
      await expectSqlState(db.superuser.query(`delete from lims.${t}`), 'LA008');
      // Postgres refuses to truncate a table other tables reference before any trigger runs (0A000).
      await expectSqlState(db.superuser.query(`truncate lims.${t}`), ['record_version', 'signature'].includes(t) ? '0A000' : 'LA008');
    });
  }
});

describe('the grant audit', () => {
  it('lims_app holds DELETE or TRUNCATE nowhere, UPDATE on no insert-only table, and INSERT on no door-only table', async () => {
    const grants = await db.superuser.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where grantee = 'lims_app' and table_schema = 'lims'`);
    const bad = grants.rows.filter(
      (g) => g.privilege_type === 'DELETE' || g.privilege_type === 'TRUNCATE'
        || (g.privilege_type === 'UPDATE' && (INSERT_ONLY_TABLES as readonly string[]).includes(g.table_name))
        || (g.privilege_type === 'INSERT' && (DOOR_ONLY_TABLES as readonly string[]).includes(g.table_name)),
    );
    expect(bad).toEqual([]);
    expect(INSERT_ONLY_TABLES).toContain('audit_entry');
    expect(DOOR_ONLY_TABLES).toEqual(expect.arrayContaining(['audit_entry', 'record_version', 'record_version_cite', 'signature', 'record_lock', 'audit_chain_head']));
  });

  it('every table in lims is captured unless it is on the short exempt list', async () => {
    const rows = await db.superuser.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'lims' and c.relkind = 'r'
          and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'capture')
        order by 1`);
    expect(rows.rows.map((r) => r.relname)).toEqual([
      'audit_chain_head', 'audit_entry', 'commit_outcome', 'counter', 'ledger', 'migration', 'record_kind', 'release', 'service_write', 'session_activity',
    ]);
  });

  it('no function in lims is executable by PUBLIC, and lims_app can execute exactly the doors and readers', async () => {
    const fns = await db.superuser.query<{ name: string; by_public: boolean; by_app: boolean }>(
      `select p.oid::regprocedure::text as name,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where a.grantee = 0 and a.privilege_type = 'EXECUTE') as by_public,
              has_function_privilege('lims_app', p.oid, 'execute') as by_app
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'lims' order by 1`);
    expect(fns.rows.filter((f) => f.by_public).map((f) => f.name)).toEqual([]);
    expect(fns.rows.filter((f) => f.by_app).map((f) => f.name)).toEqual([
      'lims.company_ledger()',
      'lims.create_lab(uuid,text,text)',
      'lims.lock_chains()',
      'lims.lock_released(uuid)',
      'lims.next_number(text,text,integer)',
      'lims.seal(uuid,bytea,text,jsonb)',
      'lims.session_state(lims.session,timestamp with time zone,timestamp with time zone)',
      'lims.sign(uuid,uuid,bytea,text,text,uuid,uuid,bytea)',
      'lims.verify_chain(uuid)',
      'lims.version_standing_failures(uuid)',
      'lims.version_stands(uuid)',
    ]);
  });
});
