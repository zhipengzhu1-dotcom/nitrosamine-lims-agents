import { createHash, createHmac, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import { type AuditContext, audited, type DB, type Role, type SignInFailure } from '@lims/db';
import { hashPassword, verifyPassword } from '@lims/db/credentials';
import { type ActorContext, routes } from '@lims/domain';
import { type Insertable, type Kysely, sql, type Transaction } from 'kysely';
import type { App } from './app.ts';
import { refuse } from './refuse.ts';
import { DEVICE_COOKIE, deviceOf } from './workstations.ts';

export const LOCKOUT_AFTER_FAILURES = 20;
export const IDLE_LIMIT_MS = 8 * 60 * 60_000;
export const ABSOLUTE_LIMIT_MS = 12 * 60 * 60_000;
export const SESSION_COOKIE = 'lims_session';

type AccessEvent = Insertable<DB['accessEvent']>;
export interface SessionKey {
  labId: string;
  id: string;
  workstationId: string | null;
}
export interface SignedIn {
  actor: ActorContext;
  session: SessionKey;
}

const SIGN_IN_SERVICE: AuditContext = { actor: 'svc:sign-in', role: 'system', reason: 'Sign in' };

const TIMING_DECOY_HASH = await hashPassword(randomBytes(16).toString('base64url'));

/** Signing out, locking and unlocking act on the person's own session, under no role of the Lab. */
const NO_ROLE = 'none' as const;

const hashToken = (token: string) => createHash('sha256').update(token).digest();
const notValid = () => refuse('badCredentials', 'the credentials are not valid');

const REFUSAL: { readonly [F in SignInFailure]: () => never } = {
  UnknownUserId: notValid,
  WrongPassword: notValid,
  WrongPasswordOnLockedAccount: notValid,
  AccountLocked: () => refuse('accountLocked', 'this account is locked'),
  NoLab: () => refuse('role', 'this account belongs to no Lab'),
  NotInWorkstationLab: () => refuse('role', "this account belongs to no role in this Workstation's Lab"),
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

/**
 * Proves the person of the session again, to sign or to unlock: a wrong password refuses as badCredentials, counts
 * toward lockout, and writes `failureEvent` when given; a lockout it applies is an Access Event.
 */
export async function reauthenticate(
  db: Kysely<DB>,
  { actor, session }: SignedIn,
  password: string,
  purpose: string,
  role: Role | typeof NO_ROLE,
  sourceAddress: string,
  failureEvent?: 'UnlockFailed',
): Promise<void> {
  const person = await db.selectFrom('person').selectAll().where('id', '=', actor.person.id).executeTakeFirstOrThrow();
  const as = (reason: string) => ({ actor: `person:${person.username}`, role, reason });
  if (await verifyPassword(password, person.passwordHash)) {
    if (person.lockedAt) refuse('accountLocked', 'this account is locked');
    if (person.failedLogins > 0)
      await audited(db, as(purpose), (tx) =>
        tx.updateTable('person').set({ failedLogins: 0 }).where('id', '=', person.id).execute(),
      );
    return;
  }
  await audited(db, as('Failed authentication'), async (tx) => {
    const { lockedNow } = await countFailure(tx, person.id);
    const event = {
      subjectId: person.id,
      roles: actor.roles,
      sourceAddress,
      sessionLabId: session.labId,
      sessionId: session.id,
      workstationId: session.workstationId,
    };
    if (failureEvent) await record(tx, { kind: failureEvent, ...event });
    if (lockedNow) await record(tx, { kind: 'Lockout', ...event });
  });
  notValid();
}

const lockedMessage = (displayName: string) =>
  `this screen is locked; ${displayName} unlocks it with their password, or another person signs in with Switch user`;

/** A session past its idle or absolute limit, or whose person's account is locked, has ended even before the sweep reaches it. */
const expired = sql<boolean>`person.locked_at is not null
  or session.last_seen_at < now() - ${IDLE_LIMIT_MS} * interval '1 millisecond'
  or session.created_at < now() - ${ABSOLUTE_LIMIT_MS} * interval '1 millisecond'`.as('expired');

/**
 * Builds the ActorContext from the session cookie. Reads the session tables directly: no context exists yet to scope by.
 * A locked session is refused as sessionLocked, with no record content, unless `whileLocked` serves the lock screen.
 */
export async function actorFor(
  db: Kysely<DB>,
  token: string | undefined,
  { whileLocked = false } = {},
): Promise<SignedIn> {
  const session =
    token &&
    (await db
      .selectFrom('session')
      .innerJoin('person', 'person.id', 'session.personId')
      .innerJoin('lab', 'lab.labId', 'session.labId')
      .leftJoin('workstation', (join) =>
        join.onRef('workstation.labId', '=', 'session.labId').onRef('workstation.id', '=', 'session.workstationId'),
      )
      .leftJoin('room', (join) =>
        join.onRef('room.labId', '=', 'workstation.labId').onRef('room.id', '=', 'workstation.roomId'),
      )
      .select([
        'session.id',
        'session.workstationId',
        sql<boolean>`session.locked_at is not null`.as('locked'),
        expired,
        'person.id as personId',
        'person.username',
        'person.displayName',
        'person.customerId',
        'lab.labId',
        'lab.code',
        'lab.name',
        'workstation.name as workstationName',
        'room.name as roomName',
      ])
      .where('tokenHash', '=', hashToken(token))
      .where('endedAt', 'is', null)
      .executeTakeFirst());
  if (!session) return refuse('noSession', 'sign in first');
  if (session.expired) {
    await db.updateTable('session').set({ endedAt: sql`now()` }).where('id', '=', session.id).execute();
    refuse('noSession', 'the session has ended; sign in again');
  }
  if (session.locked && !whileLocked) refuse('sessionLocked', lockedMessage(session.displayName));
  if (!session.locked)
    await db.updateTable('session').set({ lastSeenAt: sql`now()` }).where('id', '=', session.id).execute();
  const { workstationName, roomName } = session;
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
      workstation: workstationName === null || roomName === null ? null : { name: workstationName, room: roomName },
    },
    session: { labId: session.labId, id: session.id, workstationId: session.workstationId },
  };
}

