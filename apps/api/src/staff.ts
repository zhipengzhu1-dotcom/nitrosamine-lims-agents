import { randomBytes } from 'node:crypto';
import { type DB, postgresFault } from '@lims/db';
import { type ActorContext, administrationApart, routes, staffRefusal } from '@lims/domain';
import { type Kysely, sql } from 'kysely';
import type { App } from './app.ts';
import { hashToken, sessionEnd, type SessionLimits, sourceAddressOf } from './auth.ts';
import { refuse } from './refuse.ts';
import { labScope, type LabQueries, type Scope, type WriteQueries } from './scope.ts';

function adminScope(db: Kysely<DB>, actor: ActorContext): Scope {
  const refused = staffRefusal(actor.roles);
  if (refused) refuse(refused.kind, refused.message);
  return labScope(db, actor);
}

/** The staff this Lab's Admin sees: those with a Membership here, and those whose identity was checked here; Customer Users have portal accounts instead. */
async function staffOf(q: LabQueries, labId: string, only?: string) {
  const memberships = await q.from('membership').select(['personId', 'role']).orderBy('role').execute();
  const members = [...new Set(memberships.map((m) => m.personId))];
  let people = q.company
    .selectFrom('person')
    .leftJoin('identityVerification as iv', 'iv.id', 'person.identityVerificationId')
    .leftJoin('person as checker', 'checker.id', 'iv.checkedBy')
    .select([
      'person.id',
      'person.username',
      'person.displayName as printedName',
      sql<boolean>`person.password_hash is not null`.as('credentialSet'),
      sql<boolean>`exists (select from lims.authenticator a where a.person_id = person.id)`.as('authenticatorEnrolled'),
      'iv.checkedAt as identityVerifiedAt',
      'checker.displayName as identityVerifiedBy',
      'iv.evidence as identityEvidence',
    ])
    .where((eb) =>
      eb.or([...(members.length > 0 ? [eb('person.id', 'in', members)] : []), eb('iv.checkedInLabId', '=', labId)]),
    )
    .where('person.customerId', 'is', null)
    .orderBy('person.displayName');
  if (only) people = people.where('person.id', '=', only);
  const rows = await people.execute();
  return rows.map((person) =>
    Object.assign(person, { roles: memberships.filter((m) => m.personId === person.id).map((m) => m.role) }),
  );
}

async function onePerson(q: LabQueries, labId: string, personId: string) {
  const [person] = await staffOf(q, labId, personId);
  return person ?? refuse('notFound', 'This Lab’s staff has no such person.');
}

/** The database refuses Admin beside a business role across every Lab, which this Lab's scope cannot see. */
function heldApart(error: unknown): never {
  if (postgresFault(error)?.sqlstate === 'LA008') refuse(administrationApart.kind, administrationApart.message);
  throw new Error('granting a Membership failed', { cause: error });
}

/** What the database says when the acting Admin issued the person's enrolment grant. */
function notTheGrantIssuer(error: unknown): never {
  if (postgresFault(error)?.sqlstate === 'LA016')
    refuse('guard', 'A one-time link comes from an Admin who did not issue the person’s enrolment grant.');
  throw new Error('issuing a one-time link failed', { cause: error });
}

/**
 * A fresh one-time link for the person, never from the Admin who issued their enrolment grant; the LIMS keeps only its
 * hash, and only the newest link counts.
 */
async function issueLink(q: WriteQueries, personId: string) {
  const token = randomBytes(32).toString('base64url');
  const { expiresAt } = await q.company
    .insertInto('credentialLink')
    .values({ personId, tokenHash: hashToken(token) })
    .returning('expiresAt')
    .executeTakeFirstOrThrow()
    .catch(notTheGrantIssuer);
  return { token, expiresAt };
}

/** What the database says when the issuer is the person, the Admin who created the account or one who issued its one-time link. */
function secondAdmin(error: unknown): never {
  if (postgresFault(error)?.sqlstate === 'LA016')
    refuse(
      'guard',
      'An enrolment grant comes from a second Admin: not the person, and not an Admin who created the account or issued its one-time link.',
    );
  throw new Error('issuing an enrolment grant failed', { cause: error });
}

/**
 * A fresh enrolment grant for the person from the acting Admin, whom the database holds to be a second Admin; the
 * LIMS keeps only its hash, only the newest grant counts, and the issue is an Access Event on the person.
 */
