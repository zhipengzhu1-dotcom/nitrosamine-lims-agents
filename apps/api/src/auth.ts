import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import cookie from '@fastify/cookie';
import { type AuditContext, audited, type DB, type Role, type SignInFailure } from '@lims/db';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '@lims/db/credentials';
import { type ActorContext, routes, SESSION_ENDED, type SignedInView } from '@lims/domain';
import { type Insertable, type Kysely, sql, type Transaction } from 'kysely';
import type { App } from './app.ts';
import { openJobIncident } from './incident.ts';
import { refuse, requestReference } from './refuse.ts';

export const LOCKOUT_AFTER_FAILURES = 20;
export const SESSION_COOKIE = 'lims_session';

/** How long a session lives: `idleMs` after its last request, and `absoluteMs` after sign-in at most. */
export interface SessionLimits {
  idleMs: number;
  absoluteMs: number;
}
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/**
 * The session limits of each login configuration. The demo's 8-hour idle limit stands under ADR 0002's demo-login
 * exception until the real-data gate (#102), which is to refuse `real` while the login is not `decided`.
 */
export const SESSION_LIMITS = {
  decided: { idleMs: 15 * MINUTE_MS, absoluteMs: 12 * HOUR_MS },
  demo: { idleMs: 8 * HOUR_MS, absoluteMs: 12 * HOUR_MS },
} as const satisfies Record<string, SessionLimits>;
export type Login = keyof typeof SESSION_LIMITS;

type AccessEvent = Insertable<DB['accessEvent']>;
export interface SessionKey {
  labId: string;
  id: string;
  workstationId: string | null;
}
export interface SignedIn {
  actor: ActorContext;
  session: SessionKey;
  /** What the API answers a person with about their own session: who, how long it has left, and their preferences. */
  view: SignedInView;
}

const SIGN_IN_SERVICE: AuditContext = { actor: 'svc:sign-in', role: 'system', reason: 'Sign in' };
const SWEEP_SERVICE: AuditContext = {
  actor: 'svc:session-sweep',
  role: 'system',
  reason: 'End sessions past their limit or locked out',
};

const TIMING_DECOY_HASH = await hashPassword(randomBytes(16).toString('base64url'));

/** Signing out, locking, unlocking, switching Lab and setting preferences act on the person's own account, under no role of the Lab. */
const NEEDS_NO_ROLE = 'none' as const;

/** The Audit Trail context for a step a person takes on their own account: them as actor, under no role of the Lab. */
export const asOwnAccount = (username: string, reason: string): AuditContext => ({
  actor: `person:${username}`,
  role: NEEDS_NO_ROLE,
  reason,
});

/** A session or device token as stored: its SHA-256, never the token. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest();

export const DEVICE_COOKIE = 'lims_device';

/** The Workstation a browser's device token enrols it as, or undefined for an unregistered device. */
export async function deviceOf(
  db: Kysely<DB>,
  token: string | undefined,
): Promise<{ labId: string; id: string } | undefined> {
  if (!token) return undefined;
  return db
    .selectFrom('workstation')
    .select(['labId', 'id'])
    .where('deviceTokenHash', '=', hashToken(token))
    .executeTakeFirst();
}
const notValid = () => refuse('badCredentials', 'the user ID or password is not valid');
const linkNotValid = () =>
  refuse('badCredentials', 'this link has been used, replaced or has expired; ask the Admin for a new one');

const REFUSAL: { readonly [F in SignInFailure]: (labName?: string) => never } = {
  UnknownUserId: notValid,
  WrongPassword: notValid,
  WrongPasswordOnLockedAccount: notValid,
  OtherUserId: notValid,
  NoCredential: notValid,
  AccountLocked: () => refuse('accountLocked', 'this account is locked'),
  NoLab: () => refuse('role', 'this account belongs to no Lab'),
  WrongUserId: notValid,
  NoLabChosen: () => refuse('labNotChosen', 'choose the Lab to work in'),
  NoMembership: (labName = 'that Lab') => refuse('role', `You hold no Membership in ${labName}. Choose another Lab.`),
  NotInWorkstationLab: () => refuse('role', "this account belongs to no role in this Workstation's Lab"),
  SessionEnded: () =>
    refuse('stale', 'this session has already moved to another Lab or ended; reload to see where you work'),
};

const record = (tx: Transaction<DB>, event: AccessEvent) => tx.insertInto('accessEvent').values(event).execute();

