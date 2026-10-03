import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { checkoutDatabase, databaseUrl, dbServer } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { SERVICE_IDENTITIES } from '../src/seed.ts';

const server = dbServer();

const AS_SERVICE = (name: string) =>
  `select set_config('lims.actor', '${name}', true), set_config('lims.role', 'system', true),
          set_config('lims.reason', 'Probe the data class', true)`;

const REAL = {
  kind: 'ConfigurationChange',
  title: 'Real data',
  summary: 'The deployment takes real data',
  sets_data_class: 'real',
  file_vault_personal_key: true,
};

/** Drops `database` if an earlier run left it, so the test starts from an empty cluster database. */
async function fresh(database: string): Promise<void> {
  const admin = new pg.Client({ connectionString: databaseUrl(server, 'postgres') });
  await admin.connect();
  await admin.query(`drop database if exists ${pg.escapeIdentifier(database)} with (force)`);
  await admin.end();
}

/** Every migration before the Release Log, copied out so `migrate` stops short of it. */
async function migrationsBefore0028(): Promise<URL> {
  const migrations = new URL('../migrations/', import.meta.url);
  const before0028 = await mkdtemp(`${tmpdir()}/lims-before-0028-`);
  for (const name of await readdir(migrations))
    if (name.endsWith('.sql') && name < '0028_') await copyFile(new URL(name, migrations), `${before0028}/${name}`);
  return pathToFileURL(`${before0028}/`);
}

/**
 * A database of its own holding only what an approval needs: one Lab, one Platform Operator with a password and a
 * session. Nothing the gate reads as a fictional record, so the class can become real. With `peopleBefore0028`, the
 * Lab and the operator are written before 0028 runs, as the hosted demo's were; the operator then holds
 * PlatformOperator only because this fixture grants it as the database owner, which no HTTP route can.
 */
