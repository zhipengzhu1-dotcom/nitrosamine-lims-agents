import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { audited, type Role } from '@lims/db';
import { routes } from '@lims/domain';
import { sql } from 'kysely';
import { LOCKOUT_AFTER_FAILURES, SESSION_LIMITS } from '../src/auth.ts';
import { labScope } from '../src/scope.ts';
import { type Account, Client, ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_access_events_test');
const SYSTEM = { actor: 'svc:test', role: 'system', reason: 'Arrange an Access Event test' };
const ada = await api.login(api.person('ada'));

const signIn = (username: string, password: string) =>
  new Client(api.base).call(routes.login, { username, password, labId: api.labId });

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
  await audited(api.superuser, SYSTEM, (tx) =>
    tx.updateTable('person').set({ lockedAt: sql`now()` }).where('id', '=', account.id).execute(),
  );
}

it('a successful sign-in writes one Access Event on the company chain, with subject, roles, source, session and database time', async () => {
  const person = await api.addPerson('access.success', ['Analyst', 'Reviewer']);
  const before = await dbNow();
  const client = new Client(api.base);
  const me = ok(
    await client.call(routes.login, { username: person.username, password: person.password, labId: api.labId }),
  );
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

it('roles are those held in the Lab the sign-in names, none for an unknown ID, never authentication', async () => {
  const otherLab = await audited(api.superuser, SYSTEM, (tx) =>
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

  const expected: Role[] = ['Analyst'];
  assert.equal(me.lab.id, api.labId);
  assert.deepEqual(me.roles, expected);
  assert.deepEqual(
    (await eventsOf(person.id)).map((e) => [e.kind, e.roles]),
    [
      ['SignInFailed', expected],
      ['SignInSucceeded', expected],
    ],
    'a failed and a successful sign-in to the same Lab record the same roles',
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
  ok(await client.call(routes.login, { username: person.username, password: person.password, labId: api.labId }));
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

const sessionsOf = (account: Account) =>
  api.superuser
    .selectFrom('session')
    .select(['id', 'labId', 'endedAt'])
    .where('personId', '=', account.id)
    .orderBy('createdAt')
    .execute();
const lockOut = async (account: Account) => {
  for (let i = 0; i < LOCKOUT_AFTER_FAILURES; i++)
    refusedWith(await signIn(account.username, 'not-the-password'), 'badCredentials');
};

it("under a Lockout, the Admin sees each of the person's sessions in this Lab that it ended, whether or not a request has noticed yet", async () => {
  const person = await api.addPerson('access.log-lockout', ['Analyst']);
  await audited(api.superuser, SYSTEM, (tx) =>
    tx.insertInto('membership').values({ labId: api.qcLabId, personId: person.id, role: 'Analyst' }).execute(),
  );
  await api.login(person);
  await api.advanceClock(person, SESSION_LIMITS.decided.idleMs + 60_000);
  ok(await (await api.login(person)).call(routes.logout));
  const noticed = await api.login(person);
  await api.login(person);
  await api.login(person, api.qcLabId);
  await lockOut(person);
  refusedWith(await noticed.call(routes.me), 'noSession');

  const [idleBefore, signedOut, ended, notYetNoticed, inQc] = await sessionsOf(person);
  assert.ok(idleBefore && signedOut?.endedAt && ended?.endedAt && notYetNoticed && inQc, 'five sessions');
  assert.equal(idleBefore.endedAt, null, 'no request or sweep has ended the session idle before the Lockout');
  assert.equal(notYetNoticed.endedAt, null, 'no request or sweep has ended the second live session yet');
  const { person: listed, events, earlierNotListed } = ok(await ada.call(routes.accessEvents, { id: person.id }));
  assert.deepEqual(listed, { id: person.id, printedName: person.username, username: person.username });
  assert.equal(earlierNotListed, false);
  const lockout = events.find((e) => e.kind === 'Lockout');
  assert.ok(lockout?.kind === 'Lockout', 'the Lockout is listed');
  assert.deepEqual(
    lockout.endedSessions.map((s) => [s.id, s.workstation]),
    [
      [ended.id, null],
      [notYetNoticed.id, null],
    ],
    'the sessions in this Lab live at the Lockout, not one idle or signed out before it, nor the one in the QC Lab',
  );
  assert.deepEqual(
    events.map((e) => e.kind),
    [
      'Lockout',
      ...Array.from({ length: LOCKOUT_AFTER_FAILURES }, () => 'SignInFailed'),
      'SignInSucceeded',
      'SignInSucceeded',
      'SignOut',
      'SignInSucceeded',
      'SignInSucceeded',
    ],
    'newest first, with no event of the session in the QC Lab',
  );
});

it("a person's Access Events are read only by this Lab's Admin, and only for this Lab's staff", async () => {
  const person = await api.addPerson('access.log-who', ['Analyst']);
  const quinn = await api.login(api.person('quinn'));
  refusedWith(await quinn.call(routes.accessEvents, { id: person.id }), 'role');
  refusedWith(await ada.call(routes.accessEvents, { id: api.person('cora').id }), 'notFound');
});

it("the Admin's list of a person's Access Events stops at the newest 100, and says that earlier ones exist", async () => {
  const person = await api.addPerson('access.log-many', ['Analyst']);
  await audited(api.superuser, SYSTEM, (tx) =>
    tx
      .insertInto('accessEvent')
      .values(
        Array.from({ length: 101 }, () => ({
          kind: 'SignInFailed' as const,
          failureReason: 'WrongPassword' as const,
          subjectId: person.id,
          sourceAddress: '192.0.2.1',
          roles: ['Analyst' as const],
        })),
      )
      .execute(),
  );
  const { events, earlierNotListed } = ok(await ada.call(routes.accessEvents, { id: person.id }));
  assert.equal(events.length, 100);
  assert.equal(earlierNotListed, true);
});

/** Waits until a backend in this test's database waits on a lock, or `request` settles, for at most about two seconds. */
async function blockedOrSettled(request: Promise<unknown>): Promise<void> {
  const settled = request.then(
    () => true,
    () => true,
  );
  for (let polls = 0; polls < 100; polls++) {
    const { rows } = await sql<{ waiting: boolean }>`select exists (
        select from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'
      ) as waiting`.execute(api.superuser);
    if (rows[0]?.waiting || (await Promise.race([settled, pause(20, false)]))) return;
  }
}

it('a sign-out that meets a Lockout not yet committed ends its session at the Lockout, which lists it, and records no sign-out', async () => {
  const person = await api.addPerson('access.signout-race', ['Analyst']);
  const client = await api.login(person);
  let signingOut: Promise<unknown> = Promise.resolve();
  await audited(api.superuser, SYSTEM, async (tx) => {
    await tx
      .updateTable('person')
      .set({ failedLogins: LOCKOUT_AFTER_FAILURES, lockedAt: sql`clock_timestamp()` })
      .where('id', '=', person.id)
      .execute();
    await tx
      .insertInto('accessEvent')
      .values({ kind: 'Lockout', subjectId: person.id, sourceAddress: '192.0.2.1', roles: ['Analyst'] })
      .execute();
    signingOut = client.call(routes.logout);
    await blockedOrSettled(signingOut);
  });
  await signingOut;

  const { lockedAt } = await api.superuser
    .selectFrom('person')
    .select('lockedAt')
    .where('id', '=', person.id)
    .executeTakeFirstOrThrow();
  const [session] = await sessionsOf(person);
  assert.ok(session && lockedAt);
  assert.deepEqual(session.endedAt, lockedAt, 'the session ended at the Lockout, not at the sign-out after it');
  const { events } = ok(await ada.call(routes.accessEvents, { id: person.id }));
  const lockout = events.find((e) => e.kind === 'Lockout');
  assert.ok(lockout?.kind === 'Lockout');
  assert.deepEqual(
    lockout.endedSessions.map((s) => s.id),
    [session.id],
  );
  assert.ok(!events.some((e) => e.kind === 'SignOut'), 'no sign-out is recorded for a session the Lockout ended');
});

it('a Lock waits for the company chain before it holds its session, the order a sign-out takes, so the two cannot deadlock', async () => {
  const person = await api.addPerson('access.lock-order', ['Analyst']);
  const client = await api.login(person);
  const [session] = await sessionsOf(person);
  assert.ok(session);
  let locking: Promise<unknown> = Promise.resolve();
  let sessionHeld = false;
  await audited(api.superuser, SYSTEM, async (tx) => {
    await sql`select lims.lock_chains('company')`.execute(tx);
    locking = client.call(routes.lock).then((answer) => ok(answer));
    await blockedOrSettled(locking);
    try {
      await sql`select from lims.session where id = ${session.id} for update nowait`.execute(api.superuser);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === '55P03')) throw error;
      sessionHeld = true;
    }
  });
  await locking;
  assert.equal(sessionHeld, false, 'the Lock did not hold the session while it waited for the chain');
});

it("the Lab scope reads no other Lab's Access Events or sessions, and no session's token hash", async () => {
  const person = await api.addPerson('access.scope', ['Analyst']);
  await audited(api.superuser, SYSTEM, (tx) =>
    tx.insertInto('membership').values({ labId: api.qcLabId, personId: person.id, role: 'Analyst' }).execute(),
  );
  await api.login(person, api.qcLabId);
  const scope = labScope(api.db, ok(await ada.call(routes.me)));

  assert.deepEqual(
    await scope.accessEvents().select('kind').where('subjectId', '=', person.id).execute(),
    [],
    'the sign-in to the QC Lab is out of reach',
  );
  assert.deepEqual(await scope.sessions().selectAll().where('session.personId', '=', person.id).execute(), []);
  const [own] = await scope.sessions().selectAll().where('session.personId', '=', api.person('ada').id).execute();
  assert.ok(own, "the Admin's own session here is in reach");
  assert.ok(!('tokenHash' in own), 'without its token hash');
});

it('the Lab a person switched out of sees the Lab Switch that ended its session', async () => {
  const person = await api.addPerson('access.log-switch', ['Analyst']);
  await audited(api.superuser, SYSTEM, (tx) =>
    tx.insertInto('membership').values({ labId: api.qcLabId, personId: person.id, role: 'Analyst' }).execute(),
  );
  const client = await api.login(person);
  ok(await client.call(routes.switchLab, { username: person.username, password: person.password, labId: api.qcLabId }));
  const { events } = ok(await ada.call(routes.accessEvents, { id: person.id }));
  assert.deepEqual(
    events.map((e) => e.kind),
    ['LabSwitch', 'SignInSucceeded'],
  );
});
