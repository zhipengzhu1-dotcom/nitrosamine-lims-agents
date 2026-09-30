// Accounts (decision 13 §3, the login research). The Admin creates the person and the role grants
// and hands over a one-time link; the person sets the password and enrols TOTP through it. The
// Admin never sees either. User IDs are never reused.

import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { CUSTOMER_ROLES, STAFF_ROLES } from '@lims/contract';
import { CustomerIdSchema, LabIdSchema, PersonIdSchema } from '../wire.ts';
import type { PersonId } from '@lims/domain/ids';
import { refuse } from '@lims/domain/refusal';
import { tokenHash } from '../actor.ts';
import { receipt, type CommandTx } from '../commit.ts';
import { defineCommand } from '../doors.ts';
import { hashPassword, passwordProblems, PASSWORD_PROBLEM_TEXT } from '../identity/password.ts';
import { decryptSecret, encryptSecret, matchTotp, newTotpSecret, otpauthUri } from '../identity/totp.ts';

const LINK_HOURS = 24;

const GrantSchema = z.union([
  z.object({ role: z.enum(STAFF_ROLES), lab: LabIdSchema }),
  z.object({ role: z.enum(CUSTOMER_ROLES), customer: CustomerIdSchema }),
  z.object({ role: z.literal('Admin') }),
]);

export const createPerson = defineCommand({
  name: 'identity.createPerson',
  input: z.object({
    printedName: z.string().min(1).max(200),
    nativeName: z.string().min(1).max(200).nullable().default(null),
    username: z.string().regex(/^[a-z][a-z0-9._-]{1,31}$/),
    grants: z.array(GrantSchema).min(1).max(8),
  }),
  acting: { as: 'role', role: 'Admin' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const admin = tx.actor.kind === 'admin' || tx.actor.kind === 'service' ? tx.actor.person : null;
    if (!admin) throw new Error('createPerson acts as Admin');
    const taken = await tx.db.selectFrom('account').select('person_id').where('username', '=', input.username).unionAll(
      tx.db.selectFrom('enrolment_link').select('person_id').where('username', '=', input.username)).executeTakeFirst();
    if (taken) return { kind: 'not-permitted', message: `The user ID ${input.username} is taken. User IDs are never reused.` };
    const id = randomUUID() as PersonId;
    await tx.db.insertInto('person').values({ id, printed_name: input.printedName, native_name: input.nativeName }).execute();
    await tx.db.insertInto('account').values({ person_id: id, username: input.username, password_hash: null, totp_secret_enc: null }).execute();
    for (const g of input.grants) {
      await tx.db.insertInto('role_grant').values({
        id: randomUUID(), person_id: id, role: g.role, lab_id: 'lab' in g ? g.lab : null, customer_id: 'customer' in g ? g.customer : null,
      }).execute();
    }
    const link = await newLink(tx, id, input.username, admin);
    return receipt(`Created ${input.printedName} (${input.username}). Hand over the enrolment link; it works once and expires in ${LINK_HOURS} hours.`, 'audited',
      { personId: id, username: input.username, expiresAt: link.expiresAt }, { data: { enrolmentToken: link.token } });
  },
});

async function newLink(tx: CommandTx, person: PersonId, username: string, by: PersonId): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(tx.dbNow.getTime() + LINK_HOURS * 3600_000);
  await tx.db.insertInto('enrolment_link').values({ id: randomUUID(), person_id: person, username, token_hash: tokenHash(token), created_by: by, expires_at: expiresAt }).execute();
  return { token, expiresAt: expiresAt.toISOString() };
}

const LINK_REFUSAL = { kind: 'not-permitted', message: 'This enrolment link has expired or was already used. Ask the Admin for a new one.' } as const;

async function liveLink(tx: CommandTx, token: string) {
  const link = await tx.db.selectFrom('enrolment_link').innerJoin('person', 'person.id', 'enrolment_link.person_id')
    .select(['enrolment_link.id', 'enrolment_link.person_id', 'enrolment_link.username', 'enrolment_link.expires_at', 'enrolment_link.used_at', 'enrolment_link.totp_secret_enc', 'person.printed_name'])
    .where('enrolment_link.token_hash', '=', tokenHash(token)).executeTakeFirst();
  if (!link || link.used_at || link.expires_at.getTime() <= tx.dbNow.getTime()) return null;
  return link;
}

export const enrolStart = defineCommand({
  name: 'identity.enrolStart',
  input: z.object({ token: z.string().min(16).max(128) }),
  acting: { as: 'nobody' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx, { token }) => {
    const link = await liveLink(tx, token);
    if (!link) return LINK_REFUSAL;
    const secret = newTotpSecret();
    await tx.db.updateTable('enrolment_link').set({ totp_secret_enc: encryptSecret(tx.deps.totpKey, secret) }).where('id', '=', link.id).execute();
    return receipt(`Scan the code with your authenticator app, then set your password and type the current code.`, 'audited',
      { username: link.username, printedName: link.printed_name }, { data: { otpauthUri: otpauthUri(secret, link.username) } });
  },
});

