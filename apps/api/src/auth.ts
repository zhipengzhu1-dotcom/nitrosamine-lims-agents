import { createHash, createHmac, randomBytes } from 'node:crypto';
import { type AuditContext, audited, type DB, type Role, type SignInFailure } from '@lims/db';
import { hashPassword, verifyPassword } from '@lims/db/credentials';
import { type ActorContext, routes } from '@lims/domain';
import { type Insertable, type Kysely, sql, type Transaction } from 'kysely';
import type { App } from './app.ts';
import { refuse } from './refuse.ts';

export const LOCKOUT_AFTER_FAILURES = 20;
export const IDLE_LIMIT_MS = 8 * 60 * 60_000;
export const ABSOLUTE_LIMIT_MS = 12 * 60 * 60_000;
export const SESSION_COOKIE = 'lims_session';

type AccessEvent = Insertable<DB['accessEvent']>;
export interface SessionKey {
  labId: string;
  id: string;
}
export interface SignedIn {
  actor: ActorContext;
  session: SessionKey;
}

const SIGN_IN_SERVICE: AuditContext = { actor: 'svc:sign-in', role: 'system', reason: 'Sign in' };

const TIMING_DECOY_HASH = await hashPassword(randomBytes(16).toString('base64url'));

const hashToken = (token: string) => createHash('sha256').update(token).digest();
const notValid = () => refuse('badCredentials', 'the credentials are not valid');

const REFUSAL: { readonly [F in SignInFailure]: () => never } = {
  UnknownUserId: notValid,
  WrongPassword: notValid,
  WrongPasswordOnLockedAccount: notValid,
  AccountLocked: () => refuse('accountLocked', 'this account is locked'),
  NoLab: () => refuse('role', 'this account belongs to no Lab'),
};

const record = (tx: Transaction<DB>, event: AccessEvent) => tx.insertInto('accessEvent').values(event).execute();

async function rolesIn(db: Kysely<DB>, personId: string, labId: string): Promise<Role[]> {
  const rows = await db
    .selectFrom('membership')
    .select('role')
    .where('labId', '=', labId)
    .where('personId', '=', personId)
    .execute();
  return rows.map((r) => r.role);
}

async function lowestIdMembershipLab(db: Kysely<DB>, personId: string): Promise<string | undefined> {
  const membership = await db
    .selectFrom('membership')
    .select('labId')
    .where('personId', '=', personId)
    .orderBy('labId')
    .executeTakeFirst();
  return membership?.labId;
}

async function countFailure(tx: Transaction<DB>, personId: string) {
  return tx
    .updateTable('person')
    .set({
      failedLogins: sql`failed_logins + 1`,
      lockedAt: sql`coalesce(locked_at, case when failed_logins + 1 >= ${LOCKOUT_AFTER_FAILURES} then clock_timestamp() end)`,
    })
    .where('id', '=', personId)
    .returning([
      sql<boolean>`old.locked_at is not null`.as('wasLocked'),
      sql<boolean>`old.locked_at is null and new.locked_at is not null`.as('lockedNow'),
    ])
    .executeTakeFirstOrThrow();
}

/** Proves the signer before a Signature is written: a wrong password refuses as badCredentials, counts toward lockout, and a lockout it applies is an Access Event. */
export async function reauthenticate(
  db: Kysely<DB>,
  { actor, session }: SignedIn,
  password: string,
  step: string,
  role: Role,
  sourceAddress: string,
): Promise<void> {
  const person = await db.selectFrom('person').selectAll().where('id', '=', actor.person.id).executeTakeFirstOrThrow();
  const as = (reason: string) => ({ actor: `person:${person.username}`, role, reason });
  if (await verifyPassword(password, person.passwordHash)) {
    if (person.lockedAt) refuse('accountLocked', 'this account is locked');
    if (person.failedLogins > 0)
      await audited(db, as(`Re-authenticate to sign ${step}`), (tx) =>
        tx.updateTable('person').set({ failedLogins: 0 }).where('id', '=', person.id).execute(),
      );
    return;
  }
  await audited(db, as('Failed authentication'), async (tx) => {
    const { lockedNow } = await countFailure(tx, person.id);
    if (lockedNow)
      await record(tx, {
        kind: 'Lockout',
        subjectId: person.id,
        roles: actor.roles,
        sourceAddress,
        sessionLabId: session.labId,
        sessionId: session.id,
      });
  });
  notValid();
}

