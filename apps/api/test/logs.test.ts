import assert from 'node:assert/strict';
import { it } from 'node:test';
import { stepRoute } from '@lims/domain';
import { sql } from 'kysely';
import { type Client, ok, startApi } from './harness.ts';

const api = await startApi('lims_api_logs_test');
const [ana, cora, samir, lena] = [api.person('ana'), api.person('cora'), api.person('samir'), api.person('lena')];
const as = {
  ana: await api.login(ana),
  cora: await api.login(cora),
  samir: await api.login(samir),
  lena: await api.login(lena),
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

async function assignedToAna(): Promise<string> {
  const { testId } = ok(
    await as.cora.call(stepRoute('submit'), {
      input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' },
    }),
  );
  ok(await as.samir.call(stepRoute('receive'), { testId, input: {} }));
  ok(await as.lena.call(stepRoute('assign'), { testId, input: { assigneeId: ana.id } }));
  return testId;
}

async function post(client: Client, url: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(api.base + url, {
    method: 'POST',
    headers: { cookie: client.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

it('an unexpected failure answers a generic 500 that names a reference, not the database error', async () => {
  const testId = await assignedToAna();
  const failed = await post(as.ana, stepRoute('enterResult').url, {
    testId,
    input: result(PROBE),
    signature: { password: ana.password },
  });
  assert.equal(failed.status, 500);
  assert.doesNotMatch(failed.text, /log_probe|violates/, 'the database error stays out of the answer');
  assert.match(failed.text, /reference req-\w+/, 'the answer names a reference the Admin can find in the log');
});

it('a refusal and a request that fails validation answer with their own status and message', async () => {
  const testId = await assignedToAna();
  const refused = await post(as.cora, stepRoute('review').url, { testId, input: {}, signature: { password: 'x' } });
  assert.deepEqual(refused, {
    status: 409,
    text: '{"statusCode":409,"error":"Conflict","message":"review needs a Test in SubmittedForReview state, not Assigned"}',
  });
  const invalid = await post(as.ana, stepRoute('enterResult').url, { testId, input: {} });
  assert.deepEqual(invalid, {
    status: 400,
    text: `{"statusCode":400,"error":"Bad Request","message":"body must have required property 'signature'"}`,
  });
});

const lou = await api.addPerson('lou.analyst', ['Analyst'], { trained: true });
const asLou = await api.login(lou);

async function assignedToLou(): Promise<string> {
  const { testId } = ok(
    await as.cora.call(stepRoute('submit'), {
      input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' },
    }),
  );
  ok(await as.samir.call(stepRoute('receive'), { testId, input: {} }));
  ok(await as.lena.call(stepRoute('assign'), { testId, input: { assigneeId: lou.id } }));
  return testId;
}

it("a signed step logs its step name and the Test's id, and never the signer's password", async () => {
  const testId = await assignedToLou();
  ok(
    await asLou.call(stepRoute('enterResult'), {
      testId,
      input: result('RD-NB-0007-012'),
      signature: { password: lou.password },
    }),
  );
  assert.ok(
    api.logLines().some((line) => line.step === 'enterResult' && line.testId === testId),
    "a log line names the step and the Test's id",
  );
  assert.ok(!api.log().includes(lou.password), "the signer's password is not in the log");
});

it("a failed signed step logs the failure without the password or the Result's content", async () => {
  const testId = await assignedToLou();
  const failed = await post(asLou, stepRoute('enterResult').url, {
    testId,
    input: result(PROBE),
    signature: { password: lou.password },
  });
  const reference = /reference (req-\w+)/.exec(failed.text)?.[1] ?? assert.fail(`no reference in ${failed.text}`);
  const logged = api.logLines().find((line) => line.level === 50 && line.reqId === reference);
  assert.match(JSON.stringify(logged?.err), /log_probe/, 'the log names the failure under the reference');
  assert.ok(!api.log().includes(lou.password), "the signer's password is not in the log");
  assert.ok(!api.log().includes(PROBE), "the Result's content is not in the log");
});

it("the API's logger writes a password, a session cookie and a request body redacted", () => {
  const [password, token] = ['logged-password-for-tests', 'logged-session-token-for-tests'];
  api.app.log.info({
    req: { headers: { cookie: `lims_session=${token}` }, body: { signature: { password } } },
    signature: { password },
  });
  const log = api.log();
  assert.ok(!log.includes(password), 'the password is redacted');
  assert.ok(!log.includes(token), 'the session cookie is redacted');
  assert.match(log, /\[redacted\]/);
});
