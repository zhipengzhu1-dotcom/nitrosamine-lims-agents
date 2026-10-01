import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { audited } from '@lims/db';
import { type Route, type RouteInput, routes, stepRoute } from '@lims/domain';
import { sql } from 'kysely';
import { type Account, type Answer, Client, ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_workstations_test');
const ada = api.person('ada');
const admin = await api.login(ada);
const lcmsRoom = ok(await admin.call(routes.workstations)).rooms[0] ?? assert.fail('the seed holds no Room');

let named = 0;
async function register(name = `RD-BENCH-${++named}`) {
  return ok(
    await admin.call(routes.registerWorkstation, {
      name,
      roomId: lcmsRoom.id,
      browserPolicy: 'Managed Chrome; no saved passwords; cleared on close',
      reason: 'Register the bench PC',
    }),
  );
}

/** A browser enrolled by the Admin signing in on it, then signing out, as a bench PC is set up. */
async function enrolledBrowser() {
  const workstation = await register();
  const browser = await api.login(ada);
  ok(await browser.call(routes.enrolWorkstation, { workstationId: workstation.id, reason: 'Enrol the bench PC' }));
  ok(await browser.call(routes.logout));
  return { workstation, browser, token: browser.jar.get('lims_device') ?? assert.fail('no device cookie') };
}

const signInOn = async (browser: Client, account: Account) =>
  ok(await browser.call(routes.login, { username: account.username, password: account.password }));

const eventsOf = (subjectId: string) =>
  api.superuser
    .selectFrom('accessEvent')
    .select(['kind', 'subjectId', 'takenById', 'workstationId', 'sessionId'])
    .where('subjectId', '=', subjectId)
    .orderBy('at')
    .execute();

const sessionsOf = (personId: string) =>
  api.superuser
    .selectFrom('session')
    .select(['id', 'workstationId', sql<boolean>`ended_at is not null`.as('ended')])
    .where('personId', '=', personId)
    .orderBy('createdAt')
    .execute();

describe('registering a Workstation', () => {
  it('an Admin registers a Workstation with its name, Lab, Room and browser policy, and the Audit Trail records it with the reason', async () => {
    const workstation = await register('RD-BENCH-LCMS');
    assert.deepEqual(
      { ...workstation, id: undefined },
      {
        id: undefined,
        name: 'RD-BENCH-LCMS',
        room: lcmsRoom.name,
        browserPolicy: 'Managed Chrome; no saved passwords; cleared on close',
        enrolled: false,
      },
    );
    const entry = await api.superuser
      .selectFrom('auditEntry')
      .select(['chain', 'actor', 'role', 'reason', 'op', sql<string>`new_row ->> 'room_id'`.as('roomId')])
      .where('tableName', '=', 'workstation')
      .where(sql<boolean>`new_row ->> 'id' = ${workstation.id}`)
      .executeTakeFirstOrThrow();
    assert.deepEqual(entry, {
      chain: api.labId,
      actor: `person:${ada.username}`,
      role: 'Admin',
      reason: 'Register the bench PC',
      op: 'INSERT',
      roomId: lcmsRoom.id,
    });
    assert.ok(ok(await admin.call(routes.workstations)).workstations.some((w) => w.id === workstation.id));
  });

  it('every role but Admin is refused registering, listing and enrolling a Workstation, and nothing is written', async () => {
    const workstation = await register();
    const before = await api.superuser.selectFrom('workstation').selectAll().orderBy('id').execute();
    for (const name of ['cora', 'samir', 'lena', 'ana', 'rui', 'quinn'] as const) {
      const client = await api.login(api.person(name));
      const registration: RouteInput<typeof routes.registerWorkstation>[0] = {
        name: `RD-BENCH-BY-${name}`,
        roomId: lcmsRoom.id,
        browserPolicy: 'Managed Chrome',
        reason: 'Register the bench PC',
      };
      const answers: Answer<Route>[] = [
        await client.call(routes.registerWorkstation, registration),
        await client.call(routes.workstations),
        await client.call(routes.enrolWorkstation, { workstationId: workstation.id, reason: 'Enrol the bench PC' }),
      ];
      for (const answer of answers)
        assert.equal(refusedWith(answer, 'role'), 'registering and enrolling Workstations is an Admin action', name);
      assert.equal(client.jar.get('lims_device'), undefined, `${name} got no device token`);
    }
    assert.deepEqual(await api.superuser.selectFrom('workstation').selectAll().orderBy('id').execute(), before);
  });

  it('a Room of no Lab of the Admin and a second Workstation of the same name are refused', async () => {
    const taken = await register();
    const registration = { roomId: lcmsRoom.id, browserPolicy: 'Managed Chrome', reason: 'Register the bench PC' };
    const noRoom = await admin.call(routes.registerWorkstation, {
      ...registration,
      name: 'RD-BENCH-NOWHERE',
      roomId: randomUUID(),
    });
    assert.equal(refusedWith(noRoom, 'notFound'), 'no such Room in this Lab');
    const twice = await admin.call(routes.registerWorkstation, { ...registration, name: taken.name });
    assert.equal(refusedWith(twice, 'guard'), `a Workstation named ${taken.name} is already registered in this Lab`);
    const noWorkstation = await admin.call(routes.enrolWorkstation, { workstationId: randomUUID(), reason: 'Enrol' });
    assert.equal(refusedWith(noWorkstation, 'notFound'), 'no such Workstation in this Lab');
  });
});

describe('the device token', () => {
  it('a browser enrolled with the device token signs in with the Workstation on its session, its Access Event and its ActorContext', async () => {
    const { workstation, browser } = await enrolledBrowser();
    const rui = await api.addPerson(`rui.enrolled-${randomUUID()}`, ['Reviewer']);
    const me = await signInOn(browser, rui);
    assert.deepEqual(me.workstation, { name: workstation.name, room: lcmsRoom.name });
    assert.deepEqual(ok(await browser.call(routes.me)).workstation, me.workstation);
    const [session] = await sessionsOf(rui.id);
    assert.equal(session?.workstationId, workstation.id);
    assert.deepEqual(
      (await eventsOf(rui.id)).map((e) => [e.kind, e.workstationId]),
      [['SignInSucceeded', workstation.id]],
    );
  });

  it('a browser without a device token signs in as an unregistered device, and so does one whose token was replaced', async () => {
    const plain = await api.addPerson(`ana.unregistered-${randomUUID()}`, ['Analyst']);
    const me = await signInOn(new Client(api.base), plain);
    assert.equal(me.workstation, null);

    const { browser, workstation } = await enrolledBrowser();
    const stale = new Client(api.base);
    stale.jar.set('lims_device', browser.jar.get('lims_device') ?? '');
    const again = await api.login(ada);
    ok(await again.call(routes.enrolWorkstation, { workstationId: workstation.id, reason: 'Enrol again' }));
    assert.equal((await signInOn(stale, plain)).workstation, null, 'the replaced token names no Workstation');

    const [first, second] = await sessionsOf(plain.id);
    assert.deepEqual([first?.workstationId, second?.workstationId], [null, null]);
    assert.deepEqual(
      (await eventsOf(plain.id)).map((e) => [e.kind, e.workstationId]),
      [
        ['SignInSucceeded', null],
        ['SignInSucceeded', null],
      ],
    );
  });

  it('a failed sign-in on an enrolled browser carries the Workstation too', async () => {
    const { browser, workstation } = await enrolledBrowser();
    const lou = await api.addPerson(`lou.failed-${randomUUID()}`, ['Analyst']);
    refusedWith(await browser.call(routes.login, { username: lou.username, password: 'wrong' }), 'badCredentials');
    assert.deepEqual(
      (await eventsOf(lou.id)).map((e) => [e.kind, e.workstationId]),
      [['SignInFailed', workstation.id]],
    );
  });

  it("a person with no role in the Workstation's Lab is refused on it after the right password, with the true reason recorded", async () => {
    const { browser, workstation } = await enrolledBrowser();
    const outsider = await api.addPerson(`otto.other-lab-${randomUUID()}`, []);
    await audited(api.superuser, { actor: 'svc:test', role: 'system', reason: 'Arrange another Lab' }, async (tx) => {
      const { labId } = await tx
        .insertInto('lab')
        .values({ code: 'OT', name: 'Other Lab (fictional)', timeZone: 'Asia/Tokyo' })
        .returning('labId')
        .executeTakeFirstOrThrow();
      await tx.insertInto('membership').values({ labId, personId: outsider.id, role: 'Analyst' }).execute();
    });
    const refused = await browser.call(routes.login, { username: outsider.username, password: outsider.password });
    assert.equal(refusedWith(refused, 'role'), "this account belongs to no role in this Workstation's Lab");
    const [event] = await api.superuser
      .selectFrom('accessEvent')
      .select(['kind', 'failureReason', 'workstationId', sql<string[]>`roles::text[]`.as('roles')])
      .where('subjectId', '=', outsider.id)
      .execute();
    assert.deepEqual(event, {
      kind: 'SignInFailed',
      failureReason: 'NotInWorkstationLab',
      workstationId: workstation.id,
      roles: ['Analyst'],
    });
    assert.equal((await signInOn(new Client(api.base), outsider)).workstation, null, 'elsewhere the account works');
  });

  it('the device token is stored only as its SHA-256, is in no reply body and no Audit Trail entry, and appears in no log line', async () => {
    const workstation = await register();
    const browser = await api.login(ada);
    const res = await fetch(`${api.base}${routes.enrolWorkstation.url}`, {
      method: 'POST',
      headers: { cookie: browser.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ workstationId: workstation.id, reason: 'Enrol the bench PC' }),
    });
    const body = await res.text();
    const [, token = ''] = /lims_device=([^;]+)/.exec(res.headers.getSetCookie().join('\n')) ?? [];
    assert.match(token, /^[\w-]{43}$/, 'a 256-bit token in the cookie');
    assert.ok(!body.includes(token), 'not in the reply body');
    assert.equal(JSON.parse(body).enrolled, true);

    browser.jar.set('lims_device', token);
    await signInOn(browser, api.person('ana'));

    const stored = await api.superuser
      .selectFrom('workstation')
      .select('deviceTokenHash')
      .where('id', '=', workstation.id)
      .executeTakeFirstOrThrow();
    assert.deepEqual(stored.deviceTokenHash, createHash('sha256').update(token).digest());
    const { rows } = await sql<{ hit: boolean }>`select exists (
        select 1 from lims.audit_entry where coalesce(new_row, '{}')::text || coalesce(old_row, '{}')::text like ${`%${token}%`}
      ) as hit`.execute(api.superuser);
    assert.equal(rows[0]?.hit, false, 'not in the Audit Trail');
    assert.ok(api.log().length > 0, 'the API logged the requests');
    assert.ok(!api.log().includes(token), 'not in any log line');
  });
});

