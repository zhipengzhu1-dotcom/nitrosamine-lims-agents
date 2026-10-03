import type { DB, Json } from '@lims/db';
import {
  type ActorContext,
  actorUsername,
  type AuditedTable,
  type AuditTrailVerification,
  type Authenticator,
  auditedRecords,
  auditOp,
  type ChainReading,
  chainReading,
  currentLabel,
  describeTrail,
  imagesOf,
  instantKey,
  type Instant,
  isAuditedTable,
  type RecordIds,
  type RecordVersionRef,
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
import { type ExpressionBuilder, type ExpressionWrapper, type Kysely, type SqlBool, sql } from 'kysely';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { Value } from 'typebox/value';
import type { App } from './app.ts';
import { openChainIncidents, openSystemIncident } from './incident.ts';
import { refuse } from './refuse.ts';
import {
  labScope,
  type RecomputedChain,
  type Scope,
  VERIFY_READ_LIMIT_SECONDS,
  inUtc,
  onWallClock,
  type VerifiedChains,
  type VerifyOptions,
} from './scope.ts';

function snapshot(row: Json | null): RowSnapshot | null {
  if (row === null) return null;
  if (typeof row !== 'object' || Array.isArray(row)) throw new Error('an Audit Trail row snapshot is not an object');
  return row;
}

function opOf(op: string): TimedEntry['op'] {
  if (Value.Check(auditOp, op)) return op;
  throw new Error(`an Audit Trail entry has the op ${op}`);
}

/**
 * What every read shows of a Signature and the Record Version it was given on, from `signature` joined to
 * `recordVersion`; `signedAtLab` is on the wall clock of the zone it was signed in, which no later change to its Lab's
 * zone moves. The record noun and `unsigned` depend on the record kind, so each read selects them itself.
 */
export const signatureReplyColumns = [
  'signature.meaning',
  'signature.printedName as signer',
  'signature.username',
  'signature.role',
  sql<Authenticator | null>`signature.authenticator`.as('authenticator'),
  'signature.signedAt',
  onWallClock(sql.ref<Date>('signature.signed_at'), sql.ref('signature.signed_time_zone')).as('signedAtLab'),
  'recordVersion.version',
  'recordVersion.canonicalForm',
  sql<string>`encode(record_version.content_hash, 'hex')`.as('contentHash'),
] as const;

/** A row selected with `signatureReplyColumns` as the Signature a reply carries, with the signed record named `record`. */
export function signatureReply<Row extends RecordVersionRef>(
  { version, canonicalForm, contentHash, ...signature }: Row,
  record: string,
) {
  return { ...signature, record, recordVersion: { version, canonicalForm, contentHash } };
}
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
    case 'picklist_reason':
      return true;
    case 'chain_verification':
      return Boolean(
        await scope.company
          .selectFrom('chainVerification')
          .select('id')
          .where('id', '=', id)
          .where('chain', 'in', [scope.ctx.lab.id, 'company'])
          .executeTakeFirst(),
      );
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
    case 'critical_data_change':
    case 'critical_data_change_decision':
      return true;
  }
}

export function trailRoutes(app: App, db: Kysely<DB>, readLimitSeconds?: number): void {
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
      const changes = await scope.from('criticalDataChange').select('id').where('testId', '=', id).execute();
      // A Critical Data Change's Record Version and its Approved Signature name the change, not the Test.
      const ids = [test.id, test.sampleId, ...(test.reportId ? [test.reportId] : []), ...changes.map((c) => c.id)];
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
    handler: (req) =>
      verify(db, req, { everyEntry: false, readLimitSeconds: readLimitSeconds ?? VERIFY_READ_LIMIT_SECONDS.routine }),
  });
  app.route({
    ...routes.recomputeAuditTrail,
    handler: (req) =>
      verify(db, req, { everyEntry: true, readLimitSeconds: readLimitSeconds ?? VERIFY_READ_LIMIT_SECONDS.everyEntry }),
  });
}

async function verify(db: Kysely<DB>, req: FastifyRequest, options: VerifyOptions): Promise<AuditTrailVerification> {
  if (!req.actor.roles.includes('QA')) refuse('role', 'Verifying the Audit Trail is a QA action.');
  const scope = labScope(db, req.actor);
  const { at, chains: recomputed } = await chainsOf(db, req, await scope.verifyAuditTrail(options));
  const chains = await chainReadings(db, req.log, req.actor, recomputed);
  const intact = recomputed.filter((c) => c.breaks.length === 0 && c.lastEntry !== '0');
  if (intact.length > 0)
    await scope.write('Verify chain', 'QA', (q) =>
      q.company
        .insertInto('chainVerification')
        .values(
          intact.map((c) => ({
            chain: c.chainId,
            through: c.lastEntry,
            head: Buffer.from(c.head, 'hex'),
            recomputedFrom: c.recomputedFrom,
            verifiedBy: req.actor.person.id,
          })),
        )
        .execute(),
    );
  return { at, chains };
}

/**
 * The recomputed chains, or, once a System Incident under the request's reference records the overrun, the refusal
 * that names the chain whose recompute did not finish within the read limit, the limit and that incident; the incident
 * is written on `db`'s own connection, so it lands while the read's transaction is aborted.
 */
export async function chainsOf(
  db: Kysely<DB>,
  req: FastifyRequest,
  verified: VerifiedChains,
): Promise<Extract<VerifiedChains, { chains: RecomputedChain[] }>> {
  if (!('timedOut' in verified)) return verified;
  await openSystemIncident(db, req, verified.error);
  return refuse(
    'state',
    `Verifying the ${verified.timedOut === 'lab' ? 'Lab' : 'company'} chain did not finish within ${verified.withinSeconds} seconds, and System Incident ${req.id} records it. Try again when the LIMS is less busy.`,
  );
}

/**
 * Reads each recomputed chain as QA sees it; each break opens its System Incident, or answers the one that records it
 * already, so no break is shown without a record.
 */
export async function chainReadings(
  db: Kysely<DB>,
  log: FastifyBaseLogger,
  requester: ActorContext,
  chains: RecomputedChain[],
): Promise<ChainReading[]> {
  const verified = [];
  for (const { chain, chainId, lastEntry, breaks, recomputedFrom, verifiedBefore } of chains)
    verified.push(
      chainReading(chain, lastEntry, await openChainIncidents(db, log, requester, chainId, breaks), {
        recomputedFrom,
        verifiedBefore,
      }),
    );
  return verified;
}
