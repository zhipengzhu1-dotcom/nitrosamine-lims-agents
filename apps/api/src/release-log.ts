import { type DB, postgresFault } from '@lims/db';
import { type ActorContext, type DemoException, realDataGate, type Role, routes, type SigningBody } from '@lims/domain';
import { type Kysely, sql } from 'kysely';
import type { App } from './app.ts';
import { type Login, reauthenticate, sourceAddressOf } from './auth.ts';
import { refuse } from './refuse.ts';
import { type LabQueries, labScope, type Scope, type WriteQueries } from './scope.ts';
import { statementInForce } from './steps.ts';

/** Anchoring of the Audit Trail is not built, so the gate reads it as not live until the build that makes it a record. */
const ANCHORING_LIVE = false;

const RECORDERS = new Set<Role>(['PlatformOperator', 'QA']);

/** QA approves an entry that brings a signature statement into force; the Platform Operator approves every other, as the apply trigger checks. */
const approverOf = (entry: { statementVersion: number | null }): Role =>
  entry.statementVersion === null ? 'PlatformOperator' : 'QA';

type Identity = { name: string; scope: string[] };
/** Read as text[], because the driver parses an array of a Postgres enum as one string. */
const exceptionColumns = [
  sql<DemoException[]>`records_exceptions::text[]`.as('recordsExceptions'),
  sql<DemoException[]>`lapses_exceptions::text[]`.as('lapsesExceptions'),
];
type VersionRef = { version: number; canonicalForm: number; contentHash: string };

function listed(q: LabQueries) {
  return q.company.selectFrom('releaseLogEntry').select([
    'id',
    'kind',
    'title',
    'summary',
    'release',
    'setsDataClass',
    'fileVaultPersonalKey',
    ...exceptionColumns,
    'statementVersion',
    sql<string | null>`convert_from(statement, 'UTF8')`.as('statement'),
    'recordedAt',
    sql<boolean>`lims.release_log_entry_approved(id)`.as('approved'),
    sql<Identity[]>`coalesce((select json_agg(json_build_object('name', s.name, 'scope', s.scope) order by s.name)
                                 from lims.service_identity as s where s.created_by_entry_id = release_log_entry.id), '[]')`.as(
      'identities',
    ),
    sql<VersionRef>`(select json_build_object('version', v.version, 'canonicalForm', v.canonical_form,
                                                'contentHash', encode(v.content_hash, 'hex'))
                         from lims.record_version as v
                        where v.record_table = 'release_log_entry' and v.record_id = release_log_entry.id
                        order by v.version desc limit 1)`.as('recordVersion'),
  ]);
}

const one = async (scope: Scope, id: string) =>
  (await listed(scope).where('id', '=', id).executeTakeFirst()) ??
  refuse('notFound', 'The LIMS has no such Release Log entry.');

/** Refuses an entry that would set the real data class while any gate condition is unmet, naming each one. The open demo exceptions and the fictional records are the database's own answers, which its class trigger checks again. */
async function gateReal(scope: Scope, login: Login, fileVaultPersonalKey: boolean): Promise<void> {
  const { openExceptions, fictionalRecords } = await scope.company
    .selectNoFrom([
      // Read as text[], because the driver parses an array of a Postgres enum as one string.
      sql<DemoException[]>`lims.open_demo_exceptions()::text[]`.as('openExceptions'),
      sql<string[]>`lims.fictional_records()`.as('fictionalRecords'),
    ])
    .executeTakeFirstOrThrow();
  const verdict = realDataGate({
    login,
    anchoringLive: ANCHORING_LIVE,
    fileVaultPersonalKey,
    openExceptions,
    fictionalRecords,
  });
  if (!verdict.allowed)
    refuse(
      'realDataRefused',
      `Setting the real data class is refused while these conditions are unmet: ${verdict.conditions.map((c) => c.slice(0, -1)).join('; ')}.`,
    );
}

/** lims.sign's and the apply trigger's own refusals (LA010, LA011) reach the operator as a refusal; any other failure is thrown with its cause. */
function signingRefused(error: unknown): never {
  const sqlstate = postgresFault(error)?.sqlstate;
  if ((sqlstate === 'LA010' || sqlstate === 'LA011') && error instanceof Error)
    refuse('signingRefused', `The Signature was refused: ${error.message}.`);
  throw new Error('signing failed', { cause: error });
}

/** The version a new signature statement must take: the one after the statement in force, so versions never skip or collide. */
const nextStatementVersion = async (scope: Scope) => (await statementInForce(scope)).version + 1;

async function seenEntryVersion(scope: Scope, entryId: string, signing: SigningBody) {
  const latest = await scope
    .companyVersions()
    .select(['id', 'version', sql<string>`encode(content_hash, 'hex')`.as('contentHash')])
    .where('recordTable', '=', 'release_log_entry')
    .where('recordId', '=', entryId)
    .orderBy('version', 'desc')
    .executeTakeFirstOrThrow();
  if (latest.version !== signing.recordVersion.version || latest.contentHash !== signing.recordVersion.contentHash)
    refuse('recordChanged', 'The Release Log entry changed since this screen loaded it. Read it again before signing.');
  if ((await statementInForce(scope)).version !== signing.statementVersion)
    refuse(
      'signingRefused',
      'The Signature Statement changed since this screen loaded it. Read it again before signing.',
    );
  return { id: latest.id, contentHash: signing.recordVersion.contentHash };
}

/** `GET /api/deployment`, public: the data class every screen shows a banner for while it is fictional. */
export function deploymentRoute(app: App, db: Kysely<DB>): void {
  app.route({
    ...routes.deployment,
    handler: () => db.selectFrom('deployment').select('dataClass').executeTakeFirstOrThrow(),
  });
}

