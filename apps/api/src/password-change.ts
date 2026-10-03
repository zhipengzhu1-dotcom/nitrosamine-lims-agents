import type { DB } from '@lims/db';
import { hashPassword } from '@lims/db/credentials';
import { passwordRefusal, routes } from '@lims/domain';
import { type Kysely, sql } from 'kysely';
import type { App } from './app.ts';
import {
  asOwnAccount,
  auditedAfterReauthentication,
  type Credentials,
  reauthenticate,
  sourceAddressOf,
} from './auth.ts';
import { refuse } from './refuse.ts';

/**
 * A signed-in person changes their own password: the new one must meet the password rule, checked before the current
 * password and code are spent, and the current ones prove the person as a signing does, so a wrong one counts toward
 * the lockout. lims.change_password writes the PasswordChanged Access Event with the new hash.
 */
export function passwordChangeRoute(app: App, db: Kysely<DB>, credentials: Credentials): void {
  app.route({
    ...routes.changePassword,
    handler: async (req) => {
      const { password, code, newPassword } = req.body;
      const weak = passwordRefusal(credentials.policy.password, newPassword);
      if (weak) refuse('malformed', weak);
      const sourceAddress = sourceAddressOf(req);
      const reauthenticated = await reauthenticate(
        db,
        credentials,
        { actor: req.actor, session: req.sessionKey },
        { password, code },
        'none',
        sourceAddress,
        'ReauthenticationFailed',
      );
      const passwordHash = await hashPassword(newPassword, credentials.pepper);
      const { labId, id } = req.sessionKey;
      await auditedAfterReauthentication(
        db,
        asOwnAccount(req.actor.person.username, 'Change password'),
        reauthenticated,
        (tx) => sql`select lims.change_password(${labId}, ${id}, ${passwordHash}, ${sourceAddress})`.execute(tx),
      );
      return { changed: true } as const;
    },
  });
}
