import { audited, type DB } from '@lims/db';
import { routes } from '@lims/domain';
import type { Kysely } from 'kysely';
import type { App } from './app.ts';
import { NEEDS_NO_ROLE } from './auth.ts';

/** A person sets only their own preferences, under no role of the Lab, and the Audit Trail records each change under them. */
export function preferenceRoutes(app: App, db: Kysely<DB>): void {
  app.route({
    ...routes.setPreferences,
    handler: async (req) => {
      const { person } = req.actor;
      const { reducedMotion } = req.body;
      const as = {
        actor: `person:${person.username}`,
        role: NEEDS_NO_ROLE,
        reason: 'Set my reduced-motion preference',
      };
      // Setting the value the person already has writes nothing, so the Audit Trail holds only changes.
      await audited(db, as, (tx) =>
        tx
          .updateTable('person')
          .set({ reducedMotion })
          .where('id', '=', person.id)
          .where('reducedMotion', 'is distinct from', reducedMotion)
          .execute(),
      );
      return { reducedMotion };
    },
  });
}