async function rolesIn(db: Kysely<DB>, personId: string, labId: string): Promise<Role[]> {
  const rows = await db
    .selectFrom('membership')
    .select('role')
    .where('labId', '=', labId)
    .where('personId', '=', personId)
    .orderBy('role')
    .execute();
  return rows.map((r) => r.role);
}

type LabChoice =
  | { labId: string; roles: Role[] }
  | {
      refused: Extract<SignInFailure, 'NoLab' | 'NoLabChosen' | 'NoMembership'>;
      roles: Role[];
      labName?: string | undefined;
    };

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
  if (labId === undefined) return { refused: 'NoLabChosen', roles: rolesOf(first.labId) };
  const named = await db.selectFrom('lab').select('name').where('labId', '=', labId).executeTakeFirst();
  return { refused: 'NoMembership', roles: rolesOf(first.labId), labName: named?.name };
}

/** Counts a wrong credential; `locksOut` says this one reaches the lockout, which `lockOut` applies once the failure is recorded. */
async function countFailure(tx: Transaction<DB>, personId: string) {
  return tx
    .updateTable('person')
    .set({ failedLogins: sql`failed_logins + 1` })
    .where('id', '=', personId)
    .returning([
      sql<boolean>`locked_at is not null`.as('wasLocked'),
      sql<boolean>`locked_at is null and failed_logins >= ${LOCKOUT_AFTER_FAILURES}`.as('locksOut'),
    ])
    .executeTakeFirstOrThrow();
}

/** Locks the person out and records the Lockout, which the database stamps at the instant the lock landed. */
async function lockOut(tx: Transaction<DB>, event: Omit<AccessEvent, 'kind'> & { subjectId: string }) {
  await tx
    .updateTable('person')
    .set({ lockedAt: sql`clock_timestamp()` })
    .where('id', '=', event.subjectId)
    .where('lockedAt', 'is', null)
    .execute();
  await record(tx, { ...event, kind: 'Lockout' });
}

/** Counts a wrong credential toward the lockout and records it, with any Lockout it applies, in the caller's transaction. */
async function recordWrongCredential(
  tx: Transaction<DB>,
  kind: 'SignInFailed' | 'LabSwitchFailed',
  event: Omit<AccessEvent, 'kind' | 'failureReason'> & { subjectId: string },
  wrong: 'WrongPassword' | 'OtherUserId',
): Promise<SignInFailure> {
  const { wasLocked, locksOut } = await countFailure(tx, event.subjectId);
  const reason = wrong === 'WrongPassword' && wasLocked ? 'WrongPasswordOnLockedAccount' : wrong;
  await record(tx, { ...event, kind, failureReason: reason });
  if (locksOut) await lockOut(tx, event);
  return reason;
}

/** Locks the person's row for the session about to open, without blocking a key-share lock from a step that holds the company chain; answers true, and resets nothing, if a lock landed since the password was checked. */
async function resetFailuresUnlessLocked(tx: Transaction<DB>, personId: string): Promise<boolean> {
  const { lockedAt, failedLogins } = await tx
    .selectFrom('person')
    .select(['lockedAt', 'failedLogins'])
    .where('id', '=', personId)
    .forNoKeyUpdate()
    .executeTakeFirstOrThrow();
  if (lockedAt) return true;
  if (failedLogins > 0) await tx.updateTable('person').set({ failedLogins: 0 }).where('id', '=', personId).execute();
  return false;
}

async function openSession(
  tx: Transaction<DB>,
  personId: string,
  labId: string,
  token: string,
  workstationId: string | null,
): Promise<SessionKey> {
  const { id } = await tx
    .insertInto('session')
    .values({ labId, personId, tokenHash: hashToken(token), workstationId })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { labId, id, workstationId };
}

/**
 * The request's source address as one Access Event key: a trusted proxy's forwarded value that is not an address
 * falls back to the peer, and an IPv4-mapped IPv6 address is the IPv4 address.
 */
export function sourceAddressOf(req: {
  ip: string;
  socket: { remoteAddress?: string | undefined };
  log: { warn: (message: string) => void };
}): string {
  if (!isIP(req.ip))
    req.log.warn('a trusted proxy forwarded a source address that is not an address; the peer is used');
  const address = (isIP(req.ip) ? req.ip : (req.socket.remoteAddress ?? '')).replace(/%.*$/, '');
  const mapped = /^::ffff:(.+)$/i.exec(address)?.[1];
  return mapped && isIP(mapped) === 4 ? mapped : address;
}

