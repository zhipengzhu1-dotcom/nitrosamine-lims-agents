import { audited, type DB, type SignInFailure } from '@lims/db';
import { routes } from '@lims/domain';
import type { Kysely } from 'kysely';
import type { App } from './app.ts';
import {
  asOwnAccount,
  browserSession,
  type Credentials,
  proves,
  record,
  recordWrongCredential,
  refusalsUnder,
  SESSION_COOKIE,
  SIGN_IN_SERVICE,
  sourceAddressOf,
  TIMING_DECOY_HASH,
  typedUserIdDigest,
} from './auth.ts';
import { base32, newTotpSecret, otpauthUri, sealSecret } from './totp.ts';

/**
 * Enrolment proves the person by their own password and needs no session. A browser where someone else is signed in,
 * such as the Admin who created the account, is refused first, whatever was typed. The secret is shown once: every
 * other outcome, a second enrolment among them, is the uniform credential refusal, so the password alone learns
 * nothing, and each refusal is a failed sign-in Access Event; only a wrong password counts toward the lockout.
 */
export function enrolmentRoute(app: App, db: Kysely<DB>, accessEventKey: Buffer, credentials: Credentials): void {
  const { policy: limits } = credentials;
  const REFUSAL = refusalsUnder(limits);
  app.route({
    ...routes.enrolAuthenticator,
    handler: async (req) => {
      const { username, password } = req.body;
      const sourceAddress = sourceAddressOf(req);
      const person = await db.selectFrom('person').selectAll().where('username', '=', username).executeTakeFirst();
      const subject = person
        ? { subjectId: person.id, roles: [], sourceAddress }
        : { ...typedUserIdDigest(accessEventKey, username), roles: [], sourceAddress };
      const failed = async (failureReason: SignInFailure, refusal = REFUSAL[failureReason]) => {
        await audited(db, SIGN_IN_SERVICE, (tx) => record(tx, { kind: 'SignInFailed', failureReason, ...subject }));
        return refusal();
      };
      const signedIn = await browserSession(db, req.cookies[SESSION_COOKIE]);
      // The guard answers for every user ID, known or not, so the signed-in browser learns nothing about which exist.
      if (signedIn && signedIn.personId !== person?.id)
        return failed(person ? 'OtherPersonSignedIn' : 'UnknownUserId', REFUSAL.OtherPersonSignedIn);
      const proven = await proves(credentials, password, person?.passwordHash ?? TIMING_DECOY_HASH);
      if (!person) return failed('UnknownUserId');
      if (!person.passwordHash) return failed('NoCredential');
      const own = { subjectId: person.id, roles: [], sourceAddress };
      if (!proven) {
        const failure = await audited(db, SIGN_IN_SERVICE, (tx) =>
          recordWrongCredential(tx, 'SignInFailed', own, 'WrongPassword', limits.lockoutAfter),
        );
        return REFUSAL[failure]();
      }
      const secret = newTotpSecret();
      const refused = await audited(db, asOwnAccount(username, 'Enrol an authenticator'), async (tx) => {
        // The lock is read under the person's row lock, so a Lockout lands wholly before the enrolment, which it then
        // refuses, or wholly after it. A lock is told only to a sign-in that proves the code too; a password alone
        // learns the uniform sentence.
        const { lockedAt } = await tx
          .selectFrom('person')
          .select('lockedAt')
          .where('id', '=', person.id)
          .forNoKeyUpdate()
          .executeTakeFirstOrThrow();
        if (lockedAt) {
          await record(tx, { kind: 'SignInFailed', failureReason: 'AccountLocked', ...own });
          return REFUSAL.WrongPassword;
        }
        const added = await tx
          .insertInto('authenticator')
          .values({ personId: person.id, secretCiphertext: sealSecret(credentials.totpKey, secret) })
          .onConflict((oc) => oc.column('personId').doNothing())
          .executeTakeFirst();
        if (!added.numInsertedOrUpdatedRows) {
          await record(tx, { kind: 'SignInFailed', failureReason: 'AlreadyEnrolled', ...own });
          return REFUSAL.AlreadyEnrolled;
        }
        await record(tx, { kind: 'AuthenticatorEnrolled', ...own });
        return null;
      });
      if (refused) return refused();
      return { secret: base32(secret), otpauth: otpauthUri(username, secret) };
    },
  });
}
