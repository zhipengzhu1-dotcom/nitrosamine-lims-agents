import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { forcesYes, incidentStepRoute, type Role, routes, type SigningBody, stepRoute } from '@lims/domain';
import { sql } from 'kysely';
import { type Account, type Client, ok, refusedWith, signatureOf, startApi } from './harness.ts';

const api = await startApi('lims_api_incident_closure_test');
const lou = await api.addPerson('lou.analyst', ['Analyst'], { trained: true });
const quinn = api.person('quinn');
const ada = api.person('ada');
const as = {
  lou: await api.login(lou),
  cora: await api.login(api.person('cora')),
  samir: await api.login(api.person('samir')),
  lena: await api.login(api.person('lena')),
  quinn: await api.login(quinn),
  ada: await api.login(ada),
};

const PROBE = 'RD-NB-CLOSURE-PROBE';
await sql`alter table lims.result add constraint closure_probe check (notebook_ref <> ${sql.lit(PROBE)})`.execute(
  api.superuser,
);

/** An UnexpectedFailure System Incident, opened by a write the probe constraint refuses. */
async function failedIncident(): Promise<string> {
  const { testId } = ok(
    await as.cora.call(stepRoute('submit'), {
      commitKey: randomUUID(),
      input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' },
    }),
  );
  ok(await as.samir.call(stepRoute('receive'), { commitKey: randomUUID(), testId, input: {} }));
  ok(await as.lena.call(stepRoute('assign'), { commitKey: randomUUID(), testId, input: { assigneeId: lou.id } }));
  const res = await fetch(api.base + stepRoute('enterResult').url, {
    method: 'POST',
    headers: { cookie: as.lou.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      commitKey: randomUUID(),
      testId,
      input: {
        analyte: 'NDMA',
        value: '0.0300',
        unit: 'ppm',
        injectionSequenceRef: 'SEQ-2026-0042',
        notebookRef: PROBE,
        performedOn: '2026-09-30',
      },
      signature: await signatureOf(as.lou, testId, lou),
    }),
  });
  const text = await res.text();
  return /reference (\w+), then reload/.exec(text)?.[1] ?? assert.fail(`no reference in ${text}`);
}

/** A ChainVerifyFailure System Incident: the database owner alters an entry and QA verifies the chain. */
async function brokenChainIncident(): Promise<string> {
  await failedIncident();
  const { seq } = await api.db
    .selectFrom('auditEntry')
    .select('seq')
    .where('chain', '=', api.labId)
    .orderBy('seq', 'desc')
    .executeTakeFirstOrThrow();
  await api.superuser.transaction().execute(async (tx) => {
    await sql`set local session_replication_role = replica`.execute(tx);
    await sql`update lims.audit_entry set reason = 'Routine update' where chain = ${api.labId} and seq = ${seq}`.execute(
      tx,
    );
  });
  const verified = ok(await as.quinn.call(routes.verifyAuditTrail));
  return verified.chains[0]?.breaks[0]?.incident ?? assert.fail('the break names a System Incident');
}

const view = async (client: Client, reference: string) => ok(await client.call(routes.incident, { reference }));

async function acknowledgement(client: Client, reference: string, account: Account): Promise<SigningBody> {
  const { recordVersion, statement } = await view(client, reference);
  return {
    username: account.username,
    password: account.password,
    recordVersion: { version: recordVersion.version, contentHash: recordVersion.contentHash },
    statementVersion: statement.version,
  };
}

const answer = (client: Client, reference: string, answered: 'Yes' | 'No') =>
  client.call(incidentStepRoute('answerImpact'), { reference, input: { answer: answered } });
const immediate = (client: Client, reference: string, text: string) =>
  client.call(incidentStepRoute('recordImmediateAction'), { reference, input: { text } });
const corrective = (client: Client, reference: string, text: string) =>
  client.call(incidentStepRoute('recordCorrectiveAction'), { reference, input: { text } });
const acknowledge = async (client: Client, reference: string, signer: Account) =>
  client.call(incidentStepRoute('acknowledge'), {
    reference,
    input: {},
    signature: await acknowledgement(client, reference, signer),
  });
const close = (client: Client, reference: string) => client.call(incidentStepRoute('close'), { reference, input: {} });

const incidentEntries = (reference: string) =>
  api.db
    .selectFrom('auditEntry')
    .select(['actor', 'role', 'reason', 'chain', 'op'])
    .select(sql<string | null>`new_row ->> 'immediate_action'`.as('immediateAction'))
    .select(sql<string | null>`new_row ->> 'corrective_action'`.as('correctiveAction'))
    .select(sql<string | null>`new_row ->> 'impact_answer'`.as('impactAnswer'))
    .select(sql<string | null>`new_row ->> 'state'`.as('state'))
    .where('tableName', '=', 'system_incident')
    .where(sql<boolean>`new_row ->> 'reference' = ${reference}`)
    .orderBy('seq')
    .execute();

