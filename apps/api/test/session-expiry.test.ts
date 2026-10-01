import assert from 'node:assert/strict';
import { it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { routes, SESSION_ENDED } from '@lims/domain';
import { audited } from '@lims/db';
import { sql } from 'kysely';
import { endExpiredSessions, SESSION_LIMITS } from '../src/auth.ts';
import { type Account, Client, ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_session_expiry_test');
const { idleMs, absoluteMs } = SESSION_LIMITS.decided;
const MINUTE_MS = 60_000;

const sweep = () => endExpiredSessions(api.db, SESSION_LIMITS.decided);

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

it('a request on a session past its limit, before the sweep reaches it, is refused as an ended session', async () => {
  const person = await api.addPerson('expiry.unswept', ['Analyst']);
  const client = await api.login(person);
  await api.advanceClock(person, idleMs + MINUTE_MS);
  const { lastSeenAt } = await sessionOf(person);

  assert.equal(refusedWith(await client.call(routes.me), 'noSession'), SESSION_ENDED);
  const refused = await sessionOf(person);
  assert.deepEqual(
    [refused.lastSeenAt, refused.endedAt],
    [lastSeenAt, null],
    'the refusal neither counts as activity nor ends the session',
  );
  assert.deepEqual(await expiriesOf(person), [], 'the refusal leaves the record to the sweep');

  await sweep();
  assert.deepEqual(
    (await expiriesOf(person)).map((e) => e.at.getTime()),
    [lastSeenAt.getTime() + idleMs],
    'the sweep still stamps the computed instant',
  );
});

it("a locked person's session past its limit is left to the sweep, which records its expiry", async () => {
  const person = await api.addPerson('expiry.locked', ['Analyst']);
  const client = await api.login(person);
  await audited(api.db, { actor: 'svc:test', role: 'system', reason: 'Lock a test person' }, (tx) =>
    tx.updateTable('person').set({ lockedAt: sql`now()` }).where('id', '=', person.id).execute(),
  );
  await api.advanceClock(person, idleMs + MINUTE_MS);
  const { lastSeenAt } = await sessionOf(person);

  assert.equal(refusedWith(await client.call(routes.me), 'noSession'), SESSION_ENDED);
  assert.equal((await sessionOf(person)).endedAt, null);
  await sweep();
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
    const { session } = ok(await client.call(routes.login, { username: person.username, password: person.password }));
    assert.equal(session.idleLimitMs, idle, `the ${login} idle limit`);
    assert.ok(
      session.absoluteLeftMs <= 12 * 60 * MINUTE_MS && session.absoluteLeftMs > 12 * 60 * MINUTE_MS - MINUTE_MS,
      `the ${login} absolute limit is 12 hours from sign-in, not ${session.absoluteLeftMs} ms`,
    );

    await api.advanceClock(person, idle - MINUTE_MS);
    ok(await client.call(routes.me));
    ok(await client.call(routes.logout));

    const again = new Client(base);
    ok(await again.call(routes.login, { username: person.username, password: person.password }));
    await api.advanceClock(person, idle + MINUTE_MS);
    assert.equal(refusedWith(await again.call(routes.me), 'noSession'), SESSION_ENDED, `${login}: idle past its limit`);
  }
});

it('the sweep refuses limits other than the decided or demo ones, so no caller ends a session early', async () => {
  const person = await api.addPerson('expiry.early', ['Analyst']);
  const client = await api.login(person);
  await assert.rejects(
    endExpiredSessions(api.db, { idleMs: 1, absoluteMs: absoluteMs }),
    (err: { code?: string }) => err.code === 'LA003',
  );
  assert.deepEqual(await expiriesOf(person), []);
  ok(await client.call(routes.me));
});

it('the sweep takes every login configuration the API offers', async () => {
  for (const limits of Object.values(SESSION_LIMITS)) await endExpiredSessions(api.db, limits);
});

it("the API's database role cannot move a session's times, so it cannot choose when an expiry is stamped", async () => {
  const person = await api.addPerson('expiry.backdate', ['Analyst']);
  await api.login(person);
  for (const set of [
    { lastSeenAt: sql<Date>`now() - interval '1 day'` },
    { createdAt: sql<Date>`now() - interval '1 day'` },
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
