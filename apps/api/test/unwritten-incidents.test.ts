import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, it } from 'node:test';
import { audited } from '@lims/db';
import { routes } from '@lims/domain';
import { sql } from 'kysely';
import type { Clock } from '../src/log.ts';
import { ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_unwritten_incidents_test');

const volume = mkdtempSync(join(tmpdir(), 'lims-api-volume-'));
after(() => rmSync(volume, { recursive: true, force: true }));

const LOGGED = { ms: 1_790_000_000_123, iso: '2026-09-21T14:13:20.123Z' };
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const NO_SUCH_ROW = 'abcdef01-2345-4678-89ab-cdef01234567';

function unwrittenLine(reference: string, time = LOGGED.ms): string {
  return `${JSON.stringify({
    level: 50,
    time,
    pid: 4242,
    hostname: 'lims-api',
    reqId: reference,
    err: { type: 'DatabaseError', message: '[redacted]', stack: '', sqlstate: '57014' },
    unwrittenSystemIncident: {
      kind: 'UnexpectedFailure',
      reference,
      requestedBy: null,
      sessionLabId: api.labId,
      step: 'enterResult',
      recordId: null,
      errorClass: 'DatabaseError',
      sqlstate: '23514',
      constraintName: 'result_value_check',
    },
    msg: 'unwritten System Incident',
  })}\n`;
}

function logVolume(name: string, ...lines: string[]): string {
  const file = join(volume, `${name}.log`);
  writeFileSync(file, lines.join(''));
  return file;
}

function handClock() {
  let now = 0;
  const timers: { due: number; ms: number; task: () => Promise<void> }[] = [];
  const clock: Clock = {
    every: (ms, task) => {
      const timer = { due: now + ms, ms, task };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
  };
  async function advance(ms: number) {
    const until = now + ms;
    for (let next = timers.find((t) => t.due <= until); next; next = timers.find((t) => t.due <= until)) {
      now = next.due;
      next.due += next.ms;
      await next.task();
    }
    now = until;
  }
  return { clock, advance };
}

const startOn = (file: string, clock = handClock().clock) => api.startAnotherApi({ logVolume: { file, clock } });

const incidentsWith = (reference: string) =>
  api.db
    .selectFrom('systemIncident')
    .selectAll()
    .select([
      sql<string>`(extract(epoch from logged_at) * 1000)::bigint::text`.as('loggedMs'),
      sql<boolean>`opened_at > now() - interval '1 minute'`.as('openedJustNow'),
    ])
    .where('reference', '=', reference)
    .execute();

const auditEntriesOf = (reference: string) =>
  api.db
    .selectFrom('auditEntry')
    .select(['actor', 'role', 'reason', 'chain', 'op'])
    .where('tableName', '=', 'system_incident')
    .where(sql<boolean>`new_row ->> 'reference' = ${reference}`)
    .execute();

it('starting the API with an unwritten System Incident on its log volume writes it once, with the logged instant and the insert time as separate fields', async () => {
  const file = logVolume(
    'start',
    `${JSON.stringify({ level: 30, time: LOGGED.ms, msg: 'incoming request', reqId: 'FX0000A1' })}\n`,
    unwrittenLine('FX000001'),
  );
  await startOn(file);

  const [incident, ...more] = await incidentsWith('FX000001');
  assert.equal(more.length, 0, 'exactly one System Incident carries the reference');
  assert.deepEqual(
    [incident?.kind, incident?.step, incident?.sessionLabId, incident?.constraintName, incident?.state],
    ['UnexpectedFailure', 'enterResult', api.labId, 'result_value_check', 'Open'],
  );
  assert.equal(incident?.loggedMs, String(LOGGED.ms), "the logged instant is the line's time");
  assert.equal(incident?.openedJustNow, true, "the insert time is the database's clock, not the line's");
  assert.deepEqual(
    await incidentsWith('FX0000A1'),
    [],
    'a line that is not an unwritten System Incident raises nothing',
  );
  assert.deepEqual(await auditEntriesOf('FX000001'), [
    {
      actor: 'svc:incident',
      role: 'system',
      reason: 'Raise an unwritten System Incident from the API log',
      chain: 'company',
      op: 'INSERT',
    },
  ]);
});

it('a line whose reference already has a System Incident is skipped, and starting the API again writes no duplicate', async () => {
  await audited(api.superuser, { actor: 'svc:test', role: 'system', reason: 'Open a System Incident' }, (tx) =>
    tx
      .insertInto('systemIncident')
      .values({
        kind: 'UnexpectedFailure',
        reference: 'FX000002',
        sessionLabId: api.labId,
        step: 'enterResult',
        errorClass: 'DatabaseError',
        sqlstate: '23514',
        constraintName: 'result_value_check',
      })
      .execute(),
  );
  const file = logVolume('skip', unwrittenLine('FX000002'), unwrittenLine('FX000003'));
  await startOn(file);
  await startOn(file);

  const [written] = await incidentsWith('FX000002');
  assert.equal(written?.loggedAt, null, 'the written System Incident is unchanged');
  assert.equal((await incidentsWith('FX000003')).length, 1);
  assert.equal((await auditEntriesOf('FX000002')).length, 1, 'the skipped line wrote nothing');
  assert.equal((await auditEntriesOf('FX000003')).length, 1, 'the second start wrote nothing');
});

it('a line whose record ID is in upper case is raised, with the ID as the database stores it', async () => {
  await startOn(
    logVolume(
      'upper',
      unwrittenLine('FX00000A').replace('"recordId":null', `"recordId":"${NO_SUCH_ROW.toUpperCase()}"`),
    ),
  );
  const [incident] = await incidentsWith('FX00000A');
  assert.equal(incident?.recordId, NO_SUCH_ROW);
});

it('a 15-minute check that fails opens a System Incident, and the next check raises what the failed one could not', async () => {
  const file = logVolume('failing');
  const { clock, advance } = handClock();
  await startOn(file, clock);
  rmSync(file);
  const failedChecks = () =>
    api.db
      .selectFrom('systemIncident')
      .select('errorClass')
      .where('kind', '=', 'UnexpectedFailure')
      .where('step', '=', 'raiseUnwrittenIncidents')
      .execute();

  await advance(FIFTEEN_MINUTES);
  assert.deepEqual(await failedChecks(), [{ errorClass: 'Error' }], 'the failed check is a System Incident');
  logVolume('failing', unwrittenLine('FX00000B'));
  appendFileSync(file, unwrittenLine('FX00000C').replace('"recordId":null', '"recordId":null,"addedLater":true'));
  await advance(FIFTEEN_MINUTES);
  assert.equal((await incidentsWith('FX00000B')).length, 1, 'the next check raises the line');
  assert.equal((await incidentsWith('FX00000C')).length, 1, 'a line with a field this version does not know is raised');
});

it('a line added after start is raised by the next 15-minute check and not before', async () => {
  const file = logVolume('later');
  const { clock, advance } = handClock();
  await startOn(file, clock);
  appendFileSync(file, unwrittenLine('FX000004'));

  await advance(FIFTEEN_MINUTES - 1);
  assert.deepEqual(await incidentsWith('FX000004'), [], 'nothing is raised before the 15 minutes are up');
  await advance(1);
  assert.equal((await incidentsWith('FX000004')).length, 1, 'the check at 15 minutes raises it');
  await advance(FIFTEEN_MINUTES);
  assert.equal((await auditEntriesOf('FX000004')).length, 1, 'the next check writes it no second time');
});

it("the System Incident's reply shows the logged instant and the insert time as ISO 8601 UTC strings", async () => {
  await startOn(logVolume('reply', unwrittenLine('FX000005')));
  for (const reader of ['quinn', 'ada'] as const) {
    const incident = ok(await (await api.login(api.person(reader))).call(routes.incident, { reference: 'FX000005' }));
    assert.equal(incident.loggedAt, LOGGED.iso, `${reader} reads the logged instant`);
    assert.match(incident.openedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, `${reader} reads the insert time`);
  }
});

it('reading a System Incident is refused to anyone but Admin and QA, and an unknown reference is not found', async () => {
  for (const reader of ['ana', 'cora'] as const)
    refusedWith(await (await api.login(api.person(reader))).call(routes.incident, { reference: 'FX000005' }), 'role');
  const quinn = await api.login(api.person('quinn'));
  refusedWith(await quinn.call(routes.incident, { reference: 'FX0000ZZ' }), 'notFound');
});

const unraisable = () =>
  api.db
    .selectFrom('systemIncident')
    .select(['reference', 'errorClass', 'sqlstate', 'constraintName'])
    .where('kind', '=', 'UnraisableLogLine')
    .orderBy('openedAt')
    .execute();

it('a line the check cannot read, or whose values the database refuses, is written once as an UnraisableLogLine System Incident, and the lines after it are still raised', async () => {
  const before = (await unraisable()).length;
  const notAnId = unwrittenLine('FX000006').replace('"requestedBy":null', '"requestedBy":"lou"');
  const torn = `${unwrittenLine('FX000008').slice(0, -2)}\n`;
  const noSuchPerson = unwrittenLine('FX000009').replace('"requestedBy":null', `"requestedBy":"${NO_SUCH_ROW}"`);
  const file = logVolume('unreadable', notAnId, torn, noSuchPerson, unwrittenLine('FX000007'));
  const started = await startOn(file);
  const again = await startOn(file);

  for (const reference of ['FX000006', 'FX000008', 'FX000009']) assert.deepEqual(await incidentsWith(reference), []);
  assert.equal((await incidentsWith('FX000007')).length, 1);
  assert.deepEqual(
    (await unraisable())
      .slice(before)
      .map(({ errorClass, sqlstate, constraintName }) => [errorClass, sqlstate, constraintName]),
    [
      ['RefusedValues', '22P02', null],
      ['UnreadableLine', null, null],
      ['RefusedValues', '23503', 'system_incident_requested_by_fkey'],
    ],
    'each line that cannot be raised is a System Incident, written once over two starts',
  );
  const logged = (api: typeof started) =>
    api
      .logLines()
      .filter((line) => line.msg === 'unraisable unwritten System Incident line')
      .map((line) => line.line);
  assert.deepEqual(logged(started), [1, 2, 3], 'the log names each line the first time');
  assert.deepEqual(logged(again), [], 'a later check does not log it again');
});

it('a line whose reference a different System Incident already holds is written as an UnraisableLogLine System Incident', async () => {
  await audited(api.superuser, { actor: 'svc:test', role: 'system', reason: 'Open a System Incident' }, (tx) =>
    tx
      .insertInto('systemIncident')
      .values({ kind: 'UnexpectedFailure', reference: 'FX00000D', step: 'review', errorClass: 'TypeError' })
      .execute(),
  );
  const before = (await unraisable()).length;
  await startOn(logVolume('taken', unwrittenLine('FX00000D')));

  const [held] = await incidentsWith('FX00000D');
  assert.deepEqual(
    [held?.step, held?.loggedAt],
    ['review', null],
    'the System Incident that holds the reference is unchanged',
  );
  assert.deepEqual(
    (await unraisable()).slice(before).map((incident) => incident.errorClass),
    ['ReferenceTaken'],
  );
});
