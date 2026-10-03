import type { DB } from '@lims/db';
import {
  type ActorContext,
  type ChecklistItem,
  type ChecklistKind,
  type ChecklistVersions,
  type ChecklistView,
  checklistRefusal,
  evidenceSources,
  isTicks,
  mayTake,
  routes,
  unknownTick,
} from '@lims/domain';
import { type Kysely, sql } from 'kysely';
import type { App } from './app.ts';
import { type Credentials, reauthenticate, sourceAddressOf } from './auth.ts';
import { refuse } from './refuse.ts';
import { type LabQueries, labScope, type Scope } from './scope.ts';
import { latestVersion, proveReauthentication, signingRefused, signRecord, statementInForce } from './signing.ts';

type Company = LabQueries['company'];

interface ItemRow {
  key: string;
  text: string;
  ticked: boolean;
  needsComment: boolean;
  evidence: string | null;
}

function itemOf({ key, text, ticked, needsComment, evidence }: ItemRow): ChecklistItem {
  if (ticked) return { key, text, ticked, needsComment };
  const source = evidenceSources.find((s) => s === evidence);
  if (!source) throw new Error(`the evidence item ${key} names no evidence source the LIMS computes`);
  return { key, text, ticked, evidence: source };
}

function itemsOf(company: Company, versionIds: string[]) {
  return company
    .selectFrom('reviewChecklistItem')
    .select(['versionId', 'key', 'text', 'ticked', 'needsComment', 'evidence'])
    .where('versionId', 'in', versionIds)
    .orderBy('position')
    .execute();
}

/** The version of a checklist in force, the highest QA signed Approved, with its items in order; null until one is approved. */
export async function checklistInForce(company: Company, kind: ChecklistKind) {
  const version = await company
    .selectFrom('reviewChecklistVersion')
    .select(['id', 'version', sql<string>`encode(lims.review_checklist_content_hash(id), 'hex')`.as('contentHash')])
    .where('id', '=', sql<string>`lims.review_checklist_in_force(${kind})`)
    .executeTakeFirst();
  return version && { ...version, items: (await itemsOf(company, [version.id])).map((row) => itemOf(row)) };
}

async function versionsOf(company: Company, kind: ChecklistKind): Promise<ChecklistVersions> {
  const versions = await company
    .selectFrom('reviewChecklistVersion as v')
    .select([
      'v.id',
      'v.version',
      sql<string>`encode(lims.review_checklist_content_hash(v.id), 'hex')`.as('contentHash'),
      // A checklist is company-wide, so its Approved Signature may sit in any Lab's records (D9).
      sql<boolean>`exists (select from lims.signature s join lims.record_version rv
        on rv.lab_id = s.lab_id and rv.id = s.record_version_id
        where rv.record_table = 'review_checklist_version' and rv.record_id = v.id and s.meaning = 'Approved')`.as(
        'approved',
      ),
    ])
    .where('v.kind', '=', kind)
    .orderBy('v.version')
    .execute();
  const items = versions.length
    ? await itemsOf(
        company,
        versions.map((v) => v.id),
      )
    : [];
  const inForce = await checklistInForce(company, kind);
  return {
    kind,
    inForce: inForce?.version ?? null,
    versions: versions.map(({ id, version, contentHash, approved }) => ({
      id,
      version,
      contentHash,
      approved,
      items: items.filter((i) => i.versionId === id).map((row) => itemOf(row)),
    })),
  };
}

