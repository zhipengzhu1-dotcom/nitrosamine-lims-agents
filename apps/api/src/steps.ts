import { createHash, randomUUID } from 'node:crypto';
import type { DB } from '@lims/db';
import {
  type ActorContext,
  type Meaning,
  type PersonId,
  type Reauthentication,
  type RouteReply,
  refusal,
  type Step,
  type StepBody,
  type StepFacts,
  type StepInput,
  type StepName,
  type StepTaken,
  stepNames,
  stepRoute,
  steps,
} from '@lims/domain';
import { type Kysely, type Selectable, sql } from 'kysely';
import type { App } from './app.ts';
import { reauthenticate, sourceAddressOf } from './auth.ts';
import { refuse } from './refuse.ts';
import { type LabQueries, labScope, type WriteQueries } from './scope.ts';

/** The records a Signature can be given on, each with its own canonical content in the database. */
export type Signable = 'test' | 'test_report';

interface Effect<I> {
  signedRecord?: 'test_report';
  assignee?: (input: I) => PersonId;
  write(q: WriteQueries, ctx: ActorContext, testId: string, input: I): Promise<unknown>;
}

/** What each step writes besides moving the Test's state. */
const effects: { [K in StepName]: Effect<StepInput<K>> } = {
  submit: {
    async write(q, ctx, testId, input) {
      const customerId = ctx.person.customerId ?? refuse('role', 'only a Customer User submits');
      const submission = await q.company
        .insertInto('submission')
        .values({ customerId, submittedBy: ctx.person.id, number: await q.takeNumber('Submission') })
        .returning('id')
        .executeTakeFirstOrThrow();
      const sample = await q
        .insert('sample', {
          submissionId: submission.id,
          description: input.description,
          number: await q.takeNumber('Sample'),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await q.insert('test', { id: testId, sampleId: sample.id, methodId: input.methodId }).execute();
    },
  },
  receive: {
    write: (q, _ctx, testId) =>
      q
        .update('sample')
        .set({ receivedAt: sql`clock_timestamp()` })
        .where('id', 'in', q.from('test').select('sampleId').where('id', '=', testId))
        .execute(),
  },
  assign: {
    assignee: (input) => input.assigneeId,
    write: (q, _ctx, testId, input) =>
      q.update('test').set({ assigneeId: input.assigneeId }).where('id', '=', testId).execute(),
  },
  enterResult: {
    write: (q, ctx, testId, input) =>
      q
        .insert('result', {
          testId,
          analyte: input.analyte,
          value: input.value,
          unit: input.unit,
          injectionSequenceRef: input.injectionSequenceRef,
          notebookRef: input.notebookRef,
          performedOn: input.performedOn,
          enteredBy: ctx.person.id,
        })
        .execute(),
  },
  review: { write: async () => {} },
  release: {
    signedRecord: 'test_report',
    write: async (q, _ctx, testId) =>
      q.insert('testReport', { testId, number: await q.takeNumber('TestReport') }).execute(),
  },
};

type FactsTest = Pick<Selectable<DB['test']>, 'id' | 'assigneeId' | 'methodId'>;

export async function factsFor(
  q: LabQueries,
  ctx: ActorContext,
  test: FactsTest | null,
  assigneeId?: string,
): Promise<StepFacts> {
  const signatures = test
    ? await signedVersions(q)
        .select(['signature.meaning', 'signature.personId'])
        .where('recordVersion.recordId', '=', test.id)
        .execute()
    : [];
  const assignee = assigneeId ?? test?.assigneeId ?? null;
  const trained =
    assignee &&
    test &&
    (await q
      .from('trainingRecord')
      .innerJoin('membership', (j) =>
        j
          .onRef('membership.labId', '=', 'trainingRecord.labId')
          .onRef('membership.personId', '=', 'trainingRecord.personId'),
      )
      .select('trainingRecord.personId')
      .where('membership.role', '=', 'Analyst')
      .where('trainingRecord.personId', '=', assignee)
      .where('trainingRecord.methodId', '=', test.methodId)
      .executeTakeFirst());
  return {
    actor: ctx.person.id,
    assignee,
    assigneeTrained: Boolean(trained),
    signers: Object.fromEntries(signatures.map((s) => [s.meaning, s.personId])),
  };
}

/** Every Signature of the Lab joined to the Record Version it was given on. */
export function signedVersions(q: LabQueries) {
  return q
    .from('signature')
    .innerJoin('recordVersion', (j) =>
      j
        .onRef('recordVersion.labId', '=', 'signature.labId')
        .onRef('recordVersion.id', '=', 'signature.recordVersionId'),
    );
}

/** The record's latest Record Version, which the database wrote as it changed: what a Signature given now binds to. */
export function latestVersion(q: LabQueries, table: Signable, recordId: string) {
  return q
    .from('recordVersion')
    .select(['id', 'version', 'canonicalForm', sql<string>`encode(content_hash, 'hex')`.as('contentHash')])
    .where('recordTable', '=', table)
    .where('recordId', '=', recordId)
    .orderBy('version', 'desc')
    .executeTakeFirstOrThrow();
}

/** The Record Version the signer saw, resolved to its row before the transaction, and the hash as the screen showed it. */
interface Seen {
  id: string;
  contentHash: string;
}

/**
 * Writes the re-authentication record and signs through lims.sign in the step's transaction, so the database holds
 * the only path to a Signature: the record ties the signing to this person, session and meaning, and the function
 * refuses unless what the signer saw is still the record's latest Record Version.
 */
async function sign(
  q: WriteQueries,
  ctx: ActorContext,
  sessionId: string,
  signing: { meaning: Meaning; table: Signable; testId: string; seen: Seen; release: string },
) {
  const { meaning, table, testId, seen, release } = signing;
  const recordId =
    table === 'test'
      ? testId
      : (await q.from('testReport').select('id').where('testId', '=', testId).executeTakeFirstOrThrow()).id;
  const proof = await q
    .insert('reauthentication', { sessionId, personId: ctx.person.id, meaning, authenticator: 'Password' })
    .returning('id')
    .executeTakeFirstOrThrow();
  await sql`select lims.sign(${proof.id}, ${table}, ${recordId}, ${seen.id}, decode(${seen.contentHash}, 'hex'),
                             ${meaning}, ${release})`.execute(q.company);
}

/** The signer's typed credentials and the Record Version they saw, refused as recordChanged when the Test has moved on since. */
async function seenVersion(scope: LabQueries, testId: string, signature: Reauthentication): Promise<Seen> {
  const latest = await latestVersion(scope, 'test', testId);
  if (latest.version !== signature.recordVersion.version || latest.contentHash !== signature.recordVersion.contentHash)
    refuse('recordChanged', 'the Test changed since this screen loaded it; read it again before signing');
  return { id: latest.id, contentHash: signature.recordVersion.contentHash };
}

type KeptCommit = Pick<Selectable<DB['commitKey']>, 'sessionId' | 'requestHash' | 'testId' | 'state'>;

function receiptOf(kept: KeptCommit, sessionId: string, requestHash: Buffer): StepTaken {
  if (kept.sessionId !== sessionId)
    refuse('keyReused', 'this press was already saved under another sign-in; reload to see what was saved');
  if (!kept.requestHash.equals(requestHash))
    refuse('keyReused', 'this press was already saved with other entries; reload to see what was saved');
  return { testId: kept.testId, state: kept.state };
}

function registerStep<K extends StepName>(app: App, db: Kysely<DB>, name: K, release: string): void {
  const step: Step = steps[name];
  const effect: Effect<StepInput<K>> = effects[name];
  const route = stepRoute(name);
  app.post<{ Body: StepBody<K>; Reply: RouteReply<typeof route> }>(route.url, { schema: route.schema }, async (req) => {
    const { actor, body } = req;
    const sessionId = req.sessionKey.id;
    const scope = labScope(db, actor);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ step: name, testId: body.testId ?? null, input: body.input }))
      .digest();
    const kept = (q: LabQueries) =>
      q.from('commitKey').select(['sessionId', 'requestHash', 'testId', 'state']).where('key', '=', body.commitKey);

    const test =
      body.testId === undefined
        ? null
        : ((await scope.from('test').selectAll().where('id', '=', body.testId).executeTakeFirst()) ??
          refuse('notFound', 'no such Test in this Lab'));
    const facts = await factsFor(scope, actor, test, effect.assignee?.(body.input));
    const refused = refusal(name, test?.state ?? null, actor.roles, facts);
    if (refused) {
      // A retry finds the Test already moved by its own first press, whose key commits in the same transaction.
      const first = await kept(scope).executeTakeFirst();
      if (!first) refuse(refused.kind, refused.message);
      req.log.info({ step: name, testId: first.testId }, 'step replayed');
      return receiptOf(first, sessionId, requestHash);
    }
    let signing: Parameters<typeof sign>[3] | null = null;
    if (step.signs) {
      const signature = body.signature ?? refuse('malformed', `${name} needs the signer's credentials`);
      const testId = test?.id ?? refuse('malformed', `${name} signs a Test`);
      const seen = await seenVersion(scope, testId, signature);
      await reauthenticate(db, { actor, session: req.sessionKey }, signature, name, step.role, sourceAddressOf(req));
      signing = { meaning: step.signs, table: effect.signedRecord ?? 'test', testId, seen, release };
    }

    const claim = { testId: test?.id ?? randomUUID(), state: step.to };
    const { testId } = claim;
    const { receipt, replayed } = await scope.write(name, step.role, async (q) => {
      // A press whose key another transaction holds waits here for that one to commit, then replays it.
      const claimed = await q
        .insert('commitKey', { key: body.commitKey, sessionId, requestHash, ...claim })
        .onConflict((oc) => oc.doNothing())
        .returning('key')
        .executeTakeFirst();
      if (!claimed)
        return { receipt: receiptOf(await kept(q).executeTakeFirstOrThrow(), sessionId, requestHash), replayed: true };
      if (test) {
        const moved = await q
          .update('test')
          .set({ state: step.to })
          .where('id', '=', testId)
          .where('state', '=', test.state)
          .executeTakeFirstOrThrow();
        if (!moved.numUpdatedRows) refuse('stale', 'the Test has moved on; reload it');
      }
      await effect.write(q, actor, testId, body.input);
      if (signing) await sign(q, actor, sessionId, signing);
      return { receipt: claim, replayed: false };
    });
    req.log.info({ step: name, testId: receipt.testId }, replayed ? 'step replayed' : 'step taken');
    return receipt;
  });
}

/** `POST /api/steps/:step`, one route per registry entry so each body is validated against its own schema. */
export function stepRoutes(app: App, db: Kysely<DB>, release: string): void {
  for (const name of stepNames) registerStep(app, db, name, release);
}
