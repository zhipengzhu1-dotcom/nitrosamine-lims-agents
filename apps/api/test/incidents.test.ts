import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, it } from 'node:test';
import { stepRoute } from '@lims/domain';
import { sql } from 'kysely';
import { logFile } from '../src/log.ts';
import { type Client, ok, startApi } from './harness.ts';

const api = await startApi('lims_api_incidents_test');
const lou = await api.addPerson('lou.analyst', ['Analyst'], { trained: true });
const as = {
  lou: await api.login(lou),
  cora: await api.login(api.person('cora')),
  samir: await api.login(api.person('samir')),
  lena: await api.login(api.person('lena')),
};

const PROBE = 'RD-NB-INCIDENT-PROBE';
await sql`alter table lims.result add constraint incident_probe check (notebook_ref <> ${sql.lit(PROBE)})`.execute(
  api.superuser,
);

const volume = mkdtempSync(join(tmpdir(), 'lims-api-log-'));
after(() => rmSync(volume, { recursive: true, force: true }));

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

async function failEnterResult(client: Client, testId: string, base = api.base) {
  const res = await fetch(base + stepRoute('enterResult').url, {
    method: 'POST',
    headers: { cookie: client.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      testId,
      input: {
        analyte: 'NDMA',
        value: '0.0300',
        unit: 'ppm',
        injectionSequenceRef: 'SEQ-2026-0042',
        notebookRef: PROBE,
        performedOn: '2026-09-30',
      },
      signature: { password: lou.password },
    }),
  });
  const text = await res.text();
  const reference = /reference (\w+)"/.exec(text)?.[1] ?? assert.fail(`no reference in ${text}`);
  return { status: res.status, reference };
}

const incidentsWith = (reference: string) =>
  api.db.selectFrom('systemIncident').selectAll().where('reference', '=', reference).execute();

async function auditEntryOf(reference: string) {
  return api.db
    .selectFrom('auditEntry')
    .selectAll()
    .select(sql<string>`new_row ->> 'requested_by'`.as('requestedBy'))
    .where('tableName', '=', 'system_incident')
    .where(sql<boolean>`new_row ->> 'reference' = ${reference}`)
    .executeTakeFirstOrThrow();
}

it('an unexpected failure answers 500 with a reference and opens one System Incident on the company chain', async () => {
  const testId = await assignedToLou();
  const { status, reference } = await failEnterResult(as.lou, testId);
  assert.equal(status, 500);
  const incidents = await incidentsWith(reference);
  assert.equal(incidents.length, 1, 'exactly one System Incident carries the reference');
  const [incident] = incidents;
  assert.deepEqual(
    {
      kind: incident?.kind,
      step: incident?.step,
      recordId: incident?.recordId,
      requestedBy: incident?.requestedBy,
      sessionLabId: incident?.sessionLabId,
      errorClass: incident?.errorClass,
      sqlstate: incident?.sqlstate,
      constraintName: incident?.constraintName,
      state: incident?.state,
    },
    {
      kind: 'UnexpectedFailure',
      step: 'enterResult',
      recordId: testId,
      requestedBy: lou.id,
      sessionLabId: api.labId,
      errorClass: 'DatabaseError',
      sqlstate: '23514',
      constraintName: 'incident_probe',
      state: 'Open',
    },
  );
  assert.equal((await auditEntryOf(reference)).chain, 'company', 'the System Incident is on the company chain');
});

it('the error message appears nowhere in the System Incident or its Audit Trail entry', async () => {
  const testId = await assignedToLou();
  const { reference } = await failEnterResult(as.lou, testId);
  const recorded = JSON.stringify([await incidentsWith(reference), await auditEntryOf(reference)]);
  assert.doesNotMatch(recorded, /violates|new row for relation/, "the database's message is not recorded");
  assert.ok(!recorded.includes(PROBE), "the refused Result's content is not recorded");
});

it("the System Incident's Audit Trail entry names the service identity, with the requesting person as a field", async () => {
  const testId = await assignedToLou();
  const { reference } = await failEnterResult(as.lou, testId);
  const entry = await auditEntryOf(reference);
  assert.deepEqual([entry.actor, entry.role, entry.op], ['svc:incident', 'system', 'INSERT']);
  assert.equal(entry.requestedBy, lou.id);
});

it("on the log volume, a Postgres error's line keeps its SQLSTATE and constraint and a failed signing logs no message, password, token or body", async () => {
  const path = join(volume, 'api.log');
  const onVolume = await api.startAnotherApi({ log: logFile(path) });
  const testId = await assignedToLou();
  const { reference } = await failEnterResult(as.lou, testId, onVolume.base);
  await onVolume.app.close();

  assert.equal(statSync(path).mode & 0o777, 0o600, 'only the owner reads or writes the log file');
  const log = readFileSync(path, 'utf8');
  const failure = log
    .split('\n')
    .filter(Boolean)
    .map((line): Record<string, unknown> => JSON.parse(line))
    .find((line) => line.reqId === reference && line.msg === 'unexpected failure');
  assert.deepEqual(
    failure?.err,
    {
      type: 'DatabaseError',
      message: '[redacted]',
      stack: '[redacted]',
      sqlstate: '23514',
      constraint: 'incident_probe',
      table: 'result',
      column: null,
    },
    'the line names the failure without its message',
  );
  assert.doesNotMatch(log, /violates|new row for relation/, "no line holds the database's message");
  assert.ok(!log.includes(lou.password), "the signer's password is not in the log");
  assert.ok(!log.includes(as.lou.cookie.replace('lims_session=', '')), 'the session token is not in the log');
  assert.ok(!log.includes(PROBE), "the request body's content is not in the log");
});

it('when the System Incident cannot be written, the log records it unwritten and the 500 still carries the reference', async () => {
  const testId = await assignedToLou();
  await sql`alter table lims.system_incident add constraint unwritable_probe check (record_id <> ${sql.lit(testId)})`.execute(
    api.superuser,
  );
  const { status, reference } = await failEnterResult(as.lou, testId);
  assert.equal(status, 500);
  assert.deepEqual(await incidentsWith(reference), [], 'the database wrote no System Incident');
  const unwritten = api.logLines().find((line) => line.msg === 'unwritten System Incident');
  assert.match(
    JSON.stringify(unwritten?.unwrittenSystemIncident),
    new RegExp(`"reference":"${reference}".*"recordId":"${testId}"`),
    'the log line holds the System Incident with the reference shown',
  );
  assert.equal(typeof unwritten?.time, 'number', 'the log line holds the instant');
  assert.equal(unwritten?.reqId, reference);
});
