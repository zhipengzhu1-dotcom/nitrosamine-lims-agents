import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { audited, type Json, type JsonObject } from '@lims/db';
import { sql } from 'kysely';
import { routes, type StepInput, type StepName, stepNames, type SigningBody, stepRoute, steps } from '@lims/domain';
import { labScope } from '../src/scope.ts';
import {
  type Account,
  type Client,
  ok,
  refusedWith,
  signatureOf,
  startApi,
  TEST_RELEASE,
  HARNESS_LOGIN,
} from './harness.ts';

const api = await startApi('lims_api_steps_test');
const [cora, samir, lena, ana, theo, rui, quinn] = [
  api.person('cora'),
  api.person('samir'),
  api.person('lena'),
  api.person('ana'),
  api.person('theo'),
  api.person('rui'),
  api.person('quinn'),
];
const customerId =
  (await api.db.selectFrom('person').select('customerId').where('id', '=', cora.id).executeTakeFirstOrThrow())
    .customerId ?? assert.fail('Cora is a Customer User');
const otherCustomer = await audited(
  api.superuser,
  { actor: 'svc:test', role: 'system', reason: 'Add a second Customer' },
  (tx) =>
    tx.insertInto('customer').values({ name: 'Second Customer (fictional)' }).returning('id').executeTakeFirstOrThrow(),
);
const dana = await api.addPerson('dana.analyst-reviewer', ['Analyst', 'Reviewer'], { trained: true });
const rhea = await api.addPerson('rhea.reviewer-qa', ['Reviewer', 'QA']);
const wes = await api.addPerson('wes.analyst', ['Analyst'], { trained: true });
const olga = await api.addPerson('olga.other-customer', ['Customer'], { customerId: otherCustomer.id });

const as = {
  cora: await api.login(cora),
  samir: await api.login(samir),
  lena: await api.login(lena),
  ana: await api.login(ana),
  rui: await api.login(rui),
  quinn: await api.login(quinn),
  dana: await api.login(dana),
  rhea: await api.login(rhea),
  wes: await api.login(wes),
  olga: await api.login(olga),
};

const result = {
  analyte: 'NDMA',
  value: '0.0300',
  unit: 'ppm',
  injectionSequenceRef: 'SEQ-2026-0042',
  notebookRef: 'NB-RD-0001-012',
  performedOn: '2026-09-30',
};

async function take(client: Client, name: StepName, testId: string, input: StepInput<StepName> = {}, signer?: Account) {
  const signature = signer && (await signatureOf(client, testId, signer));
  return client.call(stepRoute(name), { commitKey: randomUUID(), testId, input, ...(signature && { signature }) });
}

async function submitTestTo(state: 'Requested' | 'Ready' | 'Assigned', analyst: Account = ana): Promise<string> {
  const { testId: id } = ok(
    await as.cora.call(stepRoute('submit'), {
      commitKey: randomUUID(),
      input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' },
    }),
  );
  if (state !== 'Requested') assert.equal((await take(as.samir, 'receive', id)).status, 200);
  if (state === 'Assigned') assert.equal((await take(as.lena, 'assign', id, { assigneeId: analyst.id })).status, 200);
  return id;
}

const view = async (id: string, client = as.lena) => ok(await client.call(routes.test, { id }));

/** Narrows a canonical content value to the object it is, so a test reads its fields without a cast. */
function object(json: Json | undefined): JsonObject {
  return typeof json === 'object' && json !== null && !Array.isArray(json) ? json : assert.fail('not an object');
}

function recordVersions(table: 'test' | 'test_report', recordId: string) {
  return api.db
    .selectFrom('recordVersion')
    .select([
      'version',
      'canonicalForm',
      'content as bytes',
      sql<string>`encode(content_hash, 'hex')`.as('contentHash'),
      sql<JsonObject>`convert_from(content, 'UTF8')::jsonb`.as('content'),
    ])
    .where('recordTable', '=', table)
    .where('recordId', '=', recordId)
    .orderBy('version')
    .execute();
}

const changeResult = (testId: string, value: string) =>
  audited(
    api.superuser,
    { actor: 'svc:test', role: 'system', reason: 'Change a signed Result from outside the chain' },
    (tx) => tx.updateTable('result').set({ value }).where('testId', '=', testId).execute(),
  );

