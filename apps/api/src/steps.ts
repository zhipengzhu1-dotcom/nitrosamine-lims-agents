import { createHash, randomUUID } from 'node:crypto';
import { type DB, postgresFault } from '@lims/db';
import {
  type ActorContext,
  type Meaning,
  type PersonId,
  pressText,
  type RouteReply,
  type SignatureStatement,
  type SigningBody,
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
import { type Credentials, type Reauthenticated, reauthenticate, sourceAddressOf } from './auth.ts';
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
      const customerId = ctx.person.customerId ?? refuse('role', 'Only a Customer User makes a Submission.');
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

/**
 * The record's latest Record Version, which the database wrote as it changed: what a Signature given now binds to. Every
 * signable row has one, because the `version_record` trigger writes it on insert, so a missing one throws as a broken
 * invariant.
 */
export function latestVersion(q: LabQueries, table: Signable, recordId: string) {
  return q
    .from('recordVersion')
    .select(['id', 'version', 'canonicalForm', sql<string>`encode(content_hash, 'hex')`.as('contentHash')])
    .where('recordTable', '=', table)
    .where('recordId', '=', recordId)
    .orderBy('version', 'desc')
    .executeTakeFirstOrThrow();
}

interface Seen {
  id: string;
  contentHash: string;
}

interface Signing {
  reauthenticated: Reauthenticated;
  meaning: Meaning;
  table: Signable;
  testId: string;
  seen: Seen;
  statementVersion: number;
  release: string;
}

/** Signs through lims.sign, the only path to a Signature, against a re-authentication record written here that names what proved the signer. */
async function sign(q: WriteQueries, ctx: ActorContext, sessionId: string, signing: Signing) {
  const { reauthenticated, meaning, table, testId, seen, statementVersion, release } = signing;
  const recordId =
    table === 'test'
      ? testId
      : (await q.from('testReport').select('id').where('testId', '=', testId).executeTakeFirstOrThrow()).id;
  const proof = await q
    .insert('reauthentication', {
      sessionId,
      personId: ctx.person.id,
      meaning,
      authenticator: reauthenticated.authenticator,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await sql`select lims.sign(${proof.id}, ${sessionId}, ${table}, ${recordId}, ${seen.id},
                             decode(${seen.contentHash}, 'hex'), ${statementVersion}, ${meaning}, ${release})`
    .execute(q.company)
    .catch(signingRefused);
}

/** lims.sign's own refusal (LA010) reaches the bench as a refusal; any other failure is thrown with its cause. */
function signingRefused(error: unknown): never {
  if (postgresFault(error)?.sqlstate === 'LA010' && error instanceof Error)
    refuse('signingRefused', `The Signature was refused: ${error.message}.`);
  throw new Error('signing failed', { cause: error });
}

/** The signature statement with the highest version: what the sheet shows and what lims.sign records. */
export function statementInForce(scope: LabQueries): Promise<SignatureStatement> {
  return scope.company
    .selectFrom('signatureStatement')
    .select(['version', sql<string>`convert_from(statement, 'UTF8')`.as('text')])
    .orderBy('version', 'desc')
    .executeTakeFirstOrThrow();
}

async function seenVersion(scope: LabQueries, testId: string, signature: SigningBody): Promise<Seen> {
  const latest = await latestVersion(scope, 'test', testId);
  if (latest.version !== signature.recordVersion.version || latest.contentHash !== signature.recordVersion.contentHash)
    refuse('recordChanged', 'The Test changed since this screen loaded it. Read it again before signing.');
  if ((await statementInForce(scope)).version !== signature.statementVersion)
    refuse(
      'signingRefused',
      'The Signature Statement changed since this screen loaded it. Read it again before signing.',
    );
  return { id: latest.id, contentHash: signature.recordVersion.contentHash };
}

type KeptCommit = Pick<Selectable<DB['commitKey']>, 'sessionId' | 'requestHash' | 'testId' | 'state'>;

function receiptOf(kept: KeptCommit, sessionId: string, requestHash: Buffer): StepTaken {
  if (kept.sessionId !== sessionId)
    refuse('keyReused', 'This press was already saved before the latest sign-in. Reload to see what was saved.');
  if (!kept.requestHash.equals(requestHash))
    refuse('keyReused', 'This press was already saved with other entries. Reload to see what was saved.');
  return { testId: kept.testId, state: kept.state };
}

function registerStep<K extends StepName>(
  app: App,
  db: Kysely<DB>,
  credentials: Credentials,
  name: K,
  release: string,
): void {
  const step: Step = steps[name];
  const effect: Effect<StepInput<K>> = effects[name];
  const route = stepRoute(name);
  app.post<{ Body: StepBody<K>; Reply: RouteReply<typeof route> }>(route.url, { schema: route.schema }, async (req) => {
    const { actor, body } = req;
    const sessionId = req.sessionKey.id;
    const scope = labScope(db, actor);
    const requestHash = createHash('sha256')
      .update(pressText(name, body.testId ?? null, body.input))
      .digest();
    const kept = (q: LabQueries) =>
      q.from('commitKey').select(['sessionId', 'requestHash', 'testId', 'state']).where('key', '=', body.commitKey);

    const test =
      body.testId === undefined
        ? null
        : ((await scope.from('test').selectAll().where('id', '=', body.testId).executeTakeFirst()) ??
          refuse('notFound', 'This Lab has no such Test.'));
    const facts = await factsFor(scope, actor, test, effect.assignee?.(body.input));
    const refused = refusal(name, test?.state ?? null, actor.roles, facts);
    if (refused) {
      // A retry finds the Test already moved by its own first press, whose key commits in the same transaction.
      const first = await kept(scope).executeTakeFirst();
      if (!first) refuse(refused.kind, refused.message);
      req.log.info({ step: name, testId: first.testId }, 'step replayed');
      return receiptOf(first, sessionId, requestHash);
    }
    let signing: Signing | null = null;
    if (step.signs) {
      // A retry whose first press committed between the registry check and here replays, as it does on a refusal.
      const first = await kept(scope).executeTakeFirst();
      if (first) {
        req.log.info({ step: name, testId: first.testId }, 'step replayed');
        return receiptOf(first, sessionId, requestHash);
      }
      const signature = body.signature ?? refuse('malformed', `The ${name} step needs the signer's credentials.`);
      const testId = test?.id ?? refuse('malformed', `The ${name} step signs a Test, and this request names none.`);
      const seen = await seenVersion(scope, testId, signature);
      const reauthenticated = await reauthenticate(
        db,
        credentials,
        { actor, session: req.sessionKey },
        { username: signature.username, password: signature.password, code: signature.code },
        step.role,
        sourceAddressOf(req),
        'ReauthenticationFailed',
      );
      signing = {
        reauthenticated,
        meaning: step.signs,
        table: effect.signedRecord ?? 'test',
        testId,
        seen,
        statementVersion: signature.statementVersion,
        release,
      };
    }

    const claim = { testId: test?.id ?? randomUUID(), state: step.to };
    const { testId } = claim;
    const { receipt, replayed } = await scope.write(
      name,
      step.role,
      async (q) => {
        // A press whose key another transaction holds waits here for that one to commit, then replays it.
        const claimed = await q
          .insert('commitKey', { key: body.commitKey, sessionId, requestHash, ...claim })
          .onConflict((oc) => oc.doNothing())
          .returning('key')
          .executeTakeFirst();
        if (!claimed)
          return {
            receipt: receiptOf(await kept(q).executeTakeFirstOrThrow(), sessionId, requestHash),
            replayed: true,
          };
        if (test) {
          const moved = await q
            .update('test')
            .set({ state: step.to })
            .where('id', '=', testId)
            .where('state', '=', test.state)
            .executeTakeFirstOrThrow();
          if (!moved.numUpdatedRows) refuse('stale', 'The Test has moved on. Reload it.');
        }
        await effect.write(q, actor, testId, body.input);
        if (signing) await sign(q, actor, sessionId, signing);
        return { receipt: claim, replayed: false };
      },
      signing?.reauthenticated,
    );
    req.log.info({ step: name, testId: receipt.testId }, replayed ? 'step replayed' : 'step taken');
    return receipt;
  });
}

/** `POST /api/steps/:step`, one route per registry entry so each body is validated against its own schema. */
export function stepRoutes(app: App, db: Kysely<DB>, credentials: Credentials, release: string): void {
  for (const name of stepNames) registerStep(app, db, credentials, name, release);
}
