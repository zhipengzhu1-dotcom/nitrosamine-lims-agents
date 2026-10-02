import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { checkoutDatabase, databaseUrl, dbServer } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

const server = dbServer();
const DATABASE = checkoutDatabase('lims_access_event_index_test');
const client = new pg.Client({ connectionString: databaseUrl(server, DATABASE) });

const FAILURE_KINDS = ['SignInFailed', 'LabSwitchFailed', 'ReauthenticationFailed'];
const FAILURE_INDEXES = ['access_event_failure_by_address', 'access_event_failure_by_subject'];

before(async () => {
  const admin = new pg.Client({ connectionString: databaseUrl(server, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${pg.escapeIdentifier(DATABASE)} with (force)`);
  } finally {
    await admin.end();
  }
  await migrate(server, DATABASE);
  await client.connect();
});

after(() => client.end());

describe('the failed-sign-in Access Event indexes hold only the failure kinds', () => {
  for (const index of FAILURE_INDEXES)
    it(`${index} holds SignInFailed, LabSwitchFailed and ReauthenticationFailed, and no other kind`, async () => {
      const { rows } = await client.query<{ predicate: string | null }>(
        `select pg_get_expr(i.indpred, i.indrelid) as predicate from pg_index i
          where i.indexrelid = ('lims.' || $1)::regclass`,
        [index],
      );
      const kinds = FAILURE_KINDS.map((kind) => `'${kind}'::lims.access_event_kind`).join(', ');
      assert.equal(rows[0]?.predicate, `(kind = ANY (ARRAY[${kinds}]))`);
    });
});

/**
 * The plans of every statement the incident trigger runs for `events`, from auto_explain, in one rolled-back transaction
 * that first writes 200 failed sign-ins from as many addresses, so the planner's statistics tell the indexes apart.
 */
async function triggerPlans(events: string[]): Promise<string> {
  const plans: string[] = [];
  const collect = (notice: { message?: string | undefined }) => plans.push(notice.message ?? '');
  client.on('notice', collect);
  await client.query('begin');
  try {
    await client.query(`select set_config('lims.actor', 'svc:sign-in', true), set_config('lims.role', 'system', true),
                               set_config('lims.reason', 'Probe the failure indexes', true)`);
    await client.query(`insert into lims.person (id, username, display_name, password_hash)
                        values ('00000000-0000-4000-8000-000000000216', 'index.person', 'Index Person', 'not-a-hash')`);
    await client.query(`insert into lims.access_event (kind, failure_reason, typed_user_id_hmac, typed_user_id_length,
                                                       source_address, roles)
                        select 'SignInFailed', 'UnknownUserId', sha256(n::text::bytea), 12, '198.51.100.0'::inet + n, '{}'
                          from generate_series(1, 200) n`);
    await client.query('analyze lims.access_event');
    await client.query(`load 'auto_explain'`);
    await client.query(`select set_config('auto_explain.log_min_duration', '0', true),
                               set_config('auto_explain.log_nested_statements', 'on', true),
                               set_config('auto_explain.log_level', 'notice', true),
                               set_config('enable_seqscan', 'off', true)`);
    for (const event of events) await client.query(event);
  } finally {
    await client.query('rollback');
    client.off('notice', collect);
  }
  return plans.join('\n');
}

describe('the incident trigger counts failures through the failure indexes', () => {
  it('the burst count from one source address reads access_event_failure_by_address', async () => {
    const plans = await triggerPlans([
      `insert into lims.access_event (kind, failure_reason, typed_user_id_hmac, typed_user_id_length, source_address, roles)
       values ('SignInFailed', 'UnknownUserId', decode(repeat('ab', 32), 'hex'), 12, '192.0.2.16', '{}')`,
    ]);
    assert.match(plans, /(using|on) access_event_failure_by_address\b/, plans);
  });

  it('the count of attempts on a locked account reads access_event_failure_by_subject', async () => {
    const plans = await triggerPlans([
      `insert into lims.access_event (kind, failure_reason, subject_id, source_address, roles)
       values ('SignInFailed', 'WrongPasswordOnLockedAccount', '00000000-0000-4000-8000-000000000216', '192.0.2.17',
               '{Analyst}')`,
    ]);
    assert.match(plans, /(using|on) access_event_failure_by_subject\b/, plans);
  });
});

const LAB = '00000000-0000-4000-8000-000000002161';
const PERSON = '00000000-0000-4000-8000-000000002162';
const SESSION = '00000000-0000-4000-8000-000000002163';

/** One failure of `kind` by the Index Person from `address`, with `reason`; a failure in a session names the session. */
function failure(kind: string, reason: string, address: string): pg.QueryConfig {
  const inSession = kind !== 'SignInFailed';
  return {
    text: `insert into lims.access_event (kind, failure_reason, subject_id, session_lab_id, session_id, source_address, roles)
           values ($1, $2, $3, $4, $5, $6, '{Analyst}')`,
    values: [kind, reason, PERSON, inSession ? LAB : null, inSession ? SESSION : null, address],
  };
}

/** A failed sign-in under an unknown user ID from `address`; each typed ID is different, so no ID burst opens. */
function unknownUserId(address: string, n: number): pg.QueryConfig {
  return {
    text: `insert into lims.access_event (kind, failure_reason, typed_user_id_hmac, typed_user_id_length, source_address,
                                          roles)
           values ('SignInFailed', 'UnknownUserId', sha256(convert_to($1, 'UTF8')), 12, $2, '{}')`,
    values: [`${address}/${n}`, address],
  };
}

// Address .40 meets the burst of ten only if failed Lab switches count; address .41 meets it through a failed
// re-authentication. The locked account meets three attempts only if failed Lab switches count, then meets them through
// a failed re-authentication.
const EVENTS = [
  ...Array.from({ length: 8 }, (_, n) => unknownUserId('192.0.2.40', n)),
  failure('LabSwitchFailed', 'OtherUserId', '192.0.2.40'),
  failure('LabSwitchFailed', 'OtherUserId', '192.0.2.40'),
  unknownUserId('192.0.2.40', 8),
  ...Array.from({ length: 9 }, (_, n) => unknownUserId('192.0.2.41', n)),
  failure('ReauthenticationFailed', 'WrongPassword', '192.0.2.41'),
  failure('SignInFailed', 'WrongPasswordOnLockedAccount', '192.0.2.42'),
  failure('LabSwitchFailed', 'AccountLocked', '192.0.2.43'),
  failure('LabSwitchFailed', 'AccountLocked', '192.0.2.43'),
  failure('SignInFailed', 'AccountLocked', '192.0.2.44'),
  failure('ReauthenticationFailed', 'AccountLocked', '192.0.2.45'),
];

/** The System Incidents the trigger opens for `EVENTS`, in one rolled-back transaction that first runs `setup`. */
async function incidentsOpened(setup: string): Promise<string[]> {
  await client.query('begin');
  try {
    if (setup) await client.query(setup);
    await client.query(`select set_config('lims.actor', 'svc:sign-in', true), set_config('lims.role', 'system', true),
                               set_config('lims.reason', 'Compare the incident counts', true)`);
    await client.query(
      `insert into lims.person (id, username, display_name, password_hash)
       values ($1, 'index.counts', 'Index Counts', 'not-a-hash')`,
      [PERSON],
    );
    await client.query(`insert into lims.lab (lab_id, code, name, time_zone) values ($1, 'IX', 'Index Lab', 'UTC')`, [
      LAB,
    ]);
    await client.query(
      `insert into lims.session (lab_id, id, person_id, token_hash) values ($1, $2, $3, sha256('index'))`,
      [LAB, SESSION, PERSON],
    );
    for (const event of EVENTS) await client.query(event);
    const { rows } = await client.query<{ incident: string }>(
      `select concat_ws(' ', kind, host(source_address), subject_id) as incident from lims.system_incident
        order by opened_at, kind`,
    );
    return rows.map((row) => row.incident);
  } finally {
    await client.query('rollback');
  }
}

describe('the incident trigger counts the failures it counted before the indexes were restored', () => {
  it('opens a System Incident on the same Access Events as 0017, with failed Lab switches still uncounted', async () => {
    const migration = readFileSync(new URL('../migrations/0017_signing_function.sql', import.meta.url), 'utf8');
    const triggerOf0017 = migration.match(
      /create or replace function lims\.open_sign_in_incident\(\)[\s\S]*?end \$\$;/,
    )?.[0];
    assert.ok(triggerOf0017, '0017 defines lims.open_sign_in_incident()');
    const now = await incidentsOpened('');
    assert.deepEqual(await incidentsOpened(triggerOf0017), now);
    assert.deepEqual(now, ['SignInBurstFromAddress 192.0.2.41', `RepeatedSignInOnLockedAccount ${PERSON}`]);
  });
});
