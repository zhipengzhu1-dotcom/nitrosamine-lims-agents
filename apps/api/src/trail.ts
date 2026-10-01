import type { DB, Json } from '@lims/db';
import {
  type AuditedTable,
  auditedRecords,
  chainVerification,
  describeTrail,
  type HistoryEntry,
  type Instant,
  isAuditedTable,
  type RawEntry,
  type RowSnapshot,
  referencedRecords,
  routes,
  type Trail,
} from '@lims/domain';
import { type ExpressionBuilder, type ExpressionWrapper, type Kysely, type SqlBool, sql } from 'kysely';
import type { App } from './app.ts';
import { refuse } from './refuse.ts';
import { labScope, type Scope } from './scope.ts';

function snapshot(row: Json | null): RowSnapshot | null {
  if (row === null) return null;
  if (typeof row !== 'object' || Array.isArray(row)) throw new Error('an Audit Trail row snapshot is not an object');
  return row;
}

/** The database's check on `op` admits these three; anything else is a failure, not a refusal. */
function opOf(op: string): RawEntry['op'] {
  if (op === 'INSERT' || op === 'UPDATE' || op === 'DELETE') return op;
  throw new Error(`an Audit Trail entry has the op ${op}`);
}

/** The entry's instant to the microsecond, as the hashed bytes render it, so that order and labels never depend on a Date's milliseconds. */
const atText = sql<Instant>`to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const rowId = sql<string>`coalesce(new_row, old_row)->>'id'`;
const newId = sql<string>`new_row->>'id'`;
const usernameOf = sql<string>`new_row->>'username'`;

type Where = (eb: ExpressionBuilder<DB, 'auditEntry'>) => ExpressionWrapper<DB, 'auditEntry', SqlBool>;

async function rawEntries(scope: Scope, where: Where): Promise<RawEntry[]> {
  const rows = await scope
    .trail()
    .select([
      'chain',
      'seq',
      atText.as('at'),
      'actor',
      'role',
      'reason',
      'tableName as table',
      'op',
      'oldRow',
      'newRow',
      sql<string>`encode(prev_hash, 'hex')`.as('prevHash'),
      sql<string>`encode(hash, 'hex')`.as('hash'),
    ])
    .where(where)
    .execute();
  return rows.map((e) => ({
    chain: e.chain,
    seq: e.seq,
    at: e.at,
    actor: e.actor,
    role: e.role,
    reason: e.reason,
    table: e.table,
    op: opOf(e.op),
    oldRow: snapshot(e.oldRow),
    newRow: snapshot(e.newRow),
    prevHash: e.prevHash,
    hash: e.hash,
  }));
}

/** Every captured image of the records the entries reference, and of the people who acted, from their own chains. */
async function historyFor(scope: Scope, entries: RawEntry[]): Promise<HistoryEntry[]> {
  const usernames = [...new Set(entries.map((e) => e.actor).filter((a) => a.startsWith('person:')))].map((a) =>
    a.slice('person:'.length),
  );
  const wanted = referencedRecords(entries);
  if (usernames.length > 0 && !wanted.some((w) => w.table === 'person')) wanted.push({ table: 'person', ids: [] });
  if (wanted.length === 0) return [];
  const rows = await scope
    .trail()
    .select(['tableName as table', atText.as('at'), 'newRow as row'])
    .where((eb) =>
      eb.or(
        wanted.map(({ table, ids }) => {
          const byUsername = table === 'person' && usernames.length > 0 ? [eb(usernameOf, 'in', usernames)] : [];
          return eb.and([
            eb('tableName', '=', table),
            eb('chain', '=', auditedRecords[table].chain === 'lab' ? scope.ctx.lab.id : 'company'),
            eb.or([...(ids.length > 0 ? [eb(newId, 'in', ids)] : []), ...byUsername]),
          ]);
        }),
      ),
    )
    .execute();
  return rows.flatMap(({ table, at, row }) => {
    const image = snapshot(row);
    return image && isAuditedTable(table) ? [{ table, at, row: image }] : [];
  });
}

async function trailOf(scope: Scope, root: { table: AuditedTable; id: string }, where: Where): Promise<Trail> {
  const entries = await rawEntries(scope, where);
  if (entries.length === 0) refuse('notFound', `no such ${auditedRecords[root.table].kind} in this Lab`);
  const { timeZone } = await scope.company
    .selectFrom('lab')
    .select('timeZone')
    .where('labId', '=', scope.ctx.lab.id)
    .executeTakeFirstOrThrow();
  const described = describeTrail(entries, await historyFor(scope, entries), { id: scope.ctx.lab.id, zone: timeZone });
  const own = described.findLast((e) => e.record.table === root.table && e.record.id === root.id)?.record;
  return {
    record: own ?? { table: root.table, id: root.id, kind: auditedRecords[root.table].kind, label: root.id },
    labZone: timeZone,
    entries: described,
  };
}

/** A Customer User never reads a trail, in the portal or by request; every other role reads the trails of what it can see. */
function staffScope(db: Kysely<DB>, req: { actor: Scope['ctx'] }): Scope {
  if (req.actor.person.customerId !== null) refuse('role', 'the Audit Trail is not shown to a Customer User');
  return labScope(db, req.actor);
}

export function trailRoutes(app: App, db: Kysely<DB>): void {
  app.route({
    ...routes.testTrail,
    handler: async (req) => {
      const scope = staffScope(db, req);
      const { id } = req.params;
      const test =
        (await scope
          .from('test')
          .innerJoin('sample', 'sample.id', 'test.sampleId')
          .select(['test.id', 'test.sampleId', 'sample.submissionId'])
          .where('test.id', '=', id)
          .executeTakeFirst()) ?? refuse('notFound', 'no such Test in this Lab');
      const report = await scope.from('testReport').select('id').where('testId', '=', id).executeTakeFirst();
      const ids = [test.id, test.sampleId, ...(report ? [report.id] : [])];
      return trailOf(scope, { table: 'test', id }, (eb) =>
        eb.or([
          eb.and([
            eb('chain', '=', scope.ctx.lab.id),
            eb.or([
              eb(rowId, 'in', ids),
              eb(sql<string>`coalesce(new_row, old_row)->>'test_id'`, '=', id),
              eb(sql<string>`coalesce(new_row, old_row)->>'record_id'`, 'in', ids),
            ]),
          ]),
          eb.and([eb('chain', '=', 'company'), eb('tableName', '=', 'submission'), eb(rowId, '=', test.submissionId)]),
        ]),
      );
    },
  });

  app.route({
    ...routes.recordTrail,
    handler: async (req) => {
      const scope = staffScope(db, req);
      const { table, id } = req.params;
      const chain = auditedRecords[table].chain === 'lab' ? scope.ctx.lab.id : 'company';
      return trailOf(scope, { table, id }, (eb) =>
        eb.and([eb('chain', '=', chain), eb('tableName', '=', table), eb(rowId, '=', id)]),
      );
    },
  });

  app.route({
    ...routes.verifyAuditTrail,
    handler: async (req) => {
      if (!req.actor.roles.includes('QA')) refuse('role', 'verifying the Audit Trail is a QA action');
      const { at, chains } = await labScope(db, req.actor).verifyAuditTrail();
      return {
        at,
        chains: chains.map((c) => chainVerification(c.chain, c.lastEntry, c.firstFailure)),
      };
    },
  });
}
