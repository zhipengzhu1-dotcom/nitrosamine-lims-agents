import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { routes, type StepInput, type StepName, stepRoute } from '@lims/domain';
import { sql } from 'kysely';
import { type Account, Client, ok, refusedWith, signatureOf, startApi } from './harness.ts';

const api = await startApi('lims_api_staff_test');
const ada = api.person('ada');
const as = {
  ada: await api.login(ada),
  cora: await api.login(api.person('cora')),
  samir: await api.login(api.person('samir')),
  lena: await api.login(api.person('lena')),
  ana: await api.login(api.person('ana')),
  quinn: await api.login(api.person('quinn')),
};

const dbNow = async () =>
  (await sql<{ now: Date }>`select clock_timestamp() as now`.execute(api.superuser)).rows[0]?.now;
const signIn = (username: string, password: string) =>
  new Client(api.base).call(routes.login, { username, password, labId: api.labId });
const setPassword = (token: string, password: string) =>
  new Client(api.base).call(routes.setPasswordThroughLink, { token, password });

let next = 0;
async function newStarter(printedName = 'Nell Newcomer') {
  next += 1;
  const verification = ok(
    await as.ada.call(routes.recordIdentityVerification, {
      printedName,
      evidence: 'Passport seen in person (fictional)',
    }),
  );
  const created = ok(
    await as.ada.call(routes.createAccount, {
      identityVerificationId: verification.id,
      username: `nell.newcomer${next}`,
    }),
  );
  return { verification, ...created };
}

const entriesFor = (table: string, id: string) =>
  api.superuser
    .selectFrom('auditEntry')
    .select(['actor', 'role', 'reason', 'op', 'chain', 'newRow'])
    .where('tableName', '=', table)
    .where(sql`coalesce(new_row, old_row)->>'id'`, '=', id)
    .orderBy('seq')
    .execute();

it('creating a staff account with no Identity Verification on record is refused with a kind, and creates nothing', async () => {
  const before = await api.superuser
    .selectFrom('person')
    .select(({ fn }) => fn.countAll<string>().as('n'))
    .execute();
  const message = refusedWith(
    await as.ada.call(routes.createAccount, { identityVerificationId: randomUUID(), username: 'no.check' }),
    'guard',
  );
  assert.equal(message, 'Record an Identity Verification in this Lab before creating the account.');
  const after = await api.superuser
    .selectFrom('person')
    .select(({ fn }) => fn.countAll<string>().as('n'))
    .execute();
  assert.deepEqual(after, before);
});

it('an Identity Verification records the checker, what was checked and database time, on the company chain', async () => {
  const before = await dbNow();
  const verification = ok(
    await as.ada.call(routes.recordIdentityVerification, {
      printedName: 'Iris Checked',
      evidence: 'Driving licence seen in person (fictional)',
    }),
  );
  const after = await dbNow();
  assert.equal(verification.printedName, 'Iris Checked');
  assert.equal(verification.evidence, 'Driving licence seen in person (fictional)');
  assert.equal(verification.checkedBy, 'Ada Novak');
  const stored = await api.superuser
    .selectFrom('identityVerification')
    .selectAll()
    .where('id', '=', verification.id)
    .executeTakeFirstOrThrow();
  assert.equal(stored.checkedBy, ada.id);
  assert.equal(stored.checkedInLabId, api.labId);
  assert.ok(before && after && stored.checkedAt >= before && stored.checkedAt <= after, 'checked at database time');
  const [entry, ...others] = await entriesFor('identity_verification', verification.id);
  assert.deepEqual(others, []);
  assert.deepEqual(
    [entry?.actor, entry?.role, entry?.reason, entry?.chain],
    ['person:ada.admin', 'Admin', 'Record an Identity Verification', 'company'],
  );
});