/**
 * Proves the person of the session again, to sign or to unlock: the password must be theirs, and a typed user ID, when
 * given, must be theirs too. A failure refuses as badCredentials, counts toward the lockout and writes `failureEvent`
 * when given, with why for a failed re-authentication; a lockout it applies is an Access Event.
 */
export async function reauthenticate(
  db: Kysely<DB>,
  { actor, session }: Pick<SignedIn, 'actor' | 'session'>,
  typed: { password: string; username?: string },
  purpose: string,
  role: Role | typeof NEEDS_NO_ROLE,
  sourceAddress: string,
  failureEvent?: 'UnlockFailed' | 'ReauthenticationFailed',
): Promise<void> {
  const person = await db.selectFrom('person').selectAll().where('id', '=', actor.person.id).executeTakeFirstOrThrow();
  const as = (reason: string) => ({ actor: `person:${person.username}`, role, reason });
  const theirs = typed.username === undefined || typed.username === person.username;
  const proven = await verifyPassword(
    typed.password,
    theirs && person.passwordHash ? person.passwordHash : TIMING_DECOY_HASH,
  );
  if (theirs && proven && person.passwordHash) {
    if (person.lockedAt) refuse('accountLocked', 'this account is locked');
    if (person.failedLogins > 0)
      await audited(db, as(purpose), (tx) =>
        tx.updateTable('person').set({ failedLogins: 0 }).where('id', '=', person.id).execute(),
      );
    return;
  }
  await audited(db, as('Failed authentication'), async (tx) => {
    const { wasLocked, locksOut } = await countFailure(tx, person.id);
    const event = {
      subjectId: person.id,
      roles: actor.roles,
      sourceAddress,
      sessionLabId: session.labId,
      sessionId: session.id,
      workstationId: session.workstationId,
    };
    if (failureEvent === 'ReauthenticationFailed') {
      let failureReason: SignInFailure = 'WrongUserId';
      if (theirs) failureReason = wasLocked ? 'WrongPasswordOnLockedAccount' : 'WrongPassword';
      await record(tx, { kind: failureEvent, failureReason, ...event });
    } else if (failureEvent) await record(tx, { kind: failureEvent, ...event });
    if (locksOut) await lockOut(tx, event);
  });
  if (typed.username === undefined) refuse('badCredentials', 'the password is not valid');
  notValid();
}

const interval = (ms: number) => sql<string>`${ms} * interval '1 millisecond'`;

const lockedMessage = (displayName: string) =>
  `this screen is locked; ${displayName} unlocks it with their password, or another person signs in with Switch user`;

/**
 * Builds the ActorContext from the session cookie, and counts the request as activity. A lapsed session (past its end,
 * or its person locked out) is ended at its lapse and refused. A locked session is refused as sessionLocked, with no
 * record content and without counting as activity, unless `whileLocked` serves the lock screen. Reads the session
 * tables directly: no context exists yet to scope by.
 */