it('the chain walks a submitted Test to Reported with three Signatures and an audit entry for every step', async () => {
  const id = await submitTestTo('Assigned');
  assert.equal((await take(as.ana, 'enterResult', id, result, ana)).status, 200);
  assert.equal((await take(as.rui, 'review', id, {}, rui)).status, 200);
  assert.equal(
    refusedWith(await as.cora.call(routes.report, { id }), 'notFound'),
    'This Test has no released Test Report.',
    'no Test Report for the Customer before release',
  );
  const unreleased = await view(id, as.cora);
  assert.deepEqual(
    [unreleased.recordVersion, unreleased.result, unreleased.signatures],
    [null, null, []],
    'before release the Customer gets no Record Version hash, which could confirm a guessed Result',
  );
  assert.equal(unreleased.withheld, true, 'the Customer is told the Result and Signatures are withheld until release');
  assert.equal((await view(id, as.rui)).withheld, false, 'staff see the Test whole before release');
  assert.equal((await take(as.quinn, 'release', id, {}, quinn)).status, 200);
  assert.equal((await view(id, as.cora)).withheld, false, 'release shows the Customer the whole Test');

  const reported = await view(id, as.quinn);
  assert.equal(reported.test.state, 'Reported');
  assert.equal(reported.result?.value, '0.0300', 'the Result as typed');
  const auditTrail = ok(await as.quinn.call(routes.testTrail, { id })).entries.map((e) => e.raw);
  assert.equal(
    auditTrail.find((e) => e.table === 'result')?.newRow?.value,
    '0.0300',
    'the Audit Trail keeps the Result as typed',
  );
  const testInsert = auditTrail.find((e) => e.table === 'test' && e.op === 'INSERT')?.newRow;
  assert.deepEqual(
    Object.keys(testInsert ?? {}).sort(),
    ['assignee_id', 'data_class', 'gxp_class', 'id', 'lab_id', 'method_id', 'sample_id', 'state'],
    'the Audit Trail shows each row snapshot under its stored column names',
  );
  assert.deepEqual(
    reported.signatures.map((s) => [s.meaning, s.signer, s.record, s.recordVersion.version, s.unsigned]),
    [
      ['Performed', 'Ana Ferreira', 'Test', 3, false],
      ['Reviewed', 'Rui Tanaka', 'Test', 3, false],
      ['Released', 'Quinn Adeyemi', 'Test Report', 1, false],
    ],
    'Performed and Reviewed bind to the Record Version the Result made; Released to the Test Report',
  );
  const actors = {
    submit: cora,
    receive: samir,
    assign: lena,
    enterResult: ana,
    review: rui,
    release: quinn,
  } satisfies {
    [K in StepName]: Account;
  };
  for (const name of stepNames) {
    const entries = auditTrail.filter((e) => e.reason === name);
    assert.ok(entries.length > 0, `an audit entry for ${name}`);
    for (const e of entries)
      assert.deepEqual([e.actor, e.role], [`person:${actors[name].username}`, steps[name].role], name);
    assert.equal(
      entries.filter((e) => e.table === 'signature').length,
      steps[name].signs ? 1 : 0,
      `the Signature ${name} wrote is in the Test's Audit Trail`,
    );
  }

  const report = ok(await as.cora.call(routes.report, { id }));
  assert.match(report.report.number, /^RD-R-\d{4}-\d{6}$/);
  const printed = report.test;
  const testVersions = await recordVersions('test', id);
  assert.deepEqual(
    testVersions.map((v) => [v.version, v.canonicalForm, v.content.receivedAt !== null, v.content.value]),
    [
      [1, 1, false, null],
      [2, 1, true, null],
      [3, 1, true, '0.0300'],
    ],
    'submit, receive and the Result each saved a Record Version in canonical form 1, and the earlier ones are readable',
  );
  for (const v of testVersions)
    assert.equal(
      v.contentHash,
      createHash('sha256').update(v.bytes).digest('hex'),
      'the hash is the SHA-256 of the content',
    );
  const current = testVersions[2] ?? assert.fail();
  const { receivedAt, ...content } = current.content;
  assert.ok(
    typeof receivedAt === 'string' && receivedAt.startsWith(String(printed.receivedAt).slice(0, -1)),
    'the content keeps the microseconds the database clock gave; the wire rounds to milliseconds',
  );
  assert.deepEqual(
    content,
    {
      id,
      customer: printed.customer,
      sample: printed.sampleNumber,
      description: printed.description,
      method: printed.methodCode,
      methodVersion: printed.methodVersion,
      methodTitle: printed.methodTitle,
      gxpClass: printed.gxpClass,
      ...result,
    },
    'the signed content is what the Test Report prints, with the Result as typed',
  );
  assert.deepEqual(reported.recordVersion, { version: 3, canonicalForm: 1, contentHash: current.contentHash });
  const reportId = reported.report?.id ?? assert.fail();
  const [reportVersion] = await recordVersions('test_report', reportId);
  assert.deepEqual(
    reported.signatures.map((s) => s.recordVersion.contentHash),
    [current.contentHash, current.contentHash, reportVersion?.contentHash],
  );
  assert.deepEqual(
    reportVersion?.content,
    { id: reportId, number: report.report.number, test: current.content },
    'the Test Report is built on the Test content it was released with',
  );
  const verified = ok(await as.quinn.call(routes.verifyAuditTrail));
  assert.deepEqual(
    verified.chains.map((c) => [c.chain, c.breaks]),
    [
      ['lab', []],
      ['company', []],
    ],
  );
  const { recent } = await api.db
    .selectNoFrom(sql<boolean>`${verified.at}::timestamptz between now() - interval '1 minute' and now()`.as('recent'))
    .executeTakeFirstOrThrow();
  assert.ok(recent, 'the server states when it checked, by the database clock');
});