it('an account created after its Identity Verification gets its first credentials only through a single-use link', async () => {
  const { verification, person, link } = await newStarter();
  assert.equal(person.printedName, verification.printedName, 'the account takes the printed name that was checked');
  assert.equal(person.credentialSet, false);
  assert.ok(person.identityVerifiedAt);
  assert.deepEqual(
    [person.identityVerifiedBy, person.identityEvidence],
    ['Ada Novak', 'Passport seen in person (fictional)'],
    'the staff list says who checked the identity and what they checked',
  );
  ok(await as.ada.call(routes.grantMembership, { personId: person.id, role: 'Analyst', reason: 'New starter' }));

  refusedWith(await signIn(person.username, 'any-password'), 'badCredentials');
  const [noCredential] = await api.superuser
    .selectFrom('accessEvent')
    .select(['kind', 'failureReason'])
    .where('subjectId', '=', person.id)
    .execute();
  assert.deepEqual(noCredential, { kind: 'SignInFailed', failureReason: 'NoCredential' });

  assert.deepEqual(ok(await setPassword(link.token, 'chosen-by-nell')), { username: person.username });
  const me = ok(await signIn(person.username, 'chosen-by-nell'));
  assert.deepEqual(me.roles, ['Analyst']);
  const set = await api.superuser
    .selectFrom('accessEvent')
    .select(['kind', sql<string[]>`roles::text[]`.as('roles')])
    .where('subjectId', '=', person.id)
    .where('kind', '=', 'PasswordSet')
    .execute();
  assert.deepEqual(set, [{ kind: 'PasswordSet', roles: ['Analyst'] }]);
});

it('a one-time link works once: a second use is refused and leaves the password as first set', async () => {
  const { person, link } = await newStarter();
  ok(await as.ada.call(routes.grantMembership, { personId: person.id, role: 'Reviewer', reason: 'New starter' }));
  ok(await setPassword(link.token, 'first-choice'));
  const message = refusedWith(await setPassword(link.token, 'second-choice'), 'badCredentials');
  assert.equal(message, 'This link has been used, replaced or has expired. Ask the Admin for a new one.');
  refusedWith(await signIn(person.username, 'second-choice'), 'badCredentials');
  ok(await signIn(person.username, 'first-choice'));
  refusedWith(await setPassword('not-a-link-the-lims-issued', 'third-choice'), 'badCredentials');
});

it('an expired one-time link is refused', async () => {
  const { link, person } = await newStarter();
  // A link's expiry never moves, so the test ages it past the trigger that refuses the change.
  await api.superuser.transaction().execute(async (tx) => {
    await sql`select set_config('lims.actor', 'svc:test', true), set_config('lims.role', 'system', true),
                     set_config('lims.reason', 'Age a one-time link', true)`.execute(tx);
    await sql`alter table lims.credential_link disable trigger use_link_once`.execute(tx);
    await sql`update lims.credential_link set issued_at = issued_at - interval '73 hours',
                     expires_at = expires_at - interval '73 hours' where person_id = ${person.id}`.execute(tx);
    await sql`alter table lims.credential_link enable trigger use_link_once`.execute(tx);
  });
  refusedWith(await setPassword(link.token, 'too-late'), 'badCredentials');
  refusedWith(await signIn(person.username, 'too-late'), 'badCredentials');
});

it('no reply to the Admin contains a password, a password hash or a second-factor secret', async () => {
  const replies: unknown[] = [];
  const keep = <T>(reply: T): T => {
    replies.push(reply);
    return reply;
  };
  const verification = keep(
    ok(await as.ada.call(routes.recordIdentityVerification, { printedName: 'Pia Private', evidence: 'ID card seen' })),
  );
  const { person, link } = keep(
    ok(await as.ada.call(routes.createAccount, { identityVerificationId: verification.id, username: 'pia.private' })),
  );
  keep(ok(await as.ada.call(routes.grantMembership, { personId: person.id, role: 'QA', reason: 'New starter' })));
  ok(await setPassword(link.token, 'pia-secret-password'));
  keep(ok(await as.ada.call(routes.changePrintedName, { personId: person.id, printedName: 'Pia P', reason: 'Asked' })));
  keep(ok(await as.ada.call(routes.staff)));

  const text = JSON.stringify(replies);
  assert.doesNotMatch(text, /pia-secret-password|scrypt\$|password|secret|totp/i);
  const stored = await api.superuser
    .selectFrom('person')
    .select('passwordHash')
    .where('id', '=', person.id)
    .executeTakeFirstOrThrow();
  assert.ok(stored.passwordHash && !text.includes(stored.passwordHash));
  const linkRow = await api.superuser
    .selectFrom('credentialLink')
    .select('tokenHash')
    .where('personId', '=', person.id)
    .executeTakeFirstOrThrow();
  assert.notEqual(linkRow.tokenHash.toString('base64url'), link.token, 'the LIMS keeps only the hash of the token');
});

