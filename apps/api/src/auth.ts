import { createHash, randomBytes } from 'node:crypto';
import { audited, type DB } from '@lims/db';
import { totpCode, totpStep, verifyPassword } from '@lims/db/credentials';
import type { FastifyInstance } from 'fastify';
import { type Kysely, type Selectable, sql } from 'kysely';
import { type ActorContext, refuse } from './scope.ts';

export const LOCKOUT_AFTER_FAILURES = 5;
export const IDLE_LIMIT_MS = 15 * 60_000;
export const ABSOLUTE_LIMIT_MS = 12 * 60 * 60_000;
const PENDING_LOGIN_MS = 5 * 60_000;
export const SESSION_COOKIE = 'lims_session';

type Person = Selectable<DB['person']>;
export interface Proof { password?: string; code?: string }

const hashToken = (token: string) => createHash('sha256').update(token).digest();
const authAudit = (person: Person, reason: string) => ({ actor: `person:${person.username}`, role: 'authentication', reason });
const notValid = () => refuse(401, 'the credentials are not valid');

// Password accepted, TOTP code still owed. Held in memory: it is not a session, and a restart only costs a re-entry.
const pendingLogins = new Map<string, { personId: string; until: number }>();

/** Accepts a code for a time step within one step of now, spending it only if it is later than the last step spent. */
async function spendTotp(db: Kysely<DB>, person: Person, code: string, reason: string): Promise<boolean> {
  const now = totpStep();
  const step = [now - 1, now, now + 1].find((s) => totpCode(person.totp_secret, s) === code);
  if (step === undefined) return false;
  const { numUpdatedRows } = await audited(db, authAudit(person, reason), (tx) => tx.updateTable('person')
    .set({ totp_last_step: step, failed_logins: 0 }).where('id', '=', person.id).where('totp_last_step', '<', String(step))
    .executeTakeFirstOrThrow());
  return numUpdatedRows > 0n;
}

/** Checks each credential given; any failure counts toward lockout. */
async function prove(db: Kysely<DB>, person: Person, proof: Proof, reason: string): Promise<void> {
  if (person.locked_at) refuse(423, 'this account is locked');
  const passed = (proof.password === undefined || await verifyPassword(proof.password, person.password_hash))
    && (proof.code === undefined || await spendTotp(db, person, proof.code, reason));
  if (passed) return;
  await audited(db, authAudit(person, 'Failed authentication'), (tx) => tx.updateTable('person').set({
    failed_logins: sql`failed_logins + 1`,
    locked_at: sql`case when failed_logins + 1 >= ${LOCKOUT_AFTER_FAILURES} then clock_timestamp() end`,
  }).where('id', '=', person.id).execute());
  notValid();
}

export async function reauthenticate(db: Kysely<DB>, ctx: ActorContext, proof: Required<Proof>, step: string): Promise<void> {
  const person = await db.selectFrom('person').selectAll().where('id', '=', ctx.person.id).executeTakeFirstOrThrow();
  await prove(db, person, proof, `Re-authenticate to sign ${step}`);
}

/** Builds the ActorContext from the session cookie. Reads the session tables directly: no context exists yet to scope by. */
export async function actorFor(db: Kysely<DB>, token: string | undefined): Promise<ActorContext> {
  const session = token && await db.selectFrom('session')
    .innerJoin('person', 'person.id', 'session.person_id').innerJoin('lab', 'lab.lab_id', 'session.lab_id')
    .select(['session.id', 'session.created_at', 'session.last_seen_at', 'person.id as personId', 'person.username',
      'person.display_name', 'person.customer_id', 'person.locked_at', 'lab.lab_id', 'lab.code', 'lab.name'])
    .where('token_hash', '=', hashToken(token)).where('ended_at', 'is', null).executeTakeFirst();
  if (!session) return refuse(401, 'sign in first');
  const now = Date.now();
  if (session.locked_at || now - session.last_seen_at.getTime() > IDLE_LIMIT_MS || now - session.created_at.getTime() > ABSOLUTE_LIMIT_MS) {
    await db.updateTable('session').set({ ended_at: new Date() }).where('id', '=', session.id).execute();
    refuse(401, 'the session has ended; sign in again');
  }
  await db.updateTable('session').set({ last_seen_at: new Date() }).where('id', '=', session.id).execute();
  const roles = await db.selectFrom('membership').select('role')
    .where('lab_id', '=', session.lab_id).where('person_id', '=', session.personId).execute();
  return {
    person: { id: session.personId, username: session.username, displayName: session.display_name, customerId: session.customer_id },
    lab: { id: session.lab_id, code: session.code, name: session.name },
    roles: roles.map((r) => r.role),
  };
}

const credential = { type: 'string', minLength: 1, maxLength: 200 } as const;

export function loginRoutes(app: FastifyInstance, db: Kysely<DB>): void {
  app.post<{ Body: { username: string; password: string } }>('/api/login', {
    schema: { body: { type: 'object', required: ['username', 'password'], additionalProperties: false,
      properties: { username: credential, password: credential } } },
  }, async (req) => {
    const person = await db.selectFrom('person').selectAll().where('username', '=', req.body.username).executeTakeFirst();
    if (!person) return notValid();
    await prove(db, person, { password: req.body.password }, 'Sign in');
    const ticket = randomBytes(32).toString('base64url');
    pendingLogins.set(ticket, { personId: person.id, until: Date.now() + PENDING_LOGIN_MS });
    return { next: 'totp', ticket };
  });

  app.post<{ Body: { ticket: string; code: string } }>('/api/login/totp', {
    schema: { body: { type: 'object', required: ['ticket', 'code'], additionalProperties: false,
      properties: { ticket: credential, code: { type: 'string', pattern: '^[0-9]{6}$' } } } },
  }, async (req, reply) => {
    const pending = pendingLogins.get(req.body.ticket);
    if (!pending || pending.until < Date.now()) return notValid();
    const person = await db.selectFrom('person').selectAll().where('id', '=', pending.personId).executeTakeFirstOrThrow();
    await prove(db, person, { code: req.body.code }, 'Sign in');
    pendingLogins.delete(req.body.ticket);
    const membership = await db.selectFrom('membership').select('lab_id').where('person_id', '=', person.id)
      .orderBy('lab_id').executeTakeFirst() ?? refuse(403, 'this account belongs to no Lab');
    const token = randomBytes(32).toString('base64url');
    await db.insertInto('session').values({ lab_id: membership.lab_id, person_id: person.id, token_hash: hashToken(token) }).execute();
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/', httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production',
    });
    return actorFor(db, token);
  });
}

export function logoutRoute(app: FastifyInstance, db: Kysely<DB>): void {
  app.post('/api/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE]!;
    await db.updateTable('session').set({ ended_at: new Date() }).where('token_hash', '=', hashToken(token)).execute();
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ended: true };
  });
}
