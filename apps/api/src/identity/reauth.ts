// Full authentication and re-authentication (decision 13 §1; decision 23 rules 3, 5, 6, 8). The
// login session never counts toward a signature. Every failure is written to the access log
// through the survivors channel, so it outlives the refusal's rollback, and the lockout is derived
// from that log (lims.lockout_state), never counted in memory.
//
// Order, stopping at the first failure:
//   1. the typed user ID names the account (login) or is the session's own (signing, unlock);
//      a typed ID that isn't the session's is wrong-user: alerted, and no password is tested, so
//      it counts toward nobody's lockout;
//   2. the account is enrolled, not disabled and not locked out;
//   3. the password matches (argon2id + pepper); else the failure counts, and the 5th consecutive
//      one (login and signing together) writes 'lockout' and alerts QA and the Admin;
//   4. the code matches a step within ±1, and that step was never accepted for this person;
//      a used step is "wait for the next code", which does not count;
//   5. success resets the count.

import type { Brand, PersonId, SessionId } from '@lims/domain/ids';
import { refuse, type Refusal } from '@lims/domain/refusal';
import type { Credentials } from '@lims/contract';
import type { ActorContext, LockedSession } from '../actor.ts';
import type { CommandTx, Detail } from '../commit.ts';
import { verifyPassword } from './password.ts';
import { decryptSecret, matchTotp } from './totp.ts';

export const LOCKOUT_AFTER = 5;

/**
 * Proof that the person just re-authenticated in full. Only this module constructs one, and
 * Records.sign demands it, so no code path signs without full re-authentication.
 */
export type ReauthenticatedSigner = Brand<{
  readonly person: PersonId;
  readonly printedName: string;
  readonly username: string;
  readonly role: string;
  readonly authenticator: 'totp';
  readonly session: SessionId;
}, 'ReauthenticatedSigner'>;

export type Purpose = 'login' | 'signing' | 'unlock' | 'takeover';

type Account = { person: PersonId; printedName: string; username: string; passwordHash: string | null; totpSecretEnc: Buffer | null; disabledAt: Date | null };

/** The enrolled person a user ID names, or null. Never reveals which part is missing. */
export async function findAccount(tx: CommandTx, username: string): Promise<Account | null> {
  const row = await tx.db.selectFrom('account').innerJoin('person', 'person.id', 'account.person_id')
    .select(['account.person_id', 'person.printed_name', 'account.username', 'account.password_hash', 'account.totp_secret_enc', 'account.disabled_at'])
    .where('account.username', '=', username).executeTakeFirst();
  return row
    ? { person: row.person_id as PersonId, printedName: row.printed_name, username: row.username, passwordHash: row.password_hash, totpSecretEnc: row.totp_secret_enc, disabledAt: row.disabled_at }
    : null;
}

async function lockoutOf(tx: CommandTx, person: PersonId): Promise<{ failures: number; lockedOut: boolean }> {
  const r = await tx.db.selectFrom('lockout_state').select(['consecutive_failures', 'locked_out']).where('person_id', '=', person).executeTakeFirst();
  return { failures: Number(r?.consecutive_failures ?? 0), lockedOut: r?.locked_out ?? false };
}

/**
 * Checks a named account's password and code. Writes every failure to the access log as it goes;
 * the caller writes the success event, because only it knows the session the success opens or
 * the signature it makes.
 */
export async function checkCredentials(tx: CommandTx, account: Account, creds: Credentials, purpose: Purpose, session: SessionId | null): Promise<Refusal | null> {
  const failKind = purpose === 'login' || purpose === 'takeover' ? 'login_fail' : 'signing_fail';
  const event = (kind: string, counts: boolean, detail: Detail = {}) =>
    tx.survive({ table: 'auth_event', row: { person_id: account.person, typed_user: creds.typedUserId, session_id: session, kind, counts_toward_lockout: counts, detail: { purpose, ...detail } } });

  const before = await lockoutOf(tx, account.person);
  if (before.lockedOut) {
    await event(failKind, false, { why: 'locked-out' });
    return refuse.lockedOut();
  }
  const fail = async (why: string): Promise<Refusal> => {
    await event(failKind, true, { why });
    const failures = before.failures + 1;
    if (failures >= LOCKOUT_AFTER) {
      await event('lockout', false, { failures });
      await tx.survive({ table: 'alert', row: { kind: 'lockout', person_id: account.person, session_id: session, detail: { username: account.username, purpose } } });
      return refuse.lockedOut();
    }
    return refuse.credentials(LOCKOUT_AFTER - failures);
  };
  if (!account.passwordHash || !account.totpSecretEnc || account.disabledAt) return fail(account.disabledAt ? 'disabled' : 'not-enrolled');
  if (!(await verifyPassword(tx.deps.pepper, account.passwordHash, creds.password))) return fail('password');
  const step = matchTotp(decryptSecret(tx.deps.totpKey, account.totpSecretEnc), creds.totp, tx.dbNow);
  if (step === null) return fail('code');
  const fresh = await tx.surviveOnce({ table: 'totp_step_used', row: { person_id: account.person, step, purpose } });
  if (!fresh) {
    await event(failKind, false, { why: 'code-used' });
    return refuse.totpAlreadyUsed();
  }
  return null;
}

/** The session's own person re-authenticating, for a signature or an unlock. */
export async function reauthenticate(
  tx: CommandTx,
  owner: Pick<LockedSession, 'person' | 'username' | 'session'> | Extract<ActorContext, { kind: 'staff' | 'admin' | 'customer' }>,
  role: string,
  creds: Credentials,
  purpose: 'signing' | 'unlock',
): Promise<ReauthenticatedSigner | Refusal> {
  if (creds.typedUserId !== owner.username) {
    await tx.survive({ table: 'auth_event', row: { person_id: owner.person, typed_user: creds.typedUserId, session_id: owner.session, kind: 'wrong_user_at_signing', counts_toward_lockout: false, detail: { purpose } } });
    await tx.survive({ table: 'alert', row: { kind: 'wrong-user-at-signing', person_id: owner.person, session_id: owner.session, detail: { typedUser: creds.typedUserId, purpose } } });
    return refuse.wrongUser();
  }
  const account = await findAccount(tx, owner.username);
  if (!account) return refuse.credentials(LOCKOUT_AFTER - 1);
  const refused = await checkCredentials(tx, account, creds, purpose, owner.session);
  if (refused) return refused;
  if (purpose === 'signing') {
    await tx.db.insertInto('auth_event').values({ person_id: account.person, typed_user: creds.typedUserId, session_id: owner.session, kind: 'signing_ok', counts_toward_lockout: false }).execute();
  }
  return { person: account.person, printedName: account.printedName, username: account.username, role, authenticator: 'totp', session: owner.session } as ReauthenticatedSigner;
}