/** Lists, records and approves Release Log entries; every effect of an entry takes hold only in the Approved Signature's transaction, in the database. */
export function releaseLogRoutes(app: App, db: Kysely<DB>, login: Login, release: string): void {
  const asStaff = (actor: ActorContext) => {
    if (actor.person.customerId !== null) refuse('role', 'The Release Log is read by staff.');
    return labScope(db, actor);
  };

  app.route({
    ...routes.releaseLog,
    handler: async (req) => {
      const scope = asStaff(req.actor);
      return {
        entries: await listed(scope).orderBy('recordedAt').execute(),
        statement: await statementInForce(scope),
      };
    },
  });

  app.route({
    ...routes.recordReleaseLogEntry,
    handler: async (req) => {
      const scope = asStaff(req.actor);
      const { identities = [], reason, statement, ...declared } = req.body;
      const role =
        req.actor.roles.find((r) => r === approverOf({ statementVersion: declared.statementVersion ?? null })) ??
        req.actor.roles.find((r) => RECORDERS.has(r)) ??
        refuse('role', 'A Release Log entry is recorded by the Platform Operator or QA.');
      if (declared.kind === 'Release' && declared.release === undefined)
        refuse('guard', 'A Release entry names its release.');
      if (declared.setsDataClass !== undefined && declared.fileVaultPersonalKey === undefined)
        refuse('guard', 'An entry setting the data class records whether the host holds a personal FileVault key.');
      if ((declared.statementVersion === undefined) !== (statement === undefined))
        refuse('guard', 'A new signature statement comes with its version, and a version with its statement.');
      if (
        declared.statementVersion !== undefined &&
        (declared.setsDataClass !== undefined ||
          declared.fileVaultPersonalKey !== undefined ||
          (declared.recordsExceptions ?? []).length > 0 ||
          (declared.lapsesExceptions ?? []).length > 0 ||
          identities.length > 0)
      )
        refuse(
          'guard',
          'An entry bringing a signature statement into force carries no other change, because QA approves it alone.',
        );
      if (declared.recordsExceptions?.some((x) => declared.lapsesExceptions?.includes(x)))
        refuse('guard', 'An entry records a demo exception or lapses it, not both.');
      if (declared.statementVersion !== undefined && declared.statementVersion !== (await nextStatementVersion(scope)))
        refuse('guard', 'A new signature statement takes the version after the one in force.');
      if (declared.setsDataClass === 'real') await gateReal(scope, login, declared.fileVaultPersonalKey ?? false);
      if (
        declared.setsDataClass === 'fictional' &&
        (await scope.company.selectFrom('deployment').select('dataClass').executeTakeFirstOrThrow()).dataClass === 'real'
      )
        refuse('state', 'The deployment holds real data, so no entry sets it back to the fictional data class.');
      const id = await scope.write(reason, role, async (q) => {
        const entry = await q.company
          .insertInto('releaseLogEntry')
          .values({ ...declared, statement: statement === undefined ? null : Buffer.from(statement) })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (identities.length > 0)
          await q.company
            .insertInto('serviceIdentity')
            .values(identities.map((i) => ({ name: i.name, scope: i.scope, createdByEntryId: entry.id })))
            .execute();
        return entry.id;
      });
      return one(scope, id);
    },
  });

  app.route({
    ...routes.approveReleaseLogEntry,
    handler: async (req) => {
      const scope = asStaff(req.actor);
      const { entryId, ...signing } = req.body;
      const entry = await one(scope, entryId);
      const role = approverOf(entry);
      if (!req.actor.roles.includes(role))
        refuse(
          'role',
          `A Release Log entry ${entry.statementVersion === null ? 'of the system' : 'bringing a signature statement into force'} is approved by ${role === 'QA' ? 'QA' : 'the Platform Operator'}.`,
        );
      if (entry.approved) refuse('state', 'This Release Log entry is already approved.');
      if (entry.statementVersion !== null && entry.statementVersion !== (await nextStatementVersion(scope)))
        refuse('state', 'Another signature statement came into force since this entry was recorded. Record it again.');
      const seen = await seenEntryVersion(scope, entry.id, signing);
      if (entry.setsDataClass === 'real') await gateReal(scope, login, entry.fileVaultPersonalKey ?? false);
      const reauthenticated = await reauthenticate(
        db,
        { actor: req.actor, session: req.sessionKey },
        { username: signing.username, password: signing.password },
        role,
        sourceAddressOf(req),
        'ReauthenticationFailed',
      );
      const sessionId = req.sessionKey.id;
      // An entry setting the data class says so before the transaction's first chain, so the database locks the
      // deployment row ahead of every chain, the order each captured write takes them in.
      const declareClassChange =
        entry.setsDataClass === null
          ? undefined
          : async (q: WriteQueries) => {
              await sql`select lims.declare_data_class_change()`.execute(q.company);
            };
      await scope.write(
        'Approve the Release Log entry',
        role,
        async (q) => {
          // The approval writes this Lab's chain (the proof, the Signature) before the company chain its effects write.
          await sql`select lims.lock_chains('company', ${req.sessionKey.labId}::text)`.execute(q.company);
          const proof = await q
            .insert('reauthentication', {
              sessionId,
              personId: req.actor.person.id,
              meaning: 'Approved',
              authenticator: 'Password',
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await sql`select lims.sign(${proof.id}, ${sessionId}, 'release_log_entry', ${entry.id}, ${seen.id},
                                     decode(${seen.contentHash}, 'hex'), ${signing.statementVersion}, 'Approved', ${release})`
            .execute(q.company)
            .catch(signingRefused);
        },
        reauthenticated,
        declareClassChange,
      );
      req.log.info({ entryId: entry.id }, 'release log entry approved');
      return one(scope, entry.id);
    },
  });
}