it('an Admin grants a Membership for a Lab and role with a reason, and the Audit Trail records it', async () => {
  const { person } = await newStarter();
  const granted = ok(
    await as.ada.call(routes.grantMembership, {
      personId: person.id,
      role: 'SampleCustodian',
      reason: 'Joins goods-in',
    }),
  );
  assert.deepEqual(granted.roles, ['SampleCustodian']);
  const entries = await api.superuser
    .selectFrom('auditEntry')
    .select(['actor', 'role', 'reason', 'op', 'chain', 'newRow'])
    .where('tableName', '=', 'membership')
    .where(sql`new_row->>'person_id'`, '=', person.id)
    .execute();
  assert.deepEqual(entries, [
    {
      actor: 'person:ada.admin',
      role: 'Admin',
      reason: 'Joins goods-in',
      op: 'INSERT',
      chain: api.labId,
      newRow: { lab_id: api.labId, person_id: person.id, role: 'SampleCustodian' },
    },
  ]);
});

it('a Membership with no reason, or a blank one, is refused', async () => {
  const { person } = await newStarter();
  for (const reason of ['', '   '])
    refusedWith(await as.ada.call(routes.grantMembership, { personId: person.id, role: 'QA', reason }), 'malformed');
  refusedWith(await as.ada.send(routes.grantMembership, { personId: person.id, role: 'QA' }), 'malformed');
});

it('every staff-account route refuses a person who is not an Admin', async () => {
  const { verification, person } = await newStarter();
  for (const client of [as.cora, as.samir, as.lena, as.ana, as.quinn]) {
    refusedWith(await client.call(routes.staff), 'role');
    refusedWith(await client.call(routes.recordIdentityVerification, { printedName: 'X Y', evidence: 'ID' }), 'role');
    refusedWith(
      await client.call(routes.createAccount, { identityVerificationId: verification.id, username: 'not.by.admin' }),
      'role',
    );
    refusedWith(
      await client.call(routes.grantMembership, { personId: person.id, role: 'Admin', reason: 'Self-made' }),
      'role',
    );
    refusedWith(
      await client.call(routes.changePrintedName, { personId: person.id, printedName: 'Z', reason: 'Because' }),
      'role',
    );
  }
});

it('a business role for an Admin, or Admin for a holder of a business role, is refused with a kind', async () => {
  const apart = 'A person who holds Admin or Platform Operator holds no business role, in any Lab.';
  const { person: admin } = await newStarter();
  const { person: analyst } = await newStarter();
  ok(await as.ada.call(routes.grantMembership, { personId: admin.id, role: 'Admin', reason: 'Second Admin' }));
  ok(await as.ada.call(routes.grantMembership, { personId: analyst.id, role: 'Analyst', reason: 'New starter' }));
  for (const [personId, role] of [
    [admin.id, 'Analyst'],
    [analyst.id, 'Admin'],
  ] as const)
    assert.equal(
      refusedWith(await as.ada.call(routes.grantMembership, { personId, role, reason: 'Try it' }), 'guard'),
      apart,
    );
});

it('a staff role goes only to an account with an Identity Verification, so not to a seeded demo account', async () => {
  assert.equal(
    refusedWith(
      await as.ada.call(routes.grantMembership, { personId: api.person('ana').id, role: 'Reviewer', reason: 'Cover' }),
      'guard',
    ),
    'A staff role goes only to a staff account with an Identity Verification.',
  );
});

it('an Identity Verification gives one account, and a username is given once', async () => {
  const { verification, person } = await newStarter();
  refusedWith(
    await as.ada.call(routes.createAccount, { identityVerificationId: verification.id, username: 'second.account' }),
    'state',
  );
  const other = ok(await as.ada.call(routes.recordIdentityVerification, { printedName: 'Twin', evidence: 'ID card' }));
  assert.equal(
    refusedWith(
      await as.ada.call(routes.createAccount, { identityVerificationId: other.id, username: person.username }),
      'state',
    ),
    `The username ${person.username} is taken.`,
  );
});

async function take(client: Client, name: StepName, testId: string, input: StepInput<StepName>, signer?: Account) {
  ok(
    await client.call(stepRoute(name), {
      commitKey: randomUUID(),
      testId,
      input,
      ...(signer && { signature: await signatureOf(client, testId, signer) }),
    }),
  );
}

