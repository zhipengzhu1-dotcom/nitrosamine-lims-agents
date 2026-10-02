import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { checkoutDatabase, databaseUrl, dbConfig } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

const { server } = dbConfig();
const migrations = new URL('../migrations/', import.meta.url);
const AS_ADMIN = `select set_config('lims.actor', 'person:grants.admin', true), set_config('lims.role', 'Admin', true),
                         set_config('lims.reason', 'Probe a grant', true)`;

async function dropDatabase(name: string) {
  const admin = new pg.Client({ connectionString: databaseUrl(server, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${pg.escapeIdentifier(name)} with (force)`);
  } finally {
    await admin.end();
  }
}

async function inTransaction(client: pg.Client, statements: [string, unknown[]?][]): Promise<pg.QueryResult[]> {
  await client.query('begin');
  try {
    await client.query(AS_ADMIN);
    const results: pg.QueryResult[] = [];
    for (const [text, values] of statements) results.push(await client.query(text, values));
    await client.query('commit');
    return results;
  } catch (error) {
    await client.query('rollback');
    throw new Error('the transaction was refused', { cause: error });
  }
}

const sqlstate = (code: string) => (error: unknown) =>
  error instanceof Error && error.cause instanceof pg.DatabaseError && error.cause.code === code;

describe('the migration refuses a database where one person already holds Admin beside a business role', () => {
  const DATABASE = checkoutDatabase('lims_staff_migration_test');
  const copies: string[] = [];
  after(async () => {
    for (const dir of copies) await rm(dir, { recursive: true, force: true });
  });

  it('migrating such a database stops at 0015 with the Admin-apart refusal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lims-staff-migrations-'));
    copies.push(dir);
    await cp(migrations, dir, { recursive: true });
    for (const name of await readdir(dir)) if (name >= '0015') await rm(join(dir, name));
    await dropDatabase(DATABASE);
    await migrate(server, DATABASE, pathToFileURL(`${dir}/`));
    const client = new pg.Client({ connectionString: databaseUrl(server, DATABASE) });
    await client.connect();
    try {
      await client.query('begin');
      await client.query(AS_ADMIN);
      const { rows } = await client.query<{ person: string }>(
        `insert into lims.person (username, display_name, password_hash) values ('both.roles', 'Both Roles', 'x')
         returning id as person`,
      );
      const { rows: labs } = await client.query<{ lab: string }>(
        `insert into lims.lab (code, name, time_zone) values ('MG', 'Migration Lab', 'UTC') returning lab_id as lab`,
      );
      for (const role of ['Admin', 'Analyst'])
        await client.query('insert into lims.membership (lab_id, person_id, role) values ($1, $2, $3)', [
          labs[0]?.lab,
          rows[0]?.person,
          role,
        ]);
      await client.query('commit');
    } finally {
      await client.end();
    }
    await assert.rejects(migrate(server, DATABASE), (error: unknown) => {
      const fault = error instanceof Error && error.cause instanceof pg.DatabaseError ? error.cause : error;
      return fault instanceof pg.DatabaseError && fault.code === 'LA008';
    });
  });
});

describe('the app role reaches a password only through a one-time link', () => {
  const DATABASE = checkoutDatabase('lims_staff_grants_test');
  const owner = new pg.Client({ connectionString: databaseUrl(server, DATABASE) });
  const app = new pg.Client({ connectionString: databaseUrl(server, DATABASE, 'lims_app') });
  const token = randomBytes(32).toString('base64url');
  const ids = { lab: '', admin: '', verification: '', newcomer: '' };

  before(async () => {
    await dropDatabase(DATABASE);
    await migrate(server, DATABASE);
    await owner.connect();
    await app.connect();
    const [admin] = await inTransaction(owner, [
      [`insert into lims.person (username, display_name) values ('grants.admin', 'Grants Admin') returning id`],
    ]);
    ids.admin = admin?.rows[0]?.id;
    const [lab] = await inTransaction(owner, [
      [`insert into lims.lab (code, name, time_zone) values ('GR', 'Grants Lab', 'UTC') returning lab_id`],
    ]);
    ids.lab = lab?.rows[0]?.lab_id;
    await inTransaction(owner, [
      ['insert into lims.membership (lab_id, person_id, role) values ($1, $2, $3)', [ids.lab, ids.admin, 'Admin']],
    ]);
    const [verification] = await inTransaction(app, [
      [
        `insert into lims.identity_verification (printed_name, evidence, checked_by, checked_in_lab_id)
         values ('Nora New', 'Passport seen in person (fictional)', $1, $2) returning id`,
        [ids.admin, ids.lab],
      ],
    ]);
    ids.verification = verification?.rows[0]?.id;
    const [newcomer] = await inTransaction(app, [
      [
        `insert into lims.person (username, display_name, identity_verification_id) values ('nora.new', 'Nora New', $1)
         returning id`,
        [ids.verification],
      ],
    ]);
    ids.newcomer = newcomer?.rows[0]?.id;
    await inTransaction(app, [
      [
        'insert into lims.credential_link (person_id, token_hash) values ($1, $2)',
        [ids.newcomer, createHash('sha256').update(token).digest()],
      ],
    ]);
  });
  after(async () => {
    await owner.end();
    await app.end();
  });

  it('the app role cannot set a password, a username, an Identity Verification or a Customer on a person', async () => {
    for (const change of [
      "password_hash = 'scrypt$x$y'",
      "username = 'nora.renamed'",
      'identity_verification_id = null',
      'customer_id = null',
    ])
      await assert.rejects(
        inTransaction(app, [[`update lims.person set ${change} where id = $1`, [ids.newcomer]]]),
        sqlstate('42501'),
        change,
      );
  });

  it('the app role cannot create a staff account without an Identity Verification, or with a password', async () => {
    const refusal = (error: unknown) =>
      error instanceof Error &&
      error.cause instanceof pg.DatabaseError &&
      error.cause.code === 'LA007' &&
      error.cause.message ===
        'a staff account names its Identity Verification and has no password until its person sets one';
    await assert.rejects(
      inTransaction(app, [[`insert into lims.person (username, display_name) values ('no.verification', 'No Check')`]]),
      refusal,
    );
    const [second] = await inTransaction(owner, [
      [
        `insert into lims.identity_verification (printed_name, evidence, checked_by, checked_in_lab_id)
         values ('Pat Preset', 'Passport seen in person (fictional)', $1, $2) returning id`,
        [ids.admin, ids.lab],
      ],
    ]);
    await assert.rejects(
      inTransaction(app, [
        [
          `insert into lims.person (username, display_name, identity_verification_id, password_hash)
           values ('pat.preset', 'Pat Preset', $1, 'scrypt$x$y')`,
          [second?.rows[0]?.id],
        ],
      ]),
      refusal,
    );
  });

  it('rewriting every person row first does not make the app role a seeding transaction', async () => {
    await assert.rejects(
      inTransaction(app, [
        ['update lims.person set failed_logins = failed_logins'],
        [`insert into lims.person (username, display_name, password_hash) values ('sneaky.seed', 'Sneaky', 'x')`],
      ]),
      sqlstate('LA007'),
    );
  });

  it('the app role cannot give a staff role to a Customer User or to an account with no Identity Verification', async () => {
    const [customer] = await inTransaction(owner, [
      [`insert into lims.customer (name) values ('Grants Customer (fictional)') returning id`],
    ]);
    const [portal] = await inTransaction(app, [
      [
        `insert into lims.person (username, display_name, customer_id, password_hash)
         values ('carl.customer', 'Carl Customer', $1, 'scrypt$x$y') returning id`,
        [customer?.rows[0]?.id],
      ],
    ]);
    const [unchecked] = await inTransaction(owner, [
      [`insert into lims.person (username, display_name) values ('owner.made', 'Owner Made') returning id`],
    ]);
    for (const person of [portal?.rows[0]?.id, unchecked?.rows[0]?.id])
      await assert.rejects(
        inTransaction(app, [
          ['insert into lims.membership (lab_id, person_id, role) values ($1, $2, $3)', [ids.lab, person, 'Analyst']],
        ]),
        (error: unknown) =>
          sqlstate('LA007')(error) &&
          error instanceof Error &&
          error.cause instanceof Error &&
          error.cause.message === 'a staff role goes only to a staff account with an Identity Verification',
      );
    await inTransaction(app, [
      [
        'insert into lims.membership (lab_id, person_id, role) values ($1, $2, $3)',
        [ids.lab, portal?.rows[0]?.id, 'Customer'],
      ],
    ]);
  });

  it('the app role cannot mark a link used, date a check, or date a link itself', async () => {
    await assert.rejects(
      inTransaction(app, [['update lims.credential_link set used_at = clock_timestamp()']]),
      sqlstate('42501'),
    );
    await assert.rejects(
      inTransaction(app, [
        [
          `insert into lims.identity_verification (printed_name, evidence, checked_by, checked_in_lab_id, checked_at)
           values ('Backdated', 'Nothing', $1, $2, '2000-01-01')`,
          [ids.admin, ids.lab],
        ],
      ]),
      sqlstate('42501'),
    );
    await assert.rejects(
      inTransaction(app, [
        [
          `insert into lims.credential_link (person_id, token_hash, expires_at) values ($1, $2, '2999-01-01')`,
          [ids.newcomer, Buffer.alloc(32, 9)],
        ],
      ]),
      sqlstate('42501'),
    );
  });

  it('lims.set_password_through_link sets a first password once from the token, and answers null for its hash, an unknown or a used link', async () => {
    const setThrough = async (link: string) =>
      (
        await inTransaction(app, [
          ['select lims.set_password_through_link($1, $2) as person', [link, 'scrypt$new$hash']],
        ])
      )[0]?.rows[0]?.person;
    const hash = createHash('sha256').update(token).digest();
    assert.equal(await setThrough(hash.toString('hex')), null, 'the stored hash redeems nothing');
    assert.equal(await setThrough('not-a-link'), null, 'an unknown link sets nothing');
    assert.equal(await setThrough(token), ids.newcomer);
    assert.equal(await setThrough(token), null, 'a used link sets nothing');
    const { rows } = await owner.query('select password_hash from lims.person where id = $1', [ids.newcomer]);
    assert.deepEqual(rows, [{ password_hash: 'scrypt$new$hash' }]);
  });
});
