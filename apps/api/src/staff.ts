import { randomBytes } from 'node:crypto';
import { type DB, postgresFault } from '@lims/db';
import { type ActorContext, administrationApart, routes, staffRefusal } from '@lims/domain';
import { type Kysely, sql } from 'kysely';
import type { App } from './app.ts';
import { hashToken } from './auth.ts';
import { refuse } from './refuse.ts';
import { labScope, type LabQueries, type Scope } from './scope.ts';

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
    .select([
      'person.id',
      'person.username',
      'person.displayName as printedName',
      sql<boolean>`person.password_hash is not null`.as('credentialSet'),
      'iv.checkedAt as identityVerifiedAt',
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
  return person ?? refuse('notFound', 'no such person among this Lab’s staff');
}

/** The Admin's staff-account routes: each write is audited under the Admin with the step's name or the reason given. */
export function staffRoutes(app: App, db: Kysely<DB>): void {
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
          .then((check) => ({ ...check, checkedBy: actor.person.displayName })),
      );
    },
  });

  app.route({
    ...routes.createAccount,
    handler: async (req) => {
      const { identityVerificationId, username } = req.body;
      const labId = req.actor.lab.id;
      const token = randomBytes(32).toString('base64url');
      return adminScope(db, req.actor).write('Create a staff account', 'Admin', async (q) => {
        const check =
          (await q.company
            .selectFrom('identityVerification as iv')
            .leftJoin('person', 'person.identityVerificationId', 'iv.id')
            .select(['iv.printedName', 'person.id as accountId'])
            .where('iv.id', '=', identityVerificationId)
            .where('iv.checkedInLabId', '=', labId)
            .executeTakeFirst()) ??
          refuse('guard', 'record an Identity Verification in this Lab before creating the account');
        if (check.accountId) refuse('state', 'this Identity Verification already has an account');
        const created =
          (await q.company
            .insertInto('person')
            .values({ username, displayName: check.printedName, identityVerificationId })
            .onConflict((oc) => oc.doNothing())
            .returning('id')
            .executeTakeFirst()) ?? refuse('state', `the username ${username} is taken`);
        const link = await q.company
          .insertInto('credentialLink')
          .values({ personId: created.id, tokenHash: hashToken(token) })
          .returning('expiresAt')
          .executeTakeFirstOrThrow();
        return { person: await onePerson(q, labId, created.id), link: { token, expiresAt: link.expiresAt } };
      });
    },
  });

  app.route({
    ...routes.grantMembership,
    handler: async (req) => {
      const { personId, role, reason } = req.body;
      const labId = req.actor.lab.id;
      const scope = adminScope(db, req.actor);
      try {
        return await scope.write(reason, 'Admin', async (q) => {
          await onePerson(q, labId, personId);
          await q
            .insert('membership', { personId, role })
            .onConflict((oc) => oc.doNothing())
            .execute();
          return onePerson(q, labId, personId);
        });
      } catch (error) {
        // The database holds Admin apart from the work across every Lab, which this Lab's scope cannot see.
        if (postgresFault(error)?.sqlstate === 'LA008') refuse(administrationApart.kind, administrationApart.message);
        throw new Error(`granting ${role} failed`, { cause: error });
      }
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
