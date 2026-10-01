// Each service identity writes only the tables, and changes only the columns, its own code writes
// (LA011). The allowlist in migration 0065 was taken from what the seed, the pipeline's svc:auth
// paths and the sweeper write; the API suite, which runs the whole seed, proves it is wide enough.
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAudited, type AuditedTx } from '../src/audited.ts';
import { createLab } from '../src/doors.ts';
import { COMPANY_LEDGER, SERVICE } from '../src/ledgers.ts';
import type { LabId, SessionId } from '@lims/domain/ids';
import { seedFixture, serviceContext, type Fixture, type Service } from '../src/testing/fixture.ts';
import { testDatabase, type TestDb } from '../src/testing/harness.ts';
import { expectSqlState, installWidget, widgets } from './support.ts';

let db: TestDb;
let fx: Fixture;

beforeAll(async () => {
  db = await testDatabase();
  fx = await seedFixture(db.app);
  await installWidget(db);
});
afterAll(() => db.close());

const as = (service: Service, body: (tx: AuditedTx) => Promise<unknown>) =>
  runAudited(db.app, serviceContext(service, { action: 'test.scope', reason: { kind: 'action' } }), { kind: 'company' }, async (tx) => {
    await body(tx);
    return { commit: null };
  }).then((out) => {
    if (!('commit' in out)) throw new Error('rolled back');
  });

const newSession = (tx: AuditedTx, person: Fixture['ann']) => {
  const id = randomUUID() as SessionId;
  return tx.db.insertInto('session').values({
    id, token_hash: createHash('sha256').update(id).digest(), person_id: person.id, acting_lab_id: person.lab,
    workstation: 'bench-2', absolute_end_at: new Date(tx.dbNow.getTime() + 3600_000),
  }).execute().then(() => id);
};

const newLink = async (person: Fixture['ann']) => {
  const id = randomUUID();
  await as(SERVICE.seed, (tx) => tx.db.insertInto('enrolment_link').values({
    id, person_id: person.id, username: person.username, token_hash: randomUUID() as never, created_by: fx.adam.id,
    expires_at: new Date(tx.dbNow.getTime() + 3600_000),
  }).execute());
  return id;
};

