import { type DB, postgresFault } from '@lims/db';
import {
  type ActorContext,
  type DocumentActor,
  type DocumentFacts,
  type DocumentStepBody,
  type DocumentStepName,
  documentAuthors,
  documentRefusal,
  documentStepNames,
  documentStepRole,
  documentStepRoute,
  documentSteps,
  mayReadDocuments,
  openDocumentSteps,
  routes,
} from '@lims/domain';
import { type Kysely, sql, type UpdateObject } from 'kysely';
import type { App } from './app.ts';
import { type Credentials, reauthenticate, sourceAddressOf } from './auth.ts';
import { refuse } from './refuse.ts';
import { labScope, type WriteQueries } from './scope.ts';
import { proveReauthentication, signRecord, statementInForce } from './signing.ts';
import { signatureReply, signatureReplyColumns } from './trail.ts';

type Scope = ReturnType<typeof labScope>;

function readableBy(actor: ActorContext): void {
  if (!mayReadDocuments(actor.roles)) refuse('role', 'Reading the Document vault is a Lab staff action.');
}

const asDocumentActor = (actor: ActorContext): DocumentActor => ({
  username: actor.person.username,
  roles: actor.roles,
});

/**
 * A Document of the session's Lab with every version and its Signatures, the latest Record Version of the newest
 * version, and the facts the step registry decides on.
 */
async function readDocument(scope: Scope, id: string) {
  const document =
    (await scope.from('document').select(['id', 'number', 'documentType']).where('id', '=', id).executeTakeFirst()) ??
    refuse('notFound', 'No Document of this Lab has that id.');
  const versions = await scope
    .from('documentVersion')
    .innerJoin('person', 'person.id', 'documentVersion.authorId')
    .select([
      'documentVersion.id',
      'documentVersion.version',
      'documentVersion.status',
      'documentVersion.title',
      'documentVersion.body',
      'person.username',
      'person.displayName',
      sql<string | null>`to_char(document_version.effective_date, 'YYYY-MM-DD')`.as('effectiveDate'),
      'documentVersion.abandonReason',
    ])
    .where('documentVersion.documentId', '=', id)
    .orderBy('documentVersion.version', 'desc')
    .execute();
  const [newest] = versions;
  if (!newest) throw new Error(`Document ${id} has no version`);
  const signatures = await scope
    .from('signature')
    .innerJoin('recordVersion', (j) =>
      j
        .onRef('recordVersion.labId', '=', 'signature.labId')
        .onRef('recordVersion.id', '=', 'signature.recordVersionId'),
    )
    .select(signatureReplyColumns)
    .select([
      'recordVersion.recordId',
      sql<boolean>`record_version.version < (select max(v.version) from lims.record_version v
        where v.lab_id = record_version.lab_id and v.record_table = record_version.record_table
          and v.record_id = record_version.record_id)`.as('unsigned'),
    ])
    .where('recordVersion.recordTable', '=', 'document_version')
    .where(
      'recordVersion.recordId',
      'in',
      versions.map((v) => v.id),
    )
    .orderBy('signature.signedAt')
    .execute();
  const latest = await scope
    .from('recordVersion')
    .select(['id', 'version', 'canonicalForm', sql<string>`encode(content_hash, 'hex')`.as('contentHash')])
    .where('recordTable', '=', 'document_version')
    .where('recordId', '=', newest.id)
    .orderBy('version', 'desc')
    .executeTakeFirst();
  const signers = (meaning: string) =>
    signatures.filter((s) => s.recordId === newest.id && s.meaning === meaning).map((s) => s.username);
  const facts: DocumentFacts = {
    status: newest.status,
    author: newest.username,
    authored: signers('Authored'),
    reviewed: signers('Reviewed'),
  };
  const view = {
    ...document,
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      title: v.title,
      body: v.body,
      author: { username: v.username, displayName: v.displayName },
      effectiveDate: v.effectiveDate,
      abandonReason: v.abandonReason,
      signatures: signatures.filter((s) => s.recordId === v.id).map((s) => signatureReply(s, 'Document version')),
    })),
    recordVersion: latest
      ? { version: latest.version, canonicalForm: latest.canonicalForm, contentHash: latest.contentHash }
      : null,
    statement: await statementInForce(scope.company),
    steps: openDocumentSteps(facts, asDocumentActor(scope.ctx)),
  };
  return { view, facts, seen: latest?.id ?? null };
}