export async function actorFor(
  db: Kysely<DB>,
  token: string | undefined,
  limits: SessionLimits,
  { whileLocked = false } = {},
): Promise<SignedIn> {
  const idle = interval(limits.idleMs);
  const absolute = interval(limits.absoluteMs);
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
        'session.endedAt',
        'session.workstationId',
        sql<boolean>`session.locked_at is not null`.as('locked'),
        sql<boolean>`lims.session_lapse(session.last_seen_at, session.created_at, person.locked_at, ${idle}, ${absolute}) > now()`.as(
          'live',
        ),
        sql<number>`(extract(epoch from session.last_seen_at + ${idle} - now()) * 1000)::integer`.as('idleLeftMs'),
        sql<number>`(extract(epoch from session.created_at + ${absolute} - now()) * 1000)::integer`.as(
          'absoluteLeftMs',
        ),
        'workstation.name as workstationName',
        'room.name as roomName',
        'person.id as personId',
        'person.username',
        'person.displayName',
        'person.customerId',
        'person.reducedMotion',
        'lab.labId',
        'lab.code',
        'lab.name',
      ])
      .where('tokenHash', '=', hashToken(token))
      .executeTakeFirst());
  if (!session) return refuse('noSession', 'sign in first');
  if (session.endedAt) return refuse('noSession', SESSION_ENDED);
  const key = { labId: session.labId, id: session.id, workstationId: session.workstationId };
  const lapsed = async () => {
    await endLapsedSessions(db, limits, key);
    return refuse('noSession', SESSION_ENDED);
  };
  if (!session.live) return lapsed();
  if (session.locked && !whileLocked) refuse('sessionLocked', lockedMessage(session.displayName));
  let { idleLeftMs, absoluteLeftMs }: { idleLeftMs: number; absoluteLeftMs: number | null } = session;
  if (!session.locked) {
    const { rows } = await sql<{
      absoluteLeftMs: number | null;
    }>`select lims.touch_session(${key.labId}, ${key.id}, ${idle}, ${absolute}) as "absoluteLeftMs"`.execute(db);
    absoluteLeftMs = rows[0]?.absoluteLeftMs ?? null;
    idleLeftMs = limits.idleMs;
  }
  if (absoluteLeftMs === null) return lapsed();
  const { workstationName, roomName } = session;
  const actor: ActorContext = {
    person: {
      id: session.personId,
      username: session.username,
      displayName: session.displayName,
      customerId: session.customerId,
    },
    lab: { id: session.labId, code: session.code, name: session.name },
    roles: await rolesIn(db, session.personId, session.labId),
    workstation: workstationName === null || roomName === null ? null : { name: workstationName, room: roomName },
  };
  return {
    actor,
    session: key,
    view: {
      ...actor,
      session: { idleLimitMs: limits.idleMs, idleLeftMs, absoluteLeftMs },
      preferences: { reducedMotion: session.reducedMotion },
    },
  };
}

/**
 * Ends every lapsed session, or only the one `key` names, at the instant it lapsed: its person's Lockout, or else its
 * idle or absolute end, with the expiry Access Event stamped there. Running it again ends none twice.
 */
export async function endLapsedSessions(
  db: Kysely<DB>,
  limits: SessionLimits,
  key?: Pick<SessionKey, 'labId' | 'id'>,
): Promise<void> {
  await audited(db, SWEEP_SERVICE, (tx) =>
    sql`select lims.end_lapsed_sessions(${interval(limits.idleMs)}, ${interval(limits.absoluteMs)}, ${key?.labId ?? null}::uuid, ${key?.id ?? null}::uuid)`.execute(
      tx,
    ),
  );
}

/** Ends a session that has not lapsed, and says whether it did; a lapsed one ends at its lapse, as `endLapsedSessions` does. */
async function endSession(
  q: Kysely<DB>,
  key: Pick<SessionKey, 'labId' | 'id'>,
  limits: SessionLimits,
): Promise<boolean> {
  const { rows } = await sql<{
    ended: boolean;
  }>`select lims.end_session(${key.labId}, ${key.id}, ${interval(limits.idleMs)}, ${interval(limits.absoluteMs)}) as ended`.execute(
    q,
  );
  return rows[0]?.ended === true;
}

/**
 * Runs the expiry sweep every `everyMs` until the API closes. A failed sweep opens a System Incident and the next one
 * retries, writing the same record, since each expiry is stamped at its computed end. A tick skips while a sweep is
 * still running, and close waits for it.
 */
export function scheduleExpirySweep(app: App, db: Kysely<DB>, limits: SessionLimits, everyMs: number): void {
  let running: Promise<void> | null = null;
  const sweep = setInterval(() => {
    running ??= endLapsedSessions(db, limits)
      .catch((err: Error) => openJobIncident(db, app.log, { reference: requestReference(), step: 'expirySweep' }, err))
      .finally(() => {
        running = null;
      });
  }, everyMs);
  app.addHook('onClose', async () => {
    clearInterval(sweep);
    await running;
  });
}

function typedUserIdDigest(key: Buffer, typed: string) {
  return { typedUserIdHmac: createHmac('sha256', key).update(typed).digest(), typedUserIdLength: typed.length };
}

/** The session this browser's cookie still names: the one a Switch user sign-in takes over. */
const browserSession = async (db: Kysely<DB>, token: string | undefined) =>
  token
    ? db
        .selectFrom('session')
        .select(['labId', 'id', 'personId', 'workstationId'])
        .where('tokenHash', '=', hashToken(token))
        .where('endedAt', 'is', null)
        .executeTakeFirst()
    : undefined;