function typedUserIdDigest(key: Buffer, typed: string) {
  return { typedUserIdHmac: createHmac('sha256', key).update(typed).digest(), typedUserIdLength: typed.length };
}

const openSession = async (db: Kysely<DB>, token: string | undefined) =>
  token
    ? db
        .selectFrom('session')
        .innerJoin('person', 'person.id', 'session.personId')
        .select(['session.labId', 'session.id', 'session.personId', 'session.workstationId', expired])
        .where('tokenHash', '=', hashToken(token))
        .where('endedAt', 'is', null)
        .executeTakeFirst()
    : undefined;

/**
 * Signs a person in. Every attempt, refused or not, writes its Access Event in a transaction of its own that commits.
 * An enrolled browser's sign-in carries its Workstation and opens in the Workstation's Lab. A sign-in over a live session
 * on the same browser (Switch user) ends that session with a takeover Access Event in the same transaction; the takeover
 * names the earlier session's Workstation and the new sign-in names this browser's, which on one bench PC are the same.
 */
export function loginRoutes(app: App, db: Kysely<DB>, accessEventKey: Buffer, secureCookie: boolean): void {
  app.register(cookie, { parseOptions: { path: '/', httpOnly: true, sameSite: 'strict', secure: secureCookie } });
  app.route({
    ...routes.login,
    handler: async (req, reply) => {
      const { username, password } = req.body;
      const sourceAddress = req.ip;
      const device = await deviceOf(db, req.cookies[DEVICE_COOKIE]);
      // A token no Workstation holds any more (enrolled again elsewhere) is dropped, so the browser shows as unregistered.
      if (req.cookies[DEVICE_COOKIE] && !device) reply.clearCookie(DEVICE_COOKIE);
      const workstationId = device?.id ?? null;
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
            workstationId,
          }),
        );
        return notValid();
      }

      const proven = await verifyPassword(password, person.passwordHash);
      const defaultLabId = await lowestIdMembershipLab(db, person.id);
      // On a Workstation the attempt is against its Lab, so the roles recorded are the ones held there, even none.
      const rolesLabId = device ? device.labId : defaultLabId;
      const roles: Role[] = rolesLabId
        ? await rolesIn(db, person.id, rolesLabId)
        : person.customerId
          ? ['Customer']
          : [];
      const labId = device ? (roles.length > 0 ? device.labId : undefined) : defaultLabId;
      const subject = { subjectId: person.id, roles, sourceAddress, workstationId };

      if (!proven || person.lockedAt || !labId) {
        const failure = await audited(db, SIGN_IN_SERVICE, async (tx): Promise<SignInFailure> => {
          if (proven) {
            const reason = person.lockedAt ? 'AccountLocked' : device ? 'NotInWorkstationLab' : 'NoLab';
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

      const earlier = await openSession(db, req.cookies[SESSION_COOKIE]);
      const earlierRoles = earlier ? await rolesIn(db, earlier.personId, earlier.labId) : [];
      const token = randomBytes(32).toString('base64url');
      const lockedMeanwhile = await audited(db, SIGN_IN_SERVICE, async (tx) => {
        const { lockedAt } = await tx
          .selectFrom('person')
          .select('lockedAt')
          .where('id', '=', person.id)
          .forNoKeyUpdate()
          .executeTakeFirstOrThrow();
        if (lockedAt) {
          await record(tx, { kind: 'SignInFailed', failureReason: 'AccountLocked', ...subject });
          return true;
        }
        if (person.failedLogins > 0)
          await tx.updateTable('person').set({ failedLogins: 0 }).where('id', '=', person.id).execute();
        if (earlier && (await endSession(tx, earlier)) && !earlier.expired)
          await record(tx, {
            kind: 'Takeover',
            subjectId: earlier.personId,
            takenById: person.id,
            roles: earlierRoles,
            sourceAddress,
            workstationId: earlier.workstationId,
            sessionLabId: earlier.labId,
            sessionId: earlier.id,
          });
        const session = await tx
          .insertInto('session')
          .values({ labId, personId: person.id, tokenHash: hashToken(token), workstationId })
          .returning('id')
          .executeTakeFirstOrThrow();
        await record(tx, { kind: 'SignInSucceeded', ...subject, sessionLabId: labId, sessionId: session.id });
        return false;
      });
      if (lockedMeanwhile) return REFUSAL.AccountLocked();
      reply.setCookie(SESSION_COOKIE, token);
      return (await actorFor(db, token)).actor;
    },
  });
}

