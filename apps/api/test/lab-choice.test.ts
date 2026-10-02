import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { audited, type Role } from '@lims/db';
import { routes, stepRoute } from '@lims/domain';
import { sql } from 'kysely';
import { LOCKOUT_AFTER_FAILURES } from '../src/auth.ts';
import { type Account, Client, ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_lab_choice_test');
const SYSTEM = { actor: 'svc:test', role: 'system', reason: 'Arrange a Lab choice test' };

async function inBothLabs(username: string): Promise<Account> {
  const person = await api.addPerson(username, ['LabManager']);
  await audited(api.db, SYSTEM, (tx) =>
    tx.insertInto('membership').values({ labId: api.qcLabId, personId: person.id, role: 'Reviewer' }).execute(),
  );
  return person;
}

const signIn = (person: Account, labId?: string, client = new Client(api.base)) =>
  client.call(routes.login, { username: person.username, password: person.password, ...(labId ? { labId } : {}) });

const eventsOf = (subjectId: string) =>
  api.superuser
    .selectFrom('accessEvent')
    .select([
      'kind',
      'failureReason',
      'sessionLabId',
      'sessionId',
      'previousSessionLabId',
      'previousSessionId',
      sql<Role[]>`roles::text[]`.as('roles'),
    ])
    .where('subjectId', '=', subjectId)
    .orderBy('at')
    .execute();

const sessionsOf = (personId: string) =>
  api.superuser
    .selectFrom('session')
    .select(['labId', 'id', 'endedAt'])
    .where('personId', '=', personId)
    .orderBy('createdAt')
    .execute();

it('a sign-in that names a Lab where the person holds a Membership opens the session in that Lab and records the roles held there', async () => {
  const person = await inBothLabs('choice.named');

  const me = ok(await signIn(person, api.qcLabId));

  assert.equal(me.lab.id, api.qcLabId);
  assert.equal(me.lab.code, 'QC');
  assert.deepEqual(me.roles, ['Reviewer']);
  const [session] = await sessionsOf(person.id);
  assert.equal(session?.labId, api.qcLabId);
  assert.deepEqual(await eventsOf(person.id), [
    {
      kind: 'SignInSucceeded',
      failureReason: null,
      sessionLabId: api.qcLabId,
      sessionId: session.id,
      previousSessionLabId: null,
      previousSessionId: null,
      roles: ['Reviewer'],
    },
  ]);
});

it('a sign-in that names no Lab is refused as labNotChosen after the right password, opens no session, and records the default Lab roles', async () => {
  const multi = await inBothLabs('choice.none');
  const single = await api.addPerson('choice.single', ['Analyst']);

  assert.equal(refusedWith(await signIn(multi), 'labNotChosen'), 'choose the Lab to work in');
  refusedWith(await signIn(single), 'labNotChosen');
  refusedWith(
    await new Client(api.base).call(routes.login, { username: multi.username, password: 'not-the-password' }),
    'badCredentials',
  );

  assert.deepEqual(await sessionsOf(multi.id), [], 'no Lab was chosen for the person');
  assert.deepEqual(await sessionsOf(single.id), [], 'a single Membership is not chosen either');
  const defaultRoles: Role[] = api.labId < api.qcLabId ? ['LabManager'] : ['Reviewer'];
  assert.deepEqual(
    (await eventsOf(multi.id)).map((e) => [e.kind, e.failureReason, e.roles]),
    [
      ['SignInFailed', 'NoLabChosen', defaultRoles],
      ['SignInFailed', 'WrongPassword', defaultRoles],
    ],
  );
});

it('a sign-in that names a Lab where the person holds no Membership is refused and opens no session', async () => {
  const person = await api.addPerson('choice.foreign', ['Analyst']);

  assert.equal(refusedWith(await signIn(person, api.qcLabId), 'role'), 'you hold no Membership in that Lab');
  refusedWith(await signIn(person, randomUUID()), 'role');

  assert.deepEqual(await sessionsOf(person.id), []);
  assert.deepEqual(
    (await eventsOf(person.id)).map((e) => [e.kind, e.failureReason, e.roles]),
    [
      ['SignInFailed', 'NoMembership', ['Analyst']],
      ['SignInFailed', 'NoMembership', ['Analyst']],
    ],
  );
});

it('the Labs to choose from are listed before sign-in', async () => {
  const labs = ok(await new Client(api.base).call(routes.labs));
  assert.deepEqual(
    labs.map((l) => [l.id, l.code]),
    [
      [api.qcLabId, 'QC'],
      [api.labId, 'RD'],
    ],
    'in order of code',
  );
});

it("a Lab switch with full re-authentication writes a Lab switch Access Event, ends the old session, and the next read returns only the new Lab's records", async () => {
  const person = await inBothLabs('choice.switch');
  const cora = await api.login(api.person('cora'));
  const { testId } = ok(
    await cora.call(stepRoute('submit'), {
      commitKey: randomUUID(),
      input: { methodId: api.methodId, description: 'Metformin HCl tablets, R&D only (fictional)' },
    }),
  );
  const client = new Client(api.base);
  ok(await signIn(person, api.labId, client));
  const oldCookie = client.cookie;
  assert.ok(
    ok(await client.call(routes.tests)).some((t) => t.id === testId),
    'the R&D Test is read in the R&D Lab',
  );

  const me = ok(
    await client.call(routes.switchLab, { username: person.username, password: person.password, labId: api.qcLabId }),
  );

  assert.equal(me.lab.id, api.qcLabId);
  assert.deepEqual(me.roles, ['Reviewer']);
  assert.deepEqual(ok(await client.call(routes.tests)), [], 'the next read sees only the QC Lab');
  refusedWith(await client.call(routes.test, { id: testId }), 'notFound');
  assert.deepEqual(ok(await client.call(routes.me)).lab.id, api.qcLabId);
  const stale = new Client(api.base);
  stale.cookie = oldCookie;
  refusedWith(await stale.call(routes.me), 'noSession');

  const [before, after] = await sessionsOf(person.id);
  assert.ok(before?.endedAt, 'the R&D session ended');
  assert.equal(after?.labId, api.qcLabId);
  assert.equal(after.endedAt, null);
  assert.deepEqual((await eventsOf(person.id)).at(-1), {
    kind: 'LabSwitch',
    failureReason: null,
    sessionLabId: api.qcLabId,
    sessionId: after.id,
    previousSessionLabId: api.labId,
    previousSessionId: before.id,
    roles: ['Reviewer'],
  });
});

it('a Lab switch with a wrong credential is refused, leaves the session in its Lab, writes a failed Access Event and counts toward the lockout', async () => {
  const person = await inBothLabs('choice.wrong');
  const other = await inBothLabs('choice.other');
  const client = new Client(api.base);
  ok(await signIn(person, api.labId, client));
  const [session] = await sessionsOf(person.id);
  const switchTo = (username: string, password: string) =>
    client.call(routes.switchLab, { username, password, labId: api.qcLabId });

  refusedWith(await switchTo(person.username, 'not-the-password'), 'badCredentials');
  refusedWith(await switchTo(other.username, other.password), 'badCredentials');

  assert.equal(ok(await client.call(routes.me)).lab.id, api.labId, 'the session stays in the R&D Lab');
  assert.deepEqual(
    (await sessionsOf(person.id)).map((s) => [s.labId, s.endedAt]),
    [[api.labId, null]],
  );
  const inSession = { sessionLabId: api.labId, sessionId: session?.id, roles: ['LabManager'] };
  assert.deepEqual((await eventsOf(person.id)).slice(1), [
    {
      kind: 'LabSwitchFailed',
      failureReason: 'WrongPassword',
      previousSessionLabId: null,
      previousSessionId: null,
      ...inSession,
    },
    {
      kind: 'LabSwitchFailed',
      failureReason: 'OtherUserId',
      previousSessionLabId: null,
      previousSessionId: null,
      ...inSession,
    },
  ]);
  assert.deepEqual(await eventsOf(other.id), [], 'the other person typed in is not the subject');
  const { failedLogins } = await api.superuser
    .selectFrom('person')
    .select('failedLogins')
    .where('id', '=', person.id)
    .executeTakeFirstOrThrow();
  assert.equal(failedLogins, 2, 'each failed switch counts toward the lockout');
});

it('the failed Lab switch that reaches the limit locks the account, writes a Lockout, and ends the session', async () => {
  const person = await inBothLabs('choice.lockout');
  const client = new Client(api.base);
  ok(await signIn(person, api.labId, client));
  await audited(api.db, SYSTEM, (tx) =>
    tx
      .updateTable('person')
      .set({ failedLogins: LOCKOUT_AFTER_FAILURES - 1 })
      .where('id', '=', person.id)
      .execute(),
  );

  refusedWith(
    await client.call(routes.switchLab, { username: person.username, password: 'nope', labId: api.qcLabId }),
    'badCredentials',
  );

  assert.deepEqual(
    (await eventsOf(person.id)).map((e) => e.kind),
    ['SignInSucceeded', 'LabSwitchFailed', 'Lockout'],
  );
  refusedWith(await client.call(routes.me), 'noSession');
});

it('a Lab switch to a Lab without a Membership is refused after the right password, and one to the same Lab is refused as state', async () => {
  const person = await api.addPerson('choice.stay', ['Analyst']);
  const client = new Client(api.base);
  ok(await signIn(person, api.labId, client));

  refusedWith(
    await client.call(routes.switchLab, { username: person.username, password: person.password, labId: api.qcLabId }),
    'role',
  );
  refusedWith(
    await client.call(routes.switchLab, { username: person.username, password: person.password, labId: api.labId }),
    'state',
  );

  assert.equal(ok(await client.call(routes.me)).lab.id, api.labId);
  assert.deepEqual(
    (await eventsOf(person.id)).map((e) => [e.kind, e.failureReason]),
    [
      ['SignInSucceeded', null],
      ['LabSwitchFailed', 'NoMembership'],
    ],
  );
});

it('a Lab switch without a session is refused as noSession', async () => {
  const person = await inBothLabs('choice.nosession');
  refusedWith(
    await new Client(api.base).call(routes.switchLab, {
      username: person.username,
      password: person.password,
      labId: api.qcLabId,
    }),
    'noSession',
  );
  assert.deepEqual(await eventsOf(person.id), []);
});

it('of two Lab switches from one session at once, one switches and the other is refused as stale and recorded', async () => {
  const person = await inBothLabs('choice.race');
  const client = new Client(api.base);
  ok(await signIn(person, api.labId, client));
  const body = { username: person.username, password: person.password, labId: api.qcLabId };

  const answers = await Promise.all([client.call(routes.switchLab, body), client.call(routes.switchLab, body)]);

  assert.deepEqual(answers.map((a) => (a.kind === 'reply' ? 'reply' : a.body.kind)).sort(), ['reply', 'stale']);
  assert.deepEqual(
    (await sessionsOf(person.id)).map((s) => [s.labId, s.endedAt === null]),
    [
      [api.labId, false],
      [api.qcLabId, true],
    ],
  );
  assert.deepEqual(
    (await eventsOf(person.id))
      .slice(1)
      .map((e) => `${e.kind} ${e.failureReason}`)
      .sort((a, b) => a.localeCompare(b)),
    ['LabSwitch null', 'LabSwitchFailed SessionEnded'],
  );
});