async function issueEnrolmentGrant(q: WriteQueries, actor: ActorContext, personId: string, sourceAddress: string) {
  const token = randomBytes(32).toString('base64url');
  const { expiresAt } = await q.company
    .insertInto('enrolmentGrant')
    .values({ personId, issuedBy: actor.person.id, tokenHash: hashToken(token) })
    .returning('expiresAt')
    .executeTakeFirstOrThrow()
    .catch(secondAdmin);
  const roles = await q.from('membership').select('role').where('personId', '=', personId).orderBy('role').execute();
  await q.accessEvent({
    kind: 'EnrolmentGrantIssued',
    subjectId: personId,
    roles: roles.map((m) => m.role),
    sourceAddress,
  });
  return { token, expiresAt };
}

const LISTED_ACCESS_EVENTS = 100;

/**
 * A page of a person's Access Events as this Lab's Admin reads them: the newest, or the newest before `before`, one of
 * theirs that this Lab sees. Each Lockout lists the sessions here that it ended, at its instant, whether or not a
 * request or the sweep has ended them yet.
 */
async function accessEventsOf(
  db: Kysely<DB>,
  actor: ActorContext,
  limits: SessionLimits,
  personId: string,
  before: string | null,
) {
  const scope = adminScope(db, actor);
  const person = await onePerson(scope, actor.lab.id, personId);
  const theirs = scope.accessEvents().where('subjectId', '=', personId);
  let page = theirs.select([
    'id',
    'kind',
    'at',
    'workstationId',
    sql<string | null>`host(source_address)`.as('sourceAddress'),
    'failureReason',
  ]);
  if (before !== null) {
    const cursor = theirs.where('id', '=', before);
    if (!(await cursor.select('id').executeTakeFirst()))
      refuse('notFound', 'This person has no such Access Event in this Lab.');
    // The database reads the cursor's instant, which a JavaScript Date would cut to milliseconds. The `<=` bound repeats
    // the `or` so that an index on `at` can start its scan at the cursor.
    const at = cursor.select('at');
    page = page.where((eb) => eb.and([eb('at', '<=', at), eb.or([eb('at', '<', at), eb('id', '>', before)])]));
  }
  const rows = await page
    .orderBy('at', 'desc')
    .orderBy('id')
    .limit(LISTED_ACCESS_EVENTS + 1)
    .execute();
  const ended = await scope
    .sessions()
    .innerJoin('person', 'person.id', 'session.personId')
    .innerJoin('accessEvent as lockout', (join) =>
      join
        .onRef('lockout.subjectId', '=', 'session.personId')
        .on('lockout.kind', '=', 'Lockout')
        .on(sql<boolean>`${sessionEnd(limits)} = lockout.at`),
    )
    .select(['lockout.id as lockoutId', 'session.id', 'session.createdAt as signedInAt', 'session.workstationId'])
    .where('session.personId', '=', personId)
    .orderBy('session.createdAt')
    .execute();
  const workstations = await scope.from('workstation').select(['id', 'name']).execute();
  const workstation = (id: string | null) => workstations.find((w) => w.id === id)?.name ?? null;
  const events = rows.slice(0, LISTED_ACCESS_EVENTS).map((e) => {
    const listed = {
      id: e.id,
      at: e.at,
      workstation: workstation(e.workstationId),
      sourceAddress: e.sourceAddress,
      failureReason: e.failureReason,
    };
    if (e.kind !== 'Lockout') return Object.assign(listed, { kind: e.kind });
    const endedSessions = ended
      .filter((s) => s.lockoutId === e.id)
      .map((s) => ({ id: s.id, signedInAt: s.signedInAt, workstation: workstation(s.workstationId) }));
    return Object.assign(listed, { kind: e.kind, endedSessions });
  });
  return {
    person: { id: person.id, printedName: person.printedName, username: person.username },
    events,
    earlier: rows.length > LISTED_ACCESS_EVENTS ? (events.at(-1)?.id ?? null) : null,
  };
}

