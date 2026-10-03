import type { DB, Json } from '@lims/db';
import {
  type ActorContext,
  actorUsername,
  type AuditedTable,
  auditedRecords,
  auditOp,
  type ChainVerification,
  chainVerification,
  currentLabel,
  describeTrail,
  imagesOf,
  instantKey,
  type Instant,
  isAuditedTable,
  type RecordIds,
  recordKey,
  referencedRecords,
  type RowImage,
  type RowSnapshot,
  routes,
  type StoredInstant,
  storedInstants,
  type TimedEntry,
  type Trail,
  type ZonedInstant,
} from '@lims/domain';
import {
  type ExpressionBuilder,
  type ExpressionWrapper,
  type Kysely,
  type RawBuilder,
  type SqlBool,
  sql,
} from 'kysely';
import type { FastifyBaseLogger } from 'fastify';
import { Value } from 'typebox/value';
import type { App } from './app.ts';
import { openChainIncidents } from './incident.ts';
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
/** `at` on `zone`'s wall clock, ISO 8601 to the microsecond with the zone's offset, rendered by the database so that no host clock formats it; null when `at` may be null. */
export const onWallClock = <At>(at: RawBuilder<At>, zone: RawBuilder<unknown>) => sql<
  null extends At ? Instant | null : Instant
>`
  to_char(${at} at time zone ${zone}, 'YYYY-MM-DD"T"HH24:MI:SS.US')
    || case when (${at} at time zone ${zone}) < (${at} at time zone 'UTC') then '-' else '+' end
    || to_char(greatest((${at} at time zone ${zone}) - (${at} at time zone 'UTC'),
                        (${at} at time zone 'UTC') - (${at} at time zone ${zone})), 'HH24:MI')`;
/** A Signature's time on the wall clock of the zone it was signed in, which no later change to its Lab's zone moves. */
export const signedAtLab = onWallClock(sql.ref<Date>('signature.signed_at'), sql.ref('signature.signed_time_zone')).as(
  'signedAtLab',
);
const entryAt = sql.ref('audit_entry.at');
/** Selected as text, not a Date: the driver's Date keeps milliseconds, and order and labels compare `at` to the microsecond, as the hash renders it. */
const atText = inUtc(entryAt);
const atLabText = sql<Instant | null>`(
  select ${onWallClock(entryAt, sql.ref('z.zone'))}
    from lims.lab l cross join lateral (select lims.lab_time_zone_at(l.lab_id, audit_entry.at) as zone) z
   where l.lab_id::text = audit_entry.chain)`;
const rowId = sql<string>`coalesce(new_row, old_row)->>'id'`;
const rowIdOf = (table: AuditedTable) => sql<string>`coalesce(new_row, old_row)->>${recordKey(table)}`;
const newIdOf = (table: AuditedTable) => sql<string>`new_row->>${recordKey(table)}`;
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
            eb.or([...(ids.length > 0 ? [eb(newIdOf(table), 'in', ids)] : []), ...byUsername]),
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

/** Each stored instant as the database renders it, in UTC and on the wall clock of the zone its row kept, else of the zone `labId`'s chain records in force at that instant, so that no host clock formats one and no zone change moves one. */
export async function storedInstantsIn(
  scope: Scope,
  labId: string,
  wanted: ZonedInstant[],
): Promise<Map<string, StoredInstant>> {
  const value = sql`${sql.ref('v.stored')}::timestamptz`;
  const { rows } = await sql<StoredInstant & ZonedInstant>`
    select v.stored, v.zone, ${inUtc(value)} as at, ${onWallClock(value, sql.ref('z.zone'))} as at_lab
      from unnest(${wanted.map((w) => w.stored)}::text[], ${wanted.map((w) => w.zone)}::text[]) as v(stored, zone)
     cross join lateral (select coalesce(v.zone, lims.lab_time_zone_at(${labId}::uuid, ${value})) as zone) z`.execute(
    scope.company,
  );
  return new Map(rows.map(({ stored, zone, ...rendered }) => [instantKey({ stored, zone }), rendered]));
}

async function trailOf(scope: Scope, root: { table: AuditedTable; id: string }, where: Where): Promise<Trail> {
  const entries = await rawEntries(scope, where);
  if (entries.length === 0) refuse('notFound', `This Lab has no such ${auditedRecords[root.table].kind}.`);
  const { timeZone } = await scope.company
    .selectFrom('lab')
    .select('timeZone')
    .where('labId', '=', scope.ctx.lab.id)
    .executeTakeFirstOrThrow();
  const images = await imagesFor(scope, entries);
  const instants = await storedInstantsIn(scope, scope.ctx.lab.id, storedInstants(entries));
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
  if (req.actor.person.customerId !== null) refuse('role', 'The Audit Trail is not shown to a Customer User.');
  return labScope(db, req.actor);
}

/** Whether a record is one this Lab already sees: a Method or a signature statement always, a Person through a Membership here, a Customer or Submission through a Sample here, and of the Labs only this one. */
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
    case 'lab':
      return id === scope.ctx.lab.id;
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
          .executeTakeFirst()) ?? refuse('notFound', 'This Lab has no such Test.');
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
        refuse('notFound', `This Lab has no such ${auditedRecords[table].kind}.`);
      return trailOf(scope, { table, id }, (eb) =>
        eb.and([eb('chain', '=', chainOf(scope, table)), eb('tableName', '=', table), eb(rowIdOf(table), '=', id)]),
      );
    },
  });

  app.route({
    ...routes.verifyAuditTrail,
    handler: async (req) => {
      if (!req.actor.roles.includes('QA')) refuse('role', 'Verifying the Audit Trail is a QA action.');
      const { at, chains } = await labScope(db, req.actor).verifyAuditTrail();
      return { at, chains: await chainVerifications(db, req.log, req.actor, chains) };
    },
  });
}

/** A chain as the database recomputed it, before QA reads it. */
export type RecomputedChain = Awaited<ReturnType<Scope['verifyAuditTrail']>>['chains'][number];

/**
 * Reads each recomputed chain as QA sees it; each break opens its System Incident, or answers the one that records it
 * already, so no break is shown without a record.
 */
export async function chainVerifications(
  db: Kysely<DB>,
  log: FastifyBaseLogger,
  requester: ActorContext,
  chains: RecomputedChain[],
): Promise<ChainVerification[]> {
  const verified = [];
  for (const { chain, chainId, lastEntry, breaks } of chains)
    verified.push(chainVerification(chain, lastEntry, await openChainIncidents(db, log, requester, chainId, breaks)));
  return verified;
}