it('a change to a signed Test re-versions it and its Test Report, and every Signature on the earlier version is returned as unsigned', async () => {
  const id = await submitTestTo('Assigned');
  assert.equal((await take(as.ana, 'enterResult', id, result, ana)).status, 200);
  assert.equal((await take(as.rui, 'review', id, {}, rui)).status, 200);
  assert.equal((await take(as.quinn, 'release', id, {}, quinn)).status, 200);
  const signed = await view(id, as.quinn);
  const reportId = signed.report?.id ?? assert.fail();
  const before = signed.recordVersion ?? assert.fail();
  const released = ok(await as.cora.call(routes.report, { id }));
  assert.deepEqual(
    [released.recordVersion.version, released.signatures.find((s) => s.meaning === 'Released')?.recordVersion],
    [1, released.recordVersion],
    'the Test Report read names its current Record Version, the one the Released Signature was given on',
  );

  await changeResult(id, '0.0380');
  const changed = await view(id, as.quinn);
  const after = changed.recordVersion ?? assert.fail();
  assert.deepEqual(
    [after.version, after.contentHash === before.contentHash],
    [before.version + 1, false],
    'the Test moved to a new Record Version with another hash',
  );
  assert.deepEqual(
    changed.signatures.map((s) => [s.meaning, s.recordVersion.version, s.unsigned]),
    [
      ['Performed', 3, true],
      ['Reviewed', 3, true],
      ['Released', 1, true],
    ],
    'each Signature keeps the version it was given on and is returned as unsigned',
  );
  assert.deepEqual(
    (await recordVersions('test_report', reportId)).map((v) => [v.version, object(v.content.test).value]),
    [
      [1, '0.0300'],
      [2, '0.0380'],
    ],
    'the Test Report built on the Test has a new Record Version too',
  );
  const changedReport = ok(await as.cora.call(routes.report, { id }));
  assert.ok(
    changedReport.signatures.every((s) => s.unsigned),
    'the Customer sees the Released signature as unsigned on the Test Report',
  );
  const { version, canonicalForm, contentHash } =
    (await recordVersions('test_report', reportId)).at(-1) ?? assert.fail();
  assert.deepEqual(
    [changedReport.recordVersion, version],
    [{ version, canonicalForm, contentHash }, 2],
    "the Test Report read names the report's new Record Version, later than the Released Signature's",
  );
  assert.ok(
    ok(await as.quinn.call(routes.testTrail, { id })).entries.some(
      (e) => e.raw.table === 'record_version' && e.reason === 'Change a signed Result from outside the chain',
    ),
    'the new Record Version is in the Audit Trail under the change that made it',
  );

  await changeResult(id, '0.038');
  const narrower = (await view(id, as.quinn)).recordVersion ?? assert.fail();
  assert.notEqual(
    narrower.contentHash,
    after.contentHash,
    '0.038 is not 0.0380: the content keeps the digits as typed',
  );
  await changeResult(id, '0.0380');
  const again = await view(id, as.quinn);
  assert.deepEqual(
    [again.recordVersion?.contentHash, again.recordVersion?.version],
    [after.contentHash, before.version + 3],
    'the same content gives the same hash, on a new Record Version',
  );
  assert.ok(
    again.signatures.every((s) => s.unsigned),
    'a Signature on an earlier version stays unsigned even when the content comes back',
  );
});