export const enrolFinish = defineCommand({
  name: 'identity.enrolFinish',
  input: z.object({ token: z.string().min(16).max(128), password: z.string().min(1).max(256), totp: z.string().regex(/^\d{6}$/) }),
  acting: { as: 'nobody' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx, input) => {
    const link = await liveLink(tx, input.token);
    if (!link) return LINK_REFUSAL;
    if (!link.totp_secret_enc) return { kind: 'not-permitted', message: 'Scan the code first.' };
    const problems = passwordProblems(input.password, [link.username, ...link.printed_name.split(/\s+/)]);
    if (problems.length) return { kind: 'not-permitted', message: problems.map((p) => PASSWORD_PROBLEM_TEXT[p]).join(' ') };
    const secret = decryptSecret(tx.deps.totpKey, link.totp_secret_enc);
    const step = matchTotp(secret, input.totp, tx.dbNow);
    if (step === null) return { kind: 'not-permitted', message: 'The code does not match. Type the code your authenticator app shows now.' };
    if (!(await tx.surviveOnce({ table: 'totp_step_used', row: { person_id: link.person_id, step, purpose: 'enrol' } }))) return refuse.totpAlreadyUsed();
    await tx.db.updateTable('account').set({ password_hash: await hashPassword(tx.deps.pepper, input.password), totp_secret_enc: link.totp_secret_enc })
      .where('person_id', '=', link.person_id).execute();
    await tx.db.updateTable('enrolment_link').set({ used_at: sql`clock_timestamp()` }).where('id', '=', link.id).execute();
    await tx.db.insertInto('auth_event').values({ person_id: link.person_id, kind: 'totp_enrolled', counts_toward_lockout: false }).execute();
    return receipt(`Enrolled. Sign in as ${link.username}.`, 'audited', { username: link.username });
  },
});

export const checkIdentity = defineCommand({
  name: 'identity.checkIdentity',
  input: z.object({ personId: PersonIdSchema, method: z.string().min(1).max(200) }),
  acting: { as: 'role', role: 'Admin' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx, input) => {
    const admin = tx.actor.kind === 'admin' || tx.actor.kind === 'service' ? tx.actor.person : null;
    if (!admin) throw new Error('checkIdentity acts as Admin');
    const r = await tx.db.updateTable('account').set({ identity_checked_by: admin, identity_checked_at: sql`clock_timestamp()`, identity_check_method: input.method })
      .where('person_id', '=', input.personId).executeTakeFirst();
    if (r.numUpdatedRows === 0n) return { kind: 'not-permitted', message: 'No such person.' };
    return receipt('Identity check recorded.');
  },
});

export const unlockAccount = defineCommand({
  name: 'identity.unlockAccount',
  input: z.object({ personId: PersonIdSchema }),
  acting: { as: 'role', role: 'Admin' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx, input) => {
    const state = await tx.db.selectFrom('lockout_state').select('locked_out').where('person_id', '=', input.personId).executeTakeFirst();
    if (!state) return { kind: 'not-permitted', message: 'No such person.' };
    if (!state.locked_out) return { kind: 'transition', message: 'This account is not locked.' };
    await tx.db.insertInto('auth_event').values({ person_id: input.personId, kind: 'unlock', counts_toward_lockout: false, detail: { by: tx.actor.kind === 'nobody' || tx.actor.kind === 'locked' ? null : tx.actor.person } }).execute();
    return receipt('Account unlocked.');
  },
});

/**
 * Replaces a person's authenticator: the password and secret are revoked and a new one-time link
 * is minted (decision 13 §1: replacing a lost authenticator). The identity check is cleared too,
 * since the step repeats, so the person signs nothing until the Admin records a new one. The
 * seed's handover uses it so the owner enrols each demo account on a real authenticator app.
 */
export const reenrol = defineCommand({
  name: 'identity.reenrol',
  input: z.object({ username: z.string().min(1).max(64) }),
  acting: { as: 'role', role: 'Admin' },
  reason: { kind: 'picklist', code: 'other', text: 'authenticator replaced' },
  ledgers: () => [],
  run: async (tx, input) => {
    const admin = tx.actor.kind === 'admin' || tx.actor.kind === 'service' ? tx.actor.person : null;
    if (!admin) throw new Error('reenrol acts as Admin');
    const account = await tx.db.selectFrom('account').select(['person_id', 'username']).where('username', '=', input.username).executeTakeFirst();
    if (!account) return { kind: 'not-permitted', message: 'No such person.' };
    await tx.db.updateTable('account').set({ password_hash: null, totp_secret_enc: null, identity_checked_by: null, identity_checked_at: null, identity_check_method: null })
      .where('person_id', '=', account.person_id).execute();
    await tx.db.updateTable('session').set({ ended_at: sql`clock_timestamp()`, end_reason: 'admin' }).where('person_id', '=', account.person_id).where('ended_at', 'is', null).execute();
    await tx.db.insertInto('auth_event').values({ person_id: account.person_id, kind: 'totp_revoked', counts_toward_lockout: false, detail: { by: admin } }).execute();
    const link = await newLink(tx, account.person_id as PersonId, account.username, admin);
    return receipt(`Revoked ${account.username}'s authenticator and ended their sessions. Hand over the new enrolment link; it works once and expires in ${LINK_HOURS} hours. Record a new identity check before they can sign.`, 'audited',
      { personId: account.person_id, username: account.username, expiresAt: link.expiresAt }, { data: { enrolmentToken: link.token } });
  },
});

export const identityCommands = [createPerson, enrolStart, enrolFinish, checkIdentity, unlockAccount, reenrol];
