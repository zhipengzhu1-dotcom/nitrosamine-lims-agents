import assert from 'node:assert/strict';
import { it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { routes, SESSION_ENDED } from '@lims/domain';
import { audited } from '@lims/db';
import { sql } from 'kysely';
import { endLapsedSessions, LOCKOUT_AFTER_FAILURES, SESSION_LIMITS } from '../src/auth.ts';
import { type Account, Client, ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_session_expiry_test');
const { idleMs, absoluteMs } = SESSION_LIMITS.decided;
const MINUTE_MS = 60_000;

const sweep = () => endLapsedSessions(api.db, SESSION_LIMITS.decided);

const sessionOf = (account: Account) =>
  api.superuser
    .selectFrom('session')
    .select(['labId', 'id', 'createdAt', 'lastSeenAt', 'endedAt'])
    .where('personId', '=', account.id)
    .executeTakeFirstOrThrow();

const expiriesOf = (account: Account) =>
  api.superuser
    .selectFrom('accessEvent')
    .select([
      'id',
      'kind',
      'sessionLabId',
      'sessionId',
      'sourceAddress',
      sql<string[]>`roles::text[]`.as('roles'),
      'at',
    ])
    .where('subjectId', '=', account.id)
    .where('kind', 'in', ['IdleExpiry', 'AbsoluteExpiry'])
    .execute();

const dbNow = async () =>
  (await sql<{ now: Date }>`select clock_timestamp() as now`.execute(api.superuser)).rows[0]?.now ??
  assert.fail('the database gave no time');

it('the sweep ends a session idle past its limit, with an idle-expiry Access Event at last activity plus the idle limit, not the sweep time', async () => {
  const person = await api.addPerson('expiry.idle', ['Analyst', 'Reviewer']);
  const client = await api.login(person);
  await api.advanceClock(person, idleMs + 5 * MINUTE_MS);
  const { lastSeenAt } = await sessionOf(person);

  const sweptAt = await dbNow();
  await sweep();

  const session = await sessionOf(person);
  const [event, ...others] = await expiriesOf(person);
  assert.deepEqual(others, [], 'one expiry Access Event');
  const { id, at, ...recorded } = event ?? assert.fail('an expiry Access Event');
  assert.deepEqual(recorded, {
    kind: 'IdleExpiry',
    sessionLabId: session.labId,
    sessionId: session.id,
    sourceAddress: null,
    roles: ['Analyst', 'Reviewer'],
  });
  assert.equal(at.getTime(), lastSeenAt.getTime() + idleMs, 'stamped at last activity plus the idle limit');
  assert.ok(sweptAt.getTime() - at.getTime() >= 5 * MINUTE_MS, 'not stamped at the sweep');
  assert.equal(session.endedAt?.getTime(), at.getTime(), 'the session ended at the same instant');

  const entry = await api.superuser
    .selectFrom('auditEntry')
    .select(['chain', 'actor', 'role'])
    .where(sql<boolean>`new_row ->> 'id' = ${id}`)
    .executeTakeFirstOrThrow();
  assert.deepEqual(entry, { chain: 'company', actor: 'svc:session-sweep', role: 'system' });
  assert.equal(refusedWith(await client.call(routes.me), 'noSession'), SESSION_ENDED);
});

it('a session kept active is ended at 12 hours, with an absolute-expiry Access Event at session start plus 12 hours', async () => {
  const person = await api.addPerson('expiry.absolute', ['Analyst']);
  const client = await api.login(person);
  const { createdAt: signedInAt } = await sessionOf(person);
  for (let elapsed = 10 * MINUTE_MS; elapsed < absoluteMs; elapsed += 10 * MINUTE_MS) {
    await api.advanceClock(person, 10 * MINUTE_MS);
    ok(await client.call(routes.me));
  }
  await api.advanceClock(person, 11 * MINUTE_MS);
  const { createdAt, lastSeenAt } = await sessionOf(person);
  assert.ok(signedInAt.getTime() - createdAt.getTime() >= absoluteMs, 'the session is 12 hours old');

  await sweep();

  const [event, ...others] = await expiriesOf(person);
  assert.deepEqual(others, [], 'one expiry Access Event');
  assert.deepEqual([event?.kind, event?.at.getTime()], ['AbsoluteExpiry', createdAt.getTime() + absoluteMs]);
  assert.ok((event?.at.getTime() ?? 0) < lastSeenAt.getTime() + idleMs, 'the idle limit had not run out');
  refusedWith(await client.call(routes.me), 'noSession');
});

it('running the sweep again writes no second expiry Access Event for the same session', async () => {
  const person = await api.addPerson('expiry.twice', ['Analyst']);
  await api.login(person);
  await api.advanceClock(person, idleMs + MINUTE_MS);

  await sweep();
  const first = await expiriesOf(person);
  await sweep();

  assert.equal(first.length, 1);
  assert.deepEqual(await expiriesOf(person), first);
});

const lockOut = async (account: Account) => {
  const stranger = new Client(api.base);
  for (let i = 0; i < LOCKOUT_AFTER_FAILURES; i++)
    refusedWith(
      await stranger.call(routes.login, { username: account.username, password: 'not-the-password', labId: api.labId }),
      'badCredentials',
    );
  const lockout = await api.superuser
    .selectFrom('accessEvent')
    .select('at')
    .where('subjectId', '=', account.id)
    .where('kind', '=', 'Lockout')
    .executeTakeFirst();
  return lockout?.at ?? assert.fail('a Lockout Access Event');
};

for (const [limit, kind, activeFor, thenIdleFor] of [
  ['idle', 'IdleExpiry', 0, idleMs + MINUTE_MS],
  ['absolute', 'AbsoluteExpiry', absoluteMs - 10 * MINUTE_MS, 11 * MINUTE_MS],
] as const)
  it(`a request on a session past its ${limit} limit ends it with one ${kind} Access Event at the computed instant, and neither the sweep nor a second request writes another`, async () => {
    const person = await api.addPerson(`expiry.request-${limit}`, ['Analyst']);
    const client = await api.login(person);
    for (let elapsed = 0; elapsed < activeFor; elapsed += 10 * MINUTE_MS) {
      await api.advanceClock(person, 10 * MINUTE_MS);
      ok(await client.call(routes.me));
    }
    await api.advanceClock(person, thenIdleFor);
    const { createdAt, lastSeenAt } = await sessionOf(person);
    const end = Math.min(lastSeenAt.getTime() + idleMs, createdAt.getTime() + absoluteMs);

    assert.equal(refusedWith(await client.call(routes.me), 'noSession'), SESSION_ENDED);
    const ended = await sessionOf(person);
    assert.equal(ended.lastSeenAt.getTime(), lastSeenAt.getTime(), 'the refusal does not count as activity');
    assert.equal(ended.endedAt?.getTime(), end, 'the session ended at its computed end');
    const [event, ...others] = await expiriesOf(person);
    assert.deepEqual(others, [], 'one expiry Access Event');
    const { id, at, ...recorded } = event ?? assert.fail('an expiry Access Event');
    assert.deepEqual(recorded, {
      kind,
      sessionLabId: ended.labId,
      sessionId: ended.id,
      sourceAddress: null,
      roles: ['Analyst'],
    });
    assert.equal(at.getTime(), end, 'stamped at the computed end, not at the request');
    const entry = await api.superuser
      .selectFrom('auditEntry')
      .select(['actor', 'role'])
      .where(sql<boolean>`new_row ->> 'id' = ${id}`)
      .executeTakeFirstOrThrow();
    assert.deepEqual(entry, { actor: 'svc:session-sweep', role: 'system' }, 'written as the sweep writes it');

    await sweep();
    refusedWith(await client.call(routes.me), 'noSession');
    assert.deepEqual(await expiriesOf(person), [event]);
  });

it('a request racing the sweep for the same lapsed session leaves one expiry Access Event', async () => {
  const people = await Promise.all(
    Array.from({ length: 5 }, (_, i) => api.addPerson(`expiry.race-${i}`, ['Analyst'])),
  );
  const clients = await Promise.all(people.map((person) => api.login(person)));
  for (const person of people) await api.advanceClock(person, idleMs + MINUTE_MS);

  const [answers] = await Promise.all([Promise.all(clients.map((client) => client.call(routes.me))), sweep()]);
  for (const answer of answers) refusedWith(answer, 'noSession');
  for (const person of people)
    assert.deepEqual(
      (await expiriesOf(person)).map((e) => e.kind),
      ['IdleExpiry'],
    );
});

it("the countdown's check on a lapsed session ends it with its expiry Access Event", async () => {
  const person = await api.addPerson('expiry.countdown', ['Analyst']);
  const client = await api.login(person);
  await api.advanceClock(person, idleMs + MINUTE_MS);
  const { lastSeenAt } = await sessionOf(person);

  assert.equal(refusedWith(await client.call(routes.session), 'noSession'), SESSION_ENDED);
  assert.deepEqual(
    (await expiriesOf(person)).map((e) => [e.kind, e.at.getTime()]),
    [['IdleExpiry', lastSeenAt.getTime() + idleMs]],
  );
  assert.equal((await sessionOf(person)).endedAt?.getTime(), lastSeenAt.getTime() + idleMs);
});

it("a session whose person is locked out ends at the Lockout's instant, with no expiry Access Event", async () => {
  const person = await api.addPerson('expiry.lockout', ['Analyst']);
  const client = await api.login(person);
  const lockedOutAt = await lockOut(person);

  assert.equal(refusedWith(await client.call(routes.me), 'noSession'), SESSION_ENDED);
  assert.equal((await sessionOf(person)).endedAt?.getTime(), lockedOutAt.getTime());
  await api.advanceClock(person, idleMs + MINUTE_MS);
  await sweep();
  assert.deepEqual(await expiriesOf(person), []);
});

it("the sweep ends a locked-out person's session at the Lockout's instant, before any request finds it", async () => {
  const person = await api.addPerson('expiry.lockout-swept', ['Analyst']);
  await api.login(person);
  const lockedOutAt = await lockOut(person);

  await sweep();
  assert.equal((await sessionOf(person)).endedAt?.getTime(), lockedOutAt.getTime());
  assert.deepEqual(await expiriesOf(person), []);
});

it('a Lockout Access Event is stamped at the lock instant, and one for a person who is not locked is refused', async () => {
  const person = await api.addPerson('expiry.lockout-stamp', ['Analyst']);
  await assert.rejects(
    audited(api.db, { actor: 'svc:test', role: 'system', reason: 'Record a Lockout' }, (tx) =>
      tx
        .insertInto('accessEvent')
        .values({ kind: 'Lockout', subjectId: person.id, roles: [], sourceAddress: '192.0.2.1' })
        .execute(),
    ),
    (err: { code?: string; message?: string }) =>
      err.code === '23514' && err.message === 'a Lockout Access Event needs its person locked',
  );
  const lockedOutAt = await lockOut(person);
  const { lockedAt } = await api.superuser
    .selectFrom('person')
    .select('lockedAt')
    .where('id', '=', person.id)
    .executeTakeFirstOrThrow();
  assert.equal(lockedOutAt.getTime(), lockedAt?.getTime());
});

it("a locked person's session that lapsed before the lock ends at its own end, with its expiry Access Event", async () => {
  const person = await api.addPerson('expiry.locked', ['Analyst']);
  const client = await api.login(person);
  await api.advanceClock(person, idleMs + MINUTE_MS);
  const { lastSeenAt } = await sessionOf(person);
  await lockOut(person);

  assert.equal(refusedWith(await client.call(routes.me), 'noSession'), SESSION_ENDED);
  assert.equal((await sessionOf(person)).endedAt?.getTime(), lastSeenAt.getTime() + idleMs);
  assert.deepEqual(
    (await expiriesOf(person)).map((e) => [e.kind, e.at.getTime()]),
    [['IdleExpiry', lastSeenAt.getTime() + idleMs]],
  );
});

it('with the decided login the idle limit is 15 minutes, with the demo login 8 hours, and the absolute limit is 12 hours in both', async () => {
  const demo = await api.startAnotherApi({ login: 'demo' });
  for (const [login, base, idle] of [
    ['decided', api.base, 15 * MINUTE_MS],
    ['demo', demo.base, 8 * 60 * MINUTE_MS],
  ] as const) {
    const person = await api.addPerson(`expiry.${login}`, ['Analyst']);
    const client = new Client(base);
    const { session } = ok(
      await client.call(routes.login, { username: person.username, password: person.password, labId: api.labId }),
    );
    assert.equal(session.idleLimitMs, idle, `the ${login} idle limit`);
    assert.ok(
      session.absoluteLeftMs <= 12 * 60 * MINUTE_MS && session.absoluteLeftMs > 12 * 60 * MINUTE_MS - MINUTE_MS,
      `the ${login} absolute limit is 12 hours from sign-in, not ${session.absoluteLeftMs} ms`,
    );

    await api.advanceClock(person, idle - MINUTE_MS);
    ok(await client.call(routes.me));
    ok(await client.call(routes.logout));

    const again = new Client(base);
    ok(await again.call(routes.login, { username: person.username, password: person.password, labId: api.labId }));
    await api.advanceClock(person, idle + MINUTE_MS);
    assert.equal(refusedWith(await again.call(routes.me), 'noSession'), SESSION_ENDED, `${login}: idle past its limit`);
  }
});

it('the sweep refuses limits other than the decided or demo ones, so no caller ends a session early', async () => {
  const person = await api.addPerson('expiry.early', ['Analyst']);
  const client = await api.login(person);
  await assert.rejects(
    endLapsedSessions(api.db, { idleMs: 1, absoluteMs: absoluteMs }),
    (err: { code?: string }) => err.code === 'LA003',
  );
  assert.deepEqual(await expiriesOf(person), []);
  ok(await client.call(routes.me));
});

it('the sweep takes every login configuration the API offers', async () => {
  for (const limits of Object.values(SESSION_LIMITS)) await endLapsedSessions(api.db, limits);
});

it("the API's database role cannot move or end a session itself, so it cannot choose when an expiry is stamped or skip it", async () => {
  const person = await api.addPerson('expiry.backdate', ['Analyst']);
  await api.login(person);
  for (const set of [
    { lastSeenAt: sql<Date>`now() - interval '1 day'` },
    { createdAt: sql<Date>`now() - interval '1 day'` },
    { endedAt: sql<Date>`now() - interval '1 day'` },
  ])
    await assert.rejects(
      api.db.updateTable('session').set(set).where('personId', '=', person.id).execute(),
      (err: { code?: string }) => err.code === '42501',
    );
});

it('the API runs the sweep by itself on its schedule', async () => {
  const sweeping = await api.startAnotherApi({ sweepEveryMs: 20 });
  const person = await api.addPerson('expiry.scheduled', ['Analyst']);
  await api.login(person);
  await api.advanceClock(person, idleMs + MINUTE_MS);

  for (let wait = 0; wait < 250 && (await expiriesOf(person)).length === 0; wait++) await sleep(20);
  await sweeping.app.close();

  assert.deepEqual(
    (await expiriesOf(person)).map((e) => e.kind),
    ['IdleExpiry'],
  );
});

it('a sweep that fails opens a System Incident, and the next sweep records the expiry', async () => {
  const person = await api.addPerson('expiry.failing', ['Analyst']);
  await api.login(person);
  await api.advanceClock(person, idleMs + MINUTE_MS);
  const incidents = () =>
    api.superuser
      .selectFrom('systemIncident')
      .select(['step', 'sqlstate', 'requestedBy'])
      .where('step', '=', 'expirySweep')
      .execute();
  await sql`revoke execute on function lims.end_lapsed_sessions(interval, interval, uuid, uuid) from lims_app`.execute(
    api.superuser,
  );
  try {
    const sweeping = await api.startAnotherApi({ sweepEveryMs: 20 });
    for (let wait = 0; wait < 250 && (await incidents()).length === 0; wait++) await sleep(20);
    await sweeping.app.close();
  } finally {
    await sql`grant execute on function lims.end_lapsed_sessions(interval, interval, uuid, uuid) to lims_app`.execute(
      api.superuser,
    );
  }

  const [incident] = await incidents();
  assert.deepEqual(incident, { step: 'expirySweep', sqlstate: '42501', requestedBy: null });
  assert.deepEqual(await expiriesOf(person), [], 'the failed sweep wrote nothing');
  await sweep();
  assert.deepEqual(
    (await expiriesOf(person)).map((e) => e.kind),
    ['IdleExpiry'],
  );
});

it("the countdown's check reads the time left without counting as activity, so a second tab cannot keep a session alive", async () => {
  const person = await api.addPerson('expiry.peek', ['Analyst']);
  const tabA = await api.login(person);
  const tabB = new Client(api.base);
  tabB.cookie = tabA.cookie;
  await api.advanceClock(person, 10 * MINUTE_MS);
  const { lastSeenAt } = await sessionOf(person);

  const left = ok(await tabB.call(routes.session));
  assert.equal(left.idleLimitMs, idleMs);
  assert.ok(
    left.idleLeftMs <= 5 * MINUTE_MS && left.idleLeftMs > 4 * MINUTE_MS,
    `five minutes of idle time left, not ${left.idleLeftMs} ms`,
  );
  assert.deepEqual((await sessionOf(person)).lastSeenAt, lastSeenAt, 'the check did not touch the session');

  await api.advanceClock(person, 6 * MINUTE_MS);
  assert.equal(refusedWith(await tabB.call(routes.session), 'noSession'), SESSION_ENDED);
  assert.equal(refusedWith(await tabA.call(routes.me), 'noSession'), SESSION_ENDED, 'ended at the idle limit');
});