/**
 * The routes before a session: the Labs to choose from, sign-in, and how long a session has left without touching it.
 * Every sign-in attempt, refused or not, writes its Access Event in a transaction of its own that commits. An enrolled
 * browser's sign-in carries its Workstation and opens in the Workstation's Lab. A sign-in over a live session on the
 * same browser (Switch user) ends it with a takeover Access Event in the same transaction; the takeover names the
 * earlier session's Workstation. An earlier session that has lapsed ends at its lapse instead, with no takeover. A
 * countdown check that finds its session lapsed ends it the same way.
 */
export function loginRoutes(
  app: App,
  db: Kysely<DB>,
  accessEventKey: Buffer,
  secureCookie: boolean,
  limits: SessionLimits,
): void {
  app.register(cookie, { parseOptions: { path: '/', httpOnly: true, sameSite: 'strict', secure: secureCookie } });
  app.route({
    ...routes.labs,
    // An enrolled browser offers only its Workstation's Lab, the one every sign-in on it opens.
    handler: async (req) => {
      const device = await deviceOf(db, req.cookies[DEVICE_COOKIE]);
      const labs = db.selectFrom('lab').select(['labId as id', 'code', 'name']).orderBy('code');
      return (device ? labs.where('labId', '=', device.labId) : labs).execute();
    },
  });
  app.route({
    ...routes.login,
    handler: async (req, reply) => {
      const { username, password } = req.body;
      const sourceAddress = sourceAddressOf(req);
      const device = await deviceOf(db, req.cookies[DEVICE_COOKIE]);
      // A token no Workstation holds any more (enrolled again elsewhere) is dropped, so the browser shows as unregistered.
      if (req.cookies[DEVICE_COOKIE] && !device) reply.clearCookie(DEVICE_COOKIE);
      const workstationId = device?.id ?? null;
      const labId = device?.labId ?? req.body.labId;
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

      const proven = await verifyPassword(password, person.passwordHash ?? TIMING_DECOY_HASH);
      const offWorkstation =
        device && (await rolesIn(db, person.id, device.labId)).length === 0
          ? { refused: 'NotInWorkstationLab' as const, roles: [] }
          : null;
      const choice: LabChoice | NonNullable<typeof offWorkstation> =
        offWorkstation ?? (await chooseLab(db, person, labId));
      const subject = { subjectId: person.id, roles: choice.roles, sourceAddress, workstationId };

      const refusal = person.lockedAt ? 'AccountLocked' : 'refused' in choice ? choice.refused : null;
      if (!proven || !person.passwordHash || refusal || 'refused' in choice) {
        const failure = await audited(db, SIGN_IN_SERVICE, async (tx): Promise<SignInFailure> => {
          if (!person.passwordHash) {
            await record(tx, { kind: 'SignInFailed', failureReason: 'NoCredential', ...subject });
            return 'NoCredential';
          }
          if (proven && refusal) {
            await record(tx, { kind: 'SignInFailed', failureReason: refusal, ...subject });
            return refusal;
          }
          return recordWrongCredential(tx, 'SignInFailed', subject, 'WrongPassword');
        });
        return REFUSAL[failure]('labName' in choice ? choice.labName : undefined);
      }

      const earlier = await browserSession(db, req.cookies[SESSION_COOKIE]);
      const earlierRoles = earlier ? await rolesIn(db, earlier.personId, earlier.labId) : [];
      const token = randomBytes(32).toString('base64url');
      const locked = await audited(db, SIGN_IN_SERVICE, async (tx) => {
        if (await resetFailuresUnlessLocked(tx, person.id)) {
          await record(tx, { kind: 'SignInFailed', failureReason: 'AccountLocked', ...subject });
          return true;
        }
        if (earlier && (await endSession(tx, earlier, limits)))
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
        const session = await openSession(tx, person.id, choice.labId, token, workstationId);
        await record(tx, { kind: 'SignInSucceeded', ...subject, sessionLabId: session.labId, sessionId: session.id });
        return false;
      });
      if (locked) return REFUSAL.AccountLocked();
      reply.setCookie(SESSION_COOKIE, token);
      return (await actorFor(db, token, limits)).view;
    },
  });
  app.route({
    ...routes.setPasswordThroughLink,
    handler: async (req) => {
      const { token, password } = req.body;
      if (password.length < MIN_PASSWORD_LENGTH)
        refuse('malformed', `a password needs at least ${MIN_PASSWORD_LENGTH} characters`);
      const live = await db
        .selectFrom('credentialLink')
        .select('id')
        .where('tokenHash', '=', hashToken(token))
        .where('usedAt', 'is', null)
        .where('expiresAt', '>', sql<Date>`clock_timestamp()`)
        .executeTakeFirst();
      if (!live) return linkNotValid();
      const passwordHash = await hashPassword(password);
      const as = { ...SIGN_IN_SERVICE, reason: 'Set a password through a one-time link' };
      const set = await audited(db, as, async (tx) => {
        const { rows } = await sql<{ person: string | null }>`
          select lims.set_password_through_link(${token}, ${passwordHash}) as person`.execute(tx);
        const personId = rows[0]?.person;
        if (!personId) return null;
        const lab = await tx
          .selectFrom('membership')
          .select('labId')
          .where('personId', '=', personId)
          .orderBy('labId')
          .executeTakeFirst();
        const roles = lab ? await rolesIn(tx, personId, lab.labId) : [];
        await record(tx, { kind: 'PasswordSet', subjectId: personId, roles, sourceAddress: sourceAddressOf(req) });
        return tx.selectFrom('person').select('username').where('id', '=', personId).executeTakeFirstOrThrow();
      });
      return set ?? linkNotValid();
    },
  });
  app.route({
    ...routes.session,
    handler: async (req) => {
      const token = req.cookies[SESSION_COOKIE];
      if (!token) return refuse('noSession', 'sign in first');
      const idle = interval(limits.idleMs);
      const absolute = interval(limits.absoluteMs);
      const session = await db
        .selectFrom('session')
        .innerJoin('person', 'person.id', 'session.personId')
        .select([
          'session.labId',
          'session.id',
          sql<boolean>`lims.session_lapse(last_seen_at, created_at, person.locked_at, ${idle}, ${absolute}) > now()`.as(
            'live',
          ),
          sql<number>`(extract(epoch from last_seen_at + ${idle} - now()) * 1000)::integer`.as('idleLeftMs'),
          sql<number>`(extract(epoch from created_at + ${absolute} - now()) * 1000)::integer`.as('absoluteLeftMs'),
        ])
        .where('tokenHash', '=', hashToken(token))
        .where('session.endedAt', 'is', null)
        .executeTakeFirst();
      if (!session) return refuse('noSession', SESSION_ENDED);
      const { labId, id, live, idleLeftMs, absoluteLeftMs } = session;
      if (live) return { idleLimitMs: limits.idleMs, idleLeftMs, absoluteLeftMs };
      await endLapsedSessions(db, limits, { labId, id });
      return refuse('noSession', SESSION_ENDED);
    },
  });
}

