import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { checkoutDatabase, databaseUrl, dbServer } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

const server = dbServer();
const DATABASE = checkoutDatabase('lims_authenticator_test');
const app = new pg.Client({ connectionString: databaseUrl(server, DATABASE, 'lims_app') });
const AS_ADMIN = `select set_config('lims.actor', 'person:auth.admin', true), set_config('lims.role', 'Admin', true),
                         set_config('lims.reason', 'Probe the authenticator', true)`;
const person = randomUUID();
const secret = Buffer.alloc(28, 9);

async function refusal(text: string, values: unknown[]): Promise<pg.DatabaseError> {
  await app.query('begin');
  try {
    await app.query(AS_ADMIN);
    await app.query(text, values);
  } catch (error) {
    if (error instanceof pg.DatabaseError) return error;
    throw error;
  } finally {
    await app.query('rollback');
  }
  assert.fail(`the database accepted ${text}`);
}

async function write(text: string, values: unknown[], client = app): Promise<void> {
  await client.query('begin');
  await client.query(AS_ADMIN);
  await client.query(text, values);
  await client.query('commit');
}

before(async () => {
  const admin = new pg.Client({ connectionString: databaseUrl(server, 'postgres') });
  await admin.connect();
  await admin.query(`drop database if exists ${pg.escapeIdentifier(DATABASE)} with (force)`);
  await admin.end();
  await migrate(server, DATABASE);
  await app.connect();
  // The owner adds the test person, because the app role cannot choose a person's id.
  const owner = new pg.Client({ connectionString: databaseUrl(server, DATABASE) });
  await owner.connect();
  try {
    await write(
      `insert into lims.person (id, username, display_name, password_hash) values ($1, 'auth.person', 'A', 'x')`,
      [person],
      owner,
    );
  } finally {
    await owner.end();
  }
  await write('insert into lims.authenticator (person_id, secret_ciphertext) values ($1, $2)', [person, secret]);
  await write('update lims.authenticator set last_used_step = 100 where person_id = $1', [person]);
});
after(() => app.end());

describe('the database keeps one authenticator per person and accepts each TOTP code once', () => {
  const cases: [name: string, text: string, values: unknown[], code: string, rule: string][] = [
    [
      'a second authenticator for one person is refused',
      'insert into lims.authenticator (person_id, secret_ciphertext) values ($1, $2)',
      [person, secret],
      '23505',
      'authenticator_pkey',
    ],
    [
      'an authenticator for no person is refused',
      'insert into lims.authenticator (person_id, secret_ciphertext) values ($1, $2)',
      [randomUUID(), secret],
      '23503',
      'authenticator_person_id_fkey',
    ],
    [
      'an authenticator without a person is refused',
      'insert into lims.authenticator (person_id, secret_ciphertext) values ($1, $2)',
      [null, secret],
      '23502',
      'person_id',
    ],
    [
      'an authenticator without a secret is refused',
      'insert into lims.authenticator (person_id, secret_ciphertext) values ($1, $2)',
      [randomUUID(), null],
      '23502',
      'secret_ciphertext',
    ],
  ];
  for (const [name, text, values, code, rule] of cases) {
    it(name, async () => {
      const error = await refusal(text, values);
      assert.deepEqual([error.code, error.constraint ?? error.column], [code, rule]);
    });
  }

  it('an authenticator without an enrolment time is refused', async () => {
    const owner = new pg.Client({ connectionString: databaseUrl(server, DATABASE) });
    await owner.connect();
    try {
      await owner.query('begin');
      await owner.query(AS_ADMIN);
      await assert.rejects(
        owner.query('update lims.authenticator set enrolled_at = null where person_id = $1', [person]),
        (error: unknown) =>
          error instanceof pg.DatabaseError && error.code === '23502' && error.column === 'enrolled_at',
      );
    } finally {
      await owner.query('rollback');
      await owner.end();
    }
  });

  for (const [name, step] of [
    ['a TOTP code at the step already accepted is refused', 100],
    ['a TOTP code at an earlier step than the one accepted is refused', 99],
    ['clearing the last accepted step is refused', null],
  ] as const) {
    it(name, async () => {
      const error = await refusal('update lims.authenticator set last_used_step = $2 where person_id = $1', [
        person,
        step,
      ]);
      assert.equal(error.code, 'LA014', error.message);
    });
  }

  it('a TOTP code at a later step is accepted', async () => {
    await write('update lims.authenticator set last_used_step = 101 where person_id = $1', [person]);
    const { rows } = await app.query('select last_used_step from lims.authenticator where person_id = $1', [person]);
    assert.equal(rows[0]?.last_used_step, '101');
  });
});