it('a step by the wrong role is refused', async () => {
  const id = await submitTestTo('Requested');
  assert.equal(
    refusedWith(await take(as.cora, 'receive', id), 'role'),
    'The receive step is taken by the SampleCustodian role.',
  );
  refusedWith(await take(as.ana, 'receive', id), 'role');
  assert.equal((await view(id)).test.state, 'Requested');
});

it('assigning an Analyst without a Training Record for the Method is refused', async () => {
  const id = await submitTestTo('Ready');
  const refused = await take(as.lena, 'assign', id, { assigneeId: theo.id });
  assert.match(refusedWith(refused, 'guard'), /Training Record/);
  const after = await view(id);
  assert.deepEqual([after.test.state, after.test.assignee], ['Ready', null]);
});

it('the Analyst who signed Performed cannot review, and the Reviewer who reviewed cannot release', async () => {
  const id = await submitTestTo('Assigned', dana);
  assert.equal((await take(as.dana, 'enterResult', id, result, dana)).status, 200);
  assert.equal((await view(id, as.dana)).next, null, 'review is not offered to the Analyst who performed it');
  const anySignature = {
    username: 'unused',
    password: 'unused',
    recordVersion: { version: 1, contentHash: '0'.repeat(64) },
    statementVersion: 1,
  };
  const selfReview = await as.dana.call(stepRoute('review'), {
    commitKey: randomUUID(),
    testId: id,
    input: {},
    signature: anySignature,
  });
  assert.equal(refusedWith(selfReview, 'guard'), 'The Analyst who performed the Test cannot review it.');

  assert.equal((await take(as.rhea, 'review', id, {}, rhea)).status, 200);
  const selfRelease = await as.rhea.call(stepRoute('release'), {
    commitKey: randomUUID(),
    testId: id,
    input: {},
    signature: anySignature,
  });
  refusedWith(selfRelease, 'guard');
  assert.equal((await view(id)).test.state, 'Reviewed');
});

it('a signing with a wrong password is refused and changes nothing, and a signing on an ended session is refused by another kind', async () => {
  const id = await submitTestTo('Assigned', wes);
  const before = await view(id);
  const seen = await signatureOf(as.wes, id, wes);
  const enter = (signature: SigningBody) =>
    as.wes.call(stepRoute('enterResult'), { commitKey: randomUUID(), testId: id, input: result, signature });

  assert.equal(
    refusedWith(await enter({ ...seen, password: 'not-the-password' }), 'badCredentials'),
    'The user ID or password is not valid.',
  );
  assert.deepEqual(
    await view(id),
    before,
    'a wrong password leaves the Test, Result, Signatures and Audit Trail as they were',
  );
  assert.equal((await enter(seen)).status, 200);

  ok(await as.wes.call(routes.logout));
  assert.equal(refusedWith(await enter(seen), 'noSession'), 'Sign in first.');
});

it('a typed user ID that is not the session person is refused like a wrong password, and each failure is its own Access Event that counts toward the lockout', async () => {
  const signer = await api.addPerson('kim.analyst', ['Analyst'], { trained: true });
  const client = await api.login(signer);
  const id = await submitTestTo('Assigned', signer);
  const failures = async () =>
    (
      await api.superuser
        .selectFrom('person')
        .select('failedLogins')
        .where('id', '=', signer.id)
        .executeTakeFirstOrThrow()
    ).failedLogins;
  const seen = await signatureOf(client, id, signer);
  const attempt = (signature: SigningBody) =>
    client.call(stepRoute('enterResult'), { commitKey: randomUUID(), testId: id, input: result, signature });

  assert.equal(
    refusedWith(await attempt({ ...seen, username: ana.username }), 'badCredentials'),
    'The user ID or password is not valid.',
  );
  assert.equal(await failures(), 1, "another person's user ID with the right password counts one failure");
  assert.equal(
    refusedWith(await attempt({ ...seen, password: 'wrong' }), 'badCredentials'),
    'The user ID or password is not valid.',
  );
  assert.equal(await failures(), 2);
  const { id: sessionId } = await api.superuser
    .selectFrom('session')
    .select('id')
    .where('personId', '=', signer.id)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await api.superuser
      .selectFrom('accessEvent')
      .select(['kind', 'failureReason', 'sessionId', sql<string[]>`roles::text[]`.as('roles')])
      .where('subjectId', '=', signer.id)
      .where('kind', '=', 'ReauthenticationFailed')
      .orderBy('at')
      .execute(),
    [
      { kind: 'ReauthenticationFailed', failureReason: 'WrongUserId', sessionId, roles: ['Analyst'] },
      { kind: 'ReauthenticationFailed', failureReason: 'WrongPassword', sessionId, roles: ['Analyst'] },
    ],
    'each failed re-authentication is an Access Event on the session, naming why',
  );
  assert.equal((await view(id, client)).signatures.length, 0, 'nothing was signed');
  assert.equal((await attempt(seen)).status, 200, 'the right user ID and password sign');
  assert.equal(await failures(), 0, 'a signing that proves the person clears the count');
});