/** Writes the person's own Access Event on their session when `change` applied, under no role of the Lab. */
function onOwnSession(
  db: Kysely<DB>,
  req: { actor: ActorContext; sessionKey: SessionKey } & Parameters<typeof sourceAddressOf>[0],
  kind: 'SignOut' | 'Lock' | 'Unlock',
  change: (tx: Transaction<DB>) => Promise<boolean>,
) {
  const { actor, sessionKey: session } = req;
  const reason = kind === 'SignOut' ? 'Sign out' : kind;
  return audited(db, asOwnAccount(actor.person.username, reason), async (tx) => {
    if (!(await change(tx))) return;
    await record(tx, {
      kind,
      subjectId: actor.person.id,
      roles: actor.roles,
      sourceAddress: sourceAddressOf(req),
      sessionLabId: session.labId,
      sessionId: session.id,
      workstationId: session.workstationId,
    });
  });
}

/**
 * The routes a locked session still reaches: sign-out, lock and unlock. Lock hides the session behind sessionLocked;
 * only the same person's password unlocks it, and a wrong one is an UnlockFailed Access Event that counts toward
 * lockout. Each change is an Access Event under the person whose session it is.
 */
export function lockScreenRoutes(app: App, db: Kysely<DB>, limits: SessionLimits): void {
  app.route({
    ...routes.logout,
    handler: async (req, reply) => {
      await onOwnSession(db, req, 'SignOut', (tx) => endSession(tx, req.sessionKey, limits));
      reply.clearCookie(SESSION_COOKIE);
      return { ended: true } as const;
    },
  });

  // Postgres 18's old.locked_at tells whether this very update changed the lock, so a repeat writes no second event.
  const setLocked = async (tx: Transaction<DB>, session: SessionKey, locked: boolean) => {
    const row = await tx
      .updateTable('session')
      .set({ lockedAt: locked ? sql`coalesce(locked_at, now())` : null })
      .where('labId', '=', session.labId)
      .where('id', '=', session.id)
      .where('endedAt', 'is', null)
      .where(
        sql<boolean>`lims.session_end(last_seen_at, created_at, ${interval(limits.idleMs)}, ${interval(limits.absoluteMs)}) > now()`,
      )
      .returning(sql<boolean>`(old.locked_at is null) <> (new.locked_at is null)`.as('changed'))
      .executeTakeFirst();
    return row ? row.changed : refuse('noSession', SESSION_ENDED);
  };

  app.route({
    ...routes.lock,
    handler: async (req) => {
      await onOwnSession(db, req, 'Lock', (tx) => setLocked(tx, req.sessionKey, true));
      return { locked: true, message: lockedMessage(req.actor.person.displayName) } as const;
    },
  });

  app.route({
    ...routes.unlock,
    handler: async (req) => {
      const signedIn = { actor: req.actor, session: req.sessionKey };
      await reauthenticate(
        db,
        signedIn,
        { password: req.body.password },
        'Unlock',
        NEEDS_NO_ROLE,
        sourceAddressOf(req),
        'UnlockFailed',
      );
      await onOwnSession(db, req, 'Unlock', (tx) => setLocked(tx, req.sessionKey, false));
      return (await actorFor(db, req.cookies[SESSION_COOKIE], limits)).view;
    },
  });
}

