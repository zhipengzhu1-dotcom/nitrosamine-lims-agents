import assert from 'node:assert/strict';
import { it } from 'node:test';
import { pathOf, type Route, routes, SESSION_ENDED } from '@lims/domain';
import { sql } from 'kysely';
import { LOCKOUT_AFTER_FAILURES, SESSION_COOKIE, SESSION_LIMITS } from '../src/auth.ts';
import { Client, ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_auth_test');

it('a wrong password or an unknown username gives no session, and the right password does', async () => {
  const rui = api.person('rui');
  const client = new Client(api.base);
  const wrongPassword = await client.call(routes.login, { username: rui.username, password: 'not-the-password' });
  const unknownUsername = await client.call(routes.login, { username: 'no.such-person', password: rui.password });
  for (const refused of [wrongPassword, unknownUsername])
    assert.equal(refusedWith(refused, 'badCredentials'), 'The user ID or password is not valid.');
  assert.equal(client.cookie, '', 'no session cookie after a refused sign-in');
  assert.equal(refusedWith(await client.call(routes.me), 'noSession'), 'Sign in first.');

  const signedIn = await api.login(rui);
  assert.equal(ok(await signedIn.call(routes.me)).person.username, rui.username);

  const noLab = await api.addPerson('nolab.person', []);
  const refused = await client.call(routes.login, { username: noLab.username, password: noLab.password });
  assert.equal(refusedWith(refused, 'role'), 'This account belongs to no Lab.', 'told only with the right password');
});

it(`the ${LOCKOUT_AFTER_FAILURES}th failed login locks the account and ends its sessions, and only the right password learns of the lock`, async () => {
  const ada = api.person('ada');
  const fail = () => new Client(api.base).call(routes.login, { username: ada.username, password: 'not-the-password' });
  const lockedAt = async () =>
    (await api.superuser.selectFrom('person').select('lockedAt').where('id', '=', ada.id).executeTakeFirstOrThrow())
      .lockedAt;
  for (let i = 1; i < LOCKOUT_AFTER_FAILURES; i++) refusedWith(await fail(), 'badCredentials');
  const session = await api.login(ada);

  for (let i = 1; i <= LOCKOUT_AFTER_FAILURES; i++) refusedWith(await fail(), 'badCredentials');
  const firstLock = (await lockedAt()) ?? assert.fail('the account is locked');
  const locked = await new Client(api.base).call(routes.login, { username: ada.username, password: ada.password });
  assert.equal(refusedWith(locked, 'accountLocked'), 'This account is locked.');
  assert.equal(refusedWith(await session.call(routes.me), 'noSession'), SESSION_ENDED);

  assert.equal(
    refusedWith(await fail(), 'badCredentials'),
    'The user ID or password is not valid.',
    'a wrong password answers the same whether or not the account is locked',
  );
  assert.deepEqual(await lockedAt(), firstLock, 'a wrong password on a locked account keeps the first lock time');
});

it('a session ends when idle too long, when too old, and on logout', async () => {
  const sessions = {
    idle: await api.login(api.person('samir')),
    old: await api.login(api.person('lena')),
    out: await api.login(api.person('theo')),
  };
  const ago = (ms: number) => sql<Date>`now() - ${`${ms + 60_000} milliseconds`}::interval`;
  await api.superuser
    .updateTable('session')
    .set({ lastSeenAt: ago(SESSION_LIMITS.decided.idleMs) })
    .where('personId', '=', api.person('samir').id)
    .execute();
  await api.superuser
    .updateTable('session')
    .set({ createdAt: ago(SESSION_LIMITS.decided.absoluteMs) })
    .where('personId', '=', api.person('lena').id)
    .execute();
  assert.equal((await sessions.out.call(routes.logout)).status, 200);

  for (const [name, client, message] of [
    ['idle', sessions.idle, SESSION_ENDED],
    ['old', sessions.old, SESSION_ENDED],
    ['out', sessions.out, 'Sign in first.'],
  ] as const)
    assert.equal(refusedWith(await client.call(routes.me), 'noSession'), message, name);
});

async function sessionCookieFrom(base: string, route: Route, body: object, cookie = ''): Promise<string> {
  const res = await fetch(base + pathOf(route), {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const [header, ...others] = res.headers.getSetCookie().filter((h) => h.startsWith(`${SESSION_COOKIE}=`));
  assert.deepEqual(others, [], `one session Set-Cookie from ${route.url}`);
  return header ?? assert.fail(`no session Set-Cookie from ${route.url}`);
}

const attributesOf = (header: string) =>
  header
    .split(';')
    .slice(1)
    .map((part) => part.trim())
    .filter((part) => !part.startsWith('Expires='))
    .sort();

for (const secureCookie of [true, false]) {
  it(`sign-in and sign-out set the session cookie HttpOnly, SameSite=Strict, Path=/ and ${secureCookie ? '' : 'not '}Secure on an API built ${secureCookie ? 'with' : 'without'} secure cookies`, async () => {
    const { base } = await api.startAnotherApi({ secureCookie });
    const rui = api.person('rui');
    const expected = ['HttpOnly', 'Path=/', 'SameSite=Strict', ...(secureCookie ? ['Secure'] : [])].sort();

    const issued = await sessionCookieFrom(base, routes.login, {
      username: rui.username,
      password: rui.password,
      labId: api.labId,
    });
    assert.deepEqual(attributesOf(issued), expected, 'the sign-in Set-Cookie');

    const cleared = await sessionCookieFrom(base, routes.logout, {}, issued.split(';')[0]);
    assert.deepEqual(attributesOf(cleared), [...expected, 'Max-Age=0'].sort(), 'the sign-out Set-Cookie');
  });
}