/** The Lab's today on the database clock in the Lab's time zone, as YYYY-MM-DD, which orders as text. */
async function labToday(db: Kysely<DB>, labId: string): Promise<string> {
  const { rows } = await sql<{ today: string }>`
    select to_char(now() at time zone time_zone, 'YYYY-MM-DD') as today from lims.lab where lab_id = ${labId}`.execute(
    db,
  );
  return rows[0]?.today ?? refuse('notFound', "The session's Lab is not recorded.");
}

/** The database's own refusal of a move (LA014) means another session moved the version first; the bench reloads. */
function movedOn(error: unknown): never {
  if (postgresFault(error)?.sqlstate === 'LA014' && error instanceof Error)
    refuse('stale', `The Document has moved on: ${error.message}. Reload it.`);
  throw new Error('the Document step failed in the database', { cause: error });
}

/**
 * What a step writes on the newest version once its Signature, if any, is given. An Approved version whose Effective
 * Date is the Lab's today or earlier takes effect at once, and the version it replaces is Superseded.
 */
async function move<K extends DocumentStepName>(
  q: WriteQueries,
  name: K,
  body: DocumentStepBody<K>,
  versionId: string,
  facts: DocumentFacts,
  due: boolean,
): Promise<void> {
  const from = facts.status;
  const moved = async (change: UpdateObject<DB, 'documentVersion'>, status = from) => {
    const result = await q
      .update('documentVersion')
      .set(change)
      .where('id', '=', versionId)
      .where('status', '=', status)
      .executeTakeFirstOrThrow()
      .catch(movedOn);
    if (!result.numUpdatedRows) refuse('stale', 'The Document has moved on. Reload it.');
  };
  const input: DocumentStepBody<DocumentStepName>['input'] = body.input;
  if (name === 'signAuthored') await moved({ status: 'InReview' });
  if (name === 'abandon' && 'reason' in input) await moved({ status: 'Abandoned', abandonReason: input.reason });
  if (name === 'signApproved' && 'effectiveDate' in input) {
    await moved({ status: 'Approved' });
    if (!due) return;
    const { documentId } = await q
      .from('documentVersion')
      .select('documentId')
      .where('id', '=', versionId)
      .executeTakeFirstOrThrow();
    await q
      .update('documentVersion')
      .set({ status: 'Superseded' })
      .where('documentId', '=', documentId)
      .where('status', '=', 'Effective')
      .execute()
      .catch(movedOn);
    await moved({ status: 'Effective' }, 'Approved');
  }
}

