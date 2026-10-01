import assert from 'node:assert/strict';
import { it } from 'node:test';
import { sql } from 'kysely';
import { ABSOLUTE_LIMIT_MS, IDLE_LIMIT_MS, LOCKOUT_AFTER_FAILURES } from '../src/auth.ts';
import { Client, startApi } from './harness.ts';

const api = await startApi('lims_api_auth_test');

it('a wrong password or an unknown username gives no session, and the right password does', async () => {
  const rui = api.people.rui!;
  const client = new Client(api.base);
  assert.equal((await client.post('/api/login', { username: rui.username, password: 'not-the-password' })).status, 401);
  assert.equal((await client.post('/api/login', { username: 'no.such-person', password: rui.password })).status, 401);
  assert.equal(client.cookie, '', 'no session cookie after a refused sign-in');
  assert.equal((await client.get('/api/me')).status, 401);

  const signedIn = await api.login(rui);
  assert.equal((await signedIn.get('/api/me')).body.person.username, rui.username);
});

it(`the ${LOCKOUT_AFTER_FAILURES}th failed login locks the account and ends its sessions`, async () => {
  const ada = api.people.ada!;
  const fail = () => new Client(api.base).post('/api/login', { username: ada.username, password: 'not-the-password' });
  for (let i = 1; i < LOCKOUT_AFTER_FAILURES; i++) assert.equal((await fail()).status, 401);
  const session = await api.login(ada);

  for (let i = 1; i <= LOCKOUT_AFTER_FAILURES; i++) assert.equal((await fail()).status, 401, `failure ${i}`);
  const locked = await new Client(api.base).post('/api/login', { username: ada.username, password: ada.password });
  assert.equal(locked.status, 423);
  assert.equal((await session.get('/api/me')).status, 401);
});

it('a session ends when idle too long, when too old, and on logout', async () => {
  const sessions = {
    idle: await api.login(api.people.samir!),
    old: await api.login(api.people.lena!),
    out: await api.login(api.people.theo!),
  };
  const ago = (ms: number) => sql<Date>`now() - ${`${ms + 60_000} milliseconds`}::interval`;
  await api.superuser
    .updateTable('session')
    .set({ last_seen_at: ago(IDLE_LIMIT_MS) })
    .where('person_id', '=', api.people.samir!.id)
    .execute();
  await api.superuser
    .updateTable('session')
    .set({ created_at: ago(ABSOLUTE_LIMIT_MS) })
    .where('person_id', '=', api.people.lena!.id)
    .execute();
  assert.equal((await sessions.out.post('/api/logout')).status, 200);

  for (const [name, client] of Object.entries(sessions)) assert.equal((await client.get('/api/me')).status, 401, name);
});
