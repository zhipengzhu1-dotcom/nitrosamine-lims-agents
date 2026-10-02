import { createHash, randomBytes } from 'node:crypto';
import type { DB } from '@lims/db';
import { type ActorContext, routes } from '@lims/domain';
import { type Kysely, sql } from 'kysely';
import type { App } from './app.ts';
import { refuse } from './refuse.ts';
import { labScope, type Scope } from './scope.ts';

export const DEVICE_COOKIE = 'lims_device';
/** Chrome caps a cookie's expiry at 400 days; enrolling the browser again replaces its token. */
const DEVICE_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

export interface Device {
  labId: string;
  id: string;
}

const hashDeviceToken = (token: string) => createHash('sha256').update(token).digest();

/** The Workstation a browser's device token enrols it as, or undefined for an unregistered device. */
export async function deviceOf(db: Kysely<DB>, token: string | undefined): Promise<Device | undefined> {
  if (!token) return undefined;
  return db
    .selectFrom('workstation')
    .select(['labId', 'id'])
    .where('deviceTokenHash', '=', hashDeviceToken(token))
    .executeTakeFirst();
}

const listed = (scope: Scope) =>
  scope
    .from('workstation')
    .innerJoin('room', (join) =>
      join.onRef('room.labId', '=', 'workstation.labId').onRef('room.id', '=', 'workstation.roomId'),
    )
    .select([
      'workstation.id',
      'workstation.name',
      'room.name as room',
      'workstation.browserPolicy',
      sql<boolean>`workstation.device_token_hash is not null`.as('enrolled'),
    ]);

/** Registers Rooms, and registers, lists and enrols Workstations, in the Admin's Lab. The device token leaves the API only as the cookie, and is stored only as its hash. */
export function workstationRoutes(app: App, db: Kysely<DB>): void {
  const asAdmin = (actor: ActorContext) => {
    if (!actor.roles.includes('Admin'))
      refuse('role', 'registering Rooms and Workstations and enrolling browsers is an Admin action');
    return labScope(db, actor);
  };
  const one = (scope: Scope, id: string) => listed(scope).where('workstation.id', '=', id).executeTakeFirstOrThrow();

  app.route({
    ...routes.workstations,
    handler: async (req) => {
      const scope = asAdmin(req.actor);
      return {
        rooms: await scope.from('room').select(['id', 'name']).orderBy('name').execute(),
        workstations: await listed(scope).orderBy('workstation.name').execute(),
      };
    },
  });

  app.route({
    ...routes.registerRoom,
    handler: async (req) => {
      const scope = asAdmin(req.actor);
      const { name, reason } = req.body;
      if (await scope.from('room').select('id').where('name', '=', name).executeTakeFirst())
        refuse('guard', `a Room named ${name} is already registered in this Lab`);
      return scope.write(reason, 'Admin', (q) =>
        q.insert('room', { name }).returning(['id', 'name']).executeTakeFirstOrThrow(),
      );
    },
  });

  app.route({
    ...routes.registerWorkstation,
    handler: async (req) => {
      const scope = asAdmin(req.actor);
      const { name, roomId, browserPolicy, reason } = req.body;
      if (!(await scope.from('room').select('id').where('id', '=', roomId).executeTakeFirst()))
        refuse('notFound', 'no such Room in this Lab');
      if (await scope.from('workstation').select('id').where('name', '=', name).executeTakeFirst())
        refuse('guard', `a Workstation named ${name} is already registered in this Lab`);
      const { id } = await scope.write(reason, 'Admin', (q) =>
        q.insert('workstation', { name, roomId, browserPolicy }).returning('id').executeTakeFirstOrThrow(),
      );
      return one(scope, id);
    },
  });

  app.route({
    ...routes.enrolWorkstation,
    handler: async (req, reply) => {
      const scope = asAdmin(req.actor);
      const { workstationId, reason } = req.body;
      const token = randomBytes(32).toString('base64url');
      await scope.write(reason, 'Admin', async (q) => {
        const enrolled = await q
          .update('workstation')
          .set({ deviceTokenHash: hashDeviceToken(token) })
          .where('id', '=', workstationId)
          .executeTakeFirst();
        if (!enrolled.numUpdatedRows) refuse('notFound', 'no such Workstation in this Lab');
      });
      reply.setCookie(DEVICE_COOKIE, token, { maxAge: DEVICE_COOKIE_MAX_AGE_S });
      return one(scope, workstationId);
    },
  });
}