/** Builds the ActorContext from the session cookie. Reads the session tables directly: no context exists yet to scope by. */
export async function actorFor(db: Kysely<DB>, token: string | undefined): Promise<SignedIn> {
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
  return {
    actor: {
      person: {
        id: session.personId,
        username: session.username,
        displayName: session.displayName,
        customerId: session.customerId,
      },
      lab: { id: session.labId, code: session.code, name: session.name },
      roles: await rolesIn(db, session.personId, session.labId),
    },
    session: { labId: session.labId, id: session.id },
  };
}

function typedUserIdDigest(key: Buffer, typed: string) {
  return { typedUserIdHmac: createHmac('sha256', key).update(typed).digest(), typedUserIdLength: typed.length };
}

/** Signs a person in. Every attempt, refused or not, writes its Access Event in a transaction of its own that commits. */
export function loginRoutes(app: App, db: Kysely<DB>, accessEventKey: Buffer): void {
  app.route({
    ...routes.login,
    handler: async (req, reply) => {
      const { username, password } = req.body;
      const sourceAddress = req.ip;
      const person = await db.selectFrom('person').selectAll().where('username', '=', username).executeTakeFirst();
      if (!person) {
        await verifyPassword(password, TIMING_DECOY_HASH);
        await audited(db, SIGN_IN_SERVICE, (tx) =>
          record(tx, {
            kind: 'SignInFailed',
            failureReason: 'UnknownUserId',
            ...typedUserIdDigest(accessEventKey, username),
            roles: [],
            sourceAddress,
          }),
        );
        return notValid();
      }

      const proven = await verifyPassword(password, person.passwordHash);
      const labId = await lowestIdMembershipLab(db, person.id);
      const roles: Role[] = labId ? await rolesIn(db, person.id, labId) : person.customerId ? ['Customer'] : [];
      const subject = { subjectId: person.id, roles, sourceAddress };

      if (!proven || person.lockedAt || !labId) {
        const failure = await audited(db, SIGN_IN_SERVICE, async (tx): Promise<SignInFailure> => {
          if (proven) {
            const reason = person.lockedAt ? 'AccountLocked' : 'NoLab';
            await record(tx, { kind: 'SignInFailed', failureReason: reason, ...subject });
            return reason;
          }
          const { wasLocked, lockedNow } = await countFailure(tx, person.id);
          const reason = wasLocked ? 'WrongPasswordOnLockedAccount' : 'WrongPassword';
          await record(tx, { kind: 'SignInFailed', failureReason: reason, ...subject });
          if (lockedNow) await record(tx, { kind: 'Lockout', ...subject });
          return reason;
        });
        return REFUSAL[failure]();
      }

      const token = randomBytes(32).toString('base64url');
      await audited(db, SIGN_IN_SERVICE, async (tx) => {
        if (person.failedLogins > 0)
          await tx
            .updateTable('person')
            .set({ failedLogins: 0 })
            .where('id', '=', person.id)
            .where('lockedAt', 'is', null)
            .execute();
        const session = await tx
          .insertInto('session')
          .values({ labId, personId: person.id, tokenHash: hashToken(token) })
          .returning('id')
          .executeTakeFirstOrThrow();
        await record(tx, { kind: 'SignInSucceeded', ...subject, sessionLabId: labId, sessionId: session.id });
      });
      reply.setCookie(SESSION_COOKIE, token);
      return (await actorFor(db, token)).actor;
    },
  });
}

/** Ends the request's session and writes its sign-out Access Event, under the person who signs out. */
export function logoutRoute(app: App, db: Kysely<DB>): void {
  app.route({
    ...routes.logout,
    handler: async (req, reply) => {
      const { actor, session } = req;
      const as = { actor: `person:${actor.person.username}`, role: actor.roles.join(', '), reason: 'Sign out' };
      await audited(db, as, async (tx) => {
        await tx
          .updateTable('session')
          .set({ endedAt: sql`now()` })
          .where('labId', '=', session.labId)
          .where('id', '=', session.id)
          .execute();
        await record(tx, {
          kind: 'SignOut',
          subjectId: actor.person.id,
          roles: actor.roles,
          sourceAddress: req.ip,
          sessionLabId: session.labId,
          sessionId: session.id,
        });
      });
      reply.clearCookie(SESSION_COOKIE);
      return { ended: true } as const;
    },
  });
}
