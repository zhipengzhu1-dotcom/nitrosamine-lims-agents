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

/**
 * A migrated database holding only what an approval needs: one Lab, one Platform Operator with a password and a
 * session. Nothing the gate reads as a fictional record, so the class can become real.
 */
async function deployment(name: string) {
  const database = checkoutDatabase(name);
  const owner = new pg.Client({ connectionString: databaseUrl(server, database) });
  const app = new pg.Client({ connectionString: databaseUrl(server, database, 'lims_app') });
  const lab = randomUUID();
  const operator = { id: randomUUID(), username: 'class.operator', session: randomUUID() };
  const admin = new pg.Client({ connectionString: databaseUrl(server, 'postgres') });
  await admin.connect();
  await admin.query(`drop database if exists ${pg.escapeIdentifier(database)} with (force)`);
  await admin.end();
  await migrate(server, database);
  await owner.connect();
  await app.connect();
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

  const asOperator = `select set_config('lims.actor', 'person:${operator.username}', true),
                             set_config('lims.role', 'PlatformOperator', true),
                             set_config('lims.reason', 'Approve a Release Log entry', true)`;
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
  /** Runs `statements` in one transaction as the service and returns the first row of the last. */
  async function asService(...statements: [string, unknown[]?][]): Promise<Record<string, unknown> | undefined> {
    await owner.query('begin');
    await owner.query(AS_SERVICE('svc:test'));
    let last: Record<string, unknown> | undefined;
    for (const [text, values] of statements) last = (await owner.query(text, values)).rows[0];
    await owner.query('commit');
    return last;
  }
  /** The statements that sign `entry` Approved as the operator, from a fresh re-authentication record. */
  const approval = (entry: string, from?: { lab: string; session: string }) => {
    const at = from ?? { lab, session: operator.session };
    return [
      asOperator,
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
  async function approve(entry: string): Promise<pg.DatabaseError | null> {
    await owner.query('begin');
    try {
      for (const statement of approval(entry)) await owner.query(statement);
      await owner.query('commit');
      return null;
    } catch (error) {
      await owner.query('rollback');
      if (error instanceof pg.DatabaseError) return error;
      throw error;
    }
  }
  async function approved(entry: string): Promise<void> {
    const error = await approve(entry);
    assert.equal(error, null, error?.message);
  }
  const openExceptions = async () =>
    (await owner.query<{ open: string[] }>('select lims.open_demo_exceptions()::text[] as open')).rows[0]?.open;
  const dataClass = async () =>
    (await owner.query<{ data_class: string }>('select data_class from lims.deployment')).rows[0]?.data_class;
  async function end() {
    await owner.end();
    await app.end();
  }
  return {
    database,
    owner,
    app,
    lab,
    operator,
    record,
    asService,
    approval,
    approve,
    approved,
    openExceptions,
    dataClass,
    end,
  };
}

type Deployment = Awaited<ReturnType<typeof deployment>>;

describe('the real data class is set by an approved Release Log entry once every demo exception has lapsed', () => {
  let d: Deployment;
  before(async () => {
    d = await deployment('lims_data_class_test');
  });
  after(() => d.end());

  it('a demo exception recorded again after it lapsed is open, and an entry closes only what it lapses', async () => {
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
  });

  it('the data class is refused real while a demo exception stands, naming it', async () => {
    const real = await d.record({
      kind: 'ConfigurationChange',
      title: 'Real data',
      summary: 'The deployment takes real data',
      sets_data_class: 'real',
      file_vault_personal_key: true,
    });
    const error = await d.approve(real);
    assert.deepEqual([error?.code, error?.message], ['LA011', 'these demo exceptions still stand: TwoRole, Anchoring']);
    assert.equal(await d.dataClass(), 'fictional');
  });

  it('the data class is refused real while the entry setting it records no personal FileVault key', async () => {
    const closing = await d.record({
      kind: 'ConfigurationChange',
      title: 'Every exception lapses',
      summary: 'The demo exceptions lapse',
      lapses_exceptions: '{TwoRole,Anchoring}',
    });
    await d.approved(closing);
    const noKey = await d.record({
      kind: 'ConfigurationChange',
      title: 'Real data without the key',
      summary: 'The deployment takes real data',
      sets_data_class: 'real',
      file_vault_personal_key: false,
    });
    const error = await d.approve(noKey);
    assert.deepEqual([error?.code, error?.message], ['LA011', 'the host records no personal FileVault key']);
    assert.equal(await d.dataClass(), 'fictional');
  });

  it('with no fictional record and no open exception, approving the entry sets the class real, citing the entry', async () => {
    const real = await d.record({
      kind: 'ConfigurationChange',
      title: 'Real data',
      summary: 'The deployment takes real data',
      sets_data_class: 'real',
      file_vault_personal_key: true,
    });
    await d.approved(real);
    const { rows } = await d.owner.query<{ data_class: string; set_by_entry_id: string }>(
      'select data_class, set_by_entry_id from lims.deployment',
    );
    assert.deepEqual(rows, [{ data_class: 'real', set_by_entry_id: real }]);
    await d.owner.query('begin');
    await d.owner.query(AS_SERVICE('svc:test'));
    const { rows: later } = await d.owner.query<{ data_class: string }>(
      `insert into lims.customer (name) values ('Real Customer') returning data_class`,
    );
    await d.owner.query('commit');
    assert.equal(later[0]?.data_class, 'real', 'a record created from now on carries the real class');
  });

  it('once an entry is approved, a service identity no approved entry declares is refused on the app role', async () => {
    await d.app.query('begin');
    try {
      await d.app.query(AS_SERVICE('svc:nobody'));
      await assert.rejects(
        d.app.query(`insert into lims.customer (name) values ('Undeclared')`),
        (error: unknown) =>
          error instanceof pg.DatabaseError &&
          error.code === 'LA011' &&
          error.message ===
            'the service identity svc:nobody is not declared to insert customer, or its Release Log entry is not approved',
      );
    } finally {
      await d.app.query('rollback');
    }
  });

  /** Records an entry declaring `name` to insert Customers, with the identity, in one transaction. */
  const declare = async (name: string): Promise<string> => {
    const entry = randomUUID();
    await d.asService(
      [
        `insert into lims.release_log_entry (id, kind, title, summary) values ($1, 'ConfigurationChange', 'Identity', 'Declares an identity')`,
        [entry],
      ],
      [
        `insert into lims.service_identity (name, scope, created_by_entry_id) values ($1, '{customer:INSERT}', $2)`,
        [name, entry],
      ],
    );
    return entry;
  };
  const latestVersion = async (entry: string) =>
    (
      await d.owner.query<{ id: string; content: string }>(
        `select id, convert_from(content, 'UTF8') as content from lims.record_version
          where record_table = 'release_log_entry' and record_id = $1 order by version desc limit 1`,
        [entry],
      )
    ).rows[0];

  it('a service identity whose declaring entry is not approved is refused on the app role, and writes once it is', async () => {
    const entry = await declare('svc:pending');
    const write = async () => {
      await d.app.query('begin');
      try {
        await d.app.query(AS_SERVICE('svc:pending'));
        await d.app.query(`insert into lims.customer (name) values ('Pending Customer')`);
      } finally {
        await d.app.query('rollback');
      }
    };
    await assert.rejects(write(), (error: unknown) => error instanceof pg.DatabaseError && error.code === 'LA011');
    await d.approved(entry);
    await write();
  });

  it('retiring a service identity versions the retiring entry alone, so the declaring entry keeps its signed Record Version', async () => {
    const declaring = await declare('svc:retiring');
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
  });
});

describe('a captured write and a change of the data class take turns', () => {
  let d: Deployment;
  let other: pg.Client;
  before(async () => {
    d = await deployment('lims_data_class_race_test');
    other = new pg.Client({ connectionString: databaseUrl(server, d.database) });
    await other.connect();
  });
  after(async () => {
    await other.end();
    await d.end();
  });

  it('a change of the class waits for an uncommitted captured insert, then sees the record it created', async () => {
    const real = await d.record({
      kind: 'ConfigurationChange',
      title: 'Real data',
      summary: 'The deployment takes real data',
      sets_data_class: 'real',
      file_vault_personal_key: true,
    });
    await other.query('begin');
    await other.query(AS_SERVICE('svc:test'));
    await other.query(`insert into lims.customer (name) values ('In Flight')`);
    await d.owner.query('begin');
    await d.owner.query(`set local lock_timeout = '300ms'`);
    await d.owner.query(AS_SERVICE('svc:test'));
    await d.owner.query(`select lims.set_this_transaction('lims.release_log', '${real}')`);
    await assert.rejects(
      d.owner.query(`update lims.deployment set data_class = 'real', set_by_entry_id = '${real}'`),
      (error: unknown) => error instanceof pg.DatabaseError && error.code === '55P03',
      'the class change waits on the insert in flight',
    );
    await d.owner.query('rollback');
    await other.query('commit');
    const error = await d.approve(real);
    assert.deepEqual(
      [error?.code, error?.message],
      ['LA011', 'the database holds records created under fictional: customer'],
    );
  });

  it('a second approval of one entry, from another Lab, waits for the first, then finds the entry approved', async () => {
    const entry = await d.record({ kind: 'ConfigurationChange', title: 'Once', summary: 'Approved once' });
    // From another Lab the two approvals write different chains, so only the entry's own lock makes them take turns.
    const second = { lab: randomUUID(), session: randomUUID() };
    await d.owner.query('begin');
    await d.owner.query(AS_SERVICE('svc:test'));
    await d.owner.query(`insert into lims.lab (lab_id, code, name, time_zone) values ($1, 'DD', 'Second Lab', 'UTC')`, [
      second.lab,
    ]);
    await d.owner.query(`insert into lims.membership (lab_id, person_id, role) values ($1, $2, 'PlatformOperator')`, [
      second.lab,
      d.operator.id,
    ]);
    await d.owner.query(`insert into lims.session (lab_id, id, person_id, token_hash) values ($1, $2, $3, $4)`, [
      second.lab,
      second.session,
      d.operator.id,
      Buffer.alloc(32, 10),
    ]);
    await d.owner.query('commit');
    const [as, , sign] = d.approval(entry, second);
    await other.query('begin');
    for (const statement of d.approval(entry)) await other.query(statement);
    await d.owner.query('begin');
    await d.owner.query(`set local lock_timeout = '300ms'`);
    await d.owner.query(as ?? '');
    await assert.rejects(
      d.owner.query(sign ?? ''),
      (error: unknown) => error instanceof pg.DatabaseError && error.code === '55P03',
      'the second approval waits on the first',
    );
    await d.owner.query('rollback');
    await other.query('commit');
    await d.owner.query('begin');
    await d.owner.query(as ?? '');
    await assert.rejects(
      d.owner.query(sign ?? ''),
      (error: unknown) =>
        error instanceof pg.DatabaseError &&
        error.code === 'LA011' &&
        error.message === 'the Release Log entry is already approved',
    );
    await d.owner.query('rollback');
  });
});

describe('a database that held people before the Release Log keeps signing in until an entry is approved', () => {
  const database = checkoutDatabase('lims_data_class_migrated_test');
  const owner = new pg.Client({ connectionString: databaseUrl(server, database) });
  const app = new pg.Client({ connectionString: databaseUrl(server, database, 'lims_app') });
  const lab = randomUUID();
  const operator = { id: randomUUID(), username: 'migrated.operator', session: randomUUID() };
  const migrations = new URL('../migrations/', import.meta.url);

  before(async () => {
    const admin = new pg.Client({ connectionString: databaseUrl(server, 'postgres') });
    await admin.connect();
    await admin.query(`drop database if exists ${pg.escapeIdentifier(database)} with (force)`);
    await admin.end();
    // Every migration before the Release Log, applied to a database that then gains a person, as the hosted demo did.
    const before0028 = await mkdtemp(`${tmpdir()}/lims-before-0028-`);
    for (const name of await readdir(migrations))
      if (name.endsWith('.sql') && name < '0028_') await copyFile(new URL(name, migrations), `${before0028}/${name}`);
    await migrate(server, database, pathToFileURL(`${before0028}/`));
    await owner.connect();
    await owner.query('begin');
    await owner.query(AS_SERVICE('svc:test'));
    await owner.query(
      `insert into lims.person (id, username, display_name, password_hash) values ($1, $2, 'Migrated Operator', 'not-a-real-hash')`,
      [operator.id, operator.username],
    );
    await owner.query(`insert into lims.lab (lab_id, code, name, time_zone) values ($1, 'MG', 'Migrated Lab', 'UTC')`, [
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
      Buffer.alloc(32, 11),
    ]);
    await owner.query('commit');
    await migrate(server, database);
    await app.connect();
  });
  after(async () => {
    await owner.end();
    await app.end();
  });

  const signIn = async () => {
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
  };

  it('the migration records one unapproved entry declaring the service identities the seed declares, as svc:migrate', async () => {
    const { rows } = await owner.query<{ id: string; approved: boolean; actor: string; identities: unknown }>(
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
  });

  it('with no approved entry, svc:sign-in writes an Access Event on the app role', async () => {
    await signIn();
  });

  it('once the operator approves the entry, the declared identity writes in its scope and an undeclared one is refused', async () => {
    const { rows } = await owner.query<{ id: string }>('select id from lims.release_log_entry');
    const entry = rows[0]?.id ?? assert.fail('the migration recorded an entry');
    await owner.query('begin');
    await owner.query(`select set_config('lims.actor', 'person:${operator.username}', true),
                              set_config('lims.role', 'PlatformOperator', true),
                              set_config('lims.reason', 'Approve the service identities', true)`);
    await owner.query(`select lims.lock_chains('company', '${lab}')`);
    await owner.query(`do $$
       declare proof uuid;
       begin
         insert into lims.reauthentication (lab_id, session_id, person_id, meaning, authenticator)
         values ('${lab}', '${operator.session}', '${operator.id}', 'Approved', 'Password') returning id into proof;
         perform lims.sign(proof, '${operator.session}', 'release_log_entry', '${entry}',
                           (select id from lims.record_version where record_table = 'release_log_entry' and record_id = '${entry}' order by version desc limit 1),
                           (select content_hash from lims.record_version where record_table = 'release_log_entry' and record_id = '${entry}' order by version desc limit 1),
                           (select max(version) from lims.signature_statement), 'Approved', 'test');
       end $$`);
    await owner.query('commit');
    await signIn();
    await app.query('begin');
    try {
      await app.query(AS_SERVICE('svc:nobody'));
      await assert.rejects(
        app.query(
          `insert into lims.access_event (kind, failure_reason, subject_id, source_address, roles) values ('SignInFailed', 'WrongPassword', $1, '192.0.2.1', '{}')`,
          [operator.id],
        ),
        (error: unknown) => error instanceof pg.DatabaseError && error.code === 'LA011',
      );
    } finally {
      await app.query('rollback');
    }
  });
});