async function endSession(tx: Transaction<DB>, session: Pick<SessionKey, 'labId' | 'id'>): Promise<boolean> {
  const ended = await tx
    .updateTable('session')
    .set({ endedAt: sql`now()` })
    .where('labId', '=', session.labId)
    .where('id', '=', session.id)
    .where('endedAt', 'is', null)
    .executeTakeFirst();
  return ended.numUpdatedRows > 0n;
}

/** Writes the person's own Access Event on their session when `change` applied, under no role of the Lab. */
function onOwnSession(db: Kysely<DB>, { actor, sessionKey: session }: { actor: ActorContext; sessionKey: SessionKey }) {
  return (
    kind: 'SignOut' | 'Lock' | 'Unlock',
    reason: string,
    sourceAddress: string,
    change: (tx: Transaction<DB>) => Promise<boolean>,
  ) =>
    audited(db, { actor: `person:${actor.person.username}`, role: NO_ROLE, reason }, async (tx) => {
      if (!(await change(tx))) return;
      await record(tx, {
        kind,
        subjectId: actor.person.id,
        roles: actor.roles,
        sourceAddress,
        sessionLabId: session.labId,
        sessionId: session.id,
        workstationId: session.workstationId,
      });
    });
}

/** Ends the request's session and writes its sign-out Access Event, under the person who signs out. */
export function logoutRoute(app: App, db: Kysely<DB>): void {
  app.route({
    ...routes.logout,
    handler: async (req, reply) => {
      await onOwnSession(db, req)('SignOut', 'Sign out', req.ip, (tx) => endSession(tx, req.sessionKey));
      reply.clearCookie(SESSION_COOKIE);
      return { ended: true } as const;
    },
  });
}

/**
 * Lock and unlock, served on a locked session too. Lock hides the session behind sessionLocked; only the same person's
 * password unlocks it, and a wrong one is an Access Event that counts toward lockout. Each change is an Access Event.
 */
export function lockRoutes(app: App, db: Kysely<DB>): void {
  // Postgres 18's old.locked_at tells whether this very update changed the lock, so a repeat writes no second event.
  const setLocked = async (tx: Transaction<DB>, session: SessionKey, locked: boolean) => {
    const row = await tx
      .updateTable('session')
      .set({ lockedAt: locked ? sql`coalesce(locked_at, now())` : null })
      .where('labId', '=', session.labId)
      .where('id', '=', session.id)
      .where('endedAt', 'is', null)
      .returning(sql<boolean>`(old.locked_at is null) <> (new.locked_at is null)`.as('changed'))
      .executeTakeFirst();
    return row ? row.changed : refuse('noSession', 'the session has ended; sign in again');
  };

  app.route({
    ...routes.lock,
    handler: async (req) => {
      await onOwnSession(db, req)('Lock', 'Lock', req.ip, (tx) => setLocked(tx, req.sessionKey, true));
      return { locked: true, message: lockedMessage(req.actor.person.displayName) } as const;
    },
  });

  app.route({
    ...routes.unlock,
    handler: async (req) => {
      await reauthenticate(
        db,
        { actor: req.actor, session: req.sessionKey },
        req.body.password,
        'Unlock',
        NO_ROLE,
        req.ip,
        'UnlockFailed',
      );
      await onOwnSession(db, req)('Unlock', 'Unlock', req.ip, (tx) => setLocked(tx, req.sessionKey, false));
      return req.actor;
    },
  });
}