it('QA records Yes or No on an Open System Incident, once; any other role is refused', async () => {
  const reference = await failedIncident();
  assert.equal((await view(as.quinn, reference)).impact, null);
  for (const [client, role] of [
    [as.ada, 'Admin'],
    [as.lena, 'LabManager'],
    [as.lou, 'Analyst'],
  ] as const satisfies [Client, Role][]) {
    refusedWith(await answer(client, reference, 'No'), 'role');
    assert.equal((await view(as.quinn, reference)).impact, null, `${role} recorded no answer`);
  }
  const answered = ok(await answer(as.quinn, reference, 'No'));
  assert.partialDeepStrictEqual(answered.impact, {
    answer: 'No',
    by: { username: quinn.username, displayName: 'Quinn Adeyemi' },
  });
  assert.equal(answered.state, 'Open');
  assert.equal(
    refusedWith(await answer(as.quinn, reference, 'Yes'), 'guard'),
    "QA's answer is already recorded on this System Incident.",
  );
  assert.equal((await view(as.ada, reference)).impact?.answer, 'No');

  const other = await failedIncident();
  assert.equal(ok(await answer(as.quinn, other, 'Yes')).impact?.answer, 'Yes');
});

it('on a chain-verify System Incident a No answer is refused and the answer is Yes', async () => {
  const reference = await brokenChainIncident();
  assert.equal((await view(as.quinn, reference)).kind, 'ChainVerifyFailure');
  assert.equal(
    refusedWith(await answer(as.quinn, reference, 'No'), 'guard'),
    'A broken or unanchored audit chain, or a clock step, could have affected results or records: the answer is Yes.',
  );
  assert.equal((await view(as.quinn, reference)).impact, null, 'the refused No left no answer');
  assert.equal(ok(await answer(as.quinn, reference, 'Yes')).impact?.answer, 'Yes');
});

it('the kinds that force a Yes answer are the same in the step registry and in the database', async () => {
  const { rows } = await sql<{ kind: string; forced: boolean }>`
    select kind::text as kind, lims.incident_forces_yes(kind::text) as forced
      from unnest(enum_range(null::lims.incident_kind)) as kind`.execute(api.superuser);
  assert.ok(rows.length > 0);
  for (const { kind, forced } of rows) assert.equal(forcesYes(kind), forced, kind);
  assert.equal(forcesYes('ChainVerifyFailure'), true);
});

it('the Admin records the immediate and corrective actions, once each, and the Audit Trail holds each on the company chain', async () => {
  const reference = await failedIncident();
  refusedWith(await immediate(as.quinn, reference, 'QA cannot record this.'), 'role');
  refusedWith(await immediate(as.lena, reference, 'A Lab Manager cannot record this.'), 'role');
  const first = ok(await immediate(as.ada, reference, 'Stopped the bench and reran the entry.'));
  assert.partialDeepStrictEqual(first.immediateAction, {
    text: 'Stopped the bench and reran the entry.',
    by: { username: ada.username, displayName: 'Ada Novak' },
  });
  assert.equal(first.correctiveAction, null);
  assert.equal(
    refusedWith(await immediate(as.ada, reference, 'Again.'), 'guard'),
    'The immediate action is already recorded.',
  );
  const second = ok(await corrective(as.ada, reference, 'Added a check on the notebook reference.'));
  assert.equal(second.correctiveAction?.text, 'Added a check on the notebook reference.');
  assert.equal(
    refusedWith(await corrective(as.ada, reference, 'Again.'), 'guard'),
    'The corrective action is already recorded.',
  );
  refusedWith(await immediate(as.ada, reference, ' '), 'malformed');

  const entries = await incidentEntries(reference);
  assert.partialDeepStrictEqual(
    entries.filter((e) => e.op === 'UPDATE'),
    [
      {
        actor: `person:${ada.username}`,
        role: 'Admin',
        reason: 'recordImmediateAction',
        chain: 'company',
        immediateAction: 'Stopped the bench and reran the entry.',
        correctiveAction: null,
      },
      {
        actor: `person:${ada.username}`,
        role: 'Admin',
        reason: 'recordCorrectiveAction',
        chain: 'company',
        correctiveAction: 'Added a check on the notebook reference.',
      },
    ],
  );
});

