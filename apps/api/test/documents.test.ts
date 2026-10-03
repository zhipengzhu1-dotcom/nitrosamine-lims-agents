import assert from 'node:assert/strict';
import { it } from 'node:test';
import { audited } from '@lims/db';
import { type DocumentStepName, documentStepRoute, routes, type SigningBody } from '@lims/domain';
import { sql } from 'kysely';
import { type Account, type Answer, type Client, ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_documents_test');
const lena = api.person('lena');
const rui = api.person('rui');
const quinn = api.person('quinn');
const rhea = await api.addPerson('rhea.both', ['LabManager', 'Reviewer']);
const remy = await api.addPerson('remy.both', ['Reviewer', 'QA']);
const as = {
  lena: await api.login(lena),
  rui: await api.login(rui),
  quinn: await api.login(quinn),
  ana: await api.login(api.person('ana')),
  cora: await api.login(api.person('cora')),
  rhea: await api.login(rhea),
  remy: await api.login(remy),
};

const { rows } = await sql<{ today: string; later: string }>`
  select to_char(now() at time zone time_zone, 'YYYY-MM-DD') as today,
         to_char(now() at time zone time_zone + interval '30 days', 'YYYY-MM-DD') as later
    from lims.lab where lab_id = ${api.labId}`.execute(api.superuser);
const { today, later } = rows[0] ?? assert.fail('the Lab is recorded');

const draft = (client: Client, title = 'Receiving samples (fictional)', effectiveDate = today) =>
  client.call(routes.createDocument, {
    documentType: 'SOP',
    title,
    body: 'Check the seal and the label.',
    effectiveDate,
  });

/** Writes a Document's Effective Date `days` away past the trigger that freezes it, as a tampered row would hold it. */
const moveEffectiveDate = (documentId: string, days: number) =>
  audited(
    api.superuser,
    { actor: 'svc:test', role: 'system', reason: 'Move an Effective Date behind its Signatures' },
    async (tx) => {
      await sql`alter table lims.document_version disable trigger move_document_version`.execute(tx);
      await sql`update lims.document_version set effective_date = effective_date + ${days}::integer
               where document_id = ${documentId}`.execute(tx);
      await sql`alter table lims.document_version enable trigger move_document_version`.execute(tx);
    },
  );

async function signing(client: Client, documentId: string, account: Account): Promise<SigningBody> {
  const { recordVersion, statement } = ok(await client.call(routes.document, { id: documentId }));
  const { version, contentHash } = recordVersion ?? assert.fail('the newest version has a Record Version');
  return {
    username: account.username,
    password: account.password,
    recordVersion: { version, contentHash },
    statementVersion: statement.version,
  };
}

/** Takes a step on the Document's newest version, signing as `account` when the step signs. */
async function step(
  client: Client,
  account: Account,
  name: DocumentStepName,
  documentId: string,
  reason = '',
): Promise<Answer<typeof routes.document>> {
  if (name === 'abandon') return client.call(documentStepRoute('abandon'), { documentId, input: { reason } });
  const signature = await signing(client, documentId, account);
  return client.call(documentStepRoute(name), { documentId, input: {}, signature });
}

it('the database numbers each Document {Lab}-{Type}-{NNNN}, the next of its type in the Lab', async () => {
  const first = ok(await draft(as.lena));
  const second = ok(await draft(as.ana, 'Labelling samples (fictional)'));
  const [, lab, type, seq] = /^(\w+)-(\w+)-(\d{4})$/.exec(first.number) ?? assert.fail(first.number);
  assert.equal(type, 'SOP');
  assert.equal(second.number, `${lab}-SOP-${String(Number(seq) + 1).padStart(4, '0')}`);
  assert.deepEqual(
    first.versions.map((v) => [v.version, v.status, v.author.username]),
    [[1, 'Draft', 'lena.manager']],
  );
  assert.deepEqual(first.steps, ['signAuthored', 'abandon']);
});

it('a Draft becomes Effective today through Authored by its author, Reviewed by a Reviewer and Approved by QA', async () => {
  const { id } = ok(await draft(as.lena));
  ok(await step(as.lena, lena, 'signAuthored', id));
  ok(await step(as.rui, rui, 'signReviewed', id));
  const effective = ok(await step(as.quinn, quinn, 'signApproved', id));
  const [version] = effective.versions;
  assert.deepEqual([version?.status, version?.effectiveDate], ['Effective', today]);
  assert.deepEqual(
    version?.signatures.map((s) => [s.meaning, s.username, s.role, s.record, s.unsigned]),
    [
      ['Authored', 'lena.manager', 'LabManager', 'Document version', false],
      ['Reviewed', 'rui.reviewer', 'Reviewer', 'Document version', false],
      ['Approved', 'quinn.qa', 'QA', 'Document version', false],
    ],
  );
  const vault = ok(await as.ana.call(routes.documents));
  assert.deepEqual(
    vault.filter((row) => row.id === id).map((row) => row.status),
    ['Effective'],
  );
});

it('an Effective Date after the Lab’s today leaves the version Approved, and a Draft dated before it is refused', async () => {
  assert.equal(
    refusedWith(await draft(as.lena, 'Back-dated (fictional)', '2020-01-01'), 'guard'),
    `An Effective Date must be ${today}, the Lab's today, or later.`,
  );
  const { id } = ok(await draft(as.lena, 'Receiving samples (fictional)', later));
  ok(await step(as.lena, lena, 'signAuthored', id));
  ok(await step(as.rui, rui, 'signReviewed', id));
  const approved = ok(await step(as.quinn, quinn, 'signApproved', id));
  assert.deepEqual(
    approved.versions.map((v) => [v.status, v.effectiveDate]),
    [['Approved', later]],
  );
});

it('QA does not Approve a version whose Effective Date has passed in the Lab', async () => {
  const { id } = ok(await draft(as.lena));
  ok(await step(as.lena, lena, 'signAuthored', id));
  ok(await step(as.rui, rui, 'signReviewed', id));
  await moveEffectiveDate(id, -1);
  assert.match(
    refusedWith(await step(as.quinn, quinn, 'signApproved', id), 'guard'),
    /^This version's Effective Date, \d{4}-\d{2}-\d{2}, has passed in the Lab, so it is not Approved\. Abandon it\.$/,
  );
});

it('every Signature on a version reads unsigned once its Effective Date changes behind it', async () => {
  const { id } = ok(await draft(as.lena, 'Receiving samples (fictional)', later));
  ok(await step(as.lena, lena, 'signAuthored', id));
  ok(await step(as.rui, rui, 'signReviewed', id));
  ok(await step(as.quinn, quinn, 'signApproved', id));
  await moveEffectiveDate(id, 1);
  const moved = ok(await as.ana.call(routes.document, { id }));
  assert.deepEqual(
    moved.versions[0]?.signatures.map((s) => [s.meaning, s.unsigned]),
    [
      ['Authored', true],
      ['Reviewed', true],
      ['Approved', true],
    ],
  );
});

it('the author does not review, a reviewer does not approve, and Approved waits for a Reviewed', async () => {
  const { id } = ok(await draft(as.rhea));
  ok(await step(as.rhea, rhea, 'signAuthored', id));
  assert.equal(
    refusedWith(await step(as.rhea, rhea, 'signReviewed', id), 'guard'),
    'The author of a Document version does not review it.',
  );
  assert.equal(
    refusedWith(await step(as.quinn, quinn, 'signApproved', id), 'guard'),
    'A Document version is Approved only after it is Reviewed.',
  );
  ok(await step(as.remy, remy, 'signReviewed', id));
  assert.equal(
    refusedWith(await step(as.remy, remy, 'signApproved', id), 'guard'),
    'A Document version is Approved by someone who neither authored nor reviewed it.',
  );
  assert.equal(
    refusedWith(await step(as.ana, api.person('ana'), 'signAuthored', id), 'guard'),
    'A Document version is signed Authored by its author.',
  );
});

it('Approved is refused to a person who is not QA, to a QA who wrote the version, and to an Admin', async () => {
  const qiana = await api.addPerson('qiana.author', ['QA']);
  const qianaClient = await api.login(qiana);
  const ada = api.person('ada');
  const adaClient = await api.login(ada);
  const { id } = ok(await draft(qianaClient));
  ok(await step(qianaClient, qiana, 'signAuthored', id));
  assert.equal(
    refusedWith(await step(adaClient, ada, 'signReviewed', id), 'role'),
    'The signReviewed step is taken by the Reviewer role.',
  );
  ok(await step(as.rui, rui, 'signReviewed', id));
  assert.equal(
    refusedWith(await step(as.ana, api.person('ana'), 'signApproved', id), 'role'),
    'The signApproved step is taken by the QA role.',
  );
  assert.equal(
    refusedWith(await step(qianaClient, qiana, 'signApproved', id), 'guard'),
    'A Document version is Approved by someone who neither authored nor reviewed it.',
  );
  assert.equal(
    refusedWith(await step(adaClient, ada, 'signApproved', id), 'role'),
    'The signApproved step is taken by the QA role.',
  );
});

it('the author Abandons a Draft with a reason and it keeps its number; someone else may not', async () => {
  const { id, number } = ok(await draft(as.lena));
  assert.equal(
    refusedWith(await step(as.ana, api.person('ana'), 'abandon', id, 'Not needed.'), 'guard'),
    'A Document version is Abandoned by its author or QA.',
  );
  const abandoned = ok(await step(as.lena, lena, 'abandon', id, 'Replaced by a Form.'));
  assert.deepEqual(
    [abandoned.number, abandoned.versions[0]?.status, abandoned.versions[0]?.abandonReason],
    [number, 'Abandoned', 'Replaced by a Form.'],
  );
  const next = ok(await draft(as.lena));
  const following = (n: string) => Number(n.slice(-4));
  assert.equal(following(next.number), following(number) + 1);
});

it('a Customer neither reads nor writes the Document vault', async () => {
  refusedWith(await as.cora.call(routes.documents), 'role');
  refusedWith(await draft(as.cora), 'role');
});

it('a Title of only spaces is refused as a value', async () => {
  refusedWith(await draft(as.lena, '   '), 'malformed');
});

it('a Platform Operator neither reads the Document vault nor writes or signs a Document', async () => {
  const pat = await api.addPerson('pat.operator', ['PlatformOperator']);
  const patClient = await api.login(pat);
  const { id } = ok(await draft(as.lena));
  refusedWith(await patClient.call(routes.documents), 'role');
  refusedWith(await patClient.call(routes.document, { id }), 'role');
  refusedWith(await draft(patClient), 'role');
  for (const name of ['signAuthored', 'signReviewed', 'signApproved'] as const) {
    const signature = await signing(as.lena, id, pat);
    refusedWith(await patClient.call(documentStepRoute(name), { documentId: id, input: {}, signature }), 'role');
  }
});

it('an Admin neither writes a Document nor signs one Authored', async () => {
  const ada = api.person('ada');
  const adaClient = await api.login(ada);
  refusedWith(await draft(adaClient), 'role');
  const { id } = ok(await draft(as.lena));
  refusedWith(await step(adaClient, ada, 'signAuthored', id), 'role');
});
