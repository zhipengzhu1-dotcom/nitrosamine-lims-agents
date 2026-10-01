import type { DB, Json } from '@lims/db';
import { nextStep, type RowSnapshot, routes } from '@lims/domain';
import { type Kysely, sql } from 'kysely';
import type { App } from './app.ts';
import { labScope, refuse, type Scope } from './scope.ts';
import { factsFor } from './steps.ts';

function visibleTests(scope: Scope) {
  const { customerId } = scope.ctx.person;
  const tests = scope
    .from('test')
    .innerJoin('sample', 'sample.id', 'test.sample_id')
    .innerJoin('submission', 'submission.id', 'sample.submission_id')
    .innerJoin('customer', 'customer.id', 'submission.customer_id')
    .innerJoin('method', 'method.id', 'test.method_id')
    .leftJoin('person as assignee', 'assignee.id', 'test.assignee_id')
    .select([
      'test.id',
      'test.state',
      'test.gxp_class as gxpClass',
      'sample.number as sampleNumber',
      'sample.description',
      'sample.received_at as receivedAt',
      'customer.name as customer',
      'method.code as methodCode',
      'method.version as methodVersion',
      'method.title as methodTitle',
      'assignee.display_name as assignee',
      'test.sample_id',
      'test.method_id',
      'test.assignee_id',
    ]);
  return customerId === null ? tests : tests.where('submission.customer_id', '=', customerId);
}

function snapshot(row: Json | null): RowSnapshot | null {
  if (row === null) return null;
  if (typeof row !== 'object' || Array.isArray(row)) throw new Error('an Audit Trail row snapshot is not an object');
  return row;
}

async function testView(scope: Scope, id: string) {
  const test = (await visibleTests(scope).where('test.id', '=', id).executeTakeFirst()) ?? refuse(404, 'no such Test');
  const report = await scope.from('test_report').select(['id', 'number']).where('test_id', '=', id).executeTakeFirst();
  const ids = [test.id, test.sample_id, ...(report ? [report.id] : [])];
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
            'injection_sequence_ref as injectionSequenceRef',
            'notebook_ref as notebookRef',
            sql<string>`performed_on::text`.as('performedOn'),
          ])
          .where('test_id', '=', id)
          .executeTakeFirst()) ?? null)
      : null,
    signatures: visibleToActor
      ? await scope
          .from('signature')
          .innerJoin('person', 'person.id', 'signature.person_id')
          .select([
            'signature.meaning',
            'person.display_name as signer',
            'signature.signed_at as signedAt',
            'signature.record_table as record',
            sql<string>`encode(signature.content_hash, 'hex')`.as('contentHash'),
          ])
          .where('signature.record_id', 'in', ids)
          .orderBy('signature.signed_at')
          .execute()
      : [],
    auditTrail: isCustomer
      ? []
      : await scope
          .auditTrail()
          .select([
            'seq',
            'at',
            'actor',
            'role',
            'reason',
            'table_name as table',
            'op',
            'old_row as oldRow',
            'new_row as newRow',
          ])
          .where(sql<boolean>`coalesce(new_row, old_row)->>'id' = any(${ids}) or coalesce(new_row, old_row)->>'test_id' = ${id}
        or coalesce(new_row, old_row)->>'record_id' = any(${ids})`)
          .orderBy('seq')
          .execute()
          .then((entries) => entries.map((e) => ({ ...e, oldRow: snapshot(e.oldRow), newRow: snapshot(e.newRow) }))),
    next: nextStep(test.state, scope.ctx.roles, await factsFor(scope, scope.ctx, test)),
  };
}

export function readRoutes(app: App, db: Kysely<DB>): void {
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
          .innerJoin('person', 'person.id', 'membership.person_id')
          .select(['person.id', 'person.display_name as displayName'])
          .where('membership.role', '=', 'Analyst')
          .orderBy('person.display_name')
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
      return report ? { report, test, result, signatures } : refuse(404, 'this Test has no released Test Report');
    },
  });

  app.route({
    ...routes.verifyAuditTrail,
    handler: async (req) => {
      if (!req.actor.roles.includes('QA')) refuse(403, 'verifying the Audit Trail is a QA action');
      const scope = labScope(db, req.actor);
      return { at: new Date(), lab: await scope.verifyChain('lab'), company: await scope.verifyChain('company') };
    },
  });
}
