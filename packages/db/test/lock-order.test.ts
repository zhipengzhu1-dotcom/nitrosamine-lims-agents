import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';
import { checkoutDatabase, databaseUrl, dbServer } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

const server = dbServer();
const DATABASE = checkoutDatabase('lims_lock_order_test');
const url = databaseUrl(server, DATABASE);

const labId = randomUUID();
const LIMITS = `interval '15 minutes', interval '12 hours'`;
/** A race that has not settled by then is stuck behind a lock, so the test fails instead of hanging the suite. */
const RACE = { timeout: 30_000 };

interface Session {
  personId: string;
  id: string;
  username: string;
}

/** The actor, role and reason the Audit Trail captures; `actor` binds to $1. */
const AUDIT_CONTEXT = `select set_config('lims.actor', $1, true), set_config('lims.role', 'system', true),
                              set_config('lims.reason', 'Race a Lock against a Lockout', true)`;
const SERVICE = ['svc:test'];

/** `locking` presses a Lock on a session, `lockingOut` lands a Lockout on its person, and `watch` sees who waits. */
let locking: pg.Client;
let lockingOut: pg.Client;
let watch: pg.Client;

before(async () => {
  const admin = new pg.Client({ connectionString: databaseUrl(server, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${pg.escapeIdentifier(DATABASE)} with (force)`);
  } finally {
    await admin.end();
  }
  await migrate(server, DATABASE);
  const setup = new pg.Client({ connectionString: url });
  await setup.connect();
  try {
    await setup.query('begin');
    await setup.query(AUDIT_CONTEXT, SERVICE);
    await setup.query(
      `insert into lims.lab (lab_id, code, name, time_zone) values ($1, 'LO', 'Lock Order Lab', 'UTC')`,
      [labId],
    );
    await setup.query('commit');
  } finally {
    await setup.end();
  }
});

beforeEach(async () => {
  locking = new pg.Client({ connectionString: url });
  lockingOut = new pg.Client({ connectionString: url });
  watch = new pg.Client({ connectionString: url });
  await Promise.all([locking.connect(), lockingOut.connect(), watch.connect()]);
});

/** Closing the connections rolls back whatever a failed race left open, so the company chain is free for the next. */
afterEach(() => Promise.all([locking.end(), lockingOut.end(), watch.end()]));

/** Opens a live session for a new Analyst, as sign-in leaves it. */
async function openSession(username: string): Promise<Session> {
  const session = { personId: randomUUID(), id: randomUUID(), username };
  await locking.query('begin');
  await locking.query(AUDIT_CONTEXT, SERVICE);
  await locking.query(
    `insert into lims.person (id, username, display_name, password_hash) values ($1, $2, 'Lock Order Person', 'not-a-real-hash')`,
    [session.personId, username],
  );
  await locking.query(`insert into lims.membership (lab_id, person_id, role) values ($1, $2, 'Analyst')`, [
    labId,
    session.personId,
  ]);
  await locking.query(`insert into lims.session (lab_id, id, person_id, token_hash) values ($1, $2, $3, $4)`, [
    labId,
    session.id,
    session.personId,
    randomBytes(32),
  ]);
  await locking.query('commit');
  return session;
}

/** Holds the company chain for the rest of `client`'s transaction, as the Lock and Lockout functions take it. */
async function holdCompanyChain(client: pg.Client): Promise<void> {
  await client.query(`select lims.lock_chains('company')`);
}

/** Resolves once `count` backends of this database wait on a lock; fails after about 10 s. */
async function untilWaitingOnLocks(count: number): Promise<void> {
  for (let polls = 0; polls < 200; polls++) {
    const { rows } = await watch.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if ((rows[0]?.waiting ?? 0) >= count) return;
    await watch.query('select pg_sleep(0.05)');
  }
  assert.fail(`${count} backends never waited on a lock`);
}

/** Locks `session` on `locking`, which the transaction's actor, the session's person, may do. */
async function pressLock(session: Session): Promise<boolean | null> {
  await locking.query(`select set_config('lims.actor', $1, true)`, [`person:${session.username}`]);
  const { rows } = await locking.query<{ changed: boolean | null }>(
    `select lims.lock_session($1, $2, ${LIMITS}, '192.0.2.1') as changed`,
    [labId, session.id],
  );
  const [row] = rows;
  return row ? row.changed : assert.fail('lock_session answers one row');
}

/**
 * Lands the lock on the person and records its Lockout under the app role, with no person write before it. The API's
 * Lockout counts the failure first, and that write's Audit Trail capture already holds the company chain; this bare
 * update is the writer that only lock_once's own chain keeps in order.
 */
async function lockOut(session: Session): Promise<void> {
  await lockingOut.query('set local role lims_app');
  await lockingOut.query(`update lims.person set locked_at = clock_timestamp() where id = $1`, [session.personId]);
  await lockingOut.query(
    `insert into lims.access_event (kind, subject_id, source_address, roles) values ('Lockout', $1, '192.0.2.2', '{Analyst}')`,
    [session.personId],
  );
}

/** The person's Lock and Lockout Access Events in the order of their instants, compared at the database's precision. */
async function eventsOf(session: Session): Promise<string[]> {
  const { rows } = await watch.query<{ kind: string }>(
    `select kind from lims.access_event where subject_id = $1 and kind in ('Lock', 'Lockout') order by at`,
    [session.personId],
  );
  return rows.map((event) => event.kind);
}

describe('a Lock and a Lockout on the same person land in the order they took the company chain', () => {
  it(
    'a Lockout that meets the company chain held by a Lock waits for it before it stamps, so it lands after the Lock',
    RACE,
    async () => {
      const session = await openSession('lock.order.first');

      await locking.query('begin');
      await locking.query(AUDIT_CONTEXT, SERVICE);
      await holdCompanyChain(locking);
      await lockingOut.query('begin');
      await lockingOut.query(AUDIT_CONTEXT, SERVICE);
      const lockout = lockOut(session);
      await untilWaitingOnLocks(1);
      const locked = await pressLock(session);
      await locking.query('commit');
      await lockout;
      await lockingOut.query('commit');

      assert.equal(locked, true);
      assert.deepEqual(await eventsOf(session), ['Lock', 'Lockout']);
    },
  );

  // The Lock's half of the order: set_session_lock takes the chain before it reads the session (0025).
  it(
    'a Lock that meets a Lockout not yet committed waits for it, then answers null and writes no Lock',
    RACE,
    async () => {
      const session = await openSession('lock.order.second');

      await lockingOut.query('begin');
      await lockingOut.query(AUDIT_CONTEXT, SERVICE);
      await holdCompanyChain(lockingOut);
      await locking.query('begin');
      await locking.query(AUDIT_CONTEXT, SERVICE);
      const lock = pressLock(session);
      await untilWaitingOnLocks(1);
      await lockOut(session);
      await lockingOut.query('commit');
      const locked = await lock;
      await locking.query('commit');

      assert.equal(locked, null, 'the session is not live once the Lockout landed');
      assert.deepEqual(await eventsOf(session), ['Lockout']);
    },
  );
});
