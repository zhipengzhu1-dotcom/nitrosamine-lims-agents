import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { sql } from 'kysely';
import pg from 'pg';
import { audited, checkoutDatabase, createDb, databaseUrl, dbServer } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

const server = dbServer();

const DATABASE = checkoutDatabase('lims_test');

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
    tx
      .insertInto('lab')
      .values({ code: 'TL', name: 'Test Lab', timeZone: 'UTC' })
      .returning('labId')
      .executeTakeFirstOrThrow(),
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

it("the Lab's chain verifies; an entry the database owner alters is the first failure, and the entries before it still verify", async () => {
  const rename = (name: string) =>
    audited(app, { actor: 'person:lena', role: 'LabManager', reason: 'Rename the Lab' }, (tx) =>
      tx.updateTable('lab').set({ name }).where('labId', '=', labId).execute(),
    );
  await rename('Test Laboratory');
  await rename('Test Laboratory, renamed');
  await rename('Test Laboratory, renamed again');
  const verify = async () =>
    (await sql<{ broken: string | null }>`select lims.verify_chain(${labId}) as broken`.execute(app)).rows[0]?.broken;
  const last = (
    await sql<{ last: string }>`select max(seq)::text as last from lims.audit_entry where chain = ${labId}`.execute(app)
  ).rows[0]?.last;
  assert.equal(last, '4');
  assert.equal(await verify(), null);

  const alterAsOwner = async (seq: number) => {
    await superuser.query('begin');
    await superuser.query('set local role lims_owner');
    await superuser.query('alter table lims.audit_entry disable trigger refuse_change');
    await superuser.query(`update lims.audit_entry set reason = 'Routine update' where chain = $1 and seq = $2`, [
      labId,
      seq,
    ]);
    await superuser.query('alter table lims.audit_entry enable trigger refuse_change');
    await superuser.query('commit');
  };
  await alterAsOwner(4);
  assert.equal(await verify(), '4', 'the altered last entry fails; entries 1 to 3 verify');
  await alterAsOwner(2);
  assert.equal(await verify(), '2', 'the earliest altered entry is the first failure; entry 1 verifies');
});

const transactionIds = (customers: string[]) =>
  app
    .selectFrom('auditEntry')
    .select(['transactionId', sql<string>`new_row->>'name'`.as('name')])
    .where('tableName', '=', 'customer')
    .where(sql<string>`new_row->>'name'`, 'in', customers)
    .execute();

it('every entry of one audited write carries one transaction ID, and the next audited write draws another', async () => {
  const ctx = { actor: 'svc:test', role: 'system', reason: 'Add Customers together' };
  await audited(app, ctx, async (tx) => {
    await tx.insertInto('customer').values({ name: 'Together One' }).execute();
    await tx.updateTable('lab').set({ name: 'Test Lab, renamed together' }).where('labId', '=', labId).execute();
    await tx.insertInto('customer').values({ name: 'Together Two' }).execute();
  });
  await audited(app, ctx, (tx) => tx.insertInto('customer').values({ name: 'Apart' }).execute());

  const ids = new Map(
    (await transactionIds(['Together One', 'Together Two', 'Apart'])).map((e) => [e.name, e.transactionId]),
  );
  const { transactionId: labEntry } = await app
    .selectFrom('auditEntry')
    .select('transactionId')
    .where('chain', '=', labId)
    .where(sql<string>`new_row->>'name'`, '=', 'Test Lab, renamed together')
    .executeTakeFirstOrThrow();
  assert.match(ids.get('Together One') ?? '', /^[0-9a-f-]{36}$/);
  assert.equal(ids.get('Together Two'), ids.get('Together One'), 'one audited write, one ID');
  assert.equal(labEntry, ids.get('Together One'), 'the same ID on the Lab chain and the company chain');
  assert.notEqual(ids.get('Apart'), ids.get('Together One'), 'another audited write, another ID');
});

it('changing the transaction ID stored on an entry breaks its chain at that entry', async () => {
  await audited(app, { actor: 'svc:test', role: 'system', reason: 'Add a Customer to regroup' }, (tx) =>
    tx.insertInto('customer').values({ name: 'Regrouped Ltd' }).execute(),
  );
  const verify = async () =>
    (await sql<{ broken: string | null }>`select lims.verify_chain('company') as broken`.execute(app)).rows[0]?.broken;
  assert.equal(await verify(), null);
  const { seq } = await app
    .selectFrom('auditEntry')
    .select('seq')
    .where('chain', '=', 'company')
    .where(sql<string>`new_row->>'name'`, '=', 'Regrouped Ltd')
    .executeTakeFirstOrThrow();

  await superuser.query('begin');
  await superuser.query('set local session_replication_role = replica');
  await superuser.query(
    `update lims.audit_entry set transaction_id = gen_random_uuid() where chain = 'company' and seq = $1`,
    [seq],
  );
  await superuser.query('commit');
  assert.equal(await verify(), seq);
});

it('a transaction that locks the company chain after a Lab chain is refused, so it cannot deadlock', async () => {
  await assert.rejects(
    audited(app, { actor: 'svc:test', role: 'system', reason: 'Write a Lab, then the company' }, async (tx) => {
      await tx.updateTable('lab').set({ name: 'Test Lab, out of order' }).where('labId', '=', labId).execute();
      await tx.insertInto('customer').values({ name: 'Out Of Order Ltd' }).execute();
    }),
    (error: unknown) =>
      refusedWith('LA004')(error) &&
      error instanceof Error &&
      error.message === `chain company is locked after chain ${labId}; declare both chains when the transaction starts`,
  );
});