it('closing is refused, each with a kind, while either action, QA’s answer or the Acknowledged signing is missing', async () => {
  const reference = await failedIncident();
  refusedWith(await close(as.quinn, reference), 'role');
  assert.equal(
    refusedWith(await close(as.ada, reference), 'guard'),
    'The immediate action is not recorded on this System Incident.',
  );
  ok(await immediate(as.ada, reference, 'Reran the entry.'));
  assert.equal(
    refusedWith(await close(as.ada, reference), 'guard'),
    'The corrective action is not recorded on this System Incident.',
  );
  ok(await corrective(as.ada, reference, 'Added a check.'));
  assert.equal(
    refusedWith(await close(as.ada, reference), 'guard'),
    "QA's answer is not recorded on this System Incident.",
  );
  assert.equal(
    refusedWith(await acknowledge(as.ada, reference, ada), 'guard'),
    "QA's answer is not recorded on this System Incident.",
  );
  ok(await answer(as.quinn, reference, 'No'));
  assert.equal(
    refusedWith(await close(as.ada, reference), 'guard'),
    'The Acknowledged signing is not on this System Incident.',
  );
  assert.equal((await view(as.ada, reference)).state, 'Open');
});

it('the Acknowledged signing goes through the signing function, moves the incident to Acknowledged, and the Admin then closes it', async () => {
  const reference = await failedIncident();
  ok(await answer(as.quinn, reference, 'Yes'));
  ok(await immediate(as.ada, reference, 'Reran the entry.'));
  ok(await corrective(as.ada, reference, 'Added a check.'));
  const before = await view(as.ada, reference);
  assert.equal(before.acknowledged, null);
  assert.equal(before.recordVersion.version, 1, 'no version is written until the signing');

  const wrongPassword = { ...(await acknowledgement(as.ada, reference, ada)), password: 'not-the-password' };
  refusedWith(
    await as.ada.call(incidentStepRoute('acknowledge'), { reference, input: {}, signature: wrongPassword }),
    'badCredentials',
  );
  assert.equal((await view(as.ada, reference)).state, 'Open', 'a failed re-authentication moves nothing');
  const stale = {
    ...(await acknowledgement(as.ada, reference, ada)),
    recordVersion: { version: 1, contentHash: '00'.repeat(32) },
  };
  refusedWith(
    await as.ada.call(incidentStepRoute('acknowledge'), { reference, input: {}, signature: stale }),
    'recordChanged',
  );
  refusedWith(await acknowledge(as.quinn, reference, quinn), 'role');

  const acknowledged = ok(await acknowledge(as.ada, reference, ada));
  assert.equal(acknowledged.state, 'Acknowledged');
  assert.partialDeepStrictEqual(acknowledged.acknowledged, {
    signer: 'Ada Novak',
    username: ada.username,
    role: 'Admin',
  });
  const signature = await api.db
    .selectFrom('signature')
    .innerJoin('recordVersion', (j) =>
      j
        .onRef('recordVersion.labId', '=', 'signature.labId')
        .onRef('recordVersion.id', '=', 'signature.recordVersionId'),
    )
    .innerJoin('reauthentication', 'reauthentication.id', 'signature.reauthenticationId')
    .select([
      'signature.meaning',
      'signature.role',
      'signature.statementVersion',
      'recordVersion.recordTable',
      'recordVersion.version',
      'reauthentication.meaning as reauthenticatedFor',
      sql<string>`encode(record_version.content_hash, 'hex')`.as('contentHash'),
    ])
    .where('recordVersion.recordTable', '=', 'system_incident')
    .where(
      'recordVersion.recordId',
      '=',
      (
        await api.db
          .selectFrom('systemIncident')
          .select('id')
          .where('reference', '=', reference)
          .executeTakeFirstOrThrow()
      ).id,
    )
    .execute();
  assert.partialDeepStrictEqual(signature, [
    {
      meaning: 'Acknowledged',
      role: 'Admin',
      statementVersion: before.statement.version,
      recordTable: 'system_incident',
      version: 1,
      reauthenticatedFor: 'Acknowledged',
      contentHash: before.recordVersion.contentHash,
    },
  ]);
  assert.equal(
    refusedWith(await immediate(as.ada, reference, 'Again.'), 'guard'),
    'The immediate action is already recorded.',
  );
  assert.equal(
    refusedWith(await acknowledge(as.ada, reference, ada), 'state'),
    'The acknowledge step needs a System Incident in Open state, not Acknowledged.',
  );

  const closed = ok(await close(as.ada, reference));
  assert.equal(closed.state, 'Closed');
  assert.equal(closed.acknowledged?.username, ada.username);
  assert.equal(
    refusedWith(await close(as.ada, reference), 'state'),
    'The close step needs a System Incident in Acknowledged state, not Closed.',
  );
  const states = (await incidentEntries(reference)).filter((e) => e.op === 'UPDATE').map((e) => e.state);
  assert.deepEqual(states, ['Open', 'Open', 'Open', 'Acknowledged', 'Closed']);
  assert.ok(
    !ok(await as.ada.call(routes.incidents)).some((row) => row.reference === reference),
    'a Closed System Incident leaves the open list',
  );
});

