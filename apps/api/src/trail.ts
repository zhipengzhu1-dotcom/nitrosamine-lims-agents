import type { DB, Json } from '@lims/db';
import {
  actorUsername,
  type AuditedTable,
  auditedRecords,
  auditOp,
  chainVerification,
  currentLabel,
  describeTrail,
  imagesOf,
  type Instant,
  isAuditedTable,
  type RecordIds,
  referencedRecords,
  type RowImage,
  type RowSnapshot,
  routes,
  type StoredInstant,
  storedInstants,
  type TimedEntry,
  type Trail,
} from '@lims/domain';
import {
  type ExpressionBuilder,
  type ExpressionWrapper,
  type Kysely,
  type RawBuilder,
  type SqlBool,
  sql,
} from 'kysely';
import { Value } from 'typebox/value';
import type { App } from './app.ts';
import { refuse } from './refuse.ts';
import { labScope, type Scope } from './scope.ts';

function snapshot(row: Json | null): RowSnapshot | null {
  if (row === null) return null;
  if (typeof row !== 'object' || Array.isArray(row)) throw new Error('an Audit Trail row snapshot is not an object');
  return row;
}

function opOf(op: string): TimedEntry['op'] {
  if (Value.Check(auditOp, op)) return op;
  throw new Error(`an Audit Trail entry has the op ${op}`);
}

