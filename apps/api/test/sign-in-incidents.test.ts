import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { audited, type IncidentKind } from '@lims/db';
import { routes } from '@lims/domain';
import { sql } from 'kysely';
import { LOCKOUT_AFTER_FAILURES } from '../src/auth.ts';
import { type Account, Client, ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_sign_in_incidents_test');

let lastAddress = 0;
const nextAddress = () => `2001:db8::${(++lastAddress).toString(16)}`;

const signIn = (from: string, username: string, password: string) =>
  new Client(api.base, from).call(routes.login, { username, password, labId: api.labId });

const { rows: rules } = await sql<{ kind: IncidentKind; attempts: number; withinMs: number }>`
  select kind, attempts, (extract(epoch from within) * 1000)::int as "withinMs" from lims.sign_in_burst_rule()`.execute(
  api.superuser,
);
const rule = (kind: IncidentKind) => rules.find((r) => r.kind === kind) ?? assert.fail(`no burst rule for ${kind}`);
const addressRule = rule('SignInBurstFromAddress');
const unknownIdRule = rule('SignInBurstOnUnknownUserId');
const lockedAccountRule = rule('RepeatedSignInOnLockedAccount');

const hashOf = (typed: string) => createHmac('sha256', api.accessEventKey).update(typed).digest();

const incidents = (kind: IncidentKind) =>
  api.superuser
    .selectFrom('systemIncident')
    .select([
      'id',
      'reference',
      'subjectId',
      sql<string | null>`host(source_address)`.as('sourceAddress'),
      'typedUserIdHmac',
      'step',
      'errorClass',
      'state',
    ])
    .where('kind', '=', kind)
    .orderBy('openedAt')
    .execute();

/** The clock seam: moves every Access Event and System Incident `ms` into the past, as a clock advanced by `ms` would leave them. */
async function advanceClock(ms: number): Promise<void> {
  await api.superuser.transaction().execute(async (tx) => {
    await sql`set local session_replication_role = replica`.execute(tx);
    const by = sql`${ms} * interval '1 millisecond'`;
    await tx
      .updateTable('accessEvent')
      .set({ at: sql`at - ${by}` })
      .execute();
    await tx
      .updateTable('systemIncident')
      .set({ openedAt: sql`opened_at - ${by}` })
      .execute();
  });
}

async function lock(account: Account): Promise<void> {
  await audited(api.db, { actor: 'svc:test', role: 'system', reason: 'Lock an account for a test' }, (tx) =>
    tx.updateTable('person').set({ lockedAt: sql`now()` }).where('id', '=', account.id).execute(),
  );
}

it('a burst of failed sign-ins from one source address opens a System Incident naming the address, on the company chain under the incident service', async () => {
  const from = nextAddress();
  for (let i = 0; i < addressRule.attempts; i++)
    refusedWith(await signIn(from, `burst.nobody-${randomUUID()}`, 'any-password'), 'badCredentials');

  const opened = (await incidents('SignInBurstFromAddress')).filter((i) => i.sourceAddress === from);
  assert.equal(opened.length, 1, 'one System Incident for the burst');
  const [incident] = opened;
  assert.ok(incident);
  assert.deepEqual(
    { ...incident, id: undefined, reference: undefined },
    {
      id: undefined,
      reference: undefined,
      subjectId: null,
      sourceAddress: from,
      typedUserIdHmac: null,
      step: null,
      errorClass: null,
      state: 'Open',
    },
  );
  assert.match(incident.reference, /^[0-9A-HJKMNP-TV-Z]{8}$/);

  const entry = await api.superuser
    .selectFrom('auditEntry')
    .select(['chain', 'actor', 'role', 'reason'])
    .where('tableName', '=', 'system_incident')
    .where(sql<boolean>`new_row ->> 'id' = ${incident.id}`)
    .executeTakeFirstOrThrow();
  assert.deepEqual(entry, {
    chain: 'company',
    actor: 'svc:incident',
    role: 'system',
    reason: 'Open a System Incident',
  });
});

it('a burst whose attempts arrive at once opens one System Incident', async () => {
  const from = nextAddress();
  const answers = await Promise.all(
    Array.from({ length: 2 * addressRule.attempts }, () =>
      signIn(from, `burst.nobody-${randomUUID()}`, 'any-password'),
    ),
  );
  for (const answer of answers) refusedWith(answer, 'badCredentials');
  assert.equal((await incidents('SignInBurstFromAddress')).filter((i) => i.sourceAddress === from).length, 1);
});

it('the incident trigger fires after the Audit Trail capture, which holds the company chain', async () => {
  const { rows } = await sql<{ name: string }>`select tgname as name from pg_trigger
    where tgrelid = 'lims.access_event'::regclass and not tgisinternal and tgtype & 4 = 4 and tgtype & 2 = 0
    order by tgname`.execute(api.superuser);
  const names = rows.map((r) => r.name);
  assert.deepEqual(
    names.filter((name) => name === 'capture' || name === 'open_incident'),
    ['capture', 'open_incident'],
  );
});

it('during a burst every attempt writes its failure Access Event and gets the same reply as an attempt before it', async () => {
  const from = nextAddress();
  const known = await api.addPerson('burst.known', ['Analyst']);
  const answers = [];
  for (let i = 0; i < addressRule.attempts + 2; i++)
    answers.push(
      i % 2
        ? await signIn(from, known.username, 'not-the-password')
        : await signIn(from, `burst.nobody-${randomUUID()}`, 'any-password'),
    );

  assert.equal((await incidents('SignInBurstFromAddress')).filter((i) => i.sourceAddress === from).length, 1);
  for (const answer of answers) assert.deepEqual(answer, answers[0], 'the reply says nothing about the burst');
  refusedWith(answers[0] ?? assert.fail('no answer'), 'badCredentials');

  const { n } = await api.superuser
    .selectFrom('accessEvent')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('kind', '=', 'SignInFailed')
    .where(sql<boolean>`source_address = ${from}::inet`)
    .executeTakeFirstOrThrow();
  assert.equal(n, answers.length, 'one failure Access Event per attempt');
});

it('a burst against one unknown-ID hash from several addresses opens a System Incident naming the hash, never the typed ID', async () => {
  const typed = `burst.target-${randomUUID()}`;
  for (let i = 0; i < unknownIdRule.attempts; i++)
    refusedWith(await signIn(nextAddress(), typed, 'any-password'), 'badCredentials');

  const opened = (await incidents('SignInBurstOnUnknownUserId')).filter((i) =>
    i.typedUserIdHmac?.equals(hashOf(typed)),
  );
  assert.equal(opened.length, 1, 'one System Incident for the burst');
  const incident = await api.superuser
    .selectFrom('systemIncident')
    .selectAll()
    .where('id', '=', opened[0]?.id ?? '')
    .executeTakeFirstOrThrow();
  assert.ok(!JSON.stringify(incident).includes(typed), 'the System Incident does not hold the typed user ID');
  assert.deepEqual([incident.subjectId, incident.sourceAddress], [null, null]);
});

it('repeated attempts against a locked account open a System Incident naming the account', async () => {
  const locked = await api.addPerson('burst.locked', ['Analyst']);
  await lock(locked);
  for (let i = 0; i < lockedAccountRule.attempts; i++)
    refusedWith(
      await signIn(nextAddress(), locked.username, i % 2 ? locked.password : 'not-the-password'),
      i % 2 ? 'accountLocked' : 'badCredentials',
    );

  const opened = (await incidents('RepeatedSignInOnLockedAccount')).filter((i) => i.subjectId === locked.id);
  assert.equal(opened.length, 1, 'one System Incident for the repeats');
  assert.deepEqual([opened[0]?.sourceAddress, opened[0]?.typedUserIdHmac], [null, null]);
});

it('a lockout opens a System Incident of kind lockout naming the account, and the Access Events stay under the sign-in service', async () => {
  const person = await api.addPerson('burst.lockout', ['Analyst']);
  const from = nextAddress();
  for (let i = 0; i < LOCKOUT_AFTER_FAILURES; i++)
    refusedWith(
      await signIn(LOCKOUT_AFTER_FAILURES - i > addressRule.attempts ? nextAddress() : from, person.username, 'wrong'),
      'badCredentials',
    );

  const opened = (await incidents('Lockout')).filter((i) => i.subjectId === person.id);
  assert.equal(opened.length, 1, 'one System Incident for the lockout');
  assert.equal(
    (await incidents('SignInBurstFromAddress')).filter((i) => i.sourceAddress === from).length,
    1,
    'the attempt that locked the account also opened a burst',
  );
  const entries = await api.superuser
    .selectFrom('auditEntry')
    .select([sql<string>`new_row ->> 'kind'`.as('kind'), 'actor', 'reason'])
    .where('tableName', '=', 'access_event')
    .where(sql<boolean>`new_row ->> 'subject_id' = ${person.id}`)
    .where(sql<boolean>`new_row ->> 'kind' = 'Lockout'`)
    .execute();
  assert.deepEqual(
    entries,
    [{ kind: 'Lockout', actor: 'svc:sign-in', reason: 'Sign in' }],
    'the lockout is an Access Event, written by the sign-in service after the incident service wrote the burst',
  );
});

it('attempts below each burst threshold open no System Incident', async () => {
  const before = await api.superuser
    .selectFrom('systemIncident')
    .select(sql<number>`count(*)::int`.as('n'))
    .executeTakeFirstOrThrow();

  const from = nextAddress();
  for (let i = 0; i < addressRule.attempts - 1; i++)
    refusedWith(await signIn(from, `burst.nobody-${randomUUID()}`, 'any-password'), 'badCredentials');
  const typed = `burst.quiet-${randomUUID()}`;
  for (let i = 0; i < unknownIdRule.attempts - 1; i++)
    refusedWith(await signIn(nextAddress(), typed, 'any-password'), 'badCredentials');
  const locked = await api.addPerson('burst.quiet-locked', ['Analyst']);
  await lock(locked);
  for (let i = 0; i < lockedAccountRule.attempts - 1; i++)
    refusedWith(await signIn(nextAddress(), locked.username, 'not-the-password'), 'badCredentials');

  const after = await api.superuser
    .selectFrom('systemIncident')
    .select(sql<number>`count(*)::int`.as('n'))
    .executeTakeFirstOrThrow();
  assert.equal(after.n, before.n, 'no System Incident below a threshold');
});

it('attempts spread wider than the window open no System Incident, and a continuing burst opens one per window', async () => {
  const count = async (from: string) =>
    (await incidents('SignInBurstFromAddress')).filter((i) => i.sourceAddress === from).length;
  const from = nextAddress();
  const fail = async (times: number) => {
    for (let i = 0; i < times; i++)
      refusedWith(await signIn(from, `burst.nobody-${randomUUID()}`, 'any-password'), 'badCredentials');
  };

  await fail(addressRule.attempts - 1);
  await advanceClock(addressRule.withinMs);
  await fail(1);
  assert.equal(await count(from), 0, 'attempts outside the window are not counted');

  await fail(addressRule.attempts - 1);
  assert.equal(await count(from), 1, 'a burst inside the window opens one System Incident');
  await fail(addressRule.attempts);
  assert.equal(await count(from), 1, 'the burst continuing inside the window opens no other');

  await advanceClock(addressRule.withinMs);
  await fail(addressRule.attempts);
  assert.equal(await count(from), 2, 'the burst continuing into the next window opens one more');
});

it('attempts against an unknown user ID lock no account', async () => {
  const person = await api.addPerson('burst.near-miss', ['Analyst']);
  const lockedAccounts = () =>
    api.superuser.selectFrom('person').select('id').where('lockedAt', 'is not', null).orderBy('id').execute();
  const before = await lockedAccounts();
  const typed = person.username.toUpperCase();
  for (let i = 0; i < LOCKOUT_AFTER_FAILURES + 1; i++)
    refusedWith(await signIn(nextAddress(), typed, 'not-the-password'), 'badCredentials');

  assert.deepEqual(await lockedAccounts(), before, 'no account was locked');
  ok(await signIn(nextAddress(), person.username, person.password));
});

it('a forwarded address from a peer that is not a trusted proxy is not taken as the source address', async () => {
  const { base } = await api.startAnotherApi({ trustedProxies: [] });
  const typed = `burst.spoofed-${randomUUID()}`;
  const answer = await new Client(base, nextAddress()).call(routes.login, {
    username: typed,
    password: 'any-password',
  });
  refusedWith(answer, 'badCredentials');

  const event = await api.superuser
    .selectFrom('accessEvent')
    .select(sql<string>`host(source_address)`.as('sourceAddress'))
    .where('typedUserIdHmac', '=', hashOf(typed))
    .executeTakeFirstOrThrow();
  assert.equal(event.sourceAddress, '127.0.0.1', 'the socket peer is the source address');
});

it('the source address is the hop the trusted proxy saw, kept as a plain address', async () => {
  const recorded = async (forwarded: string) => {
    const typed = `burst.forwarded-${randomUUID()}`;
    refusedWith(await signIn(forwarded, typed, 'any-password'), 'badCredentials');
    const event = await api.superuser
      .selectFrom('accessEvent')
      .select(sql<string>`host(source_address)`.as('sourceAddress'))
      .where('typedUserIdHmac', '=', hashOf(typed))
      .executeTakeFirstOrThrow();
    return event.sourceAddress;
  };
  assert.equal(await recorded('203.0.113.66, 198.51.100.7'), '198.51.100.7', 'a spoofed earlier hop is ignored');
  assert.equal(await recorded('::ffff:198.51.100.8'), '198.51.100.8', 'an IPv4-mapped address is its IPv4 address');
  assert.equal(
    await recorded('not-an-address'),
    '127.0.0.1',
    'a forwarded value that is no address falls back to the peer',
  );
});

it('QA reads a sign-in incident by its reference, with the hash in hex and no step', async () => {
  const typed = `burst.read-${randomUUID()}`;
  for (let i = 0; i < unknownIdRule.attempts; i++)
    refusedWith(await signIn(nextAddress(), typed, 'any-password'), 'badCredentials');
  const opened = (await incidents('SignInBurstOnUnknownUserId')).find((i) => i.typedUserIdHmac?.equals(hashOf(typed)));
  const qa = await api.login(await api.addPerson('burst.reader', ['QA']));

  const read = ok(await qa.call(routes.incident, { reference: opened?.reference ?? assert.fail('no incident') }));
  assert.partialDeepStrictEqual(read, {
    kind: 'SignInBurstOnUnknownUserId',
    step: null,
    errorClass: null,
    subjectId: null,
    sourceAddress: null,
    typedUserIdHmac: hashOf(typed).toString('hex'),
  });
});
