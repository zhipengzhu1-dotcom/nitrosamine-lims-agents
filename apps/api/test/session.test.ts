// Test-plan C18 and sessions.md: the state is derived from the database clock, a locked session
// gets 423 everywhere but unlock and takeover, a takeover ends the previous session.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { credentials, enrol, login, testApi, type Person, type TestApi } from '../src/testing/harness.ts';
import { sweepIdleSessions } from '../src/sweeper.ts';
import { createCustomer } from '../src/commands/reference.ts';
import { createLab, createWidget, installWidget, widgetKind, type Lab } from './support.ts';

let api: TestApi;
let lab: Lab;
let ann: Person;
let bob: Person;
let cid: Person;

beforeAll(async () => {
  api = await testApi({ kinds: [widgetKind], commands: [createWidget] });
  await installWidget(api);
  lab = await createLab(api, 'RD');
  ann = await enrol(api, { username: 'ann', printedName: 'Ann Analyst', grants: [{ role: 'Analyst', lab: lab.id as never }] });
  bob = await enrol(api, { username: 'bob', printedName: 'Bob Reviewer', grants: [{ role: 'Reviewer', lab: lab.id as never }] });
  cid = await enrol(api, { username: 'cid', printedName: 'Cid Quality', grants: [{ role: 'QA', lab: lab.id as never }] });
});
afterAll(() => api.close());

const sessionIdOf = async (username: string) =>
  (await api.db.app.selectFrom('session').innerJoin('account', 'account.person_id', 'session.person_id').select('session.id')
    .where('account.username', '=', username).where('session.ended_at', 'is', null).orderBy('session.started_at', 'desc').executeTakeFirstOrThrow()).id;

const ageActivity = (session: string, minutes: number) =>
  api.db.app.updateTable('session_activity').set({ last_activity_at: sql`clock_timestamp() - interval '${sql.raw(String(minutes))} minutes'` }).where('session_id', '=', session).execute();

