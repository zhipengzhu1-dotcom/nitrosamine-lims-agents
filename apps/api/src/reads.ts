import type { DB } from '@lims/db';
import { nextStep, recordKind, routes } from '@lims/domain';
import { type Kysely, sql } from 'kysely';
import type { App } from './app.ts';
import { refuse } from './refuse.ts';
import { labScope, type Scope } from './scope.ts';
import { factsFor, latestVersion, signedVersions, statementInForce } from './steps.ts';
import { staffRoutes } from './staff.ts';
import { trailRoutes } from './trail.ts';
import { auditExportRoutes } from './audit-export.ts';

function visibleTests(scope: Scope) {
  const { customerId } = scope.ctx.person;
  const tests = scope
    .from('test')
    .innerJoin('sample', 'sample.id', 'test.sampleId')
    .innerJoin('submission', 'submission.id', 'sample.submissionId')
    .innerJoin('customer', 'customer.id', 'submission.customerId')
    .innerJoin('method', 'method.id', 'test.methodId')
    .leftJoin('person as assignee', 'assignee.id', 'test.assigneeId')
    .select([
      'test.id',
      'test.state',
      'test.gxpClass',
      'sample.number as sampleNumber',
      'sample.description',
      'sample.receivedAt',
      'customer.name as customer',
      'method.code as methodCode',
      'method.version as methodVersion',
      'method.title as methodTitle',
      'assignee.displayName as assignee',
      'test.sampleId',
      'test.methodId',
      'test.assigneeId',
    ]);
  return customerId === null ? tests : tests.where('submission.customerId', '=', customerId);
}

async function testView(scope: Scope, id: string) {
  const test =
    (await visibleTests(scope).where('test.id', '=', id).executeTakeFirst()) ?? refuse('notFound', 'no such Test');
  const report = await scope.from('testReport').select(['id', 'number']).where('testId', '=', id).executeTakeFirst();
  const ids = [test.id, test.sampleId, ...(report ? [report.id] : [])];
  const isCustomer = scope.ctx.person.customerId !== null;
  const visibleToActor = !isCustomer || test.state === 'Reported';
  const latest = visibleToActor ? await latestVersion(scope, 'test', id) : null;
  const next = nextStep(test.state, scope.ctx.roles, await factsFor(scope, scope.ctx, test));
  return {
    test,
    recordVersion: latest && {
      version: latest.version,
      canonicalForm: latest.canonicalForm,
      contentHash: latest.contentHash,
    },
    report: report ? { id: report.id, number: report.number } : null,
    result: visibleToActor
      ? ((await scope
          .from('result')
          .select([
            'analyte',
            'value',
            'unit',
            'injectionSequenceRef',
            'notebookRef',
            sql<string>`performed_on::text`.as('performedOn'),
          ])
          .where('testId', '=', id)
          .executeTakeFirst()) ?? null)
      : null,
    signatures: visibleToActor
      ? await signedVersions(scope)
          .select([
            'signature.meaning',
            'signature.printedName as signer',
            'signature.username',
            'signature.role',
            'signature.signedAt',
            'recordVersion.recordTable as record',
            'recordVersion.version',
            'recordVersion.canonicalForm',
            sql<string>`encode(record_version.content_hash, 'hex')`.as('contentHash'),
            sql<boolean>`exists (select from lims.record_version later
              where later.lab_id = record_version.lab_id and later.record_table = record_version.record_table
                and later.record_id = record_version.record_id and later.version > record_version.version)`.as(
              'unsigned',
            ),
          ])
          .where('recordVersion.recordId', 'in', ids)
          .orderBy('signature.signedAt')
          .execute()
          .then((rows) =>
            rows.map(({ record, version, canonicalForm, contentHash, ...signature }) => ({
              ...signature,
              record: recordKind(record),
              recordVersion: { version, canonicalForm, contentHash },
            })),
          )
      : [],
    next,
    statement: isCustomer ? null : await statementInForce(scope),
  };
}

export function readRoutes(app: App, db: Kysely<DB>): void {
  trailRoutes(app, db);
  auditExportRoutes(app, db);
  staffRoutes(app, db);
  app.route({ ...routes.me, handler: async (req) => ({ ...req.actor, session: req.sessionClock }) });

  app.route({
    ...routes.lookups,
    handler: async (req) => {
      const scope = labScope(db, req.actor);
      return {
        methods: await scope.company
          .selectFrom('method')
          .select(['id', 'code', 'version', 'title'])
          .orderBy('code')
          .execute(),
        analysts: await scope
          .from('membership')
          .innerJoin('person', 'person.id', 'membership.personId')
          .select(['person.id', 'person.displayName'])
          .where('membership.role', '=', 'Analyst')
          .orderBy('person.displayName')
          .execute(),
      };
    },
  });

  app.route({
    ...routes.tests,
    handler: async (req) => visibleTests(labScope(db, req.actor)).orderBy('sample.number', 'desc').execute(),
  });

  app.route({ ...routes.test, handler: async (req) => testView(labScope(db, req.actor), req.params.id) });

  app.route({
    ...routes.report,
    handler: async (req) => {
      const scope = labScope(db, req.actor);
      const { report, test, result, signatures } = await testView(scope, req.params.id);
      if (!report) return refuse('notFound', 'this Test has no released Test Report');
      const { version, canonicalForm, contentHash } = await latestVersion(scope, 'test_report', report.id);
      return { report, recordVersion: { version, canonicalForm, contentHash }, test, result, signatures };
    },
  });

  app.route({
    ...routes.incident,
    handler: async (req) => {
      if (!req.actor.roles.some((role) => role === 'Admin' || role === 'QA'))
        refuse('role', 'reading a System Incident is an Admin or QA action');
      return (
        (await db
          .selectFrom('systemIncident')
          .select([
            'reference',
            'kind',
            'state',
            'step',
            'recordId',
            'requestedBy',
            'sessionLabId',
            'errorClass',
            'sqlstate',
            'constraintName',
            'subjectId',
            sql<string | null>`host(source_address)`.as('sourceAddress'),
            sql<string | null>`encode(typed_user_id_hmac, 'hex')`.as('typedUserIdHmac'),
            'openedAt',
            'loggedAt',
          ])
          .where('reference', '=', req.params.reference)
          .executeTakeFirst()) ?? refuse('notFound', `no System Incident has the reference ${req.params.reference}`)
      );
    },
  });
}