it('two transactions that write the company chain and a Lab chain in opposite orders both complete', async () => {
  const waiting = async () => {
    for (let polls = 0; polls < 500; polls++) {
      const { rows } = await superuser.query<{ n: string }>(
        `select count(*) as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      );
      if (rows[0]?.n !== '0') return;
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
    }
    assert.fail('the second transaction never waited on a chain lock');
  };
  let companyFirstHolds: () => void = () => {};
  const companyLocked = new Promise<void>((resolve) => {
    companyFirstHolds = resolve;
  });
  const ctx = { actor: 'svc:test', role: 'system', reason: 'Write two chains at once' };
  const companyFirst = audited(app, ctx, async (tx) => {
    await tx.insertInto('customer').values({ name: 'Company First Ltd' }).execute();
    companyFirstHolds();
    await waiting();
    await tx.updateTable('lab').set({ name: 'Test Lab, company first' }).where('labId', '=', labId).execute();
  });
  const labFirst = companyLocked.then(() =>
    audited(app, ctx, async (tx) => {
      await sql`select lims.lock_chains('company', ${labId})`.execute(tx);
      await tx.updateTable('lab').set({ name: 'Test Lab, Lab first' }).where('labId', '=', labId).execute();
      await tx.insertInto('customer').values({ name: 'Lab First Ltd' }).execute();
    }),
  );
  await Promise.all([companyFirst, labFirst]);
  assert.equal((await transactionIds(['Company First Ltd', 'Lab First Ltd'])).length, 2);
});

it('a transaction ID left on the connection by an earlier transaction is never taken for a later one', async () => {
  const forged = '11111111-1111-4111-8111-111111111111';
  const ctx = { actor: 'svc:test', role: 'system', reason: 'Leave a transaction ID on the connection' };
  await sql`select 1`.execute(app);
  await audited(app, ctx, async (tx) => {
    await sql`select set_config('lims.transaction', ${forged}, false)`.execute(tx);
    await tx.insertInto('customer').values({ name: 'Left Behind One' }).execute();
  });
  await audited(app, ctx, (tx) => tx.insertInto('customer').values({ name: 'Left Behind Two' }).execute());
  const ids = (await transactionIds(['Left Behind One', 'Left Behind Two'])).map((e) => e.transactionId);
  assert.equal(ids.length, 2);
  assert.ok(!ids.includes(forged), 'the value set on the connection is not an ID');
  assert.notEqual(ids[0], ids[1], 'two transactions, two IDs');
});

it('a transaction that locks a Lab chain after a Lab with a higher ID is refused', async () => {
  const ctx = { actor: 'svc:test', role: 'system', reason: 'Add two more Labs' };
  const labs = [];
  for (const code of ['TA', 'TB'])
    labs.push(
      (
        await audited(app, ctx, (tx) =>
          tx
            .insertInto('lab')
            .values({ code, name: `Lab ${code}`, timeZone: 'UTC' })
            .returning('labId')
            .executeTakeFirstOrThrow(),
        )
      ).labId,
    );
  const [low, high] = labs.sort();
  assert.ok(low && high);
  await assert.rejects(
    audited(app, { ...ctx, reason: 'Rename two Labs, the higher ID first' }, async (tx) => {
      await tx.updateTable('lab').set({ name: 'Higher first' }).where('labId', '=', high).execute();
      await tx.updateTable('lab').set({ name: 'Lower second' }).where('labId', '=', low).execute();
    }),
    refusedWith('LA004'),
  );
  await audited(app, { ...ctx, reason: 'Rename two Labs, declared first' }, async (tx) => {
    await sql`select lims.lock_chains(${high}, ${low})`.execute(tx);
    await tx.updateTable('lab').set({ name: 'Higher first' }).where('labId', '=', high).execute();
    await tx.updateTable('lab').set({ name: 'Lower second' }).where('labId', '=', low).execute();
  });
});

it('a chain or a Lab that does not exist is refused, and a number is taken only inside an audited write', async () => {
  const ctx = { actor: 'svc:test', role: 'system', reason: 'Probe what does not exist' };
  const nowhere = '22222222-2222-4222-8222-222222222222';
  await assert.rejects(
    audited(app, ctx, (tx) => sql`select lims.lock_chains(${nowhere})`.execute(tx)),
    refusedWith('LA005'),
  );
  await assert.rejects(
    audited(app, ctx, (tx) => sql`select * from lims.take_number('Sample', ${nowhere})`.execute(tx)),
    refusedWith('LA005'),
  );
  await assert.rejects(sql`select * from lims.take_number('Sample', ${labId})`.execute(app), refusedWith('LA001'));
});

it("one transaction keeps one ID when it changes the session's time zone and date style between writes", async () => {
  await audited(app, { actor: 'svc:test', role: 'system', reason: 'Change display settings mid-write' }, async (tx) => {
    await tx.insertInto('customer').values({ name: 'Before The Zone Change' }).execute();
    await sql`set local timezone = 'Asia/Tokyo'`.execute(tx);
    await sql`set local datestyle = 'SQL, DMY'`.execute(tx);
    await tx.insertInto('customer').values({ name: 'After The Zone Change' }).execute();
  });
  const ids = (await transactionIds(['Before The Zone Change', 'After The Zone Change'])).map((e) => e.transactionId);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});
