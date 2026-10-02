import type { DB } from '@lims/db';
import { nextStep, routes } from '@lims/domain';
import { type Kysely, sql } from 'kysely';
import type { App } from './app.ts';
import { refuse } from './refuse.ts';
import { labScope, type Scope } from './scope.ts';
import { factsFor } from './steps.ts';
import { trailRoutes } from './trail.ts';

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
  return {
    test,
    report: report ? { number: report.number } : null,
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
      ? await scope
          .from('signature')
          .innerJoin('person', 'person.id', 'signature.personId')
          .select([
            'signature.meaning',
            'person.displayName as signer',
            'signature.signedAt',
            'signature.recordTable as record',
            sql<string>`encode(signature.content_hash, 'hex')`.as('contentHash'),
          ])
          .where('signature.recordId', 'in', ids)
          .orderBy('signature.signedAt')
          .execute()
      : [],
    next: nextStep(test.state, scope.ctx.roles, await factsFor(scope, scope.ctx, test)),
  };
}

export function readRoutes(app: App, db: Kysely<DB>): void {
  trailRoutes(app, db);
  app.route({ ...routes.me, handler: async (req) => req.actor });

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
      const { report, test, result, signatures } = await testView(labScope(db, req.actor), req.params.id);
      return report
        ? { report, test, result, signatures }
        : refuse('notFound', 'this Test has no released Test Report');
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
            'openedAt',
            'loggedAt',
          ])
          .where('reference', '=', req.params.reference)
          .executeTakeFirst()) ?? refuse('notFound', `no System Incident has the reference ${req.params.reference}`)
      );
    },
  });
}
