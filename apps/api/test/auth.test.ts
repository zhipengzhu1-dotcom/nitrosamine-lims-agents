import assert from 'node:assert/strict';
import { it } from 'node:test';
import { pathOf, type Route, routes } from '@lims/domain';
import { sql } from 'kysely';
import { ABSOLUTE_LIMIT_MS, IDLE_LIMIT_MS, LOCKOUT_AFTER_FAILURES, SESSION_COOKIE } from '../src/auth.ts';
import { Client, ok, startApi } from './harness.ts';

const api = await startApi('lims_api_auth_test');

it('a wrong password or an unknown username gives no session, and the right password does', async () => {
  const rui = api.person('rui');
  const client = new Client(api.base);
  assert.equal((await client.call(routes.login, { username: rui.username, password: 'not-the-password' })).status, 401);
  assert.equal((await client.call(routes.login, { username: 'no.such-person', password: rui.password })).status, 401);
  assert.equal(client.cookie, '', 'no session cookie after a refused sign-in');
  assert.equal((await client.call(routes.me)).status, 401);

  const signedIn = await api.login(rui);
  assert.equal(ok(await signedIn.call(routes.me)).person.username, rui.username);
});

it(`the ${LOCKOUT_AFTER_FAILURES}th failed login locks the account and ends its sessions`, async () => {
  const ada = api.person('ada');
  const fail = () => new Client(api.base).call(routes.login, { username: ada.username, password: 'not-the-password' });
  for (let i = 1; i < LOCKOUT_AFTER_FAILURES; i++) assert.equal((await fail()).status, 401);
  const session = await api.login(ada);

  for (let i = 1; i <= LOCKOUT_AFTER_FAILURES; i++) assert.equal((await fail()).status, 401, `failure ${i}`);
  const locked = await new Client(api.base).call(routes.login, { username: ada.username, password: ada.password });
  assert.equal(locked.status, 423);
  assert.equal((await session.call(routes.me)).status, 401);
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
    .set({ lastSeenAt: ago(IDLE_LIMIT_MS) })
    .where('personId', '=', api.person('samir').id)
    .execute();
  await api.superuser
    .updateTable('session')
    .set({ createdAt: ago(ABSOLUTE_LIMIT_MS) })
    .where('personId', '=', api.person('lena').id)
    .execute();
  assert.equal((await sessions.out.call(routes.logout)).status, 200);

  for (const [name, client] of Object.entries(sessions)) assert.equal((await client.call(routes.me)).status, 401, name);
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

    const issued = await sessionCookieFrom(base, routes.login, { username: rui.username, password: rui.password });
    assert.deepEqual(attributesOf(issued), expected, 'the sign-in Set-Cookie');

    const cleared = await sessionCookieFrom(base, routes.logout, {}, issued.split(';')[0]);
    assert.deepEqual(attributesOf(cleared), [...expected, 'Max-Age=0'].sort(), 'the sign-out Set-Cookie');
  });
}