describe('the derived state', () => {
  it('no cookie is state none, and a view or command then answers 401', async () => {
    const tab = api.client();
    expect((await tab.session()).body).toEqual({ state: 'none', dataClass: 'fictional' });
    expect((await tab.view('record.audit', { recordId: crypto.randomUUID() })).status).toBe(401);
    expect((await tab.command('session.lock', {})).status).toBe(401);
  });

  it('after sign-in the state is active, with the Lab, roles, epoch and an idle lock 15 minutes ahead', async () => {
    const tab = await login(api, ann, 'bench-7');
    const s = await tab.session();
    expect(s.body).toMatchObject({ state: 'active', dataClass: 'fictional', person: { username: 'ann', printedName: 'Ann Analyst' }, lab: { code: 'RD' }, roles: ['Analyst'], workstation: 'bench-7' });
    const idle = new Date(s.body['idleLockAt'] as string).getTime() - new Date(s.body['startedAt'] as string).getTime();
    expect(idle).toBeGreaterThan(14 * 60_000);
    expect(idle).toBeLessThanOrEqual(15 * 60_000 + 1000);
  });

  it('C18: 16 minutes without real activity is locked before the sweeper runs; views answer 423 and never move the timer', async () => {
    const tab = await login(api, ann);
    const id = await sessionIdOf('ann');
    for (let i = 0; i < 3; i++) expect((await tab.view('record.audit', { recordId: crypto.randomUUID() })).status).toBe(200);
    const activity = await api.db.app.selectFrom('session_activity').select('last_activity_at').where('session_id', '=', id).executeTakeFirstOrThrow();
    await ageActivity(id, 16);
    expect((await tab.session()).body).toMatchObject({ state: 'locked', lockReason: 'idle', owner: { username: 'ann' } });
    expect((await tab.view('record.audit', { recordId: crypto.randomUUID() })).status).toBe(423);
    expect((await tab.command('widget.create', { name: 'W', role: 'Analyst' })).status).toBe(423);
    const stillIdle = await api.db.app.selectFrom('session_activity').select('last_activity_at').where('session_id', '=', id).executeTakeFirstOrThrow();
    expect(stillIdle.last_activity_at.getTime()).toBeLessThan(activity.last_activity_at.getTime());
    expect(await sweepIdleSessions(api.db.app, 'test')).toBe(1);
    const row = await api.db.app.selectFrom('session').select('lock_reason').where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.lock_reason).toBe('idle');
    const logged = await api.db.app.selectFrom('auth_event').select('kind').where('session_id', '=', id).where('kind', '=', 'idle_lock').execute();
    expect(logged).toHaveLength(1);
  });

  it('real activity moves the idle lock; a view does not', async () => {
    const tab = await login(api, ann);
    const id = await sessionIdOf('ann');
    await ageActivity(id, 10);
    const before = (await tab.session()).body['idleLockAt'] as string;
    await tab.view('record.audit', { recordId: crypto.randomUUID() });
    expect((await tab.session()).body['idleLockAt']).toBe(before);
    expect((await tab.activity()).status).toBe(204);
    expect(new Date((await tab.session()).body['idleLockAt'] as string).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it('the 12-hour absolute end ends the session whatever the activity', async () => {
    const tab = await login(api, ann);
    const id = await sessionIdOf('ann');
    // Time passing, simulated as the superuser with the capture trigger off: the row's history is not the point here.
    const su = await api.db.superuser.connect();
    try {
      await su.query('set session_replication_role = replica');
      await su.query(`update lims.session set absolute_end_at = clock_timestamp() - interval '1 second' where id = $1`, [id]);
    } finally {
      await su.query('set session_replication_role = origin');
      su.release();
    }
    expect((await tab.session()).body).toEqual({ state: 'none', dataClass: 'fictional' });
    expect((await tab.view('record.audit', { recordId: crypto.randomUUID() })).status).toBe(401);
    expect((await tab.view('record.audit', { recordId: crypto.randomUUID() })).body).toMatchObject({ refusal: { kind: 'session', state: 'ended' } });
  });
});

describe('lock, unlock, switch user, takeover, logout', () => {
  it('Lock is a server state: the same cookie is 423 until the owner re-authenticates in full, and the epoch changes', async () => {
    const tab = await login(api, ann);
    const epoch = (await tab.session()).body['epoch'];
    expect((await tab.command('session.lock', {})).status).toBe(200);
    expect((await tab.session()).body).toMatchObject({ state: 'locked', lockReason: 'manual' });
    expect((await tab.command('session.lock', {})).status).toBe(423);
    const wrongUser = await tab.command('session.unlock', await credentials(bob));
    expect(wrongUser.status).toBe(403);
    expect((wrongUser.body as { refusal: { kind: string } }).refusal.kind).toBe('wrong-user');
    const wrongPassword = await tab.command('session.unlock', await credentials(ann, { password: 'nope' }));
    expect(wrongPassword.status).toBe(401);
    expect((await tab.session()).body['state']).toBe('locked');
    expect((await tab.command('session.unlock', await credentials(ann))).status).toBe(200);
    const after = await tab.session();
    expect(after.body['state']).toBe('active');
    expect(after.body['epoch']).not.toBe(epoch);
    const lockout = await api.db.app.selectFrom('lockout_state').select('consecutive_failures').where('person_id', '=', ann.id).executeTakeFirstOrThrow();
    expect(Number(lockout.consecutive_failures), 'a full re-authentication at unlock ends the run of failures').toBe(0);
    const alerts = await api.db.app.selectFrom('alert').select('kind').where('kind', '=', 'wrong-user-at-signing').execute();
    expect(alerts).toHaveLength(1);
  });

  it('Switch user locks at once; the newcomer\'s takeover ends the previous session on every tab', async () => {
    const tab1 = await login(api, cid);
    const tab2 = api.client();
    tab2.cookie = tab1.cookie;
    expect((await tab2.session()).body['state']).toBe('active');
    expect((await tab1.command('session.switchUser', {})).status).toBe(200);
    expect((await tab2.session()).body).toMatchObject({ state: 'locked', lockReason: 'switch-user' });
    const took = await tab1.command('session.takeover', await credentials(bob));
    expect(took.status).toBe(200);
    expect((await tab1.session()).body).toMatchObject({ state: 'active', person: { username: 'bob' } });
    expect((await tab2.session()).body).toEqual({ state: 'none', dataClass: 'fictional' });
    expect((await tab2.view('record.audit', { recordId: crypto.randomUUID() })).body).toMatchObject({ refusal: { state: 'ended' } });
    const ended = await api.db.app.selectFrom('session').select(['end_reason']).innerJoin('account', 'account.person_id', 'session.person_id')
      .where('account.username', '=', 'cid').where('session.ended_at', 'is not', null).orderBy('session.started_at', 'desc').executeTakeFirstOrThrow();
    expect(ended.end_reason).toBe('takeover');
    const log = await api.db.app.selectFrom('auth_event').select('kind').where('kind', 'in', ['lock', 'takeover', 'login_ok']).orderBy('id', 'desc').limit(3).execute();
    expect(log.map((l) => l.kind).sort()).toEqual(['lock', 'login_ok', 'takeover']);
  });

  it('logout ends the session and clears the cookie', async () => {
    const tab = await login(api, bob);
    expect((await tab.command('session.logout', {})).status).toBe(200);
    expect(tab.cookie).toBeUndefined();
    expect((await tab.session()).body).toEqual({ state: 'none', dataClass: 'fictional' });
  });

  it('the cookie is HttpOnly and SameSite=Strict, and Secure off localhost', async () => {
    const tab = api.client();
    const res = await api.app.inject({ method: 'POST', url: '/api/commands/session.login', headers: { 'x-lims-command': '1', host: 'lims.example.test' },
      payload: { commitKey: crypto.randomUUID(), input: { ...(await credentials(bob)), workstation: 'bench-1' } } });
    const cookie = res.headers['set-cookie'];
    expect(String(cookie)).toMatch(/HttpOnly/);
    expect(String(cookie)).toMatch(/SameSite=Strict/);
    expect(String(cookie)).toMatch(/Secure/);
    void tab;
  });
});

describe('signing in when the grants span several Customers or Labs', () => {
  it('asks which one after a correct password and code, and signs in for the one chosen with the next code', async () => {
    const customer = async (code: string, name: string) => {
      const out = await api.run(api.seed, createCustomer, { code, name });
      if (out.kind !== 'receipt') throw new Error(out.refusal.message);
      return (out.receipt.data as { customerId: string }).customerId;
    };
    const acme = await customer('ACME', 'Acme Pharma (fictional)');
    const beta = await customer('BETA', 'Beta Biologics (fictional)');
    const cara = await enrol(api, { username: 'cara', printedName: 'Cara Customer', grants: [{ role: 'CustomerUser', customer: acme }, { role: 'CustomerUser', customer: beta }] });
    const tab = api.client();
    const asked = await tab.command('session.login', { ...(await credentials(cara)), workstation: 'portal' });
    expect(asked.status).toBe(409);
    expect(asked.body.refusal).toMatchObject({
      kind: 'choose-place',
      places: [{ kind: 'customer', id: acme, name: 'Acme Pharma (fictional)' }, { kind: 'customer', id: beta, name: 'Beta Biologics (fictional)' }],
    });
    expect((await tab.session()).body).toEqual({ state: 'none', dataClass: 'fictional' });
    const signed = await tab.command('session.login', { ...(await credentials(cara)), workstation: 'portal', customer: beta });
    expect(signed.status).toBe(200);
    expect((await tab.session()).body).toMatchObject({ state: 'active', customer: { id: beta } });
  });
});