/** Switching Lab moves the request's session, written under the person whose session it is. A session on a Workstation stays in the Workstation's Lab. */
export function labSwitchRoute(app: App, db: Kysely<DB>, limits: SessionLimits): void {
  app.route({
    ...routes.switchLab,
    handler: async (req, reply) => {
      const { actor, sessionKey: session } = req;
      const { username, password, labId } = req.body;
      if (labId === session.labId) refuse('state', `you already work in ${actor.lab.name}`);
      if (session.workstationId)
        refuse(
          'state',
          `this Workstation belongs to ${actor.lab.name}; switch Lab on a desk PC or another Workstation`,
        );
      const person = await db
        .selectFrom('person')
        .selectAll()
        .where('id', '=', actor.person.id)
        .executeTakeFirstOrThrow();
      const as = asOwnAccount(person.username, 'Switch Lab');
      const sameUserId = username === person.username;
      const proven =
        (await verifyPassword(password, (sameUserId && person.passwordHash) || TIMING_DECOY_HASH)) && sameUserId;
      const choice = await chooseLab(db, person, labId);
      const inSession = {
        subjectId: person.id,
        roles: actor.roles,
        sourceAddress: sourceAddressOf(req),
        sessionLabId: session.labId,
        sessionId: session.id,
      };

      if (!proven || 'refused' in choice) {
        const failure = await audited(db, as, async (tx): Promise<SignInFailure> => {
          if (proven && 'refused' in choice) {
            await record(tx, { kind: 'LabSwitchFailed', failureReason: choice.refused, ...inSession });
            return choice.refused;
          }
          return recordWrongCredential(tx, 'LabSwitchFailed', inSession, sameUserId ? 'WrongPassword' : 'OtherUserId');
        });
        return REFUSAL[failure]('refused' in choice ? choice.labName : undefined);
      }

      const token = randomBytes(32).toString('base64url');
      const outcome = await audited(db, as, async (tx): Promise<'AccountLocked' | 'SessionEnded' | 'Switched'> => {
        if (await resetFailuresUnlessLocked(tx, person.id)) {
          await record(tx, { kind: 'LabSwitchFailed', failureReason: 'AccountLocked', ...inSession });
          return 'AccountLocked';
        }
        if (!(await endSession(tx, session, limits))) {
          await record(tx, { kind: 'LabSwitchFailed', failureReason: 'SessionEnded', ...inSession });
          return 'SessionEnded';
        }
        const opened = await openSession(tx, person.id, choice.labId, token, null);
        await record(tx, {
          kind: 'LabSwitch',
          subjectId: person.id,
          roles: choice.roles,
          sourceAddress: sourceAddressOf(req),
          sessionLabId: opened.labId,
          sessionId: opened.id,
          previousSessionLabId: session.labId,
          previousSessionId: session.id,
        });
        return 'Switched';
      });
      if (outcome !== 'Switched') return REFUSAL[outcome]();
      reply.setCookie(SESSION_COOKIE, token);
      return (await actorFor(db, token, limits)).view;
    },
  });
}
