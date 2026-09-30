// Identity: enrolment through a one-time link, login, the lockout derived from the access log,
// and the Admin's exclusivity surfaced as a refusal.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SERVICE_COMMANDS } from '../src/actor.ts';
import { CORE_COMMANDS } from '../src/app.ts';
import { CHAIN } from '../src/chain/index.ts';
import { checkIdentity, createPerson } from '../src/commands/identity.ts';
import { ENABLEMENT_DOCUMENTS } from '../src/records/facts.ts';
import { handover, retireSeed } from '../src/seed/index.ts';
import { Authenticator, credentials, enrol, login, signAs, testApi, type Person, type TestApi } from '../src/testing/harness.ts';
import { createLab, type Lab } from './support.ts';

let api: TestApi;
let lab: Lab;
let admin: Person;

beforeAll(async () => {
  api = await testApi();
  lab = await createLab(api, 'RD');
  admin = await enrol(api, { username: 'adam', printedName: 'Adam Admin', grants: [{ role: 'Admin' }] });
});
afterAll(() => api.close());

const events = (username: string) =>
  api.db.app.selectFrom('auth_event').innerJoin('account', 'account.person_id', 'auth_event.person_id').select(['auth_event.kind', 'auth_event.counts_toward_lockout'])
    .where('account.username', '=', username).orderBy('auth_event.id').execute();

describe('enrolment', () => {
  it('the Admin creates the person and gets a link; the receipt stored for replay carries no token', async () => {
    const adminTab = await login(api, admin);
    const key = crypto.randomUUID();
    const r = await adminTab.command('identity.createPerson', { printedName: 'Eve Analyst', username: 'eve', grants: [{ role: 'Analyst', lab: lab.id }] }, key);
    expect(r.status).toBe(200);
    const token = (r.body as { once: { enrolmentToken: string } }).once.enrolmentToken;
    expect(token.length).toBeGreaterThan(30);
    const replay = await adminTab.command('identity.createPerson', { printedName: 'Eve Analyst', username: 'eve', grants: [{ role: 'Analyst', lab: lab.id }] }, key);
    expect(replay.body['replayed']).toBe(true);
    expect(JSON.stringify(replay.body)).not.toContain(token);
    const stored = await api.db.app.selectFrom('commit_outcome').select('body').where('commit_key', '=', key).executeTakeFirstOrThrow();
    expect(JSON.stringify(stored.body)).not.toContain(token);
  });

  it('a link works once, refuses a weak password, needs the live code, and the Admin never sees the secret', async () => {
    const created = await api.run(api.seed, createPerson, { printedName: 'Fay Reviewer', username: 'fay', grants: [{ role: 'Reviewer', lab: lab.id }] });
    if (created.kind !== 'receipt') throw new Error('createPerson refused');
    const token = (created.once?.data as { enrolmentToken: string }).enrolmentToken;
    const anon = api.client();
    const start = await anon.command('identity.enrolStart', { token });
    expect(start.status).toBe(200);
    const uri = (start.body as { once: { otpauthUri: string } }).once.otpauthUri;
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(JSON.stringify(start.body['data'])).not.toContain('secret');
    const { Authenticator } = await import('../src/testing/harness.ts');
    const auth = new Authenticator(uri);

    const weak = await anon.command('identity.enrolFinish', { token, password: 'fay-password-2026', totp: await auth.next() });
    expect(weak.status).toBe(403);
    expect((weak.body as { refusal: { message: string } }).refusal.message).toMatch(/upper-case.*symbol/);
    expect((weak.body as { refusal: { message: string } }).refusal.message).toMatch(/must not contain your user ID/);

    const wrongCode = await anon.command('identity.enrolFinish', { token, password: 'Correct-Horse-Battery-9!', totp: '000000' });
    expect(wrongCode.status).toBe(403);

    const ok = await anon.command('identity.enrolFinish', { token, password: 'Correct-Horse-Battery-9!', totp: await auth.next() });
    expect(ok.status).toBe(200);
    const again = await anon.command('identity.enrolStart', { token });
    expect(again.status).toBe(403);

    const account = await api.db.app.selectFrom('account').select(['password_hash', 'totp_secret_enc']).where('username', '=', 'fay').executeTakeFirstOrThrow();
    expect(account.password_hash).toMatch(/^\$argon2id\$/);
    expect(account.totp_secret_enc?.toString('latin1')).not.toContain(auth.secret);
    const trail = await api.db.app.selectFrom('audit_entry').select('changes').where('table_name', 'in', ['account', 'enrolment_link']).execute();
    for (const t of trail) {
      expect(JSON.stringify(t.changes)).not.toContain(auth.secret);
      expect(JSON.stringify(t.changes)).not.toContain('Correct-Horse');
    }
  });

  it('a user ID is never reused, and a breached password is refused', async () => {
    const dup = await api.run(api.seed, createPerson, { printedName: 'Fay Again', username: 'fay', grants: [{ role: 'Analyst', lab: lab.id }] });
    expect(dup.kind === 'refusal' && dup.refusal.message).toMatch(/never reused/);
    const created = await api.run(api.seed, createPerson, { printedName: 'Gus Custodian', username: 'gus', grants: [{ role: 'SampleCustodian', lab: lab.id }] });
    if (created.kind !== 'receipt') throw new Error('refused');
    const token = (created.once?.data as { enrolmentToken: string }).enrolmentToken;
    const anon = api.client();
    const start = await anon.command('identity.enrolStart', { token });
    const { Authenticator } = await import('../src/testing/harness.ts');
    const auth = new Authenticator((start.body as { once: { otpauthUri: string } }).once.otpauthUri);
    const r = await anon.command('identity.enrolFinish', { token, password: 'Nitrosamine-LIMS-2026!', totp: await auth.next() });
    expect(r.status).toBe(403);
    expect(r.body.refusal.message).toMatch(/published breach/);
  });

  it('Admin with a business role is refused by the database and surfaced as a refusal', async () => {
    const r = await api.run(api.seed, createPerson, { printedName: 'Two Hats', username: 'hats', grants: [{ role: 'Admin' }, { role: 'Analyst', lab: lab.id }] });
    expect(r.kind).toBe('refusal');
    expect(r.kind === 'refusal' && r.refusal.message).toMatch(/Admin never also holds a business role/);
    expect(await api.db.app.selectFrom('person').select('id').where('printed_name', '=', 'Two Hats').executeTakeFirst()).toBeUndefined();
  });
});

