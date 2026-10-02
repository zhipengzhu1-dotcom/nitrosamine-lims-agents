import { createHash, createHmac, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
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

const NEEDS_NO_ROLE = 'none';

const hashToken = (token: string) => createHash('sha256').update(token).digest();
const notValid = () => refuse('badCredentials', 'the credentials are not valid');

const REFUSAL: { readonly [F in SignInFailure]: () => never } = {
  UnknownUserId: notValid,
  WrongPassword: notValid,
  WrongPasswordOnLockedAccount: notValid,
  OtherUserId: notValid,
  AccountLocked: () => refuse('accountLocked', 'this account is locked'),
  NoLab: () => refuse('role', 'this account belongs to no Lab'),
  NoLabChosen: () => refuse('labNotChosen', 'choose the Lab to work in'),
  NoMembership: () => refuse('role', 'you hold no Membership in that Lab'),
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

type LabChoice =
  | { labId: string; roles: Role[] }
  | { refused: Extract<SignInFailure, 'NoLab' | 'NoLabChosen' | 'NoMembership'>; roles: Role[] };

/**
 * The Lab a sign-in or a Lab switch opens: the one named, if the person holds a Membership there, and never a default.
 * A refused choice keeps the roles its Access Event records: those of the default Lab (the spec's earliest Membership;
 * a Membership has no date yet, so the lowest Lab ID stands in), or Customer for a person with no Membership.
 */
async function chooseLab(
  db: Kysely<DB>,
  person: { id: string; customerId: string | null },
  labId: string | undefined,
): Promise<LabChoice> {
  const held = await db
    .selectFrom('membership')
    .select(['labId', 'role'])
    .where('personId', '=', person.id)
    .orderBy('labId')
    .orderBy('role')
    .execute();
  const rolesOf = (lab: string) => held.filter((m) => m.labId === lab).map((m) => m.role);
  const chosen = labId === undefined ? [] : rolesOf(labId);
  if (labId !== undefined && chosen.length > 0) return { labId, roles: chosen };
  const [first] = held;
  if (!first) return { refused: 'NoLab', roles: person.customerId ? ['Customer'] : [] };
  return { refused: labId === undefined ? 'NoLabChosen' : 'NoMembership', roles: rolesOf(first.labId) };
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

/** Locks the person's row for the session about to open; answers true, and resets nothing, if a lock landed since the password was checked. */
async function resetFailuresUnlessLocked(tx: Transaction<DB>, personId: string): Promise<boolean> {
  const { lockedAt, failedLogins } = await tx
    .selectFrom('person')
    .select(['lockedAt', 'failedLogins'])
    .where('id', '=', personId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (lockedAt) return true;
  if (failedLogins > 0) await tx.updateTable('person').set({ failedLogins: 0 }).where('id', '=', personId).execute();
  return false;
}

async function endSession(tx: Transaction<DB>, session: SessionKey): Promise<boolean> {
  const ended = await tx
    .updateTable('session')
    .set({ endedAt: sql`now()` })
    .where('labId', '=', session.labId)
    .where('id', '=', session.id)
    .where('endedAt', 'is', null)
    .executeTakeFirst();
  return ended.numUpdatedRows > 0n;
}

async function openSession(tx: Transaction<DB>, personId: string, labId: string, token: string): Promise<SessionKey> {
  const { id } = await tx
    .insertInto('session')
    .values({ labId, personId, tokenHash: hashToken(token) })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { labId, id };
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

/** The routes before a session: the Labs to choose from, and sign-in. Every sign-in attempt, refused or not, writes its Access Event in a transaction of its own that commits. */
export function loginRoutes(app: App, db: Kysely<DB>, accessEventKey: Buffer, secureCookie: boolean): void {
  app.register(cookie, { parseOptions: { path: '/', httpOnly: true, sameSite: 'strict', secure: secureCookie } });
  app.route({
    ...routes.labs,
    handler: () => db.selectFrom('lab').select(['labId as id', 'code', 'name']).orderBy('code').execute(),
  });
  app.route({
    ...routes.login,
    handler: async (req, reply) => {
      const { username, password, labId } = req.body;
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
      const choice = await chooseLab(db, person, labId);
      const subject = { subjectId: person.id, roles: choice.roles, sourceAddress };

      const refusal = person.lockedAt ? 'AccountLocked' : 'refused' in choice ? choice.refused : null;
      if (!proven || refusal || 'refused' in choice) {
        const failure = await audited(db, SIGN_IN_SERVICE, async (tx): Promise<SignInFailure> => {
          if (proven && refusal) {
            await record(tx, { kind: 'SignInFailed', failureReason: refusal, ...subject });
            return refusal;
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
      const locked = await audited(db, SIGN_IN_SERVICE, async (tx) => {
        if (await resetFailuresUnlessLocked(tx, person.id)) {
          await record(tx, { kind: 'SignInFailed', failureReason: 'AccountLocked', ...subject });
          return true;
        }
        const session = await openSession(tx, person.id, choice.labId, token);
        await record(tx, { kind: 'SignInSucceeded', ...subject, sessionLabId: session.labId, sessionId: session.id });
        return false;
      });
      if (locked) return REFUSAL.AccountLocked();
      reply.setCookie(SESSION_COOKIE, token);
      return (await actorFor(db, token)).actor;
    },
  });
}

/** The routes that end or move the request's session, each written under the person whose session it is. */
export function sessionRoutes(app: App, db: Kysely<DB>): void {
  app.route({
    ...routes.logout,
    handler: async (req, reply) => {
      const { actor, sessionKey: session } = req;
      const as = { actor: `person:${actor.person.username}`, role: NEEDS_NO_ROLE, reason: 'Sign out' };
      await audited(db, as, async (tx) => {
        if (!(await endSession(tx, session))) return;
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

  app.route({
    ...routes.switchLab,
    handler: async (req, reply) => {
      const { actor, sessionKey: session } = req;
      const { username, password, labId } = req.body;
      if (labId === session.labId) refuse('state', `you already work in ${actor.lab.name}`);
      const person = await db
        .selectFrom('person')
        .selectAll()
        .where('id', '=', actor.person.id)
        .executeTakeFirstOrThrow();
      const as = { actor: `person:${person.username}`, role: NEEDS_NO_ROLE, reason: 'Switch Lab' };
      const sameUserId = username === person.username;
      const proven =
        (await verifyPassword(password, sameUserId ? person.passwordHash : TIMING_DECOY_HASH)) && sameUserId;
      const choice = await chooseLab(db, person, labId);
      const inSession = {
        subjectId: person.id,
        roles: actor.roles,
        sourceAddress: req.ip,
        sessionLabId: session.labId,
        sessionId: session.id,
      };

      if (!proven || 'refused' in choice) {
        const failure = await audited(db, as, async (tx): Promise<SignInFailure> => {
          if (proven && 'refused' in choice) {
            await record(tx, { kind: 'LabSwitchFailed', failureReason: choice.refused, ...inSession });
            return choice.refused;
          }
          const { wasLocked, lockedNow } = await countFailure(tx, person.id);
          const wrongPassword = wasLocked ? 'WrongPasswordOnLockedAccount' : 'WrongPassword';
          const reason = sameUserId ? wrongPassword : 'OtherUserId';
          await record(tx, { kind: 'LabSwitchFailed', failureReason: reason, ...inSession });
          if (lockedNow) await record(tx, { kind: 'Lockout', ...inSession });
          return reason;
        });
        return REFUSAL[failure]();
      }

      const token = randomBytes(32).toString('base64url');
      const outcome = await audited(db, as, async (tx): Promise<SignInFailure | 'SessionEnded' | 'Switched'> => {
        if (await resetFailuresUnlessLocked(tx, person.id)) {
          await record(tx, { kind: 'LabSwitchFailed', failureReason: 'AccountLocked', ...inSession });
          return 'AccountLocked';
        }
        if (!(await endSession(tx, session))) return 'SessionEnded';
        const opened = await openSession(tx, person.id, choice.labId, token);
        await record(tx, {
          kind: 'LabSwitch',
          subjectId: person.id,
          roles: choice.roles,
          sourceAddress: req.ip,
          sessionLabId: opened.labId,
          sessionId: opened.id,
          previousSessionLabId: session.labId,
          previousSessionId: session.id,
        });
        return 'Switched';
      });
      if (outcome === 'SessionEnded') return refuse('noSession', 'the session has ended; sign in again');
      if (outcome !== 'Switched') return REFUSAL[outcome]();
      reply.setCookie(SESSION_COOKIE, token);
      return (await actorFor(db, token)).actor;
    },
  });
}