it('a signing on sight of a signature statement version that is not in force is refused, with no System Incident', async () => {
  const id = await submitTestTo('Assigned');
  const seen = await signatureOf(as.ana, id, ana);
  const refused = await as.ana.call(stepRoute('enterResult'), {
    commitKey: randomUUID(),
    testId: id,
    input: result,
    signature: { ...seen, statementVersion: 999 },
  });
  assert.equal(
    refusedWith(refused, 'signingRefused'),
    'The Signature Statement changed since this screen loaded it. Read it again before signing.',
  );
  assert.deepEqual((await view(id, as.ana)).signatures, [], 'nothing was signed');
  const { n } = await api.superuser
    .selectFrom('systemIncident')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('step', '=', 'enterResult')
    .executeTakeFirstOrThrow();
  assert.equal(n, 0, 'a refused signing opens no System Incident');
});

it('a signing on sight of a Record Version that is no longer the latest is refused with its own kind and writes no Signature', async () => {
  const id = await submitTestTo('Assigned');
  assert.equal((await take(as.ana, 'enterResult', id, result, ana)).status, 200);
  const seen = await signatureOf(as.rui, id, rui);
  await audited(
    api.superuser,
    { actor: 'svc:test', role: 'system', reason: 'Rename the Customer behind the Test' },
    (tx) =>
      tx
        .updateTable('customer')
        .set({ name: `Northwind Generics renamed ${randomUUID()} (fictional)` })
        .where('id', '=', customerId)
        .execute(),
  );
  const refused = await as.rui.call(stepRoute('review'), {
    commitKey: randomUUID(),
    testId: id,
    input: {},
    signature: seen,
  });
  assert.equal(
    refusedWith(refused, 'recordChanged'),
    'The Test changed since this screen loaded it. Read it again before signing.',
  );
  const after = await view(id, as.rui);
  assert.deepEqual(
    [after.test.state, after.signatures.map((s) => s.meaning)],
    ['SubmittedForReview', ['Performed']],
    'no Reviewed Signature and no state move',
  );
  assert.ok(
    after.recordVersion && after.recordVersion.version > seen.recordVersion.version,
    'the Test has a later version',
  );
  assert.equal(
    (await take(as.rui, 'review', id, {}, rui)).status,
    200,
    'reading the Test again lets the Reviewer sign',
  );
});

