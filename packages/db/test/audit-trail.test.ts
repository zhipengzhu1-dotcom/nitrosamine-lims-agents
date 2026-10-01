import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { sql } from 'kysely';
import pg from 'pg';
import { audited, createDb, databaseUrl, dbConfig } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

const { server } = dbConfig();

const DATABASE = 'lims_test';
const LAB_TABLES = ['membership', 'training_record', 'sample', 'test', 'result', 'test_report', 'signature', 'session'];

const app = createDb(databaseUrl(server, DATABASE, 'lims_app'));
const superuser = new pg.Client({ connectionString: databaseUrl(server, DATABASE) });
let labId: string;

before(async () => {
  const admin = new pg.Client({ connectionString: databaseUrl(server, 'postgres') });
  await admin.connect();
  await admin.query(`drop database if exists ${DATABASE} with (force)`);
  await admin.end();
  await migrate(server, DATABASE);
  await superuser.connect();
  ({ labId } = await audited(app, { actor: 'svc:test', role: 'system', reason: 'Set up the test Lab' }, (tx) =>
    tx.insertInto('lab').values({ code: 'TL', name: 'Test Lab' }).returning('labId').executeTakeFirstOrThrow(),
  ));
});

after(async () => {
  await app.destroy();
  await superuser.end();
});

function refusedWith(code: string) {
  return (error: unknown) => error instanceof Error && 'code' in error && error.code === code;
}

it('an audited write records who made it, in which role, why, and the old and new row', async () => {
  const ctx = { actor: 'person:lena', role: 'LabManager', reason: 'Correct the Customer name' };
  const customer = await audited(app, ctx, async (tx) => {
    const { id } = await tx
      .insertInto('customer')
      .values({ name: 'Acme Labz' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await tx.updateTable('customer').set({ name: 'Acme Labs' }).where('id', '=', id).execute();
    return id;
  });

  const entry = await app
    .selectFrom('auditEntry')
    .selectAll()
    .select([sql<string>`old_row->>'name'`.as('oldName'), sql<string>`new_row->>'name'`.as('newName')])
    .where('tableName', '=', 'customer')
    .where('op', '=', 'UPDATE')
    .where(sql`new_row->>'id'`, '=', customer)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    { actor: entry.actor, role: entry.role, reason: entry.reason, chain: entry.chain },
    { ...ctx, chain: 'company' },
  );
  assert.deepEqual([entry.oldName, entry.newName], ['Acme Labz', 'Acme Labs']);
});

it('an Audit Trail row snapshot keeps the stored column names and leaves out the password hash', async () => {
  const { id } = await audited(app, { actor: 'svc:test', role: 'system', reason: 'Add a person' }, (tx) =>
    tx
      .insertInto('person')
      .values({ username: 'snap.shot', displayName: 'Snap Shot', passwordHash: 'not-a-real-hash' })
      .returning('id')
      .executeTakeFirstOrThrow(),
  );
  const { newRow: row } = await app
    .selectFrom('auditEntry')
    .select('newRow')
    .where('tableName', '=', 'person')
    .where(sql`new_row->>'id'`, '=', id)
    .executeTakeFirstOrThrow();
  assert.ok(row && typeof row === 'object' && !Array.isArray(row), 'the snapshot is a row object');
  assert.deepEqual(Object.keys(row).sort(), [
    'customer_id',
    'display_name',
    'failed_logins',
    'id',
    'locked_at',
    'username',
  ]);
});

it('a write without a reason is refused and leaves nothing behind', async () => {
  await assert.rejects(
    audited(app, { actor: 'person:lena', role: 'LabManager', reason: '' }, (tx) =>
      tx.insertInto('customer').values({ name: 'No Reason Ltd' }).execute(),
    ),
    refusedWith('LA001'),
  );
  await assert.rejects(app.insertInto('customer').values({ name: 'No Context Ltd' }).execute(), refusedWith('LA001'));
  const left = await app
    .selectFrom('customer')
    .select('id')
    .where('name', 'in', ['No Reason Ltd', 'No Context Ltd'])
    .execute();
  assert.deepEqual(left, []);
});

it('audit entries cannot be updated or deleted, by the app or by the superuser', async () => {
  for (const statement of [
    'update lims.audit_entry set reason = $1',
    'delete from lims.audit_entry where reason <> $1',
  ]) {
    await assert.rejects(superuser.query(statement, ['rewritten']), refusedWith('LA002'));
  }
  await assert.rejects(app.updateTable('auditEntry').set({ reason: 'rewritten' }).execute(), refusedWith('42501'));
  await assert.rejects(app.deleteFrom('auditEntry').execute(), refusedWith('42501'));
});

it("the Lab's chain verifies, and an entry tampered with as superuser is found at its seq", async () => {
  await audited(app, { actor: 'person:lena', role: 'LabManager', reason: 'Rename the Lab' }, (tx) =>
    tx.updateTable('lab').set({ name: 'Test Laboratory' }).where('labId', '=', labId).execute(),
  );
  const verify = async () =>
    (await sql<{ broken: string | null }>`select lims.verify_chain(${labId}) as broken`.execute(app)).rows[0]?.broken;
  assert.equal(await verify(), null);

  await superuser.query('begin');
  await superuser.query('set local session_replication_role = replica');
  await superuser.query(`update lims.audit_entry set reason = 'Routine update' where chain = $1 and seq = 2`, [labId]);
  await superuser.query('commit');
  assert.equal(await verify(), '2');
});

it('a lab-owned row without a lab_id is refused', async () => {
  for (const table of LAB_TABLES) {
    await assert.rejects(
      superuser.query(`insert into lims.${table} default values`),
      (error: { code?: string; column?: string }) => error.code === '23502' && error.column === 'lab_id',
      table,
    );
  }
});
