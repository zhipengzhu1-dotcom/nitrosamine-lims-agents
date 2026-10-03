import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  type DocumentStepName,
  type DocumentStepInputs,
  documentStepRoute,
  routes,
  type SigningBody,
} from '@lims/domain';
import { sql } from 'kysely';
import { type Account, type Client, ok, refusedWith, startApi } from './harness.ts';

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

const draft = (client: Client, title = 'Receiving samples (fictional)') =>
  client.call(routes.createDocument, { documentType: 'SOP', title, body: 'Check the seal and the label.' });

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

async function step<K extends DocumentStepName>(
  client: Client,
  account: Account,
  name: K,
  documentId: string,
  input: DocumentStepInputs[K],
) {
  const signs = name !== 'abandon';
  return client.call(documentStepRoute(name), {
    documentId,
    input,
    ...(signs ? { signature: await signing(client, documentId, account) } : {}),
  });
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
  ok(await step(as.lena, lena, 'signAuthored', id, {}));
  ok(await step(as.rui, rui, 'signReviewed', id, {}));
  const effective = ok(await step(as.quinn, quinn, 'signApproved', id, { effectiveDate: today }));
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

it('an Effective Date after the Lab’s today leaves the version Approved, and one before it is refused', async () => {
  const { id } = ok(await draft(as.lena));
  ok(await step(as.lena, lena, 'signAuthored', id, {}));
  ok(await step(as.rui, rui, 'signReviewed', id, {}));
  assert.match(
    refusedWith(await step(as.quinn, quinn, 'signApproved', id, { effectiveDate: '2020-01-01' }), 'guard'),
    /The Effective Date is .* the Lab's today, or later\./,
  );
  const approved = ok(await step(as.quinn, quinn, 'signApproved', id, { effectiveDate: later }));
  assert.deepEqual(
    approved.versions.map((v) => [v.status, v.effectiveDate]),
    [['Approved', later]],
  );
});

it('the author does not review, a reviewer does not approve, and Approved waits for a Reviewed', async () => {
  const { id } = ok(await draft(as.rhea));
  ok(await step(as.rhea, rhea, 'signAuthored', id, {}));
  assert.equal(
    refusedWith(await step(as.rhea, rhea, 'signReviewed', id, {}), 'guard'),
    'The author of a Document version does not review it.',
  );
  assert.equal(
    refusedWith(await step(as.quinn, quinn, 'signApproved', id, { effectiveDate: today }), 'guard'),
    'A Document version is Approved only after it is Reviewed.',
  );
  ok(await step(as.remy, remy, 'signReviewed', id, {}));
  assert.equal(
    refusedWith(await step(as.remy, remy, 'signApproved', id, { effectiveDate: today }), 'guard'),
    'A Document version is Approved by someone who neither authored nor reviewed it.',
  );
  assert.equal(
    refusedWith(await step(as.ana, api.person('ana'), 'signAuthored', id, {}), 'guard'),
    'A Document version is signed Authored by its author.',
  );
});

it('the author Abandons a Draft with a reason and it keeps its number; someone else may not', async () => {
  const { id, number } = ok(await draft(as.lena));
  assert.equal(
    refusedWith(await step(as.ana, api.person('ana'), 'abandon', id, { reason: 'Not needed.' }), 'guard'),
    'A Document version is Abandoned by its author or QA.',
  );
  const abandoned = ok(await step(as.lena, lena, 'abandon', id, { reason: 'Replaced by a Form.' }));
  assert.deepEqual(
    [abandoned.number, abandoned.versions[0]?.status, abandoned.versions[0]?.abandonReason],
    [number, 'Abandoned', 'Replaced by a Form.'],
  );
  const later = ok(await draft(as.lena));
  assert.notEqual(later.number, number);
});

it('a Customer neither reads nor writes the Document vault', async () => {
  refusedWith(await as.cora.call(routes.documents), 'role');
  refusedWith(await draft(as.cora), 'role');
});