function registerDocumentStep<K extends DocumentStepName>(
  app: App,
  db: Kysely<DB>,
  credentials: Credentials,
  name: K,
  release: string,
): void {
  const step = documentSteps[name];
  const route = documentStepRoute(name);
  app.post<{ Body: DocumentStepBody<K> }>(route.url, { schema: route.schema }, async (req) => {
    const { actor, body } = req;
    readableBy(actor);
    const scope = labScope(db, actor);
    const { view, facts, seen } = await readDocument(scope, body.documentId);
    const [newest] = view.versions;
    if (!newest) throw new Error(`Document ${body.documentId} has no version`);
    const refused = documentRefusal(name, facts, asDocumentActor(actor), body.input);
    if (refused) refuse(refused.kind, refused.message);
    const role = documentStepRole(name, facts, asDocumentActor(actor));
    if (!role) throw new Error(`the registry let ${name} through with no role`);
    const signature =
      step.signs === null
        ? null
        : (body.signature ?? refuse('malformed', `The ${name} step needs the signer's credentials.`));
    if (signature) {
      if (
        !seen ||
        signature.recordVersion.version !== view.recordVersion?.version ||
        signature.recordVersion.contentHash !== view.recordVersion.contentHash
      )
        refuse('recordChanged', 'The Document changed since this screen loaded it. Read it again before signing.');
      if (view.statement.version !== signature.statementVersion)
        refuse(
          'signingRefused',
          'The Signature Statement changed since this screen loaded it. Read it again before signing.',
        );
    }
    let due = false;
    if ('effectiveDate' in body.input) {
      const today = await labToday(db, actor.lab.id);
      if (body.input.effectiveDate < today)
        refuse('guard', `The Effective Date is ${today}, the Lab's today, or later.`);
      due = body.input.effectiveDate === today;
    }
    const reauthenticated =
      step.signs !== null && signature
        ? await reauthenticate(
            db,
            credentials,
            { actor, session: req.sessionKey },
            { username: signature.username, password: signature.password, code: signature.code },
            role,
            sourceAddressOf(req),
            'ReauthenticationFailed',
          )
        : undefined;
    await scope.write(
      name,
      role,
      async (q) => {
        if (name === 'signApproved' && 'effectiveDate' in body.input)
          await q
            .update('documentVersion')
            .set({ effectiveDate: body.input.effectiveDate })
            .where('id', '=', newest.id)
            .where('status', '=', 'InReview')
            .execute()
            .catch(movedOn);
        if (step.signs !== null && signature && reauthenticated && seen) {
          const proof = await proveReauthentication(q, actor, req.sessionKey.id, step.signs, reauthenticated);
          await signRecord(q, {
            proof,
            sessionId: req.sessionKey.id,
            meaning: step.signs,
            table: 'document_version',
            recordId: newest.id,
            seen: { id: seen, contentHash: signature.recordVersion.contentHash },
            statementVersion: signature.statementVersion,
            release,
          });
        }
        await move(q, name, body, newest.id, facts, due);
      },
      reauthenticated,
    );
    req.log.info({ step: name, documentId: body.documentId }, 'document step taken');
    return (await readDocument(scope, body.documentId)).view;
  });
}

/** The Document vault for the Lab's staff: the list, one Document, a new Document, and `POST /api/document-steps/:step`. */
export function documentRoutes(app: App, db: Kysely<DB>, credentials: Credentials, release: string): void {
  app.route({
    ...routes.documents,
    handler: async (req) => {
      readableBy(req.actor);
      return labScope(db, req.actor)
        .from('document')
        .innerJoin('documentVersion', 'documentVersion.documentId', 'document.id')
        .select([
          'document.id',
          'document.number',
          'document.documentType',
          'documentVersion.version',
          'documentVersion.title',
          'documentVersion.status',
        ])
        .where((eb) =>
          eb(
            'documentVersion.version',
            '=',
            eb
              .selectFrom('documentVersion as v')
              .select((v) => v.fn.max('v.version').as('max'))
              .whereRef('v.documentId', '=', 'document.id'),
          ),
        )
        .orderBy('document.number')
        .execute();
    },
  });
  app.route({
    ...routes.document,
    handler: async (req) => {
      readableBy(req.actor);
      return (await readDocument(labScope(db, req.actor), req.params.id)).view;
    },
  });
  app.route({
    ...routes.createDocument,
    handler: async (req) => {
      const { actor, body } = req;
      const role =
        documentAuthors.find((r) => actor.roles.includes(r)) ??
        refuse('role', `Writing a Document is taken by the ${documentAuthors.join(', ')} role.`);
      const scope = labScope(db, actor);
      const id = await scope.write('createDocument', role, async (q) => {
        const document = await q
          .insert('document', { documentType: body.documentType })
          .returning('id')
          .executeTakeFirstOrThrow();
        await q
          .insert('documentVersion', {
            documentId: document.id,
            version: 1,
            title: body.title,
            body: body.body,
            authorId: actor.person.id,
          })
          .execute();
        return document.id;
      });
      req.log.info({ step: 'createDocument', documentId: id }, 'document created');
      return (await readDocument(scope, id)).view;
    },
  });
  for (const name of documentStepNames) registerDocumentStep(app, db, credentials, name, release);
}