it('of two answers from QA at once, one is recorded and the other is refused as stale', async () => {
  const reference = await failedIncident();
  // Both read the incident unanswered, then wait on the company chain, which is held until both are waiting.
  let answers: ReturnType<typeof answer>[] = [];
  await api.superuser.transaction().execute(async (tx) => {
    await sql`select lims.lock_chains('company')`.execute(tx);
    answers = [answer(as.quinn, reference, 'Yes'), answer(as.quinn, reference, 'Yes')];
    await api.untilWaitingOnLocks(2);
  });
  const kinds = (await Promise.all(answers)).map((a) => (a.kind === 'reply' ? 'reply' : a.body.kind));
  assert.deepEqual(kinds.sort(), ['reply', 'stale']);
  assert.equal((await view(as.quinn, reference)).impact?.answer, 'Yes');
  assert.equal((await incidentEntries(reference)).filter((e) => e.op === 'UPDATE').length, 1, 'one answer recorded');
});

it('a corrective action recorded between the signing sheet loading and the signing refuses the signing as recordChanged', async () => {
  const reference = await failedIncident();
  ok(await answer(as.quinn, reference, 'Yes'));
  ok(await immediate(as.ada, reference, 'Reran the entry.'));
  const sheet = await acknowledgement(as.ada, reference, ada);
  ok(await corrective(as.ada, reference, 'Added a check.'));
  refusedWith(
    await as.ada.call(incidentStepRoute('acknowledge'), { reference, input: {}, signature: sheet }),
    'recordChanged',
  );
  const unsigned = await view(as.ada, reference);
  assert.equal(unsigned.state, 'Open');
  assert.equal(unsigned.acknowledged, null, 'nothing was signed');
  assert.notEqual(unsigned.recordVersion.contentHash, sheet.recordVersion.contentHash);
  assert.equal(ok(await acknowledge(as.ada, reference, ada)).state, 'Acknowledged');
});

it('a System Incident whose content changes after the Acknowledged signing returns that Signature as unsigned', async () => {
  const reference = await failedIncident();
  ok(await answer(as.quinn, reference, 'Yes'));
  ok(await immediate(as.ada, reference, 'Reran the entry.'));
  ok(await corrective(as.ada, reference, 'Added a check.'));
  const signed = ok(await acknowledge(as.ada, reference, ada));
  assert.partialDeepStrictEqual(signed.acknowledged, {
    meaning: 'Acknowledged',
    record: 'System Incident',
    recordVersion: { version: 1, canonicalForm: 1, contentHash: signed.recordVersion.contentHash },
    unsigned: false,
  });
  // The triggers freeze every column after the signing, so only the database owner, past them, can change the content.
  await api.superuser.transaction().execute(async (tx) => {
    await sql`set local session_replication_role = replica`.execute(tx);
    await sql`update lims.system_incident set corrective_action = 'Added a check and a test.'
      where reference = ${reference}`.execute(tx);
  });
  const changed = await view(as.ada, reference);
  assert.equal(changed.acknowledged?.unsigned, true, 'the Signature no longer binds the content');
  assert.equal(
    changed.acknowledged?.recordVersion.contentHash,
    signed.recordVersion.contentHash,
    'the Signature keeps the hash it was given on',
  );
  assert.notEqual(
    changed.recordVersion.contentHash,
    signed.recordVersion.contentHash,
    'the content now hashes differently',
  );
});

it('the open System Incident list is read by Admin and QA, newest first, and by no other role', async () => {
  const older = await failedIncident();
  const newer = await failedIncident();
  const listed = ok(await as.quinn.call(routes.incidents)).map((row) => row.reference);
  assert.ok(listed.indexOf(newer) < listed.indexOf(older), 'newest first');
  assert.partialDeepStrictEqual(
    ok(await as.ada.call(routes.incidents)).find((row) => row.reference === newer),
    {
      kind: 'UnexpectedFailure',
      state: 'Open',
      step: 'enterResult',
    },
  );
  refusedWith(await as.lena.call(routes.incidents), 'role');
  refusedWith(await as.lou.call(routes.incident, { reference: newer }), 'role');
});