describe('svc:auth writes only sessions, the access log, TOTP steps, alerts, spec gaps and enrolments (LA011)', () => {
  it('opens, locks, unlocks and ends a session, logs it, spends a step, raises an alert, records a gap and finishes an enrolment', async () => {
    const link = await newLink(fx.bob);
    let session: SessionId | null = null;
    await as(SERVICE.auth, async (tx) => {
      session = await newSession(tx, fx.bob);
      await tx.db.insertInto('auth_event').values({ person_id: fx.bob.id, session_id: session, kind: 'login_ok', counts_toward_lockout: false }).execute();
      await tx.db.insertInto('totp_step_used').values({ person_id: fx.bob.id, step: '101', purpose: 'login' }).execute();
      await tx.db.insertInto('alert').values({ kind: 'lockout', person_id: fx.bob.id, detail: {} }).execute();
      await tx.db.insertInto('spec_gap').values({ feature: 'deviation-workflow', command: 'test.scope', person_id: fx.bob.id, detail: {} }).execute();
      await tx.db.updateTable('enrolment_link').set({ totp_secret_enc: Buffer.from('pending') }).where('id', '=', link).execute();
      await tx.db.updateTable('account').set({ password_hash: 'argon2id$new', totp_secret_enc: Buffer.from('new') }).where('person_id', '=', fx.bob.id).execute();
      await tx.db.updateTable('enrolment_link').set({ used_at: sql`clock_timestamp()` }).where('id', '=', link).execute();
      await tx.db.updateTable('session').set({ locked_at: sql`clock_timestamp()`, lock_reason: 'manual' }).where('id', '=', session).execute();
      await tx.db.updateTable('session').set({ locked_at: null, lock_reason: null }).where('id', '=', session).execute();
      await tx.db.updateTable('session').set({ ended_at: sql`clock_timestamp()`, end_reason: 'takeover' }).where('id', '=', session).execute();
    });
    const row = await db.app.selectFrom('session').select(['end_reason']).where('id', '=', session!).executeTakeFirstOrThrow();
    expect(row.end_reason).toBe('takeover');
    expect((await db.app.selectFrom('account').select('password_hash').where('person_id', '=', fx.bob.id).executeTakeFirstOrThrow()).password_hash).toBe('argon2id$new');
  });

  it('may not create a person, a grant, a record or a row of a table registered later', async () => {
    await expectSqlState(as(SERVICE.auth, (tx) => tx.db.insertInto('person').values({ id: randomUUID(), printed_name: 'Nobody' }).execute()), 'LA011');
    await expectSqlState(as(SERVICE.auth, (tx) => tx.db.insertInto('role_grant').values({ id: randomUUID(), person_id: fx.ann.id, role: 'LabManager', lab_id: fx.labA }).execute()), 'LA011');
    await expectSqlState(as(SERVICE.auth, (tx) => tx.db.insertInto('record').values({ ledger_id: COMPANY_LEDGER, id: randomUUID(), kind: 'widget' }).execute()), 'LA011');
    await expectSqlState(as(SERVICE.auth, (tx) => widgets(tx).insertInto('widget').values({ lab_id: fx.labA, id: randomUUID(), name: 'W', state: 'Open', spec_pin: null }).execute()), 'LA011');
  });

  it('may change an account only by enrolling it: an identity check, a username or a disablement is refused', async () => {
    await expectSqlState(as(SERVICE.auth, (tx) => tx.db.updateTable('account').set({ identity_checked_by: fx.adam.id, identity_checked_at: sql`clock_timestamp()`, identity_check_method: 'none' }).where('person_id', '=', fx.ann.id).execute()), 'LA011');
    await expectSqlState(as(SERVICE.auth, (tx) => tx.db.updateTable('account').set({ username: 'ann2' }).where('person_id', '=', fx.ann.id).execute()), 'LA011');
    await expectSqlState(as(SERVICE.auth, (tx) => tx.db.updateTable('account').set({ disabled_at: sql`clock_timestamp()` }).where('person_id', '=', fx.ann.id).execute()), 'LA011');
  });

  it('never changes a row it ended: an ended session stays as it ended and a spent link stays spent', async () => {
    const link = await newLink(fx.cid);
    let session: SessionId | null = null;
    await as(SERVICE.auth, async (tx) => {
      session = await newSession(tx, fx.cid);
      await tx.db.updateTable('session').set({ ended_at: sql`clock_timestamp()`, end_reason: 'takeover' }).where('id', '=', session).execute();
      await tx.db.updateTable('enrolment_link').set({ used_at: sql`clock_timestamp()` }).where('id', '=', link).execute();
    });
    await expectSqlState(as(SERVICE.auth, (tx) => tx.db.updateTable('session').set({ ended_at: null, end_reason: null }).where('id', '=', session!).execute()), 'LA011');
    await expectSqlState(as(SERVICE.auth, (tx) => tx.db.updateTable('enrolment_link').set({ used_at: null }).where('id', '=', link).execute()), 'LA011');
    await expectSqlState(as(SERVICE.auth, (tx) => tx.db.updateTable('session').set({ end_reason: 'logout' }).where('id', '=', session!).execute()), 'LA011');
    await expectSqlState(as(SERVICE.auth, (tx) => tx.db.updateTable('enrolment_link').set({ totp_secret_enc: Buffer.from('again') }).where('id', '=', link).execute()), 'LA011');
  });
});

describe('svc:seed writes only reference data, people and their enrolment (LA011)', () => {
  it('creates a Lab, reference data, a person with an account and grants, and re-enrols a person', async () => {
    const person = randomUUID();
    const customer = randomUUID();
    const substance = randomUUID();
    const method = randomUUID();
    const version = randomUUID();
    await as(SERVICE.seed, async (tx) => {
      await createLab(tx, { id: randomUUID() as LabId, code: 'SC', ianaZone: 'UTC' });
      await tx.db.insertInto('customer').values({ id: customer, code: 'SCOPE', name: 'Scope Pharma' }).execute();
      await tx.db.insertInto('substance').values({ id: substance, cas: '0-00-1', name: 'Scopinib', kind: 'api' }).execute();
      await tx.db.insertInto('product').values({ id: randomUUID(), customer_id: customer, code: 'SCO-01', name: 'Scopinib API', api_substance_id: substance }).execute();
      await tx.db.insertInto('method').values({ id: method, number: 'NA-SCOPE-001', title: 'Scope method' }).execute();
      await tx.db.insertInto('record').values({ ledger_id: COMPANY_LEDGER, id: version, kind: 'method_version' }).execute();
      await tx.db.insertInto('method_version').values({ id: version, method_id: method, version: 1, data: {} }).execute();
      await tx.db.insertInto('person').values({ id: person, printed_name: 'Scope Person' }).execute();
      await tx.db.insertInto('account').values({ person_id: person, username: 'scope', password_hash: null, totp_secret_enc: null }).execute();
      await tx.db.insertInto('role_grant').values({ id: randomUUID(), person_id: person, role: 'Analyst', lab_id: fx.labA }).execute();
      await tx.db.updateTable('account').set({ password_hash: null, totp_secret_enc: null, identity_checked_by: null, identity_checked_at: null, identity_check_method: null }).where('person_id', '=', fx.eve.id).execute();
      await tx.db.updateTable('session').set({ ended_at: sql`clock_timestamp()`, end_reason: 'admin' }).where('id', '=', fx.eve.session).execute();
      await tx.db.insertInto('auth_event').values({ person_id: fx.eve.id, kind: 'totp_revoked', counts_toward_lockout: false }).execute();
    });
    await newLink(fx.eve);
    expect((await db.app.selectFrom('session').select('end_reason').where('id', '=', fx.eve.session).executeTakeFirstOrThrow()).end_reason).toBe('admin');
  });

  it('may not open a session, spend a TOTP step, raise an alert, lock a session or enter a Submission', async () => {
    await expectSqlState(as(SERVICE.seed, (tx) => newSession(tx, fx.cid)), 'LA011');
    await expectSqlState(as(SERVICE.seed, (tx) => tx.db.insertInto('totp_step_used').values({ person_id: fx.cid.id, step: '202', purpose: 'signing' }).execute()), 'LA011');
    await expectSqlState(as(SERVICE.seed, (tx) => tx.db.insertInto('alert').values({ kind: 'lockout', person_id: fx.cid.id, detail: {} }).execute()), 'LA011');
    await expectSqlState(as(SERVICE.seed, (tx) => tx.db.updateTable('session').set({ locked_at: sql`clock_timestamp()`, lock_reason: 'idle' }).where('id', '=', fx.cid.session).execute()), 'LA011');
    await expectSqlState(as(SERVICE.seed, (tx) => tx.db.insertInto('submission').values({ id: randomUUID(), customer_id: randomUUID(), number: 'SUB-SCOPE', entered_by: fx.cid.id, submitted_at: sql`clock_timestamp()` }).execute()), 'LA011');
  });
});

