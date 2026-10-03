import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { it } from 'node:test';
import type { JsonObject } from '@lims/db';
import {
  type ChecklistDraft,
  type ChecklistView,
  type ReviewSaved,
  routes,
  type StepInput,
  type StepName,
  stepRoute,
  type Ticks,
} from '@lims/domain';
import { sql } from 'kysely';
import { type Account, type Client, ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_review_checklist_test');
const [cora, samir, lena, ana, rui, quinn] = [
  api.person('cora'),
  api.person('samir'),
  api.person('lena'),
  api.person('ana'),
  api.person('rui'),
  api.person('quinn'),
];
const rhea = await api.addPerson('rhea.second-reviewer', ['Reviewer']);
const qiao = await api.addPerson('qiao.second-qa', ['QA']);
const as = {
  cora: await api.login(cora),
  samir: await api.login(samir),
  lena: await api.login(lena),
  ana: await api.login(ana),
  rui: await api.login(rui),
  quinn: await api.login(quinn),
  rhea: await api.login(rhea),
  qiao: await api.login(qiao),
};
const performedSignature: ChecklistDraft['items'][number] = {
  key: 'performedSignature',
  text: 'Performed Signature on the current version',
  ticked: false,
  evidence: 'performedSignature',
};

async function take(client: Client, name: StepName, testId: string, input: StepInput<StepName> = {}, signer?: Account) {
  ok(
    await client.call(stepRoute(name), {
      commitKey: randomUUID(),
      testId,
      ...(await api.press(client, name, testId, input, signer)),
    }),
  );
}

async function awaitingReview(): Promise<string> {
  const { testId } = ok(
    await as.cora.call(stepRoute('submit'), {
      commitKey: randomUUID(),
      input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' },
    }),
  );
  await take(as.samir, 'receive', testId);
  await take(as.lena, 'assign', testId, { assigneeId: ana.id });
  const result = {
    analyte: 'NDMA',
    value: '0.0300',
    unit: 'ppm',
    injectionSequenceRef: 'SEQ-2026-0042',
    notebookRef: 'NB-RD-0001-012',
    performedOn: '2026-09-30',
  };
  await take(as.ana, 'enterResult', testId, result, ana);
  return testId;
}

const testView = async (testId: string, client = as.rui) => ok(await client.call(routes.test, { id: testId }));
const checklistOf = async (testId: string): Promise<ChecklistView> =>
  (await testView(testId)).checklist ?? assert.fail('a Reviewer sees the Test checklist in force');
const versions = async () => ok(await as.quinn.call(routes.reviewChecklists, { kind: 'Test' }));

/** Every ticked item ticked, with a comment where one is needed. */
const fullTicks = (checklist: ChecklistView): Ticks =>
  Object.fromEntries(
    checklist.items
      .filter((i) => i.ticked)
      .map((i) => [i.key, { comment: i.needsComment ? 'No flags raised.' : null }]),
  );

async function saved(testId: string, edit: (ticks: Ticks) => Ticks = (t) => t, client = as.rui): Promise<ReviewSaved> {
  const checklist = await checklistOf(testId);
  return ok(
    await client.call(routes.saveReview, {
      testId,
      checklistVersion: checklist.version,
      ticks: edit(fullTicks(checklist)),
    }),
  );
}

async function signReview(testId: string, review: ReviewSaved, signer = rui, client = as.rui) {
  const { statement } = await testView(testId, client);
  return client.call(stepRoute('review'), {
    commitKey: randomUUID(),
    testId,
    input: { review: review.review },
    signature: {
      username: signer.username,
      password: signer.password,
      recordVersion: { version: review.recordVersion.version, contentHash: review.recordVersion.contentHash },
      statementVersion: statement?.version ?? assert.fail('a signer sees the signature statement'),
    },
  });
}

/** QA drafts the next Test checklist version from the one in force, adding `extra` items it lacks; answers its number. */
async function draftNext(extra: ChecklistDraft['items'] = []): Promise<number> {
  await api.approveChecklist();
  const { inForce, versions: all } = await versions();
  const current = all.find((v) => v.version === inForce) ?? assert.fail('a Test checklist version is in force');
  const items = [...current.items, ...extra.filter((e) => !current.items.some((i) => i.key === e.key))];
  const drafted = ok(await as.quinn.call(routes.draftChecklistVersion, { kind: 'Test', items }));
  return drafted.versions.at(-1)?.version ?? assert.fail('the drafted version is listed');
}

async function approveAs(client: Client, account: Account, version: number) {
  const chosen = (await versions()).versions.find((v) => v.version === version) ?? assert.fail(`no version ${version}`);
  const { version: statementVersion } = await api.superuser
    .selectFrom('signatureStatement')
    .select((eb) => eb.fn.max('version').as('version'))
    .executeTakeFirstOrThrow();
  return client.call(routes.approveChecklistVersion, {
    kind: 'Test',
    version,
    username: account.username,
    password: account.password,
    recordVersion: { version: 1, contentHash: chosen.contentHash },
    statementVersion,
  });
}

function reviewContent(review: string) {
  return api.superuser
    .selectFrom('recordVersion')
    .select([
      'content as bytes',
      sql<string>`encode(content_hash, 'hex')`.as('contentHash'),
      sql<JsonObject>`convert_from(content, 'UTF8')::jsonb`.as('content'),
    ])
    .where('recordTable', '=', 'test_review')
    .where('recordId', '=', review)
    .orderBy('version', 'desc')
    .executeTakeFirstOrThrow();
}

it('a Reviewer sees the Test checklist in force while the Test awaits review, with no ticks, and a Customer sees none', async () => {
  await api.approveChecklist();
  const testId = await awaitingReview();
  const { inForce, versions: all } = await versions();
  const checklist = await checklistOf(testId);
  const current = all.find((v) => v.version === inForce) ?? assert.fail();
  assert.deepEqual(
    [checklist.kind, checklist.version, checklist.contentHash],
    ['Test', current.version, current.contentHash],
  );
  assert.deepEqual(
    checklist.items.map((i) => i.key),
    current.items.map((i) => i.key),
    'every item of the version in force, in order',
  );
  assert.ok(!('ticks' in checklist), 'the view carries no ticks');
  assert.equal((await testView(testId, as.cora)).checklist, null, 'a Customer sees no checklist');
});

it('an evidence item on an approved version shows the value the server computed: the Performed signer and role', async () => {
  const version = await draftNext([performedSignature]);
  ok(await approveAs(as.qiao, qiao, version));
  const testId = await awaitingReview();
  const evidence = (await checklistOf(testId)).items.find((i) => i.key === 'performedSignature');
  assert.ok(evidence && !evidence.ticked, 'the evidence item is shown, not ticked');
  assert.deepEqual([evidence.value['Signed by'], evidence.value.Role], ['Ana Ferreira', 'Analyst']);
});

it('saving a Test Review that ticks an evidence item or a key the checklist lacks is refused as an unknown field', async () => {
  const testId = await awaitingReview();
  if (!(await checklistOf(testId)).items.some((i) => !i.ticked))
    ok(await approveAs(as.qiao, qiao, await draftNext([performedSignature])));
  const checklist = await checklistOf(testId);
  const evidence = checklist.items.find((i) => !i.ticked) ?? assert.fail('the version in force has an evidence item');
  const save = (ticks: Ticks) => as.rui.call(routes.saveReview, { testId, checklistVersion: checklist.version, ticks });
  assert.equal(
    refusedWith(await save({ ...fullTicks(checklist), [evidence.key]: { comment: null } }), 'unknownField'),
    `The item “${evidence.text}” is evidence the LIMS shows, so it is never ticked.`,
  );
  assert.equal(
    refusedWith(await save({ ...fullTicks(checklist), madeUp: { comment: null } }), 'unknownField'),
    'The Test Review Checklist has no item “madeUp”.',
  );
});

it('saving the same ticks again returns the Test Review already saved, so a resent Reviewed press names the same review', async () => {
  await api.approveChecklist();
  const testId = await awaitingReview();
  const first = await saved(testId);
  assert.deepEqual(await saved(testId), first);
  const recommented = await saved(testId, (ticks) => ({
    ...ticks,
    flagsAcknowledged: { comment: 'One flag, cleared.' },
  }));
  assert.notEqual(recommented.review, first.review, 'changed ticks save a new Test Review');
});

it('Reviewed on a Test Review that leaves a ticked item unticked is refused, naming the item, and signs nothing', async () => {
  await api.approveChecklist();
  const testId = await awaitingReview();
  const item = (await checklistOf(testId)).items.find((i) => i.key === 'auditTrailReviewed') ?? assert.fail();
  const review = await saved(testId, (ticks) =>
    Object.fromEntries(Object.entries(ticks).filter(([key]) => key !== item.key)),
  );
  assert.equal(
    refusedWith(await signReview(testId, review), 'checklistIncomplete'),
    `Tick “${item.text}” before signing Reviewed.`,
  );
  const after = await testView(testId);
  assert.deepEqual([after.test.state, after.signatures.map((s) => s.meaning)], ['SubmittedForReview', ['Performed']]);
});

it('Reviewed on a Test Review whose needs-comment item has a blank comment is refused, naming the item', async () => {
  await api.approveChecklist();
  const testId = await awaitingReview();
  const item = (await checklistOf(testId)).items.find((i) => i.ticked && i.needsComment) ?? assert.fail();
  const review = await saved(testId, (ticks) => ({ ...ticks, [item.key]: { comment: '   ' } }));
  assert.equal(
    refusedWith(await signReview(testId, review), 'checklistIncomplete'),
    `Write a comment on “${item.text}” before signing Reviewed.`,
  );
});

it('Reviewed binds the Test Review, whose Record Version holds the Test version, the checklist version and every tick and comment', async () => {
  await api.approveChecklist();
  const testId = await awaitingReview();
  const checklist = await checklistOf(testId);
  const testVersion = (await testView(testId)).recordVersion ?? assert.fail();
  const review = await saved(testId);
  ok(await signReview(testId, review));
  const reviewed = (await testView(testId)).signatures.find((s) => s.meaning === 'Reviewed') ?? assert.fail();
  assert.deepEqual(
    [reviewed.record, reviewed.recordVersion.contentHash],
    ['Test Review', review.recordVersion.contentHash],
  );
  const { bytes, contentHash, content } = await reviewContent(review.review);
  assert.equal(contentHash, createHash('sha256').update(bytes).digest('hex'), 'the hash is the SHA-256 of the content');
  assert.deepEqual(content.test, { id: testId, version: testVersion.version, contentHash: testVersion.contentHash });
  assert.deepEqual(content.checklist, { kind: 'Test', version: checklist.version, contentHash: checklist.contentHash });
  assert.deepEqual(
    content.ticks,
    checklist.items
      .filter((i) => i.ticked)
      .map((i) => ({ key: i.key, text: i.text, comment: i.needsComment ? 'No flags raised.' : null })),
  );
});

it('a Reviewer signs only a Test Review they saved', async () => {
  await api.approveChecklist();
  const testId = await awaitingReview();
  const review = await saved(testId);
  assert.equal(
    refusedWith(await signReview(testId, review, rhea, as.rhea), 'guard'),
    'A Reviewer signs only a Test Review they saved.',
  );
});

it('a draft leaves the version in force; once QA approves it, a Test Review saved on the earlier version is refused as changed', async () => {
  await api.approveChecklist();
  const signedTest = await awaitingReview();
  const signedReview = await saved(signedTest);
  ok(await signReview(signedTest, signedReview));
  const testId = await awaitingReview();
  const before = await checklistOf(testId);
  const review = await saved(testId);
  const next = await draftNext();
  assert.equal((await checklistOf(testId)).version, before.version, 'a draft is not in force');
  ok(await approveAs(as.qiao, qiao, next));
  assert.equal((await checklistOf(testId)).version, next, 'the approved version is in force');
  assert.equal(
    refusedWith(await signReview(testId, review), 'recordChanged'),
    `The Test Review Checklist changed to version ${next}. Tick it again.`,
  );
  const earlier = await reviewContent(signedReview.review);
  assert.deepEqual(earlier.content.checklist, {
    kind: 'Test',
    version: before.version,
    contentHash: before.contentHash,
  });
});

it('saving on a checklist version that is not in force, or on a Test not awaiting review, is refused', async () => {
  await api.approveChecklist();
  const testId = await awaitingReview();
  const checklist = await checklistOf(testId);
  const inForce = checklist.version;
  assert.equal(
    refusedWith(
      await as.rui.call(routes.saveReview, { testId, checklistVersion: inForce + 1, ticks: fullTicks(checklist) }),
      'recordChanged',
    ),
    `The Test Review Checklist changed to version ${inForce}. Tick it again.`,
  );
  ok(await signReview(testId, await saved(testId)));
  assert.equal(
    refusedWith(
      await as.rui.call(routes.saveReview, { testId, checklistVersion: inForce, ticks: fullTicks(checklist) }),
      'state',
    ),
    'A Test Review is saved only while the Test is submitted for review.',
  );
});

it('only QA drafts or approves a Review Checklist version, and only a Reviewer saves a Test Review', async () => {
  await api.approveChecklist();
  const { versions: all } = await versions();
  const items = all[0]?.items ?? assert.fail();
  assert.equal(
    refusedWith(await as.rui.call(routes.draftChecklistVersion, { kind: 'Test', items }), 'role'),
    'A Review Checklist version is drafted by QA.',
  );
  assert.equal(
    refusedWith(await approveAs(as.rui, rui, all.at(-1)?.version ?? 1), 'role'),
    'A Review Checklist version is approved by QA.',
  );
  assert.equal(
    refusedWith(
      await as.quinn.call(routes.saveReview, { testId: randomUUID(), checklistVersion: 1, ticks: {} }),
      'role',
    ),
    'A Test Review is saved by a Reviewer.',
  );
});

it('approving a version already approved, or one older than the version in force, is refused', async () => {
  const older = await draftNext();
  const newer = await draftNext();
  ok(await approveAs(as.qiao, qiao, newer));
  assert.equal(
    refusedWith(await approveAs(as.qiao, qiao, newer), 'state'),
    `Version ${newer} of the Test Review Checklist is already approved.`,
  );
  assert.equal(
    refusedWith(await approveAs(as.qiao, qiao, older), 'state'),
    `Version ${newer} of the Test Review Checklist is in force, so version ${older} cannot be approved.`,
  );
});

it('a QA does not approve a Review Checklist version they drafted, and another QA does', async () => {
  const version = await draftNext();
  const drafted = (await versions()).versions.find((v) => v.version === version);
  assert.equal(drafted?.draftedBy, quinn.username, 'the version names the QA who drafted it');
  assert.equal(
    refusedWith(await approveAs(as.quinn, quinn, version), 'guard'),
    `You drafted version ${version} of the Test Review Checklist, so another QA approves it.`,
  );
  assert.equal((await versions()).inForce === version, false, 'the refused approval puts nothing in force');
  ok(await approveAs(as.qiao, qiao, version));
  assert.equal((await versions()).inForce, version, 'the second QA puts the version in force');
});

it('a draft whose evidence the checklist kind cannot show, or whose keys repeat, is refused', async () => {
  assert.deepEqual(
    (await versions()).evidenceSources,
    ['performedSignature'],
    'the Test checklist offers its evidence',
  );
  const item = { key: 'auditTrailReviewed', text: 'Audit trail reviewed', ticked: true, needsComment: false } as const;
  assert.equal(
    refusedWith(
      await as.quinn.call(routes.draftChecklistVersion, {
        kind: 'Test',
        items: [item, { key: 'runChecks', text: 'Run checks', ticked: false, evidence: 'runChecks' }],
      }),
      'guard',
    ),
    'The Test Review Checklist cannot show the evidence “runChecks”.',
  );
  assert.equal(
    refusedWith(await as.quinn.call(routes.draftChecklistVersion, { kind: 'Test', items: [item, item] }), 'malformed'),
    'Each item of a Review Checklist version needs its own key.',
  );
});
