import { audited, type DB } from '@lims/db';
import { verifyPassword } from '@lims/db/credentials';
import { routes } from '@lims/domain';
import type { Kysely } from 'kysely';
import type { App } from './app.ts';
import {
  asOwnAccount,
  browserSession,
  type Credentials,
  credentialsNotValid,
  record,
  recordWrongCredential,
  SESSION_COOKIE,
  SIGN_IN_SERVICE,
  sourceAddressOf,
  TIMING_DECOY_HASH,
} from './auth.ts';
import { refuse } from './refuse.ts';
import { base32, newTotpSecret, otpauthUri, sealSecret } from './totp.ts';

/**
 * Enrolment proves the person by their own password and needs no session. A browser where someone else is signed in,
 * such as the Admin who created the account, is refused. The secret is shown once: a second enrolment shows nothing.
 */
export function enrolmentRoute(app: App, db: Kysely<DB>, credentials: Credentials): void {
  const { policy: limits, pepper } = credentials;
  const notValid = () => refuse('badCredentials', credentialsNotValid(limits, 'userId'));
  app.route({
    ...routes.enrolAuthenticator,
    handler: async (req) => {
      const { username, password } = req.body;
      const sourceAddress = sourceAddressOf(req);
      const person = await db.selectFrom('person').selectAll().where('username', '=', username).executeTakeFirst();
      const signedIn = await browserSession(db, req.cookies[SESSION_COOKIE]);
      if (signedIn && signedIn.personId !== person?.id)
        refuse(
          'guard',
          'Sign out first. Only the holder of an account enrols its authenticator, in a browser where no one else is signed in.',
        );
      const proven = await verifyPassword(password, person?.passwordHash ?? TIMING_DECOY_HASH, pepper);
      if (!person || !person.passwordHash || !proven || person.lockedAt) {
        if (person?.passwordHash && !proven)
          await audited(db, SIGN_IN_SERVICE, (tx) =>
            recordWrongCredential(
              tx,
              'SignInFailed',
              { subjectId: person.id, roles: [], sourceAddress },
              'WrongPassword',
              limits.lockoutAfter,
            ),
          );
        return notValid();
      }
      const secret = newTotpSecret();
      const enrolled = await audited(db, asOwnAccount(username, 'Enrol an authenticator'), async (tx) => {
        const added = await tx
          .insertInto('authenticator')
          .values({ personId: person.id, secretCiphertext: sealSecret(credentials.totpKey, secret) })
          .onConflict((oc) => oc.column('personId').doNothing())
          .executeTakeFirst();
        if (!added.numInsertedOrUpdatedRows) return false;
        await record(tx, { kind: 'AuthenticatorEnrolled', subjectId: person.id, roles: [], sourceAddress });
        return true;
      });
      if (!enrolled) refuse('state', 'This account already has an authenticator enrolled.');
      return { secret: base32(secret), otpauth: otpauthUri(username, secret) };
    },
  });
}
