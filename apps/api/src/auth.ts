import { createHash, randomBytes } from 'node:crypto';
import { audited, type DB } from '@lims/db';
import { verifyPassword } from '@lims/db/credentials';
import { type ActorContext, routes } from '@lims/domain';
import { type Kysely, type Selectable, sql } from 'kysely';
import type { App } from './app.ts';
import { refuse } from './scope.ts';

export const LOCKOUT_AFTER_FAILURES = 20;
export const IDLE_LIMIT_MS = 8 * 60 * 60_000;
export const ABSOLUTE_LIMIT_MS = 12 * 60 * 60_000;
export const SESSION_COOKIE = 'lims_session';

type Person = Selectable<DB['person']>;

const hashToken = (token: string) => createHash('sha256').update(token).digest();
const authAudit = (person: Person, reason: string) => ({
  actor: `person:${person.username}`,
  role: 'authentication',
  reason,
});
const notValid = () => refuse('badCredentials', 'the credentials are not valid');

/** Checks the password. A failure counts toward lockout and a success clears the count. */
async function prove(db: Kysely<DB>, person: Person, password: string, reason: string): Promise<void> {
  if (person.lockedAt) refuse('accountLocked', 'this account is locked');
  if (await verifyPassword(password, person.passwordHash)) {
    if (person.failedLogins > 0) {
      await audited(db, authAudit(person, reason), (tx) =>
        tx.updateTable('person').set({ failedLogins: 0 }).where('id', '=', person.id).execute(),
      );
    }
    return;
  }
  await audited(db, authAudit(person, 'Failed authentication'), (tx) =>
    tx
      .updateTable('person')
      .set({
        failedLogins: sql`failed_logins + 1`,
        lockedAt: sql`case when failed_logins + 1 >= ${LOCKOUT_AFTER_FAILURES} then clock_timestamp() end`,
      })
      .where('id', '=', person.id)
      .execute(),
  );
  notValid();
}

/** Proves the signer before a Signature is written: a wrong password refuses as badCredentials and counts toward lockout. */
export async function reauthenticate(db: Kysely<DB>, ctx: ActorContext, password: string, step: string): Promise<void> {
  const person = await db.selectFrom('person').selectAll().where('id', '=', ctx.person.id).executeTakeFirstOrThrow();
  await prove(db, person, password, `Re-authenticate to sign ${step}`);
}

/** Builds the ActorContext from the session cookie. Reads the session tables directly: no context exists yet to scope by. */
export async function actorFor(db: Kysely<DB>, token: string | undefined): Promise<ActorContext> {
  const session =
    token &&
    (await db
      .selectFrom('session')
      .innerJoin('person', 'person.id', 'session.personId')
      .innerJoin('lab', 'lab.labId', 'session.labId')
      .select([
        'session.id',
        sql<boolean>`person.locked_at is not null
          or session.last_seen_at < now() - ${IDLE_LIMIT_MS} * interval '1 millisecond'
          or session.created_at < now() - ${ABSOLUTE_LIMIT_MS} * interval '1 millisecond'`.as('expired'),
        'person.id as personId',
        'person.username',
        'person.displayName',
        'person.customerId',
        'lab.labId',
        'lab.code',
        'lab.name',
      ])
      .where('tokenHash', '=', hashToken(token))
      .where('endedAt', 'is', null)
      .executeTakeFirst());
  if (!session) return refuse('noSession', 'sign in first');
  if (session.expired) {
    await db.updateTable('session').set({ endedAt: sql`now()` }).where('id', '=', session.id).execute();
    refuse('noSession', 'the session has ended; sign in again');
  }
  await db.updateTable('session').set({ lastSeenAt: sql`now()` }).where('id', '=', session.id).execute();
  const roles = await db
    .selectFrom('membership')
    .select('role')
    .where('labId', '=', session.labId)
    .where('personId', '=', session.personId)
    .execute();
  return {
    person: {
      id: session.personId,
      username: session.username,
      displayName: session.displayName,
      customerId: session.customerId,
    },
    lab: { id: session.labId, code: session.code, name: session.name },
    roles: roles.map((r) => r.role),
  };
}

export function loginRoutes(app: App, db: Kysely<DB>): void {
  app.route({
    ...routes.login,
    handler: async (req, reply) => {
      const person = await db
        .selectFrom('person')
        .selectAll()
        .where('username', '=', req.body.username)
        .executeTakeFirst();
      if (!person) return notValid();
      await prove(db, person, req.body.password, 'Sign in');
      const membership =
        (await db
          .selectFrom('membership')
          .select('labId')
          .where('personId', '=', person.id)
          .orderBy('labId')
          .executeTakeFirst()) ?? refuse('role', 'this account belongs to no Lab');
      const token = randomBytes(32).toString('base64url');
      await db
        .insertInto('session')
        .values({ labId: membership.labId, personId: person.id, tokenHash: hashToken(token) })
        .execute();
      reply.setCookie(SESSION_COOKIE, token);
      return actorFor(db, token);
    },
  });
}

export function logoutRoute(app: App, db: Kysely<DB>): void {
  app.route({
    ...routes.logout,
    handler: async (req, reply) => {
      const token = req.cookies[SESSION_COOKIE];
      if (token !== undefined)
        await db
          .updateTable('session')
          .set({ endedAt: sql`now()` })
          .where('tokenHash', '=', hashToken(token))
          .execute();
      reply.clearCookie(SESSION_COOKIE);
      return { ended: true } as const;
    },
  });
}