it('a printed-name change needs a reason; with one it is audited, and an earlier Signature keeps the name as signed', async () => {
  const ana = api.person('ana');
  const { testId } = ok(
    await as.cora.call(stepRoute('submit'), {
      commitKey: randomUUID(),
      input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' },
    }),
  );
  await take(as.samir, 'receive', testId, {});
  await take(as.lena, 'assign', testId, { assigneeId: ana.id });
  await take(
    as.ana,
    'enterResult',
    testId,
    {
      analyte: 'NDMA',
      value: '0.0300',
      unit: 'ppm',
      injectionSequenceRef: 'SEQ-2026-0042',
      notebookRef: 'NB-RD-0001-012',
      performedOn: '2026-09-30',
    },
    ana,
  );

  for (const reason of ['', ' '])
    refusedWith(
      await as.ada.call(routes.changePrintedName, { personId: ana.id, printedName: 'Ana Ferreira-Souza', reason }),
      'malformed',
    );
  refusedWith(
    await as.ada.send(routes.changePrintedName, { personId: ana.id, printedName: 'Ana Ferreira-Souza' }),
    'malformed',
  );
  const renamed = ok(
    await as.ada.call(routes.changePrintedName, {
      personId: ana.id,
      printedName: 'Ana Ferreira-Souza',
      reason: 'Name changed on marriage',
    }),
  );
  assert.equal(renamed.printedName, 'Ana Ferreira-Souza');
  assert.equal(renamed.username, 'ana.analyst', 'the username stays');

  const rename = (await entriesFor('person', ana.id)).at(-1);
  assert.deepEqual(
    [rename?.actor, rename?.role, rename?.reason, rename?.op],
    ['person:ada.admin', 'Admin', 'Name changed on marriage', 'UPDATE'],
  );
  const { signatures } = ok(await as.lena.call(routes.test, { id: testId }));
  assert.deepEqual(
    signatures.map((s) => [s.meaning, s.signer]),
    [['Performed', 'Ana Ferreira']],
  );
  ok(await as.ada.call(routes.changePrintedName, { personId: ana.id, printedName: 'Ana Ferreira', reason: 'Restore' }));
});

it('the Admin sees this Lab’s staff with their roles, and checked people still awaiting an account', async () => {
  const waiting = ok(
    await as.ada.call(routes.recordIdentityVerification, { printedName: 'Wanda Waiting', evidence: 'Passport' }),
  );
  const { people, awaitingAccount } = ok(await as.ada.call(routes.staff));
  assert.ok(awaitingAccount.some((c) => c.id === waiting.id));
  const ana = people.find((p) => p.username === 'ana.analyst');
  assert.deepEqual([ana?.roles, ana?.credentialSet], [['Analyst'], true]);
});

it('a grant to a person who is not among this Lab’s staff, or of a role already held, is refused with a kind and opens no System Incident', async () => {
  const before = await api.superuser.selectFrom('systemIncident').select('id').execute();
  refusedWith(
    await as.ada.call(routes.grantMembership, { personId: randomUUID(), role: 'QA', reason: 'Typo' }),
    'notFound',
  );
  const { person } = await newStarter();
  ok(await as.ada.call(routes.grantMembership, { personId: person.id, role: 'QA', reason: 'New starter' }));
  assert.equal(
    refusedWith(
      await as.ada.call(routes.grantMembership, { personId: person.id, role: 'QA', reason: 'Again' }),
      'state',
    ),
    `The person ${person.printedName} already holds QA in this Lab.`,
  );
  assert.deepEqual(await api.superuser.selectFrom('systemIncident').select('id').execute(), before);
});

it('a new one-time link replaces the earlier one, and none is issued once the person has set a password', async () => {
  const { person, link: first } = await newStarter();
  refusedWith(await as.lena.call(routes.issueLink, { personId: person.id }), 'role');
  const { link: second } = ok(await as.ada.call(routes.issueLink, { personId: person.id }));
  refusedWith(await setPassword(first.token, 'from-the-old-link'), 'badCredentials');
  ok(await setPassword(second.token, 'from-the-new-link'));
  refusedWith(await as.ada.call(routes.issueLink, { personId: person.id }), 'state');
  const issued = await api.superuser
    .selectFrom('auditEntry')
    .select(['actor', 'reason'])
    .where('tableName', '=', 'credential_link')
    .where('op', '=', 'INSERT')
    .where(sql`new_row->>'person_id'`, '=', person.id)
    .orderBy('seq')
    .execute();
  assert.deepEqual(issued, [
    { actor: 'person:ada.admin', reason: 'Create a staff account' },
    { actor: 'person:ada.admin', reason: 'Issue a new one-time link' },
  ]);
});