const inUtc = (at: RawBuilder<unknown>) =>
  sql<Instant>`to_char(${at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const onWallClock = (at: RawBuilder<unknown>, zone: RawBuilder<unknown>) => sql<Instant>`
  to_char(${at} at time zone ${zone}, 'YYYY-MM-DD"T"HH24:MI:SS.US')
    || case when (${at} at time zone ${zone}) < (${at} at time zone 'UTC') then '-' else '+' end
    || to_char(greatest((${at} at time zone ${zone}) - (${at} at time zone 'UTC'),
                        (${at} at time zone 'UTC') - (${at} at time zone ${zone})), 'HH24:MI')`;
const entryAt = sql.ref('audit_entry.at');
/** Selected as text, not a Date: the driver's Date keeps milliseconds, and order and labels compare `at` to the microsecond, as the hash renders it. */
const atText = inUtc(entryAt);
const atLabText = sql<Instant | null>`(
  select ${onWallClock(entryAt, sql.ref('l.time_zone'))}
    from lims.lab l where l.lab_id::text = audit_entry.chain)`;
const rowId = sql<string>`coalesce(new_row, old_row)->>'id'`;
const newId = sql<string>`new_row->>'id'`;
const usernameOf = sql<string>`new_row->>'username'`;

export type Where = (eb: ExpressionBuilder<DB, 'auditEntry'>) => ExpressionWrapper<DB, 'auditEntry', SqlBool>;

const chainOf = (scope: Scope, table: AuditedTable) =>
  auditedRecords[table].chain === 'lab' ? scope.ctx.lab.id : 'company';

/** The entries `where` picks from this Lab's chain and the company chain, as stored. */
export async function rawEntries(scope: Scope, where: Where): Promise<TimedEntry[]> {
  const rows = await scope
    .trail()
    .select([
      'chain',
      'seq',
      atText.as('at'),
      atLabText.as('atLab'),
      'actor',
      'role',
      'reason',
      'tableName as table',
      'op',
      'oldRow',
      'newRow',
      'transactionId',
      sql<string>`encode(prev_hash, 'hex')`.as('prevHash'),
      sql<string>`encode(hash, 'hex')`.as('hash'),
    ])
    .where(where)
    .execute();
  return rows.map((e) => ({
    chain: e.chain,
    seq: e.seq,
    at: e.at,
    atLab: e.atLab,
    actor: e.actor,
    role: e.role,
    reason: e.reason,
    table: e.table,
    op: opOf(e.op),
    oldRow: snapshot(e.oldRow),
    newRow: snapshot(e.newRow),
    transactionId: e.transactionId,
    prevHash: e.prevHash,
    hash: e.hash,
  }));
}

async function imagesWanted(scope: Scope, wanted: RecordIds[], usernames: string[]): Promise<RowImage[]> {
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
            eb('chain', '=', chainOf(scope, table)),
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

/** Every image of every record the entries reference, following references until no label needs a record not yet loaded. */
export async function imagesFor(scope: Scope, entries: TimedEntry[]): Promise<RowImage[]> {
  const usernames = [...new Set(entries.map((e) => actorUsername(e.actor)).filter((u) => u !== null))];
  const loaded = new Map<AuditedTable, Set<string>>();
  const unloaded = (wanted: RecordIds[]) =>
    wanted
      .map(({ table, ids }) => ({ table, ids: ids.filter((id) => !loaded.get(table)?.has(id)) }))
      .filter(({ ids }) => ids.length > 0);
  let wanted = unloaded(referencedRecords(imagesOf(entries)));
  if (usernames.length > 0 && !wanted.some((w) => w.table === 'person')) wanted.push({ table: 'person', ids: [] });
  const images: RowImage[] = [];
  while (wanted.length > 0) {
    for (const { table, ids } of wanted) loaded.set(table, new Set([...(loaded.get(table) ?? []), ...ids]));
    const found = await imagesWanted(scope, wanted, usernames);
    usernames.length = 0;
    images.push(...found);
    wanted = unloaded(referencedRecords(found));
  }
  return images;
}

async function storedInstantsIn(scope: Scope, zone: string, stored: string[]): Promise<Map<string, StoredInstant>> {
  const value = sql.ref('v.stored');
  const { rows } = await sql<StoredInstant & { stored: string }>`
    select v.stored, ${inUtc(sql`${value}::timestamptz`)} as at,
           ${onWallClock(sql`${value}::timestamptz`, sql`${zone}::text`)} as at_lab
      from unnest(${stored}::text[]) as v(stored)`.execute(scope.company);
  return new Map(rows.map(({ stored: key, ...rendered }) => [key, rendered]));
}

async function trailOf(scope: Scope, root: { table: AuditedTable; id: string }, where: Where): Promise<Trail> {
  const entries = await rawEntries(scope, where);
  if (entries.length === 0) refuse('notFound', `no such ${auditedRecords[root.table].kind} in this Lab`);
  const { timeZone } = await scope.company
    .selectFrom('lab')
    .select('timeZone')
    .where('labId', '=', scope.ctx.lab.id)
    .executeTakeFirstOrThrow();
  const images = await imagesFor(scope, entries);
  const instants = await storedInstantsIn(scope, timeZone, storedInstants(entries));
  return {
    record: {
      table: root.table,
      id: root.id,
      kind: auditedRecords[root.table].kind,
      label: currentLabel([...images, ...imagesOf(entries)], root.table, root.id),
    },
    labZone: timeZone,
    entries: describeTrail(entries, images, scope.ctx.lab.id, instants),
  };
}

function staffScope(db: Kysely<DB>, req: { actor: Scope['ctx'] }): Scope {
  if (req.actor.person.customerId !== null) refuse('role', 'the Audit Trail is not shown to a Customer User');
  return labScope(db, req.actor);
}

/** Whether a company record is one this Lab already sees: a Method or a signature statement always, a Person through a Membership here, a Customer or Submission through a Sample here. */
async function seenFromLab(scope: Scope, table: AuditedTable, id: string): Promise<boolean> {
  switch (table) {
    case 'method':
    case 'signature_statement':
    case 'signing_role':
      return true;
    case 'person':
      return Boolean(await scope.from('membership').select('personId').where('personId', '=', id).executeTakeFirst());
    case 'customer':
      return Boolean(
        await scope
          .from('sample')
          .innerJoin('submission', 'submission.id', 'sample.submissionId')
          .select('sample.id')
          .where('submission.customerId', '=', id)
          .executeTakeFirst(),
      );
    case 'submission':
      return Boolean(await scope.from('sample').select('id').where('submissionId', '=', id).executeTakeFirst());
    case 'sample':
    case 'test':
    case 'result':
    case 'test_report':
    case 'record_version':
    case 'signature':
    case 'audit_export':
    case 'reauthentication':
      return true;
  }
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
          .leftJoin('testReport', 'testReport.testId', 'test.id')
          .select(['test.id', 'test.sampleId', 'sample.submissionId', 'testReport.id as reportId'])
          .where('test.id', '=', id)
          .executeTakeFirst()) ?? refuse('notFound', 'no such Test in this Lab');
      const ids = [test.id, test.sampleId, ...(test.reportId ? [test.reportId] : [])];
      return trailOf(scope, { table: 'test', id }, (eb) =>
        eb.or([
          eb.and([
            eb('chain', '=', scope.ctx.lab.id),
            eb.or([
              eb(rowId, 'in', ids),
              eb(sql<string>`coalesce(new_row, old_row)->>'test_id'`, '=', id),
              eb(sql<string>`coalesce(new_row, old_row)->>'record_id'`, 'in', ids),
              eb(
                sql<string>`coalesce(new_row, old_row)->>'record_version_id'`,
                'in',
                scope.from('recordVersion').select(sql<string>`id::text`.as('id')).where('recordId', 'in', ids),
              ),
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
      if (!(await seenFromLab(scope, table, id)))
        refuse('notFound', `no such ${auditedRecords[table].kind} in this Lab`);
      return trailOf(scope, { table, id }, (eb) =>
        eb.and([eb('chain', '=', chainOf(scope, table)), eb('tableName', '=', table), eb(rowId, '=', id)]),
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
