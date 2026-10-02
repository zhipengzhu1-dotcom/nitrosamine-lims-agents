import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { stepRoute } from '@lims/domain';
import { sql } from 'kysely';
import { type Client, ok, signatureOf, startApi } from './harness.ts';

const api = await startApi('lims_api_logs_test');
const lou = await api.addPerson('lou.analyst', ['Analyst'], { trained: true });
const as = {
  lou: await api.login(lou),
  cora: await api.login(api.person('cora')),
  samir: await api.login(api.person('samir')),
  lena: await api.login(api.person('lena')),
};

const PROBE = 'RD-NB-LOG-PROBE';
await sql`alter table lims.result add constraint log_probe check (notebook_ref <> ${sql.lit(PROBE)})`.execute(
  api.superuser,
);

const result = (notebookRef: string) => ({
  analyte: 'NDMA',
  value: '0.0300',
  unit: 'ppm',
  injectionSequenceRef: 'SEQ-2026-0042',
  notebookRef,
  performedOn: '2026-09-30',
});

async function assignedToLou(): Promise<string> {
  const { testId } = ok(
    await as.cora.call(stepRoute('submit'), {
      commitKey: randomUUID(),
      input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' },
    }),
  );
  ok(await as.samir.call(stepRoute('receive'), { commitKey: randomUUID(), testId, input: {} }));
  ok(await as.lena.call(stepRoute('assign'), { commitKey: randomUUID(), testId, input: { assigneeId: lou.id } }));
  return testId;
}

async function post(
  client: Client,
  url: string,
  body: unknown,
  base = api.base,
): Promise<{ status: number; text: string }> {
  const res = await fetch(base + url, {
    method: 'POST',
    headers: { cookie: client.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

const referenceIn = (text: string) => /reference (\w+)"/.exec(text)?.[1] ?? assert.fail(`no reference in ${text}`);

it('an unexpected failure answers a generic 500 that names a reference, not the database error', async () => {
  const testId = await assignedToLou();
  const failed = await post(as.lou, stepRoute('enterResult').url, {
    commitKey: randomUUID(),
    testId,
    input: result(PROBE),
    signature: await signatureOf(as.lou, testId, lou),
  });
  assert.equal(failed.status, 500);
  assert.match(failed.text, /^\{"kind":"failure","message":"[^"]*"\}$/, 'the 500 body has the one refusal shape');
  assert.doesNotMatch(failed.text, /log_probe|violates/, 'the database error stays out of the answer');
  assert.match(referenceIn(failed.text), /^[0-9A-HJKMNP-TV-Z]{8}$/, 'eight characters an Admin can read aloud');
});

it('a refusal and a request that fails validation answer with their own status, kind and message', async () => {
  const testId = await assignedToLou();
  const refused = await post(as.cora, stepRoute('review').url, {
    commitKey: randomUUID(),
    testId,
    input: {},
    signature: { username: 'cora.customer', password: 'x', recordVersion: { version: 1, contentHash: '0'.repeat(64) } },
  });
  assert.deepEqual(refused, {
    status: 409,
    text: '{"kind":"state","message":"review needs a Test in SubmittedForReview state, not Assigned"}',
  });
  const invalid = await post(as.lou, stepRoute('enterResult').url, { commitKey: randomUUID(), testId, input: {} });
  assert.deepEqual(invalid, {
    status: 400,
    text: `{"kind":"malformed","message":"body must have required property 'signature'"}`,
  });
});

it("a signed step logs its step name and the Test's id, and never the signer's password", async () => {
  const testId = await assignedToLou();
  ok(
    await as.lou.call(stepRoute('enterResult'), {
      commitKey: randomUUID(),
      testId,
      input: result('RD-NB-0007-012'),
      signature: await signatureOf(as.lou, testId, lou),
    }),
  );
  assert.ok(
    api.logLines().some((line) => line.step === 'enterResult' && line.testId === testId),
    "a log line names the step and the Test's id",
  );
  assert.ok(!api.log().includes(lou.password), "the signer's password is not in the log");
  const token = as.lou.cookie.replace('lims_session=', '');
  assert.ok(token && !api.log().includes(token), "the signer's session token is not in the log");
});

it("a failed signed step logs the failure without the password or the Result's content", async () => {
  const testId = await assignedToLou();
  const failed = await post(as.lou, stepRoute('enterResult').url, {
    commitKey: randomUUID(),
    testId,
    input: result(PROBE),
    signature: await signatureOf(as.lou, testId, lou),
  });
  const reference = referenceIn(failed.text);
  const logged = api.logLines().find((line) => line.level === 50 && line.reqId === reference);
  assert.match(JSON.stringify(logged?.err), /log_probe/, 'the log names the failure under the reference');
  assert.ok(!api.log().includes(lou.password), "the signer's password is not in the log");
  assert.ok(!api.log().includes(PROBE), "the Result's content is not in the log");
});

it("the logger's configuration redacts a password at each depth its redact paths name", () => {
  const password = 'logged-password-for-tests';
  api.app.log.info({ password, signature: { password }, body: { signature: { password } } });
  const log = api.log();
  assert.ok(!log.includes(password), 'the password is redacted');
  assert.match(log, /\[redacted\]/);
});

it('each unexpected failure gets a reference no restart of the API reuses, and the log files the failure under it', async () => {
  const testId = await assignedToLou();
  const references: string[] = [];
  for (const another of [await api.startAnotherApi(), await api.startAnotherApi()]) {
    const failed = await post(
      as.lou,
      stepRoute('enterResult').url,
      { commitKey: randomUUID(), testId, input: result(PROBE), signature: await signatureOf(as.lou, testId, lou) },
      another.base,
    );
    assert.equal(failed.status, 500);
    const reference = referenceIn(failed.text);
    assert.ok(
      another
        .logLines()
        .some((line) => line.level === 50 && line.reqId === reference && line.msg === 'unexpected failure'),
      'the logged error line carries the reference the answer gave',
    );
    references.push(reference);
  }
  assert.notEqual(references[0], references[1], 'two API processes give different references');
});