describe('Lock and Switch user', () => {
  it('Lock writes a lock Access Event, and every read on the locked session returns no record content until the same person re-authenticates', async () => {
    const { browser, workstation } = await enrolledBrowser();
    const ana = await api.addPerson(`ana.locks-${randomUUID()}`, ['Analyst'], { trained: true });
    const rui = await api.addPerson(`rui.cannot-unlock-${randomUUID()}`, ['Reviewer']);
    const cora = await api.login(api.person('cora'));
    const description = 'Metformin HCl tablets (fictional)';
    ok(
      await cora.call(stepRoute('submit'), { commitKey: randomUUID(), input: { methodId: api.methodId, description } }),
    );
    await signInOn(browser, ana);
    const [test] = ok(await browser.call(routes.tests));
    assert.ok(test, 'the Lab has a Test to read');

    assert.deepEqual(ok(await browser.call(routes.lock)), { locked: true });
    const locked = [
      await browser.call(routes.me),
      await browser.call(routes.tests),
      await browser.call(routes.test, { id: test.id }),
      await browser.call(routes.lookups),
      await browser.call(stepRoute('receive'), { commitKey: randomUUID(), testId: test.id, input: {} }),
    ];
    for (const answer of locked)
      assert.equal(
        refusedWith(answer, 'sessionLocked'),
        `this screen is locked; ${ana.username} unlocks it with their password, or another person signs in with Switch user`,
      );
    assert.ok(!JSON.stringify(locked).includes(test.sampleNumber), 'no record content while locked');

    refusedWith(await browser.call(routes.unlock, { password: rui.password }), 'badCredentials');
    refusedWith(await browser.call(routes.unlock, { password: 'not-the-password' }), 'badCredentials');
    refusedWith(await browser.call(routes.tests), 'sessionLocked');
    const person = await api.superuser
      .selectFrom('person')
      .select('failedLogins')
      .where('id', '=', ana.id)
      .executeTakeFirstOrThrow();
    assert.equal(person.failedLogins, 2, 'a wrong password at unlock counts toward lockout');

    assert.equal(ok(await browser.call(routes.unlock, { password: ana.password })).person.id, ana.id);
    assert.ok(
      ok(await browser.call(routes.tests)).some((t) => t.id === test.id),
      'reads return after unlock',
    );

    const [session] = await sessionsOf(ana.id);
    assert.deepEqual(
      (await eventsOf(ana.id)).map((e) => [e.kind, e.workstationId, e.sessionId]),
      [
        ['SignInSucceeded', workstation.id, session?.id],
        ['Lock', workstation.id, session?.id],
        ['Unlock', workstation.id, session?.id],
      ],
    );
  });

  it('locking a locked session writes no second lock Access Event, and unlocking an unlocked one no unlock event', async () => {
    const ana = await api.addPerson(`ana.twice-${randomUUID()}`, ['Analyst']);
    const browser = await api.login(ana);
    ok(await browser.call(routes.unlock, { password: ana.password }));
    ok(await browser.call(routes.lock));
    ok(await browser.call(routes.lock));
    assert.deepEqual(
      (await eventsOf(ana.id)).map((e) => e.kind),
      ['SignInSucceeded', 'Lock'],
    );
  });

  it('Switch user ends the earlier session and writes a takeover Access Event naming both people and the Workstation', async () => {
    const { browser, workstation } = await enrolledBrowser();
    const ana = await api.addPerson(`ana.switch-${randomUUID()}`, ['Analyst']);
    const rui = await api.addPerson(`rui.switch-${randomUUID()}`, ['Reviewer']);
    await signInOn(browser, ana);
    const anaSessionToken = browser.jar.get('lims_session') ?? assert.fail('no session cookie');
    ok(await browser.call(routes.lock));

    refusedWith(await browser.call(routes.login, { username: rui.username, password: 'wrong' }), 'badCredentials');
    refusedWith(await browser.call(routes.me), 'sessionLocked');
    assert.deepEqual(
      (await sessionsOf(ana.id)).map((s) => s.ended),
      [false],
      'a failed Switch user leaves the earlier session locked',
    );

    const me = await signInOn(browser, rui);
    assert.equal(me.person.id, rui.id);
    assert.deepEqual(me.workstation, { name: workstation.name, room: lcmsRoom.name });
    assert.equal(ok(await browser.call(routes.me)).person.id, rui.id);

    const [anaSession] = await sessionsOf(ana.id);
    assert.equal(anaSession?.ended, true, "the earlier person's session has ended");
    const earlier = new Client(api.base);
    earlier.jar.set('lims_session', anaSessionToken);
    refusedWith(await earlier.call(routes.me), 'noSession');

    const takeover = await api.superuser
      .selectFrom('accessEvent')
      .select(['subjectId', 'takenById', 'workstationId', 'sessionId', sql<string[]>`roles::text[]`.as('roles')])
      .where('kind', '=', 'Takeover')
      .where('subjectId', '=', ana.id)
      .execute();
    assert.deepEqual(takeover, [
      {
        subjectId: ana.id,
        takenById: rui.id,
        workstationId: workstation.id,
        sessionId: anaSession?.id,
        roles: ['Analyst'],
      },
    ]);
    const [ruiSession] = await sessionsOf(rui.id);
    assert.deepEqual(
      (await eventsOf(rui.id)).map((e) => [e.kind, e.workstationId, e.sessionId]),
      [
        ['SignInFailed', workstation.id, null],
        ['SignInSucceeded', workstation.id, ruiSession?.id],
      ],
    );
  });
});
