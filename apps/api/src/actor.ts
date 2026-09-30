// Who is asking. Built per request from the session cookie, in the handler (ADR 0002). The
// session's state is derived from the database clock on every read: nothing here waits for the
// sweeper, and nothing here writes.

import { createHash, randomBytes } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@lims/db';
import type { Scope } from '@lims/db';
import type { CustomerId, LabId, PersonId, SessionId } from '@lims/domain/ids';
import type { Role } from '@lims/domain/machines';

export type StaffRole = Exclude<Role, 'CustomerUser'>;
export type CustomerRole = 'CustomerUser' | 'CustomerApprover';
export type ServiceIdentity = 'svc:seed' | 'svc:auth' | 'svc:session-sweeper';

type Signed = {
  readonly person: PersonId;
  readonly session: SessionId;
  readonly printedName: string;
  readonly username: string;
};

export type ActorContext =
  | (Signed & { readonly kind: 'staff'; readonly lab: LabId; readonly labCode: string; readonly zone: string; readonly roles: ReadonlySet<StaffRole> })
  | (Signed & { readonly kind: 'admin' })
  | (Signed & { readonly kind: 'customer'; readonly customer: CustomerId; readonly roles: ReadonlySet<CustomerRole> })
  | { readonly kind: 'service'; readonly identity: ServiceIdentity; readonly person: PersonId; readonly lab: LabId | null };

export type LockedSession = {
  readonly session: SessionId;
  readonly person: PersonId;
  readonly printedName: string;
  readonly username: string;
  readonly nativeName: string | null;
  /** The roles held where the session was opened, for the LockScreen's owner tile. */
  readonly roles: readonly string[];
  readonly lockReason: 'manual' | 'switch-user' | 'idle';
  /** When it locked: the stamp, or for an idle lock the instant the 15 minutes ran out. */
  readonly lockedAt: Date;
  /** The Lab's IANA zone, for the lock screen's clock and times. */
  readonly zone: string | null;
  readonly lab: LabId | null;
  readonly customer: CustomerId | null;
  readonly workstation: string;
};

/** An active session's actor, a locked session (only unlock and takeover act on it), or nobody. */
export type Requester = ActorContext | { readonly kind: 'locked'; readonly locked: LockedSession } | { readonly kind: 'nobody' };

export type SessionRead =
  | { readonly state: 'none' }
  | { readonly state: 'ended' }
  | { readonly state: 'locked'; readonly locked: LockedSession }
  | {
      readonly state: 'active';
      readonly actor: Exclude<ActorContext, { kind: 'service' }>;
      readonly nativeName: string | null;
      readonly workstation: string;
      readonly startedAt: Date;
      readonly idleLockAt: Date;
      readonly absoluteEndAt: Date;
      readonly epoch: string;
    };

export const scopeOf = (a: ActorContext): Scope =>
  a.kind === 'staff' ? { kind: 'lab', labId: a.lab }
  : a.kind === 'customer' ? { kind: 'customer', customerId: a.customer }
  : a.kind === 'service' && a.lab ? { kind: 'lab', labId: a.lab }
  : { kind: 'company' };

export const actingLab = (a: ActorContext): LabId | null => (a.kind === 'staff' ? a.lab : a.kind === 'service' ? a.lab : null);

/** A service holds no role of a person: SERVICE_COMMANDS says what it may run. */
export const holdsRole = (a: ActorContext, role: string): boolean =>
  a.kind === 'service' ? false
  : a.kind === 'admin' ? role === 'Admin'
  : (a.roles as ReadonlySet<string>).has(role);

/**
 * The commands each service identity may run through the pipeline, by name. The seed creates the
 * company's reference data and the demo people, and hands the demo accounts over; svc:auth and the
 * sweeper write directly and run no command.
 */
export const SERVICE_COMMANDS: Readonly<Record<ServiceIdentity, ReadonlySet<string>>> = {
  'svc:seed': new Set([
    'identity.createPerson', 'identity.reenrol',
    'reference.customer', 'reference.substance', 'reference.product', 'reference.method', 'reference.methodVersion',
    'reference.specification', 'reference.adoption', 'reference.equipment',
  ]),
  'svc:auth': new Set(),
  'svc:session-sweeper': new Set(),
};

const STAFF_PRECEDENCE: readonly StaffRole[] = ['LabManager', 'QA', 'Reviewer', 'Analyst', 'SampleCustodian'];

/** The role a person's own session actions are audited under when the command names none. */
export function primaryRole(a: ActorContext): string {
  switch (a.kind) {
    case 'admin': return 'Admin';
    case 'service': return a.identity;
    case 'staff': return STAFF_PRECEDENCE.find((r) => a.roles.has(r)) ?? 'Analyst';
    case 'customer': return a.roles.has('CustomerApprover') ? 'CustomerApprover' : 'CustomerUser';
  }
}

