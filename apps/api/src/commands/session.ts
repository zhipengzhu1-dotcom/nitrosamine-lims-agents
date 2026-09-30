// Sessions are server state (decision 23 rule 1, sessions.md). Login, unlock and takeover run as
// the authentication service, because the person has no active session to act in; lock, switch
// user and logout are the person's own acts. Every one goes to the access log.

import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { CredentialsSchema } from '@lims/contract';
import { CustomerIdSchema, LabIdSchema } from '../wire.ts';
import type { CustomerId, LabId, PersonId, SessionId } from '@lims/domain/ids';
import { refuse } from '@lims/domain/refusal';
import { newSessionToken, tokenHash } from '../actor.ts';
import { receipt, type CommandTx, type Detail } from '../commit.ts';
import { defineCommand } from '../doors.ts';
import { checkCredentials, findAccount, reauthenticate, LOCKOUT_AFTER } from '../identity/reauth.ts';

const ABSOLUTE_HOURS = 12;

/** Which Lab or Customer a session is opened for: the one named, else the only one the person's grants allow. */
async function placeOf(tx: CommandTx, person: PersonId, wanted: { lab?: LabId; customer?: CustomerId }) {
  const grants = await tx.db.selectFrom('role_grant').select(['role', 'lab_id', 'customer_id']).where('person_id', '=', person).where('revoked_at', 'is', null).execute();
  const labs = [...new Set(grants.map((g) => g.lab_id).filter((l): l is string => l !== null))];
  const customers = [...new Set(grants.map((g) => g.customer_id).filter((c): c is string => c !== null))];
  if (wanted.lab) return labs.includes(wanted.lab) ? { lab: wanted.lab, customer: null } : null;
  if (wanted.customer) return customers.includes(wanted.customer) ? { lab: null, customer: wanted.customer as CustomerId } : null;
  if (labs.length === 1) return { lab: labs[0] as LabId, customer: null };
  if (labs.length === 0 && customers.length === 1) return { lab: null, customer: customers[0] as CustomerId };
  if (labs.length === 0 && customers.length === 0 && grants.some((g) => g.role === 'Admin')) return { lab: null, customer: null };
  return null;
}

async function openSession(tx: CommandTx, person: PersonId, place: { lab: LabId | null; customer: CustomerId | null }, workstation: string): Promise<{ id: SessionId; token: string }> {
  const id = randomUUID() as SessionId;
  const token = newSessionToken();
  await tx.db.insertInto('session').values({
    id, token_hash: tokenHash(token), person_id: person, acting_lab_id: place.lab, customer_id: place.customer, workstation,
    absolute_end_at: sql`clock_timestamp() + interval '${sql.raw(String(ABSOLUTE_HOURS))} hours'`,
  }).execute();
  await tx.db.insertInto('session_activity').values({ session_id: id, last_activity_at: sql`clock_timestamp()` }).execute();
  return { id, token };
}

async function endSession(tx: CommandTx, session: SessionId, person: PersonId, reason: 'logout' | 'takeover', detail: Detail = {}): Promise<void> {
  await tx.db.updateTable('session').set({ ended_at: sql`clock_timestamp()`, end_reason: reason }).where('id', '=', session).where('ended_at', 'is', null).execute();
  await tx.db.insertInto('auth_event').values({ person_id: person, session_id: session, kind: reason, counts_toward_lockout: false, detail }).execute();
}

const sessionOf = (tx: CommandTx) => {
  const a = tx.actor;
  if (a.kind === 'nobody' || a.kind === 'locked' || a.kind === 'service') throw new Error('this command acts in a live session');
  return a;
};

export const login = defineCommand({
  name: 'session.login',
  input: CredentialsSchema.extend({ workstation: z.string().min(1).max(64), lab: LabIdSchema.optional(), customer: CustomerIdSchema.optional() }),
  acting: { as: 'nobody' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx, input) => {
    const account = await findAccount(tx, input.typedUserId);
    if (!account) {
      await tx.survive({ table: 'auth_event', row: { person_id: null, typed_user: input.typedUserId, kind: 'login_fail', counts_toward_lockout: false, detail: { why: 'unknown-user' } } });
      const unknown = await tx.db.selectFrom('auth_event').select((eb) => eb.fn.countAll<string>().as('n'))
        .where('typed_user', '=', input.typedUserId).where('person_id', 'is', null).where('kind', '=', 'login_fail').executeTakeFirstOrThrow();
      return refuse.credentials(Math.max(0, LOCKOUT_AFTER - Number(unknown.n)));
    }
    const refused = await checkCredentials(tx, account, input, 'login', null);
    if (refused) return refused;
    const place = await placeOf(tx, account.person, { ...(input.lab ? { lab: input.lab } : {}), ...(input.customer ? { customer: input.customer } : {}) });
    if (!place) return { kind: 'not-permitted', message: 'Choose the Lab or Customer to sign in for.' };
    const previous = tx.actor;
    if (previous.kind === 'staff' || previous.kind === 'admin' || previous.kind === 'customer') {
      await endSession(tx, previous.session, previous.person, previous.person === account.person ? 'logout' : 'takeover', { by: 'login' });
    } else if (previous.kind === 'locked') {
      await endSession(tx, previous.locked.session, previous.locked.person, previous.locked.person === account.person ? 'logout' : 'takeover', { by: 'login' });
    }
    const s = await openSession(tx, account.person, place, input.workstation);
    await tx.db.insertInto('auth_event').values({ person_id: account.person, typed_user: input.typedUserId, session_id: s.id, kind: 'login_ok', counts_toward_lockout: false, detail: { workstation: input.workstation } }).execute();
    return receipt(`Signed in as ${account.printedName}.`, 'audited', null, { cookie: { set: s.token } });
  },
});