const asText = (value: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(value ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'));

/** The Test checklist in force as staff see it while a Test awaits review, each evidence item with its value for this Test. */
export async function testChecklist(scope: Scope, test: { id: string; state: string }): Promise<ChecklistView | null> {
  if (scope.ctx.person.customerId !== null || test.state !== 'SubmittedForReview') return null;
  const inForce = await checklistInForce(scope.company, 'Test');
  if (!inForce) return null;
  const items = [];
  for (const item of inForce.items) {
    if (item.ticked) {
      items.push(item);
      continue;
    }
    const { rows } = await sql<{ value: unknown }>`select lims.review_evidence(${scope.ctx.lab.id}, ${test.id},
      ${item.evidence}) as value`.execute(scope.company);
    items.push({ ...item, value: asText(rows[0]?.value) });
  }
  return { kind: 'Test', version: inForce.version, contentHash: inForce.contentHash, items };
}

/**
 * Refuses a Reviewed press unless the Test Review it names is of this Test, was saved by the signer on the Test checklist
 * in force, and ticks every ticked item with each needed comment.
 */
export async function reviewToSign(scope: LabQueries, ctx: ActorContext, testId: string, reviewId: string) {
  const review =
    (await scope
      .from('testReview')
      .select(['checklistVersionId', 'ticks', 'savedBy'])
      .where('id', '=', reviewId)
      .where('testId', '=', testId)
      .executeTakeFirst()) ?? refuse('notFound', 'This Test has no such Test Review.');
  if (review.savedBy !== `person:${ctx.person.username}`)
    refuse('guard', 'A Reviewer signs only a Test Review they saved.');
  const inForce =
    (await checklistInForce(scope.company, 'Test')) ??
    refuse('state', 'No Test Review Checklist version is approved yet.');
  if (inForce.id !== review.checklistVersionId)
    refuse('recordChanged', `The Test Review Checklist changed to version ${inForce.version}. Tick it again.`);
  if (!isTicks(review.ticks)) throw new Error(`the Test Review ${reviewId} holds ticks of an unknown shape`);
  const incomplete = checklistRefusal(inForce.items, review.ticks);
  if (incomplete) refuse('checklistIncomplete', incomplete);
}

/** The review checklist routes: staff read every version, QA drafts and approves one, a Reviewer saves a Test Review. */
export function checklistRoutes(app: App, db: Kysely<DB>, credentials: Credentials, release: string): void {
  app.route({
    ...routes.reviewChecklists,
    handler: async (req) => {
      if (req.actor.person.customerId !== null) refuse('role', 'A Review Checklist is not shown to a Customer User.');
      return versionsOf(labScope(db, req.actor).company, req.params.kind);
    },
  });

  app.route({
    ...routes.draftChecklistVersion,
    handler: async (req) => {
      const { kind } = req.body;
      if (!mayTake('draftReviewChecklist', req.actor.roles))
        refuse('role', 'A Review Checklist version is drafted by QA.');
      const scope = labScope(db, req.actor);
      const sources = await scope.company
        .selectFrom('evidenceSource')
        .select('source')
        .where('kind', '=', kind)
        .execute();
      for (const item of req.body.items)
        if (!item.ticked && !sources.some((s) => s.source === item.evidence))
          refuse('guard', `The ${kind} Review Checklist cannot show the evidence “${item.evidence}”.`);
      if (new Set(req.body.items.map((i) => i.key)).size !== req.body.items.length)
        refuse('malformed', 'Each item of a Review Checklist version needs its own key.');
      await scope.write('draftReviewChecklist', 'QA', async (q) => {
        await sql`select lims.lock_chains('company')`.execute(q.company);
        const { max } = await q.company
          .selectFrom('reviewChecklistVersion')
          .select((eb) => eb.fn.max('version').as('max'))
          .where('kind', '=', kind)
          .executeTakeFirstOrThrow();
        const { id } = await q.company
          .insertInto('reviewChecklistVersion')
          .values({ kind, version: (max ?? 0) + 1 })
          .returning('id')
          .executeTakeFirstOrThrow();
        await q.company
          .insertInto('reviewChecklistItem')
          .values(
            req.body.items.map((item, i) => ({
              versionId: id,
              kind,
              position: i + 1,
              key: item.key,
              text: item.text,
              ticked: item.ticked,
              needsComment: item.ticked && item.needsComment,
              evidence: item.ticked ? null : item.evidence,
            })),
          )
          .execute();
      });
      req.log.info({ step: 'draftReviewChecklist', kind }, 'step taken');
      return versionsOf(scope.company, kind);
    },
  });

  app.route({
    ...routes.approveChecklistVersion,
    handler: async (req) => {
      const { actor, body: signature } = req;
      const { kind, version } = signature;
      if (!mayTake('approveReviewChecklist', actor.roles))
        refuse('role', 'A Review Checklist version is approved by QA.');
      const scope = labScope(db, actor);
      const chosen =
        (await versionsOf(scope.company, kind)).versions.find((v) => v.version === version) ??
        refuse('notFound', `The ${kind} Review Checklist has no version ${version}.`);
      const inForce = await checklistInForce(scope.company, kind);
      if (chosen.approved) refuse('state', `Version ${version} of the ${kind} Review Checklist is already approved.`);
      if (inForce && inForce.version >= version)
        refuse(
          'state',
          `Version ${inForce.version} of the ${kind} Review Checklist is in force, so version ${version} cannot be approved.`,
        );
      if (chosen.contentHash !== signature.recordVersion.contentHash)
        refuse(
          'recordChanged',
          'The Review Checklist version changed since this screen loaded it. Read it again before signing.',
        );
      if ((await statementInForce(scope.company)).version !== signature.statementVersion)
        refuse(
          'signingRefused',
          'The Signature Statement changed since this screen loaded it. Read it again before signing.',
        );
      const reauthenticated = await reauthenticate(
        db,
        credentials,
        { actor, session: req.sessionKey },
        { username: signature.username, password: signature.password, code: signature.code },
        'QA',
        sourceAddressOf(req),
        'ReauthenticationFailed',
      );
      const sessionId = req.sessionKey.id;
      await scope.write(
        'approveReviewChecklist',
        'QA',
        async (q) => {
          // lock_chain (LA004) wants the company chain declared before this Lab's, which the Signature writes to.
          await sql`select lims.lock_chains('company', ${actor.lab.id})`.execute(q.company);
          const proof = await proveReauthentication(q, actor, sessionId, 'Approved', reauthenticated);
          await sql`select lims.version_review_checklist(${proof}, ${chosen.id})`
            .execute(q.company)
            .catch(signingRefused);
          const latest = await latestVersion(q, 'review_checklist_version', chosen.id);
          if (latest.version !== signature.recordVersion.version)
            refuse(
              'recordChanged',
              'The Review Checklist version changed since this screen loaded it. Read it again before signing.',
            );
          await signRecord(q, {
            proof,
            sessionId,
            meaning: 'Approved',
            table: 'review_checklist_version',
            recordId: chosen.id,
            seen: { id: latest.id, contentHash: signature.recordVersion.contentHash },
            statementVersion: signature.statementVersion,
            release,
          });
        },
        reauthenticated,
      );
      req.log.info({ step: 'approveReviewChecklist', kind, version }, 'step taken');
      return versionsOf(scope.company, kind);
    },
  });

  app.route({
    ...routes.saveReview,
    handler: async (req) => {
      const { actor, body } = req;
      if (!mayTake('saveTestReview', actor.roles)) refuse('role', 'A Test Review is saved by a Reviewer.');
      const scope = labScope(db, actor);
      const test =
        (await scope.from('test').select(['id', 'state']).where('id', '=', body.testId).executeTakeFirst()) ??
        refuse('notFound', 'This Lab has no such Test.');
      if (test.state !== 'SubmittedForReview')
        refuse('state', 'A Test Review is saved only while the Test is submitted for review.');
      const inForce =
        (await checklistInForce(scope.company, 'Test')) ??
        refuse('state', 'No Test Review Checklist version is approved yet.');
      if (inForce.version !== body.checklistVersion)
        refuse('recordChanged', `The Test Review Checklist changed to version ${inForce.version}. Tick it again.`);
      const unknown = unknownTick(inForce.items, body.ticks);
      if (unknown) refuse('unknownField', unknown);
      const saved = await scope.write('saveTestReview', 'Reviewer', async (q) => {
        const { id } = await q
          .insert('testReview', { testId: test.id, checklistVersionId: inForce.id, ticks: body.ticks })
          .returning('id')
          .executeTakeFirstOrThrow();
        const { version, canonicalForm, contentHash } = await latestVersion(q, 'test_review', id);
        return { review: id, recordVersion: { version, canonicalForm, contentHash } };
      });
      req.log.info({ step: 'saveTestReview', testId: test.id, review: saved.review }, 'step taken');
      return saved;
    },
  });
}
