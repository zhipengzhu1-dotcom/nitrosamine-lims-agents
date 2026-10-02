import { audited, type DB } from '@lims/db';
import { routes } from '@lims/domain';
import type { Kysely } from 'kysely';
import type { App } from './app.ts';
import { asOwnAccount } from './auth.ts';

/** A person sets only their own preferences, under no role of the Lab, and the Audit Trail records each change under them. */
export function preferenceRoutes(app: App, db: Kysely<DB>): void {
  app.route({
    ...routes.setPreferences,
    handler: async (req) => {
      const { person } = req.actor;
      const { reducedMotion } = req.body;
      // Setting the value the person already has writes nothing, so the Audit Trail holds only changes.
      return audited(db, asOwnAccount(person.username, 'Set my reduced-motion preference'), async (tx) => {
        await tx
          .updateTable('person')
          .set({ reducedMotion })
          .where('id', '=', person.id)
          .where('reducedMotion', 'is distinct from', reducedMotion)
          .execute();
        return tx.selectFrom('person').select('reducedMotion').where('id', '=', person.id).executeTakeFirstOrThrow();
      });
    },
  });
}