export const lock = defineCommand({
  name: 'session.lock',
  input: z.object({}),
  acting: { as: 'session' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx) => {
    const a = sessionOf(tx);
    await tx.db.updateTable('session').set({ locked_at: sql`clock_timestamp()`, lock_reason: 'manual' }).where('id', '=', a.session).execute();
    await tx.db.insertInto('auth_event').values({ person_id: a.person, session_id: a.session, kind: 'lock', counts_toward_lockout: false, detail: { reason: 'manual' } }).execute();
    return receipt('Locked.');
  },
});

export const switchUser = defineCommand({
  name: 'session.switchUser',
  input: z.object({}),
  acting: { as: 'session' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx) => {
    const a = sessionOf(tx);
    await tx.db.updateTable('session').set({ locked_at: sql`clock_timestamp()`, lock_reason: 'switch-user' }).where('id', '=', a.session).execute();
    await tx.db.insertInto('auth_event').values({ person_id: a.person, session_id: a.session, kind: 'lock', counts_toward_lockout: false, detail: { reason: 'switch-user' } }).execute();
    return receipt('Locked for the next person.');
  },
});

export const unlock = defineCommand({
  name: 'session.unlock',
  input: CredentialsSchema,
  acting: { as: 'locked-session' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx, creds) => {
    if (tx.actor.kind !== 'locked') throw new Error('unlock acts on a locked session');
    const owner = tx.actor.locked;
    const signer = await reauthenticate(tx, owner, 'session', creds, 'unlock');
    if ('kind' in signer) return signer;
    await tx.db.updateTable('session').set({ locked_at: null, lock_reason: null }).where('id', '=', owner.session).execute();
    await tx.db.insertInto('auth_event').values({ person_id: owner.person, session_id: owner.session, kind: 'unlock_session', counts_toward_lockout: false }).execute();
    return receipt('Unlocked.');
  },
});

export const takeover = defineCommand({
  name: 'session.takeover',
  input: CredentialsSchema.extend({ lab: LabIdSchema.optional(), customer: CustomerIdSchema.optional() }),
  acting: { as: 'locked-session' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx, input) => {
    if (tx.actor.kind !== 'locked') throw new Error('takeover acts on a locked session');
    const previous = tx.actor.locked;
    const account = await findAccount(tx, input.typedUserId);
    if (!account) {
      await tx.survive({ table: 'auth_event', row: { person_id: null, typed_user: input.typedUserId, session_id: previous.session, kind: 'login_fail', counts_toward_lockout: false, detail: { why: 'unknown-user', purpose: 'takeover' } } });
      return refuse.credentials(LOCKOUT_AFTER - 1);
    }
    const refused = await checkCredentials(tx, account, input, 'takeover', previous.session);
    if (refused) return refused;
    const place = await placeOf(tx, account.person, { ...(input.lab ? { lab: input.lab } : {}), ...(input.customer ? { customer: input.customer } : {}) });
    if (!place) return { kind: 'not-permitted', message: 'Choose the Lab or Customer to sign in for.' };
    await endSession(tx, previous.session, previous.person, 'takeover', { by: account.person, workstation: previous.workstation });
    const s = await openSession(tx, account.person, place, previous.workstation);
    await tx.db.insertInto('auth_event').values({ person_id: account.person, typed_user: input.typedUserId, session_id: s.id, kind: 'login_ok', counts_toward_lockout: false, detail: { by: 'takeover' } }).execute();
    return receipt(`Signed in as ${account.printedName}; the previous session has ended.`, 'audited', null, { cookie: { set: s.token } });
  },
});

export const logout = defineCommand({
  name: 'session.logout',
  input: z.object({}),
  acting: { as: 'session' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx) => {
    const a = sessionOf(tx);
    await endSession(tx, a.session, a.person, 'logout');
    return receipt('Signed out.', 'audited', null, { cookie: { clear: true } });
  },
});

export const sessionCommands = [login, lock, switchUser, unlock, takeover, logout];