it(`every Signature of the chain is written by the signing function and records the signer as signed, the stored hash and form, statement 1, the authenticator, the session and the release ${TEST_RELEASE}`, async () => {
  const id = await submitTestTo('Assigned');
  assert.equal((await take(as.ana, 'enterResult', id, result, ana)).status, 200);
  assert.equal((await take(as.rui, 'review', id, {}, rui)).status, 200);
  assert.equal((await take(as.quinn, 'release', id, {}, quinn)).status, 200);
  const rows = await api.superuser
    .selectFrom('signature as s')
    .innerJoin('recordVersion as v', (j) => j.onRef('v.labId', '=', 's.labId').onRef('v.id', '=', 's.recordVersionId'))
    .innerJoin('reauthentication as r', (j) =>
      j.onRef('r.labId', '=', 's.labId').onRef('r.id', '=', 's.reauthenticationId'),
    )
    .innerJoin('signatureStatement as t', 't.version', 's.statementVersion')
    .innerJoin('person as p', 'p.id', 's.personId')
    .select([
      's.meaning',
      's.printedName',
      's.username',
      's.role',
      'v.recordTable',
      'v.version',
      sql<boolean>`s.content_hash = v.content_hash`.as('hashCopied'),
      sql<boolean>`s.canonical_form = v.canonical_form`.as('formCopied'),
      's.statementVersion',
      sql<boolean>`s.statement_hash = t.statement_hash`.as('statementCopied'),
      's.authenticator',
      's.appRelease',
      sql<boolean>`s.session_id = r.session_id and s.person_id = r.person_id and s.meaning = r.meaning`.as(
        'reauthenticated',
      ),
      sql<boolean>`exists (select from lims.session x where x.lab_id = s.lab_id and x.id = s.session_id and x.person_id = p.id)`.as(
        'onOwnSession',
      ),
    ])
    .where('v.recordId', 'in', [id, api.superuser.selectFrom('testReport').select('id').where('testId', '=', id)])
    .orderBy('s.signedAt')
    .execute();
  const signed = (meaning: string, signer: Account, role: string, recordTable: string, version: number) => ({
    meaning,
    printedName:
      signer.username === ana.username
        ? 'Ana Ferreira'
        : signer.username === rui.username
          ? 'Rui Tanaka'
          : 'Quinn Adeyemi',
    username: signer.username,
    role,
    recordTable,
    version,
    hashCopied: true,
    formCopied: true,
    statementVersion: 1,
    statementCopied: true,
    authenticator: 'Password',
    appRelease: TEST_RELEASE,
    reauthenticated: true,
    onOwnSession: true,
  });
  assert.deepEqual(rows, [
    signed('Performed', ana, 'Analyst', 'test', 3),
    signed('Reviewed', rui, 'Reviewer', 'test', 3),
    signed('Released', quinn, 'QA', 'test_report', 1),
  ]);
  assert.deepEqual(
    (await view(id, as.quinn)).signatures.map((s) => [s.meaning, s.username, s.role]),
    [
      ['Performed', ana.username, 'Analyst'],
      ['Reviewed', rui.username, 'Reviewer'],
      ['Released', quinn.username, 'QA'],
    ],
    'every screen can show the username and role at signing',
  );
});

it(`the ${HARNESS_LOGIN.lockoutAfter}th wrong signing password locks the account and writes a lockout Access Event with the session and the step's role`, async () => {
  const signer = await api.addPerson('lou.analyst', ['Analyst'], { trained: true });
  const client = await api.login(signer);
  const id = await submitTestTo('Assigned', signer);
  for (let i = 0; i < HARNESS_LOGIN.lockoutAfter; i++)
    refusedWith(
      await client.call(stepRoute('enterResult'), {
        commitKey: randomUUID(),
        testId: id,
        input: result,
        signature: { ...(await signatureOf(client, id, signer)), password: 'wrong' },
      }),
      'badCredentials',
    );

  const events = await api.superuser
    .selectFrom('accessEvent')
    .select(['kind', 'sessionId', sql<string[]>`roles::text[]`.as('roles')])
    .where('subjectId', '=', signer.id)
    .orderBy('at')
    .execute();
  const session = await api.superuser
    .selectFrom('session')
    .select('id')
    .where('personId', '=', signer.id)
    .executeTakeFirstOrThrow();
  assert.deepEqual(events, [
    { kind: 'SignInSucceeded', sessionId: session.id, roles: ['Analyst'] },
    ...Array.from({ length: HARNESS_LOGIN.lockoutAfter }, () => ({
      kind: 'ReauthenticationFailed',
      sessionId: session.id,
      roles: ['Analyst'],
    })),
    { kind: 'Lockout', sessionId: session.id, roles: ['Analyst'] },
  ]);
  const incidents = await api.superuser
    .selectFrom('systemIncident')
    .select('kind')
    .where('subjectId', '=', signer.id)
    .execute();
  assert.deepEqual(incidents, [{ kind: 'Lockout' }], 'the lockout at signing opens a System Incident');
  const roles = await api.superuser
    .selectFrom('auditEntry')
    .select('role')
    .distinct()
    .where('actor', '=', `person:${signer.username}`)
    .where('tableName', 'in', ['person', 'access_event'])
    .execute();
  assert.deepEqual(roles, [{ role: steps.enterResult.role }], "the failures are recorded under the step's role");
  refusedWith(await client.call(routes.me), 'noSession');
});