async function deployment(name: string, { peopleBefore0028 = false } = {}) {
  const database = checkoutDatabase(name);
  const owner = new pg.Client({ connectionString: databaseUrl(server, database) });
  const app = new pg.Client({ connectionString: databaseUrl(server, database, 'lims_app') });
  const other = new pg.Client({ connectionString: databaseUrl(server, database) });
  const lab = randomUUID();
  const operator = { id: randomUUID(), username: 'class.operator', session: randomUUID() };
  await fresh(database);
  await migrate(server, database, peopleBefore0028 ? await migrationsBefore0028() : undefined);
  await owner.connect();
  await owner.query('begin');
  await owner.query(AS_SERVICE('svc:test'));
  await owner.query(
    `insert into lims.person (id, username, display_name, password_hash) values ($1, $2, 'Class Operator', 'not-a-real-hash')`,
    [operator.id, operator.username],
  );
  await owner.query(`insert into lims.lab (lab_id, code, name, time_zone) values ($1, 'DC', 'Data Class Lab', 'UTC')`, [
    lab,
  ]);
  await owner.query(`insert into lims.membership (lab_id, person_id, role) values ($1, $2, 'PlatformOperator')`, [
    lab,
    operator.id,
  ]);
  await owner.query(`insert into lims.session (lab_id, id, person_id, token_hash) values ($1, $2, $3, $4)`, [
    lab,
    operator.session,
    operator.id,
    Buffer.alloc(32, 9),
  ]);
  await owner.query('commit');
  if (peopleBefore0028) await migrate(server, database);
  await app.connect();
  await other.connect();

  const asOperator = `select set_config('lims.actor', 'person:${operator.username}', true),
                             set_config('lims.role', 'PlatformOperator', true),
                             set_config('lims.reason', 'Approve a Release Log entry', true)`;
  /** Runs `statements` in one transaction as the service and returns the first row of the last. */
  async function asService(...statements: [string, unknown[]?][]): Promise<Record<string, unknown> | undefined> {
    await owner.query('begin');
    await owner.query(AS_SERVICE('svc:test'));
    let last: Record<string, unknown> | undefined;
    for (const [text, values] of statements) last = (await owner.query(text, values)).rows[0];
    await owner.query('commit');
    return last;
  }
  /** Records an entry as the service, in its own transaction, and returns its id. */
  async function record(entry: Record<string, unknown>): Promise<string> {
    const columns = Object.keys(entry);
    await owner.query('begin');
    await owner.query(AS_SERVICE('svc:test'));
    const { rows } = await owner.query<{ id: string }>(
      `insert into lims.release_log_entry (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      Object.values(entry),
    );
    await owner.query('commit');
    return rows[0]?.id ?? assert.fail('the entry was recorded');
  }
  /** Records an entry declaring `name` to write `scope`, with the identity, in one transaction. */
  async function declare(name: string, scope = '{customer:INSERT}'): Promise<string> {
    const entry = randomUUID();
    await asService(
      [
        `insert into lims.release_log_entry (id, kind, title, summary) values ($1, 'ConfigurationChange', 'Identity', 'Declares an identity')`,
        [entry],
      ],
      [
        `insert into lims.service_identity (name, scope, created_by_entry_id) values ($1, $2, $3)`,
        [name, scope, entry],
      ],
    );
    return entry;
  }
  /**
   * The statements that sign `entry` Approved as the operator, from a fresh re-authentication record, as the API's
   * approval runs them: an entry setting the data class declares so before the transaction takes any chain.
   */
  const approval = (entry: string, from?: { lab: string; session: string }) => {
    const at = from ?? { lab, session: operator.session };
    return [
      asOperator,
      `select lims.declare_data_class_change() from lims.release_log_entry where id = '${entry}' and sets_data_class is not null`,
      `select lims.lock_chains('company', '${at.lab}')`,
      `do $$
       declare proof uuid;
       begin
         insert into lims.reauthentication (lab_id, session_id, person_id, meaning, authenticator)
         values ('${at.lab}', '${at.session}', '${operator.id}', 'Approved', 'Password') returning id into proof;
         perform lims.sign(proof, '${at.session}', 'release_log_entry', '${entry}',
                           (select id from lims.record_version where record_table = 'release_log_entry' and record_id = '${entry}' order by version desc limit 1),
                           (select content_hash from lims.record_version where record_table = 'release_log_entry' and record_id = '${entry}' order by version desc limit 1),
                           (select max(version) from lims.signature_statement), 'Approved', 'test');
       end $$`,
    ];
  };
  /** Runs `statements` in one transaction on the owner's connection; answers the refusal, or null once committed. */
  async function attempt(statements: string[]): Promise<pg.DatabaseError | null> {
    await owner.query('begin');
    try {
      for (const statement of statements) await owner.query(statement);
      await owner.query('commit');
      return null;
    } catch (error) {
      await owner.query('rollback');
      if (error instanceof pg.DatabaseError) return error;
      throw error;
    }
  }
  const approve = (entry: string) => attempt(approval(entry));
  async function approved(entry: string): Promise<void> {
    const error = await approve(entry);
    assert.equal(error, null, error?.message);
  }
  /** Writes a Customer as `name` on the app role, rolled back; rejects with the database's refusal. */
  async function writeAs(name: string): Promise<void> {
    await app.query('begin');
    try {
      await app.query(AS_SERVICE(name));
      await app.query(`insert into lims.customer (name) values ('Probe Customer')`);
    } finally {
      await app.query('rollback');
    }
  }
  /** Writes an Access Event as svc:sign-in on the app role, as a refused sign-in does, and commits it. */
  async function signIn(): Promise<void> {
    await app.query('begin');
    try {
      await app.query(AS_SERVICE('svc:sign-in'));
      await app.query(
        `insert into lims.access_event (kind, failure_reason, subject_id, source_address, roles) values ('SignInFailed', 'WrongPassword', $1, '192.0.2.1', '{}')`,
        [operator.id],
      );
      await app.query('commit');
    } catch (error) {
      await app.query('rollback');
      throw error;
    }
  }
  /** Waits until the backend `pid` waits on a lock, read from a connection outside any transaction. */
  async function untilWaiting(pid: number): Promise<void> {
    const watcher = new pg.Client({ connectionString: databaseUrl(server, database) });
    await watcher.connect();
    try {
      for (let tries = 0; tries < 500; tries++) {
        const { rows } = await watcher.query<{ waiting: boolean }>(
          `select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1`,
          [pid],
        );
        if (rows[0]?.waiting) return;
      }
      assert.fail(`backend ${pid} never waited on a lock`);
    } finally {
      await watcher.end();
    }
  }
  const openExceptions = async () =>
    (await owner.query<{ open: string[] }>('select lims.open_demo_exceptions()::text[] as open')).rows[0]?.open;
  const dataClass = async () =>
    (await owner.query<{ data_class: string }>('select data_class from lims.deployment')).rows[0]?.data_class;
  async function end() {
    await owner.end();
    await app.end();
    await other.end();
  }
  return {
    database,
    owner,
    app,
    other,
    lab,
    operator,
    record,
    declare,
    asService,
    approval,
    attempt,
    approve,
    approved,
    writeAs,
    signIn,
    untilWaiting,
    openExceptions,
    dataClass,
    end,
  };
}

type Deployment = Awaited<ReturnType<typeof deployment>>;

/** Runs `body` against a deployment database of its own, so the test passes alone and in any order. */
async function inDeployment(
  name: string,
  body: (d: Deployment) => Promise<void>,
  options?: { peopleBefore0028?: boolean },
): Promise<void> {
  const d = await deployment(name, options);
  try {
    await body(d);
  } finally {
    await d.end();
  }
}

const isRefusal = (code: string, message?: string) => (error: unknown) =>
  error instanceof pg.DatabaseError && error.code === code && (message === undefined || error.message === message);

describe('the real data class is set by an approved Release Log entry once every demo exception has lapsed', () => {
  it('a demo exception recorded again after it lapsed is open, and an entry closes only what it lapses', () =>
    inDeployment('lims_dc_reopen', async (d) => {
      const recorded = await d.record({
        kind: 'ConfigurationChange',
        title: 'Two roles',
        summary: 'One person holds two roles',
        records_exceptions: '{TwoRole}',
      });
      await d.approved(recorded);
      assert.deepEqual(await d.openExceptions(), ['TwoRole']);
      const lapsed = await d.record({
        kind: 'ConfigurationChange',
        title: 'Second operator',
        summary: 'A second person holds PlatformOperator',
        lapses_exceptions: '{TwoRole}',
      });
      // Recorded before the lapse, approved after it: approval order, not recording order, decides.
      const again = await d.record({
        kind: 'ConfigurationChange',
        title: 'Two roles again',
        summary: 'The second operator left',
        records_exceptions: '{TwoRole,Anchoring}',
      });
      await d.approved(lapsed);
      assert.deepEqual(await d.openExceptions(), []);
      await d.approved(again);
      assert.deepEqual(await d.openExceptions(), ['TwoRole', 'Anchoring']);
    }));

  it('the data class is refused real while a demo exception stands, naming it', () =>
    inDeployment('lims_dc_standing', async (d) => {
      await d.approved(
        await d.record({
          kind: 'ConfigurationChange',
          title: 'Two roles',
          summary: 'One person holds two roles',
          records_exceptions: '{TwoRole,Anchoring}',
        }),
      );
      const error = await d.approve(await d.record(REAL));
      assert.deepEqual(
        [error?.code, error?.message],
        ['LA011', 'these demo exceptions still stand: TwoRole, Anchoring'],
      );
      assert.equal(await d.dataClass(), 'fictional');
    }));

  it('the data class is refused real while the entry setting it records no personal FileVault key', () =>
    inDeployment('lims_dc_no_key', async (d) => {
      const error = await d.approve(await d.record({ ...REAL, file_vault_personal_key: false }));
      assert.deepEqual([error?.code, error?.message], ['LA011', 'the host records no personal FileVault key']);
      assert.equal(await d.dataClass(), 'fictional');
    }));

  it('the data class is refused real while another person holds an account or a Membership created under fictional', () =>
    inDeployment('lims_dc_other_account', async (d) => {
      const other = randomUUID();
      await d.asService(
        [
          `insert into lims.person (id, username, display_name, password_hash) values ($1, 'fictional.other', 'Fictional Other', 'not-a-real-hash')`,
          [other],
        ],
        [`insert into lims.membership (lab_id, person_id, role) values ($1, $2, 'QA')`, [d.lab, other]],
      );
      const error = await d.approve(await d.record(REAL));
      assert.deepEqual(
        [error?.code, error?.message],
        [
          'LA011',
          'the database holds accounts created under fictional for someone other than the signer: membership, person',
        ],
      );
      assert.equal(await d.dataClass(), 'fictional');
    }));

  it('the data class is refused real while a Room created under fictional is held', () =>
    inDeployment('lims_dc_room', async (d) => {
      await d.asService([`insert into lims.room (lab_id, name) values ($1, 'Fictional Room')`, [d.lab]]);
      const error = await d.approve(await d.record(REAL));
      assert.deepEqual(
        [error?.code, error?.message],
        ['LA011', 'the database holds records created under fictional: room'],
      );
      assert.equal(await d.dataClass(), 'fictional');
    }));

  it('the data class is refused real while the signer holds Admin together with Platform Operator', () =>
    inDeployment('lims_dc_two_roles', async (d) => {
      await d.asService([
        `insert into lims.membership (lab_id, person_id, role) values ($1, $2, 'Admin')`,
        [d.lab, d.operator.id],
      ]);
      const error = await d.approve(await d.record(REAL));
      assert.deepEqual(
        [error?.code, error?.message],
        ['LA011', 'a person holds Admin together with another role: class.operator'],
      );
      assert.equal(await d.dataClass(), 'fictional');
    }));

  it('with no fictional record and no open exception, approving the entry sets the class real, citing the entry', () =>
    inDeployment('lims_dc_real', async (d) => {
      // The signer's own person and Membership were created under fictional; they carry into the real deployment.
      const real = await d.record(REAL);
      await d.approved(real);
      const { rows } = await d.owner.query<{ data_class: string; set_by_entry_id: string }>(
        'select data_class, set_by_entry_id from lims.deployment',
      );
      assert.deepEqual(rows, [{ data_class: 'real', set_by_entry_id: real }]);
      const later = await d.asService([
        `insert into lims.customer (name) values ('Real Customer') returning data_class`,
      ]);
      assert.equal(later?.data_class, 'real', 'a record created from now on carries the real class');
    }));

  it('a real deployment is refused the fictional data class, and stays real', () =>
    inDeployment('lims_dc_no_revert', async (d) => {
      await d.approved(await d.record(REAL));
      const back = await d.record({
        kind: 'ConfigurationChange',
        title: 'Fictional again',
        summary: 'The deployment takes fictional data again',
        sets_data_class: 'fictional',
        file_vault_personal_key: true,
      });
      const error = await d.approve(back);
      assert.deepEqual(
        [error?.code, error?.message],
        ['LA011', 'a deployment holding real data does not return to the fictional data class'],
      );
      assert.equal(await d.dataClass(), 'real');
    }));
});

describe('a service identity writes only inside the scope its approved Release Log entry declares', () => {
  it('once an entry declaring a service identity is approved, an identity no approved entry declares is refused on the app role', () =>
    inDeployment('lims_dc_undeclared', async (d) => {
      await d.approved(await d.declare('svc:declared'));
      await assert.rejects(
        d.writeAs('svc:nobody'),
        isRefusal(
          'LA011',
          'the service identity svc:nobody is not declared to insert customer, or its Release Log entry is not approved',
        ),
      );
    }));

  it('on the real data class, an identity no approved entry declares is refused even with no identity entry approved', () =>
    inDeployment('lims_dc_real_scope', async (d) => {
      await d.approved(await d.record(REAL));
      await assert.rejects(d.writeAs('svc:nobody'), isRefusal('LA011'));
    }));

  it('a service identity whose declaring entry is not approved is refused on the app role, and writes once it is', () =>
    inDeployment('lims_dc_pending', async (d) => {
      await d.approved(await d.declare('svc:declared'));
      const entry = await d.declare('svc:pending');
      await assert.rejects(d.writeAs('svc:pending'), isRefusal('LA011'));
      await d.approved(entry);
      await d.writeAs('svc:pending');
    }));

  it('retiring a service identity versions the retiring entry alone, so the declaring entry keeps its signed Record Version', () =>
    inDeployment('lims_dc_retire', async (d) => {
      const latestVersion = async (entry: string) =>
        (
          await d.owner.query<{ id: string; content: string }>(
            `select id, convert_from(content, 'UTF8') as content from lims.record_version
              where record_table = 'release_log_entry' and record_id = $1 order by version desc limit 1`,
            [entry],
          )
        ).rows[0];
      const declaring = await d.declare('svc:retiring');
      await d.approved(declaring);
      const signed = (
        await d.owner.query<{ id: string }>(
          `select g.record_version_id as id from lims.signature g join lims.record_version v on v.id = g.record_version_id
            where v.record_table = 'release_log_entry' and v.record_id = $1 and g.meaning = 'Approved'`,
          [declaring],
        )
      ).rows[0]?.id;
      const retiring = randomUUID();
      await d.asService(
        [
          `insert into lims.release_log_entry (id, kind, title, summary) values ($1, 'ConfigurationChange', 'Retire', 'Retires svc:retiring')`,
          [retiring],
        ],
        [`update lims.service_identity set retired_by_entry_id = $1 where name = 'svc:retiring'`, [retiring]],
      );
      assert.equal((await latestVersion(declaring))?.id, signed);
      const content = JSON.parse((await latestVersion(retiring))?.content ?? '{}');
      assert.deepEqual([content.serviceIdentities, content.retiresServiceIdentities], [[], ['svc:retiring']]);
    }));
});

describe('no captured table escapes the real-data gate', () => {
  // Each test only reads, or rolls back what it writes, so they share one database.
  let d: Deployment;
  before(async () => {
    d = await deployment('lims_dc_coverage');
  });
  after(() => d.end());

  it('every captured table but the deployment carries the data class it was created under', async () => {
    const { rows } = await d.owner.query<{ table: string }>(
      `select c.relname as table from pg_trigger g join pg_class c on c.oid = g.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'lims' and g.tgname = 'capture' and c.relname <> 'deployment'
          and not exists (select from pg_attribute a where a.attrelid = c.oid and a.attname = 'data_class' and not a.attisdropped)
        order by 1`,
    );
    assert.deepEqual(rows, []);
  });

  it('the gate leaves out only the Lab, the accounts it reads by person, and the sign-in, signing and change-control tables', async () => {
    const { rows } = await d.owner.query<{ exempt: string[] }>('select lims.gate_exempt_tables() as exempt');
    assert.deepEqual(rows[0]?.exempt, [
      'access_event',
      'credential_link',
      'deployment',
      'identity_verification',
      'lab',
      'membership',
      'person',
      'reauthentication',
      'record_version',
      'release_log_entry',
      'service_identity',
      'signature',
      'signature_statement',
      'signing_role',
    ]);
  });

  it('a captured table added later is read by the gate without being named', async () => {
    await d.owner.query('begin');
    try {
      await d.owner.query(AS_SERVICE('svc:test'));
      // As a migration creates it: owned by the schema's owner.
      await d.owner.query('set local role lims_owner');
      await d.owner.query(
        `create table lims.later_record (id uuid primary key default gen_random_uuid(),
                                         data_class lims.data_class not null default lims.current_data_class())`,
      );
      await d.owner.query(
        'create trigger capture after insert or update or delete on lims.later_record for each row execute function lims.capture()',
      );
      await d.owner.query('insert into lims.later_record default values');
      const { rows } = await d.owner.query<{ held: string[] }>('select lims.fictional_records() as held');
      assert.deepEqual(rows[0]?.held, ['later_record']);
    } finally {
      await d.owner.query('rollback');
    }
  });
});

describe('a captured write and a change of the data class take turns', () => {
  it('a change of the class waits for an uncommitted captured insert, then sees the record it created', () =>
    inDeployment('lims_dc_in_flight', async (d) => {
      const real = await d.record(REAL);
      await d.other.query('begin');
      await d.other.query(AS_SERVICE('svc:test'));
      await d.other.query(`insert into lims.customer (name) values ('In Flight')`);
      const [as, declare, chains] = d.approval(real);
      await d.owner.query('begin');
      await d.owner.query(`set local lock_timeout = '300ms'`);
      await d.owner.query(as ?? '');
      await d.owner.query(declare ?? '');
      await assert.rejects(
        d.owner.query(chains ?? ''),
        isRefusal('55P03'),
        'the approval waits on the insert in flight for the deployment row',
      );
      await d.owner.query('rollback');
      await d.other.query('commit');
      const error = await d.approve(real);
      assert.deepEqual(
        [error?.code, error?.message],
        ['LA011', 'the database holds records created under fictional: customer'],
      );
    }));

  it('an approval setting the data class and a captured insert on the company chain both finish, the insert after it', () =>
    inDeployment('lims_dc_deadlock', async (d) => {
      const entry = await d.record({
        kind: 'ConfigurationChange',
        title: 'Class',
        summary: 'Sets the class it already has',
        sets_data_class: 'fictional',
        file_vault_personal_key: false,
      });
      const [as, declare, chains, sign] = d.approval(entry);
      await d.owner.query('begin');
      for (const statement of [as, declare, chains]) await d.owner.query(statement ?? '');
      const pid = (await d.other.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid ?? 0;
      await d.other.query('begin');
      await d.other.query(AS_SERVICE('svc:test'));
      const insert = d.other
        .query(`insert into lims.customer (name) values ('Meanwhile')`)
        .then(() => d.other.query('commit'));
      await d.untilWaiting(pid);
      const signed = d.owner.query(sign ?? '').then(() => d.owner.query('commit'));
      const outcomes = await Promise.allSettled([signed, insert]);
      assert.deepEqual(
        outcomes.map((o) =>
          o.status === 'fulfilled' ? o.status : o.reason instanceof pg.DatabaseError ? o.reason.code : String(o.reason),
        ),
        ['fulfilled', 'fulfilled'],
      );
    }));

  it('a change of the data class not declared before the transaction takes its first chain is refused', () =>
    inDeployment('lims_dc_undeclared_change', async (d) => {
      const entry = await d.record({
        kind: 'ConfigurationChange',
        title: 'Class',
        summary: 'Sets the class it already has',
        sets_data_class: 'fictional',
        file_vault_personal_key: false,
      });
      const [as, declare, chains, sign] = d.approval(entry);
      const unsaid = await d.attempt([as ?? '', chains ?? '', sign ?? '']);
      assert.deepEqual(
        [unsaid?.code, unsaid?.message],
        ['LA004', 'the data class changes only in a transaction that declared it before taking any Audit Trail chain'],
      );
      const late = await d.attempt([as ?? '', chains ?? '', declare ?? '']);
      assert.deepEqual(
        [late?.code, late?.message],
        ['LA004', 'a change of the data class is declared before the transaction takes any Audit Trail chain'],
      );
    }));

  it('a second approval of one entry, from another Lab, waits for the first, then finds the entry approved', () =>
    inDeployment('lims_dc_twice', async (d) => {
      const entry = await d.record({ kind: 'ConfigurationChange', title: 'Once', summary: 'Approved once' });
      // From another Lab the two approvals write different chains, so only the entry's own lock makes them take turns.
      const second = { lab: randomUUID(), session: randomUUID() };
      await d.asService(
        [`insert into lims.lab (lab_id, code, name, time_zone) values ($1, 'DD', 'Second Lab', 'UTC')`, [second.lab]],
        [
          `insert into lims.membership (lab_id, person_id, role) values ($1, $2, 'PlatformOperator')`,
          [second.lab, d.operator.id],
        ],
        [
          `insert into lims.session (lab_id, id, person_id, token_hash) values ($1, $2, $3, $4)`,
          [second.lab, second.session, d.operator.id, Buffer.alloc(32, 10)],
        ],
      );
      // The second takes no company chain up front, so the first holding it does not hold the second back.
      const [as, , , sign] = d.approval(entry, second);
      await d.other.query('begin');
      for (const statement of d.approval(entry)) await d.other.query(statement);
      await d.owner.query('begin');
      await d.owner.query(`set local lock_timeout = '300ms'`);
      await d.owner.query(as ?? '');
      await assert.rejects(d.owner.query(sign ?? ''), isRefusal('55P03'), 'the second approval waits on the first');
      await d.owner.query('rollback');
      await d.other.query('commit');
      const error = await d.attempt([as ?? '', sign ?? '']);
      assert.deepEqual([error?.code, error?.message], ['LA011', 'the Release Log entry is already approved']);
    }));
});

describe('only the seed records a re-authentication with the Seed authenticator, and only on the fictional data class', () => {
  /** Inserts a Seed re-authentication for the operator on `client`, rolled back; answers the refusal, or null. */
  async function seedProof(d: Deployment, client: pg.Client): Promise<pg.DatabaseError | null> {
    await client.query('begin');
    try {
      await client.query(AS_SERVICE('svc:test'));
      await client.query(
        `insert into lims.reauthentication (lab_id, session_id, person_id, meaning, authenticator)
         values ($1, $2, $3, 'Approved', 'Seed')`,
        [d.lab, d.operator.session, d.operator.id],
      );
      return null;
    } catch (error) {
      if (error instanceof pg.DatabaseError) return error;
      throw error;
    } finally {
      await client.query('rollback');
    }
  }
  const refusal = 'only the seed, on the fictional data class, records a re-authentication no one typed a password for';

  it('the app role is refused the Seed authenticator once a person was written by an earlier transaction', () =>
    inDeployment('lims_dc_seed_app', async (d) => {
      const error = await seedProof(d, d.app);
      assert.deepEqual([error?.code, error?.message], ['LA010', refusal]);
      assert.equal(await seedProof(d, d.owner), null, 'the database owner may, on the fictional data class');
    }));

  it('the Seed authenticator is refused on the real data class, even to the database owner', () =>
    inDeployment('lims_dc_seed_real', async (d) => {
      await d.approved(await d.record(REAL));
      const error = await seedProof(d, d.owner);
      assert.deepEqual([error?.code, error?.message], ['LA010', refusal]);
    }));
});

describe('a database that held people before the Release Log keeps signing in until its service identities entry is approved', () => {
  const people = { peopleBefore0028: true };
  const migrationEntry = async (d: Deployment) =>
    (await d.owner.query<{ id: string }>('select id from lims.release_log_entry')).rows[0]?.id ??
    assert.fail('the migration recorded an entry');

  it('the migration records one unapproved entry declaring the service identities the seed declares, as svc:migrate', () =>
    inDeployment(
      'lims_dc_migrated_entry',
      async (d) => {
        const { rows } = await d.owner.query<{ id: string; approved: boolean; actor: string; identities: unknown }>(
          `select e.id, lims.release_log_entry_approved(e.id) as approved,
                  (select actor from lims.audit_entry where table_name = 'release_log_entry' and (new_row ->> 'id')::uuid = e.id) as actor,
                  (select json_agg(json_build_object('name', s.name, 'scope', s.scope) order by s.name)
                     from lims.service_identity s where s.created_by_entry_id = e.id) as identities
             from lims.release_log_entry e`,
        );
        assert.equal(rows.length, 1, 'one entry');
        assert.equal(rows[0]?.approved, false);
        assert.equal(rows[0]?.actor, 'svc:migrate');
        assert.deepEqual(
          rows[0]?.identities,
          SERVICE_IDENTITIES.map((s) => ({ name: s.name, scope: [...s.scope] })).toSorted((a, b) =>
            a.name.localeCompare(b.name),
          ),
        );
      },
      people,
    ));

  it('with no approved entry, svc:sign-in writes an Access Event on the app role', () =>
    inDeployment('lims_dc_migrated_open', (d) => d.signIn(), people));

  it('approving an entry that declares no service identity leaves svc:sign-in writing', () =>
    inDeployment(
      'lims_dc_migrated_other',
      async (d) => {
        await d.approved(await d.record({ kind: 'ConfigurationChange', title: 'Other', summary: 'Declares nothing' }));
        await d.signIn();
      },
      people,
    ));

  it('once the fixture-granted Platform Operator approves the identities entry, svc:sign-in writes in its scope and an undeclared identity is refused', () =>
    inDeployment(
      'lims_dc_migrated_bound',
      async (d) => {
        await d.approved(await migrationEntry(d));
        await d.signIn();
        await assert.rejects(d.writeAs('svc:nobody'), isRefusal('LA011'));
      },
      people,
    ));
});