describe('svc:session-sweeper writes only idle locks (LA011)', () => {
  it('locks an idle session and logs it, and may do nothing else', async () => {
    await as(SERVICE.sessionSweeper, async (tx) => {
      await tx.db.updateTable('session').set({ locked_at: sql`clock_timestamp()`, lock_reason: 'idle' }).where('id', '=', fx.dee.session).execute();
      await tx.db.insertInto('auth_event').values({ person_id: fx.dee.id, session_id: fx.dee.session, kind: 'idle_lock', counts_toward_lockout: false }).execute();
    });
    await expectSqlState(as(SERVICE.sessionSweeper, (tx) => tx.db.updateTable('session').set({ ended_at: sql`clock_timestamp()`, end_reason: 'admin' }).where('id', '=', fx.dee.session).execute()), 'LA011');
    await expectSqlState(as(SERVICE.sessionSweeper, (tx) => tx.db.insertInto('person').values({ id: randomUUID(), printed_name: 'Nobody' }).execute()), 'LA011');
  });
});

describe('the allowlist', () => {
  it('guards every audited table, names only audited tables, and names exactly the service identities the app knows', async () => {
    const { rows } = await db.superuser.query<{ captured: string[]; guarded: string[]; listed: string[]; roles: string[] }>(`
      select array(select c.relname::text from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname = 'capture' order by 1) as captured,
             array(select c.relname::text from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname = 'service_scope' order by 1) as guarded,
             array(select distinct table_name from lims.service_write order by 1) as listed,
             array(select distinct role from lims.service_write order by 1) as roles`);
    const { captured, guarded, listed, roles } = rows[0]!;
    expect(captured).toContain('widget');
    expect(guarded).toEqual(captured);
    expect(listed.filter((t) => !captured.includes(t))).toEqual([]);
    expect(roles).toEqual(Object.values(SERVICE).map((s) => s.role).sort());
  });
});

// Last: once svc:seed's grant is revoked, the fixture's seed context no longer writes.
describe('svc:auth revokes one grant only: the seed retiring', () => {
  it("revokes svc:seed's live grant, and refuses to revoke a person's grant or to restore the seed's", async () => {
    await expectSqlState(as(SERVICE.auth, (tx) => tx.db.updateTable('role_grant').set({ revoked_at: sql`clock_timestamp()` }).where('person_id', '=', fx.ann.id).execute()), 'LA011');
    await as(SERVICE.auth, (tx) => tx.db.updateTable('role_grant').set({ revoked_at: sql`clock_timestamp()` }).where('person_id', '=', SERVICE.seed.person).execute());
    await expectSqlState(as(SERVICE.auth, (tx) => tx.db.updateTable('role_grant').set({ revoked_at: null }).where('person_id', '=', SERVICE.seed.person).execute()), 'LA011');
    const grants = await db.app.selectFrom('role_grant').select(['person_id', 'revoked_at']).where('person_id', 'in', [SERVICE.seed.person, fx.ann.id]).execute();
    expect(grants.find((g) => g.person_id === SERVICE.seed.person)?.revoked_at).not.toBeNull();
    expect(grants.find((g) => g.person_id === fx.ann.id)?.revoked_at).toBeNull();
  });
});