export const IDLE_LOCK_MINUTES = 15;

// ---------------------------------------------------------------------------------------------
// Session tokens
// ---------------------------------------------------------------------------------------------

/** The cookie value. The database stores only its SHA-256. */
export const newSessionToken = (): string => randomBytes(32).toString('base64url');
export const tokenHash = (token: string): Buffer => createHash('sha256').update(token).digest();

type SessionRow = {
  id: SessionId; person_id: PersonId; acting_lab_id: LabId | null; customer_id: CustomerId | null; workstation: string;
  started_at: Date; absolute_end_at: Date; locked_at: Date | null; lock_reason: 'manual' | 'switch-user' | 'idle' | null;
  last_activity: Date; state: 'active' | 'locked' | 'ended';
  printed_name: string; native_name: string | null; username: string | null;
  lab_code: string | null; iana_zone: string | null; unlocks: string;
};

/**
 * Reads the session named by a cookie token and derives its state at the database's now(). Pure
 * read: the activity time moves only through POST /api/session/activity, so a polling screen
 * cannot keep an idle session alive.
 */
export async function readSession(db: Kysely<DB>, token: string | undefined): Promise<SessionRead> {
  if (!token) return { state: 'none' };
  const { rows } = await sql<SessionRow>`
    select s.id, s.person_id, s.acting_lab_id, s.customer_id, s.workstation, s.started_at, s.absolute_end_at, s.locked_at, s.lock_reason,
           coalesce(a.last_activity_at, s.started_at) as last_activity,
           lims.session_state(s, coalesce(a.last_activity_at, s.started_at), now()) as state,
           p.printed_name, p.native_name, acc.username, l.code as lab_code, l.iana_zone,
           (select count(*) from lims.auth_event e where e.session_id = s.id and e.kind = 'unlock_session') as unlocks
      from lims.session s
      join lims.person p on p.id = s.person_id
      left join lims.account acc on acc.person_id = p.id
      left join lims.session_activity a on a.session_id = s.id
      left join lims.lab l on l.id = s.acting_lab_id
     where s.token_hash = ${tokenHash(token)}`.execute(db);
  const s = rows[0];
  if (!s) return { state: 'none' };
  if (s.state === 'ended') return { state: 'ended' };
  const base = { session: s.id, person: s.person_id, printedName: s.printed_name, username: s.username ?? '' };
  const grants = await db.selectFrom('role_grant').select(['role', 'lab_id', 'customer_id'])
    .where('person_id', '=', s.person_id).where('revoked_at', 'is', null).execute();
  if (s.state === 'locked') {
    const held = grants.filter((g) => (s.acting_lab_id ? g.lab_id === s.acting_lab_id : s.customer_id ? g.customer_id === s.customer_id : g.role === 'Admin'));
    return {
      state: 'locked',
      locked: {
        ...base, nativeName: s.native_name, roles: held.map((g) => g.role), lockReason: s.lock_reason ?? 'idle',
        lockedAt: s.locked_at ?? new Date(s.last_activity.getTime() + IDLE_LOCK_MINUTES * 60_000),
        zone: s.iana_zone, lab: s.acting_lab_id, customer: s.customer_id, workstation: s.workstation,
      },
    };
  }
  let actor: Exclude<ActorContext, { kind: 'service' }> | null = null;
  if (s.acting_lab_id) {
    const roles = new Set(grants.filter((g) => g.lab_id === s.acting_lab_id).map((g) => g.role as StaffRole));
    actor = { ...base, kind: 'staff', lab: s.acting_lab_id, labCode: s.lab_code ?? '', zone: s.iana_zone ?? 'UTC', roles };
  } else if (s.customer_id) {
    const roles = new Set(grants.filter((g) => g.customer_id === s.customer_id).map((g) => g.role as CustomerRole));
    actor = { ...base, kind: 'customer', customer: s.customer_id, roles };
  } else if (grants.some((g) => g.role === 'Admin')) {
    actor = { ...base, kind: 'admin' };
  }
  if (!actor) return { state: 'none' };
  return {
    state: 'active',
    actor,
    nativeName: s.native_name,
    workstation: s.workstation,
    startedAt: s.started_at,
    idleLockAt: new Date(s.last_activity.getTime() + IDLE_LOCK_MINUTES * 60_000),
    absoluteEndAt: s.absolute_end_at,
    epoch: `${s.id}:${s.unlocks}`,
  };
}

export const serviceActor = (identity: ServiceIdentity, person: PersonId, lab: LabId | null = null): ActorContext =>
  ({ kind: 'service', identity, person, lab });