it('a Lockout committed after the signing password was checked refuses the Signature, records the refusal without counting it, and leaves the Test as it was', async () => {
  const signer = await api.addPerson('lea.analyst', ['Analyst'], { trained: true });
  const client = await api.login(signer);
  const id = await submitTestTo('Assigned', signer);
  const before = await view(id);
  const signature = await signatureOf(client, id, signer);
  const press = (password: string) =>
    client.call(stepRoute('enterResult'), {
      commitKey: randomUUID(),
      testId: id,
      input: result,
      signature: { ...signature, password },
    });
  refusedWith(await press('wrong'), 'badCredentials');

  const signing = await api.lockOutWhile(signer, () => press(signature.password));

  assert.equal(refusedWith(signing, 'accountLocked'), 'This account is locked.');
  assert.deepEqual(await view(id), before, 'no Result, no Signature, and the Test still Assigned');
  const failures = await api.superuser
    .selectFrom('accessEvent')
    .select(['kind', 'failureReason'])
    .where('subjectId', '=', signer.id)
    .where('kind', '<>', 'SignInSucceeded')
    .orderBy('at')
    .execute();
  assert.deepEqual(
    failures,
    [
      { kind: 'ReauthenticationFailed', failureReason: 'WrongPassword' },
      { kind: 'ReauthenticationFailed', failureReason: 'AccountLocked' },
    ],
    'the refused signing is an Access Event, as a sign-in refused by a Lockout is',
  );
  const { failedLogins } = await api.superuser
    .selectFrom('person')
    .select('failedLogins')
    .where('id', '=', signer.id)
    .executeTakeFirstOrThrow();
  assert.equal(failedLogins, 1, 'the refusal does not count toward the lockout again');
  const reasons = await api.superuser
    .selectFrom('auditEntry')
    .select('reason')
    .distinct()
    .where('actor', '=', `person:${signer.username}`)
    .where('tableName', '=', 'access_event')
    .execute();
  assert.deepEqual(
    reasons,
    [{ reason: 'Failed authentication' }],
    'both refusals are recorded as failed authentication',
  );
});

it("a Customer User cannot read another Customer's Test", async () => {
  const id = await submitTestTo('Requested');
  assert.ok(ok(await as.cora.call(routes.tests)).some((t) => t.id === id));
  refusedWith(await as.olga.call(routes.test, { id }), 'notFound');
  refusedWith(await as.olga.call(routes.report, { id }), 'notFound');
  assert.ok(!ok(await as.olga.call(routes.tests)).some((t) => t.id === id));
});

it("a query without the context's Lab fails, and another Lab's Test is out of reach", async () => {
  const ctx = ok(await as.lena.call(routes.me));
  assert.throws(() => labScope(api.db, { ...ctx, lab: { id: '', code: '', name: '' } }), /needs the Lab/);

  const otherTest = await audited(
    api.superuser,
    { actor: 'svc:test', role: 'system', reason: 'Add a second Lab' },
    async (tx) => {
      // The Submission comes before the Lab: a transaction locks the company chain before any Lab's.
      const submission = await tx
        .insertInto('submission')
        .values({ customerId, submittedBy: cora.id, number: 'SUB-2026-900001' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const { labId } = await tx
        .insertInto('lab')
        .values({ code: 'OT', name: 'Other Lab', timeZone: 'UTC' })
        .returning('labId')
        .executeTakeFirstOrThrow();
      const sample = await tx
        .insertInto('sample')
        .values({ labId, submissionId: submission.id, number: 'OT-S-2026-000001', description: 'x' })
        .returning('id')
        .executeTakeFirstOrThrow();
      return (
        await tx
          .insertInto('test')
          .values({ labId, sampleId: sample.id, methodId: api.methodId })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    },
  );
  refusedWith(await as.lena.call(routes.test, { id: otherTest }), 'notFound');
  refusedWith(await take(as.samir, 'receive', otherTest), 'notFound');
  assert.ok(!ok(await as.lena.call(routes.tests)).some((t) => t.id === otherTest));
});

it('a Test leaves the API with only the fields a Test row declares', async () => {
  const id = await submitTestTo('Assigned');
  const declared = Object.keys(routes.tests.schema.response[200].items.properties).sort();
  const listed = ok(await as.lena.call(routes.tests)).find((t) => t.id === id) ?? assert.fail('the Test is listed');
  assert.deepEqual(Object.keys(listed).sort(), declared, 'GET /api/tests');
  assert.deepEqual(Object.keys((await view(id)).test).sort(), declared, 'GET /api/tests/:id');
});