describe('re-enrolment', () => {
  it('replacing an authenticator clears the identity check, so signing waits until the Admin checks again', async () => {
    const hal = await enrol(api, { username: 'hal', printedName: 'Hal Analyst', grants: [{ role: 'Analyst', lab: lab.id }] });
    const adminTab = await login(api, admin);
    await adminTab.must('identity.checkIdentity', { personId: hal.id, method: 'passport seen in person' });

    const replaced = await adminTab.command('identity.reenrol', { username: 'hal' });
    expect(replaced.status).toBe(200);
    const token = (replaced.body as { once: { enrolmentToken: string } }).once.enrolmentToken;
    const anon = api.client();
    const start = await anon.command('identity.enrolStart', { token });
    const halAgain: Person = { ...hal, password: 'Replaced-Phone-Mint-7!', auth: new Authenticator((start.body as { once: { otpauthUri: string } }).once.otpauthUri, hal.auth) };
    expect((await anon.command('identity.enrolFinish', { token, password: halAgain.password, totp: await halAgain.auth.next() })).status).toBe(200);

    const tab = await login(api, halAgain);
    const { recordId } = await tab.must<{ recordId: string }>('training.open', { documentVersion: ENABLEMENT_DOCUMENTS.policy, level: 'read-and-understood' });
    const refused = await signAs(tab, halAgain, 'Acknowledged', 'Analyst', [recordId]);
    expect(refused.status).not.toBe(200);
    expect(JSON.stringify(refused.body)).toMatch(/identity/i);

    await adminTab.must('identity.checkIdentity', { personId: hal.id, method: 'passport seen in person, new phone' });
    expect((await signAs(tab, halAgain, 'Acknowledged', 'Analyst', [recordId])).status).toBe(200);
  });

  it('the seed hands the demo accounts over only on a fictional-data deployment', async () => {
    const revoked = () => api.db.app.selectFrom('auth_event').select('id').where('kind', '=', 'totp_revoked').execute();
    const before = await revoked();
    await expect(handover(api, 'real')).rejects.toThrow(/fictional/);
    expect(await revoked()).toEqual(before);
  });
});