/** The Admin's staff-account routes: each write is audited under the Admin with the step's name or the reason given. */
export function staffRoutes(app: App, db: Kysely<DB>, limits: SessionLimits): void {
  app.route({
    ...routes.accessEvents,
    handler: (req) => accessEventsOf(db, req.actor, limits, req.params.id, null),
  });

  app.route({
    ...routes.earlierAccessEvents,
    handler: (req) => accessEventsOf(db, req.actor, limits, req.params.id, req.params.before),
  });

  app.route({
    ...routes.staff,
    handler: async (req) => {
      const scope = adminScope(db, req.actor);
      const labId = req.actor.lab.id;
      const awaitingAccount = await scope.company
        .selectFrom('identityVerification as iv')
        .innerJoin('person as checker', 'checker.id', 'iv.checkedBy')
        .leftJoin('person', 'person.identityVerificationId', 'iv.id')
        .select(['iv.id', 'iv.printedName', 'iv.evidence', 'checker.displayName as checkedBy', 'iv.checkedAt'])
        .where('iv.checkedInLabId', '=', labId)
        .where('person.id', 'is', null)
        .orderBy('iv.checkedAt')
        .execute();
      return { people: await staffOf(scope, labId), awaitingAccount };
    },
  });

  app.route({
    ...routes.recordIdentityVerification,
    handler: async (req) => {
      const { actor } = req;
      return adminScope(db, actor).write('Record an Identity Verification', 'Admin', (q) =>
        q.company
          .insertInto('identityVerification')
          .values({ ...req.body, checkedBy: actor.person.id, checkedInLabId: actor.lab.id })
          .returning(['id', 'printedName', 'evidence', 'checkedAt'])
          .executeTakeFirstOrThrow()
          .then((verification) => ({ ...verification, checkedBy: actor.person.displayName })),
      );
    },
  });

  app.route({
    ...routes.createAccount,
    handler: async (req) => {
      const { identityVerificationId, username } = req.body;
      const labId = req.actor.lab.id;
      return adminScope(db, req.actor).write('Create a staff account', 'Admin', async (q) => {
        const verification =
          (await q.company
            .selectFrom('identityVerification as iv')
            .leftJoin('person', 'person.identityVerificationId', 'iv.id')
            .select(['iv.printedName', 'person.id as accountId'])
            .where('iv.id', '=', identityVerificationId)
            .where('iv.checkedInLabId', '=', labId)
            .executeTakeFirst()) ??
          refuse('guard', 'Record an Identity Verification in this Lab before creating the account.');
        if (verification.accountId) refuse('state', 'This Identity Verification already has an account.');
        const created =
          (await q.company
            .insertInto('person')
            .values({ username, displayName: verification.printedName, identityVerificationId })
            .onConflict((oc) => oc.column('username').doNothing())
            .returning('id')
            .executeTakeFirst()) ?? refuse('state', `The username ${username} is taken.`);
        const link = await issueLink(q, created.id);
        return { person: await onePerson(q, labId, created.id), link };
      });
    },
  });

  app.route({
    ...routes.issueLink,
    handler: async (req) => {
      const { personId } = req.body;
      const labId = req.actor.lab.id;
      return adminScope(db, req.actor).write('Issue a new one-time link', 'Admin', async (q) => {
        const person = await onePerson(q, labId, personId);
        if (person.credentialSet) refuse('state', `The person ${person.printedName} has already set a password.`);
        return { person, link: await issueLink(q, personId) };
      });
    },
  });

  app.route({
    ...routes.issueEnrolmentGrant,
    handler: async (req) => {
      const { personId } = req.body;
      const labId = req.actor.lab.id;
      return adminScope(db, req.actor).write('Issue an enrolment grant', 'Admin', async (q) => {
        const person = await onePerson(q, labId, personId);
        if (person.authenticatorEnrolled)
          refuse('state', `The person ${person.printedName} has already enrolled an authenticator.`);
        return { person, grant: await issueEnrolmentGrant(q, req.actor, personId, sourceAddressOf(req)) };
      });
    },
  });

  app.route({
    ...routes.grantMembership,
    handler: async (req) => {
      const { personId, role, reason } = req.body;
      const labId = req.actor.lab.id;
      return adminScope(db, req.actor).write(reason, 'Admin', async (q) => {
        const person = await onePerson(q, labId, personId);
        if (person.roles.includes(role))
          refuse('state', `The person ${person.printedName} already holds ${role} in this Lab.`);
        if (!person.identityVerifiedAt)
          refuse('guard', 'A staff role goes only to a staff account with an Identity Verification.');
        await q.insert('membership', { personId, role }).execute().catch(heldApart);
        return onePerson(q, labId, personId);
      });
    },
  });

  app.route({
    ...routes.changePrintedName,
    handler: async (req) => {
      const { personId, printedName, reason } = req.body;
      const labId = req.actor.lab.id;
      return adminScope(db, req.actor).write(reason, 'Admin', async (q) => {
        await onePerson(q, labId, personId);
        await q.company.updateTable('person').set({ displayName: printedName }).where('id', '=', personId).execute();
        return onePerson(q, labId, personId);
      });
    },
  });
}
