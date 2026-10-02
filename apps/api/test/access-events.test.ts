import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { audited, type Role } from '@lims/db';
import { routes } from '@lims/domain';
import { sql } from 'kysely';
import { LOCKOUT_AFTER_FAILURES } from '../src/auth.ts';
import { type Account, Client, ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_access_events_test');
const SYSTEM = { actor: 'svc:test', role: 'system', reason: 'Arrange an Access Event test' };

const signIn = (username: string, password: string) => new Client(api.base).call(routes.login, { username, password });

const eventColumns = [
  'id',
  'kind',
  'subjectId',
  'failureReason',
  'sessionLabId',
  'sessionId',
  'workstationId',
  'typedUserIdHmac',
  'typedUserIdLength',
  sql<string>`host(source_address)`.as('sourceAddress'),
  sql<Role[]>`roles::text[]`.as('roles'),
  'at',
] as const;

const eventsOf = (subjectId: string) =>
  api.superuser
    .selectFrom('accessEvent')
    .select(eventColumns)
    .where('subjectId', '=', subjectId)
    .orderBy('at')
    .execute();

const dbNow = async () =>
  (await sql<{ now: Date }>`select clock_timestamp() as now`.execute(api.superuser)).rows[0]?.now;

async function lock(account: Account): Promise<void> {
  await audited(api.db, SYSTEM, (tx) =>
    tx.updateTable('person').set({ lockedAt: sql`now()` }).where('id', '=', account.id).execute(),
  );
}

it('a successful sign-in writes one Access Event on the company chain, with subject, roles, source, session and database time', async () => {
  const person = await api.addPerson('access.success', ['Analyst', 'Reviewer']);
  const before = await dbNow();
  const client = new Client(api.base);
  const me = ok(await client.call(routes.login, { username: person.username, password: person.password }));
  const after = await dbNow();

  const [event, ...others] = await eventsOf(person.id);
  assert.deepEqual(others, [], 'one Access Event');
  const session = await api.superuser
    .selectFrom('session')
    .select(['labId', 'id'])
    .where('personId', '=', person.id)
    .executeTakeFirstOrThrow();
  assert.ok(event);
  assert.deepEqual(
    { ...event, id: undefined, at: undefined },
    {
      id: undefined,
      at: undefined,
      kind: 'SignInSucceeded',
      subjectId: person.id,
      failureReason: null,
      sessionLabId: me.lab.id,
      sessionId: session.id,
      workstationId: null,
      typedUserIdHmac: null,
      typedUserIdLength: null,
      sourceAddress: '127.0.0.1',
      roles: ['Analyst', 'Reviewer'],
    },
  );
  assert.equal(session.labId, me.lab.id);
  assert.ok(before && after && event.at >= before && event.at <= after, 'the database clock stamped the event');

  const entry = await api.superuser
    .selectFrom('auditEntry')
    .select(['chain', 'actor', 'role', 'op'])
    .where('tableName', '=', 'access_event')
    .where(sql<boolean>`new_row ->> 'id' = ${event.id}`)
    .executeTakeFirstOrThrow();
  assert.deepEqual(entry, { chain: 'company', actor: 'svc:sign-in', role: 'system', op: 'INSERT' });
});

it('an unknown user ID, a wrong password and a locked account get the same answer, and each Access Event keeps the true reason', async () => {
  const wrong = await api.addPerson('access.wrong', ['Analyst']);
  const locked = await api.addPerson('access.locked', ['Analyst']);
  await lock(locked);
  const unknown = `access.nobody-${randomUUID()}`;

  const answers = [
    await signIn(unknown, 'any-password'),
    await signIn(wrong.username, 'not-the-password'),
    await signIn(locked.username, 'not-the-password'),
  ];
  for (const answer of answers) refusedWith(answer, 'badCredentials');
  assert.deepEqual(answers[1], answers[0], 'a wrong password answers as an unknown user ID does');
  assert.deepEqual(answers[2], answers[0], 'a locked account answers as an unknown user ID does');

  const failures = await api.superuser
    .selectFrom('accessEvent')
    .select(['subjectId', 'failureReason', 'kind'])
    .where('kind', '=', 'SignInFailed')
    .where((eb) =>
      eb.or([
        eb('subjectId', 'in', [wrong.id, locked.id]),
        eb('typedUserIdHmac', '=', createHmac('sha256', api.accessEventKey).update(unknown).digest()),
      ]),
    )
    .orderBy('at')
    .execute();
  assert.deepEqual(failures, [
    { subjectId: null, failureReason: 'UnknownUserId', kind: 'SignInFailed' },
    { subjectId: wrong.id, failureReason: 'WrongPassword', kind: 'SignInFailed' },
    { subjectId: locked.id, failureReason: 'WrongPasswordOnLockedAccount', kind: 'SignInFailed' },
  ]);

  refusedWith(await signIn(locked.username, locked.password), 'accountLocked');
  assert.equal(
    (await eventsOf(locked.id)).at(-1)?.failureReason,
    'AccountLocked',
    'the right password on a locked account is recorded as a locked account',
  );
});

const median = (xs: number[]) => xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN;

it('an unknown user ID takes as long to refuse as a wrong password for a known one', async () => {
  const known = await api.addPerson('access.timed', ['Analyst']);
  const timed = async (username: string) => {
    const start = performance.now();
    refusedWith(await signIn(username, 'not-the-password'), 'badCredentials');
    return performance.now() - start;
  };
  const unknownMs: number[] = [];
  const knownMs: number[] = [];
  await timed(known.username);
  for (let i = 0; i < 9; i++) {
    unknownMs.push(await timed(`access.nobody-${randomUUID()}`));
    knownMs.push(await timed(known.username));
  }
  const [unknown, wrong] = [median(unknownMs), median(knownMs)];
  assert.ok(
    Math.abs(unknown - wrong) <= 0.25 * wrong + 10,
    `median refusal took ${unknown.toFixed(1)} ms for an unknown user ID and ${wrong.toFixed(1)} ms for a wrong password`,
  );
});

it('an unknown user ID is kept only as its keyed HMAC and its length, never as typed', async () => {
  const typed = `gäst-${randomUUID()}`;
  refusedWith(await signIn(typed, 'any-password'), 'badCredentials');

  const event = await api.superuser
    .selectFrom('accessEvent')
    .select(['subjectId', 'typedUserIdLength', sql<Role[]>`roles::text[]`.as('roles')])
    .where('typedUserIdHmac', '=', createHmac('sha256', api.accessEventKey).update(typed).digest())
    .executeTakeFirstOrThrow();
  assert.deepEqual(event, { subjectId: null, typedUserIdLength: typed.length, roles: [] });

  const { rows: tables } = await sql<{ tableName: string }>`select table_name as "tableName"
    from information_schema.tables where table_schema = 'lims'`.execute(api.superuser);
  assert.ok(tables.length > 10, 'every lims table is searched');
  for (const { tableName } of tables) {
    const found = await sql<{ n: number }>`select count(*)::int as n from ${sql.table(`lims.${tableName}`)} t
      where t::text like ${`%${typed}%`}`.execute(api.superuser);
    assert.equal(found.rows[0]?.n, 0, `no ${tableName} row holds the typed user ID`);
  }
  assert.ok(!api.log().includes(typed), 'no log line holds the typed user ID');
});

it('roles are those in the session Lab after sign-in and in the default Lab before, none for an unknown ID, never authentication', async () => {
  const otherLab = await audited(api.db, SYSTEM, (tx) =>
    tx
      .insertInto('lab')
      .values({ code: 'ACEV', name: 'Access Event Lab', timeZone: 'UTC' })
      .returning('labId')
      .executeTakeFirstOrThrow(),
  );
  const person = await api.addPerson('access.roles', ['Analyst']);
  await audited(api.superuser, SYSTEM, (tx) =>
    tx.insertInto('membership').values({ labId: otherLab.labId, personId: person.id, role: 'QA' }).execute(),
  );
  const customerOnly = await api.addPerson('access.customer', [], { customerId: await customerId() });

  refusedWith(await signIn(person.username, 'not-the-password'), 'badCredentials');
  const me = ok(await signIn(person.username, person.password));
  refusedWith(await signIn(customerOnly.username, 'not-the-password'), 'badCredentials');

  const expected: Role[] = me.lab.id === otherLab.labId ? ['QA'] : ['Analyst'];
  assert.deepEqual(me.roles, expected);
  assert.deepEqual(
    (await eventsOf(person.id)).map((e) => [e.kind, e.roles]),
    [
      ['SignInFailed', expected],
      ['SignInSucceeded', expected],
    ],
    'the default Lab before the session is the Lab the session opens',
  );
  assert.deepEqual(
    (await eventsOf(customerOnly.id)).map((e) => e.roles),
    [['Customer']],
    'a person in no Lab holds the role of their Customer',
  );

  const placeholders = await api.superuser
    .selectFrom('auditEntry')
    .select('seq')
    .where((eb) =>
      eb.or([eb('role', '=', 'authentication'), eb(sql`new_row -> 'roles'`, '@>', sql`'["authentication"]'::jsonb`)]),
    )
    .execute();
  assert.deepEqual(placeholders, [], 'no Audit Trail entry records the placeholder role authentication');
});

async function customerId(): Promise<string> {
  return (await api.superuser.selectFrom('customer').select('id').executeTakeFirstOrThrow()).id;
}

it('sign-out writes a sign-out Access Event, and a read or a page refresh writes nothing', async () => {
  const person = await api.addPerson('access.signout', ['Reviewer']);
  const client = new Client(api.base);
  ok(await client.call(routes.login, { username: person.username, password: person.password }));
  const writes = async () =>
    (
      await sql<{ events: number; entries: number }>`select
        (select count(*)::int from lims.access_event) as events,
        (select count(*)::int from lims.audit_entry) as entries`.execute(api.superuser)
    ).rows[0];

  const quiet = await writes();
  ok(await client.call(routes.me));
  ok(await client.call(routes.tests));
  assert.deepEqual(await writes(), quiet, 'a read writes no Access Event and no Audit Trail entry');

  ok(await client.call(routes.logout));
  const [signedIn, signedOut, ...others] = await eventsOf(person.id);
  assert.deepEqual(others, []);
  assert.deepEqual(
    [signedIn?.kind, signedOut?.kind, signedOut?.sessionId, signedOut?.roles],
    ['SignInSucceeded', 'SignOut', signedIn?.sessionId, ['Reviewer']],
  );
  const entry = await api.superuser
    .selectFrom('auditEntry')
    .select(['chain', 'actor'])
    .where(sql<boolean>`new_row ->> 'id' = ${signedOut?.id ?? ''}`)
    .executeTakeFirstOrThrow();
  assert.deepEqual(entry, { chain: 'company', actor: `person:${person.username}` });
});

it('a person whose Membership moved to another Lab during the session can still sign out, and the event records no roles', async () => {
  const person = await api.addPerson('access.removed', ['Analyst']);
  const client = await api.login(person);
  await audited(api.superuser, SYSTEM, async (tx) => {
    const elsewhere = await tx
      .insertInto('lab')
      .values({ code: 'ACMV', name: 'Lab the Membership moved to', timeZone: 'UTC' })
      .returning('labId')
      .executeTakeFirstOrThrow();
    await tx.updateTable('membership').set({ labId: elsewhere.labId }).where('personId', '=', person.id).execute();
  });

  ok(await client.call(routes.logout));
  const signedOut = (await eventsOf(person.id)).at(-1);
  assert.deepEqual([signedOut?.kind, signedOut?.roles], ['SignOut', []]);
  refusedWith(await client.call(routes.me), 'noSession');
});

it(`the ${LOCKOUT_AFTER_FAILURES}th wrong password writes one lockout Access Event`, async () => {
  const person = await api.addPerson('access.lockout', ['Analyst']);
  for (let i = 0; i <= LOCKOUT_AFTER_FAILURES; i++) await signIn(person.username, 'not-the-password');

  const kinds = (await eventsOf(person.id)).map((e) => e.failureReason ?? e.kind);
  assert.deepEqual(kinds, [
    ...Array.from({ length: LOCKOUT_AFTER_FAILURES }, () => 'WrongPassword'),
    'Lockout',
    'WrongPasswordOnLockedAccount',
  ]);
});