describe('service identities', () => {
  it('a service runs only the commands on its list, holding no business role', async () => {
    const r = await api.run(api.seed, checkIdentity, { personId: admin.id, method: 'the seed vouching for someone' });
    expect(r).toMatchObject({ kind: 'refusal', refusal: { kind: 'not-permitted' } });
    const account = await api.db.app.selectFrom('account').select('identity_checked_at').where('person_id', '=', admin.id).executeTakeFirstOrThrow();
    expect(account.identity_checked_at).toBeNull();
  });

  it('every command on a service\'s list is one the API registers', () => {
    const registered = new Set([...CORE_COMMANDS, ...CHAIN.commands].map((c) => c.name));
    for (const names of Object.values(SERVICE_COMMANDS)) for (const name of names) expect(registered).toContain(name);
  });

  it('once the seed retires, the database refuses any write as svc:seed, and retiring again changes nothing', async () => {
    const fresh = await testApi();
    try {
      await retireSeed(fresh.deps);
      await retireSeed(fresh.deps);
      await expect(fresh.run(fresh.seed, createPerson, { printedName: 'Late Arrival', username: 'late', grants: [{ role: 'Admin' }] })).rejects.toMatchObject({ code: 'LA004' });
      const grants = await fresh.db.app.selectFrom('role_grant').select('revoked_at').where('role', '=', 'svc:seed').execute();
      expect(grants).toHaveLength(1);
      expect(grants[0]!.revoked_at).toBeInstanceOf(Date);
    } finally {
      await fresh.close();
    }
  });
});

describe('login and lockout', () => {
  let eve: Person;
  beforeAll(async () => {
    eve = await enrol(api, { username: 'evelyn', printedName: 'Evelyn Analyst', grants: [{ role: 'Analyst', lab: lab.id }] });
  });

  it('an unknown user ID is refused without revealing that it is unknown, and counts toward nobody', async () => {
    const r = await api.client().command('session.login', { typedUserId: 'nobody', password: 'x', totp: '000000', workstation: 'bench-1' });
    expect(r.status).toBe(401);
    expect((r.body as { refusal: { kind: string } }).refusal.kind).toBe('credentials');
    const rows = await api.db.app.selectFrom('auth_event').select('person_id').where('typed_user', '=', 'nobody').execute();
    expect(rows).toEqual([{ person_id: null }]);
  });

  it('five consecutive failures lock the account, alert QA and the Admin, and only an Admin unlocks it', async () => {
    const tab = api.client();
    const attempt = (password: string) => tab.command('session.login', { typedUserId: eve.username, password, totp: '000000', workstation: 'bench-1' });
    for (let i = 1; i <= 4; i++) {
      const r = await attempt('wrong');
      expect(r.status).toBe(401);
      expect((r.body as { refusal: { attemptsLeft: number } }).refusal.attemptsLeft).toBe(5 - i);
    }
    const fifth = await attempt('wrong');
    expect(fifth.status).toBe(423);
    expect((fifth.body as { refusal: { kind: string; message: string } }).refusal.message).toMatch(/QA and the Admin have been alerted/);
    const alerts = await api.db.app.selectFrom('alert').select('kind').where('person_id', '=', eve.id).execute();
    expect(alerts).toEqual([{ kind: 'lockout' }]);

    const right = await tab.command('session.login', { ...(await credentials(eve)), workstation: 'bench-1' });
    expect(right.status).toBe(423);

    const adminTab = await login(api, admin);
    expect((await adminTab.command('identity.unlockAccount', { personId: eve.id })).status).toBe(200);
    const after = await tab.command('session.login', { ...(await credentials(eve)), workstation: 'bench-1' });
    expect(after.status).toBe(200);
    expect((await events(eve.username)).map((e) => e.kind)).toEqual([
      'totp_enrolled', 'login_fail', 'login_fail', 'login_fail', 'login_fail', 'login_fail', 'lockout', 'login_fail', 'unlock', 'login_ok',
    ]);
  });

  it('a right password with a wrong code counts as one failure, and a success resets the count', async () => {
    const tab = api.client();
    const wrongCode = await tab.command('session.login', { typedUserId: eve.username, password: eve.password, totp: '000000', workstation: 'bench-1' });
    expect(wrongCode.status).toBe(401);
    const ok = await tab.command('session.login', { ...(await credentials(eve)), workstation: 'bench-1' });
    expect(ok.status).toBe(200);
    const state = await api.db.app.selectFrom('lockout_state').select('consecutive_failures').where('person_id', '=', eve.id).executeTakeFirstOrThrow();
    expect(Number(state.consecutive_failures)).toBe(0);
  });

  it('a reused code is "wait for the next code" and does not count', async () => {
    const tab = api.client();
    const r = await tab.command('session.login', { typedUserId: eve.username, password: eve.password, totp: eve.auth.used(), workstation: 'bench-1' });
    expect(r.status).toBe(409);
    expect((r.body as { refusal: { message: string } }).refusal.message).toBe('Wait for the next code.');
    const state = await api.db.app.selectFrom('lockout_state').select('consecutive_failures').where('person_id', '=', eve.id).executeTakeFirstOrThrow();
    expect(Number(state.consecutive_failures)).toBe(0);
  });
});
