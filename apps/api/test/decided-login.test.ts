import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { audited } from '@lims/db';
import { routes, stepRoute } from '@lims/domain';
import { sql } from 'kysely';
import { LOGIN } from '../src/auth.ts';
import { stepAt, totpCode } from '../src/totp.ts';
import { type Account, Client, ok, refusedWith, signatureOf, startApi } from './harness.ts';

const api = await startApi('lims_api_decided_login_test');
const decided = await api.startAnotherApi({ login: LOGIN.decided });
const as = {
  cora: await api.login(api.person('cora')),
  samir: await api.login(api.person('samir')),
  lena: await api.login(api.person('lena')),
};
/** The one sentence every credential failure under the decided login answers with, which names the code it asks for. */
const NOT_VALID = 'The user ID, password or code is not valid.';

/** Decodes an enrolment's text secret, the RFC 4648 base32 a person types into their authenticator. */
function fromBase32(text: string): Buffer {
  const bits = Array.from(text, (c) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0')).join(
    '',
  );
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
}

/** A person enrolled under the decided login, with codes for this time step and the next. */
async function enrolled(name: string, roles: Parameters<typeof api.addPerson>[1] = ['Analyst']) {
  const account = await api.addPerson(name, roles, { trained: true });
  const { secret } = ok(
    await new Client(decided.base).call(routes.enrolAuthenticator, {
      username: account.username,
      password: account.password,
    }),
  );
  const key = fromBase32(secret);
  const { rows } = await sql<{
    ms: string;
  }>`select (extract(epoch from clock_timestamp()) * 1000)::bigint as ms`.execute(api.superuser);
  const now = stepAt(Number(rows[0]?.ms));
  return { account, code: (later = 0) => totpCode(key, now + later) };
}

const signIn = (account: Account, password: string, code?: string) =>
  new Client(decided.base).call(routes.login, {
    username: account.username,
    password,
    labId: api.labId,
    ...(code === undefined ? {} : { code }),
  });

async function assignedTo(analyst: Account): Promise<string> {
  const { testId } = ok(
    await as.cora.call(stepRoute('submit'), {
      commitKey: randomUUID(),
      input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' },
    }),
  );
  ok(await as.samir.call(stepRoute('receive'), { commitKey: randomUUID(), testId, input: {} }));
  ok(await as.lena.call(stepRoute('assign'), { commitKey: randomUUID(), testId, input: { assigneeId: analyst.id } }));
  return testId;
}

const result = {
  analyte: 'NDMA',
  value: '0.012',
  unit: 'ppm',
  injectionSequenceRef: 'SEQ-2026-0042',
  notebookRef: 'NB-RD-0001-012',
  performedOn: '2026-09-30',
};
const enterResult = async (
  client: Client,
  testId: string,
  signer: Account,
  signature: { password?: string; code?: string; username?: string },
) =>
  client.call(stepRoute('enterResult'), {
    commitKey: randomUUID(),
    testId,
    input: result,
    signature: { ...(await signatureOf(client, testId, signer)), ...signature },
  });

const eventsOf = (personId: string) =>
  api.superuser
    .selectFrom('accessEvent')
    .select(['kind', 'failureReason'])
    .where('subjectId', '=', personId)
    .orderBy('at')
    .execute();

it('the sign-in page learns whether the login asks for a code before anyone signs in', async () => {
  assert.deepEqual(ok(await new Client(decided.base).call(routes.loginPolicy)), { secondFactor: true });
  assert.deepEqual(ok(await new Client(api.base).call(routes.loginPolicy)), { secondFactor: false });
});

it('under the decided login, sign-in needs the password and a current code; a missing or wrong code is the uniform failure and a failed Access Event', async () => {
  const { account, code } = await enrolled('dora.decided');
  assert.equal(refusedWith(await signIn(account, account.password), 'badCredentials'), NOT_VALID);
  const wrong = code() === '000000' ? '111111' : '000000';
  assert.equal(refusedWith(await signIn(account, account.password, wrong), 'badCredentials'), NOT_VALID);
  ok(await signIn(account, account.password, code()));
  assert.deepEqual(await eventsOf(account.id), [
    { kind: 'AuthenticatorEnrolled', failureReason: null },
    { kind: 'SignInFailed', failureReason: 'WrongCode' },
    { kind: 'SignInFailed', failureReason: 'WrongCode' },
    { kind: 'SignInSucceeded', failureReason: null },
  ]);
});

it('a person with no authenticator enrolled cannot sign in under the decided login', async () => {
  const account = await api.addPerson('nina.noauth', ['Analyst']);
  assert.equal(refusedWith(await signIn(account, account.password, '123456'), 'badCredentials'), NOT_VALID);
  assert.deepEqual(await eventsOf(account.id), [{ kind: 'SignInFailed', failureReason: 'NoAuthenticator' }]);
});

it('a code used once is refused at its second use, at sign-in and at signing', async () => {
  const { account, code } = await enrolled('reid.reuse');
  const client = new Client(decided.base);
  ok(
    await client.call(routes.login, {
      username: account.username,
      password: account.password,
      labId: api.labId,
      code: code(),
    }),
  );
  refusedWith(await signIn(account, account.password, code()), 'badCredentials');
  const testId = await assignedTo(account);
  refusedWith(await enterResult(client, testId, account, { code: code() }), 'badCredentials');
  ok(await enterResult(client, testId, account, { code: code(1) }));
  assert.deepEqual((await eventsOf(account.id)).map((event) => event.failureReason).filter(Boolean), [
    'WrongCode',
    'WrongCode',
  ]);
});

it('a sign-in refused for a Lab the person holds no Membership in spends no code; the same code then opens a Lab they hold', async () => {
  const { account, code } = await enrolled('mia.membership');
  const inLab = (labId: string) =>
    new Client(decided.base).call(routes.login, {
      username: account.username,
      password: account.password,
      labId,
      code: code(),
    });
  refusedWith(await inLab(api.qcLabId), 'role');
  ok(await inLab(api.labId));
  assert.deepEqual(await eventsOf(account.id), [
    { kind: 'AuthenticatorEnrolled', failureReason: null },
    { kind: 'SignInFailed', failureReason: 'NoMembership' },
    { kind: 'SignInSucceeded', failureReason: null },
  ]);
});

it('a signing refused because the Test moved on spends no code; the same code then signs a fresh Test', async () => {
  const { account, code } = await enrolled('stan.stale');
  const client = new Client(decided.base);
  ok(
    await client.call(routes.login, {
      username: account.username,
      password: account.password,
      labId: api.labId,
      code: code(),
    }),
  );
  const moved = await assignedTo(account);
  const fresh = await assignedTo(account);
  // The Test is moved under the signing's feet: the move holds the row until the signing waits on it, then commits.
  const SYSTEM = { actor: 'svc:test', role: 'system', reason: 'Move a Test while it is signed' } as const;
  const { answer } = await audited(api.superuser, SYSTEM, async (tx) => {
    await tx.updateTable('test').set({ state: 'Ready' }).where('id', '=', moved).execute();
    const answer = enterResult(client, moved, account, { code: code(1) });
    answer.catch(() => {});
    await api.untilWaitingOnLocks(1);
    return { answer };
  });
  refusedWith(await answer, 'stale');
  ok(await enterResult(client, fresh, account, { code: code(1) }));
});

it('two sign-ins racing with one code give one session and one refusal, and no failure is recorded against the person', async () => {
  const { account, code } = await enrolled('rae.race');
  const answers = await Promise.all([
    signIn(account, account.password, code()),
    signIn(account, account.password, code()),
  ]);
  assert.deepEqual(answers.map((a) => (a.kind === 'reply' ? 'reply' : a.body.kind)).sort(), [
    'badCredentials',
    'reply',
  ]);
  assert.deepEqual(await eventsOf(account.id), [
    { kind: 'AuthenticatorEnrolled', failureReason: null },
    { kind: 'SignInSucceeded', failureReason: null },
  ]);
});

it('under the decided login, signing refuses without the typed user ID, the password and a fresh code', async () => {
  const { account, code } = await enrolled('sig.decided');
  const client = new Client(decided.base);
  ok(
    await client.call(routes.login, {
      username: account.username,
      password: account.password,
      labId: api.labId,
      code: code(),
    }),
  );
  const testId = await assignedTo(account);
  refusedWith(await enterResult(client, testId, account, {}), 'badCredentials');
  refusedWith(
    await enterResult(client, testId, account, { username: 'someone.else', code: code(1) }),
    'badCredentials',
  );
  refusedWith(
    await enterResult(client, testId, account, { password: 'not-the-password', code: code(1) }),
    'badCredentials',
  );
  ok(await enterResult(client, testId, account, { code: code(1) }));
});

it('enrolment shows the secret as text and as a QR payload once; a second enrolment is the uniform refusal, so the right password alone learns nothing', async () => {
  const account = await api.addPerson('erin.enrol', ['Analyst']);
  const client = new Client(decided.base);
  const first = ok(
    await client.call(routes.enrolAuthenticator, { username: account.username, password: account.password }),
  );
  assert.match(first.secret, /^[A-Z2-7]{32}$/);
  const qr = new URL(first.otpauth);
  assert.deepEqual([qr.protocol, qr.host, qr.searchParams.get('secret')], ['otpauth:', 'totp', first.secret]);
  const second = await client.call(routes.enrolAuthenticator, {
    username: account.username,
    password: account.password,
  });
  assert.equal(refusedWith(second, 'badCredentials'), NOT_VALID);
  assert.equal(JSON.stringify(second.body).includes(first.secret), false);
  assert.equal(
    refusedWith(
      await client.call(routes.enrolAuthenticator, { username: account.username, password: 'wrong-password' }),
      'badCredentials',
    ),
    NOT_VALID,
  );
  assert.deepEqual(await eventsOf(account.id), [
    { kind: 'AuthenticatorEnrolled', failureReason: null },
    { kind: 'SignInFailed', failureReason: 'AlreadyEnrolled' },
    { kind: 'SignInFailed', failureReason: 'WrongPassword' },
  ]);
  const { failedLogins } = await api.superuser
    .selectFrom('person')
    .select('failedLogins')
    .where('id', '=', account.id)
    .executeTakeFirstOrThrow();
  assert.equal(failedLogins, 1, 'only the wrong password counts toward the lockout');
});

it('enrolment refuses an unknown user ID, an account with no credential yet and a locked account with the uniform sentence, and records each', async () => {
  const client = new Client(decided.base);
  const enrol = (username: string, password: string) => client.call(routes.enrolAuthenticator, { username, password });
  assert.equal(refusedWith(await enrol('nobody.enrol', 'Benchline-2026-nobody'), 'badCredentials'), NOT_VALID);
  const unknown = await api.superuser
    .selectFrom('accessEvent')
    .select(['kind', 'failureReason', 'subjectId', 'typedUserIdLength'])
    .where('typedUserIdHmac', '=', createHmac('sha256', api.accessEventKey).update('nobody.enrol').digest())
    .execute();
  assert.deepEqual(unknown, [
    { kind: 'SignInFailed', failureReason: 'UnknownUserId', subjectId: null, typedUserIdLength: 'nobody.enrol'.length },
  ]);

  const ada = await api.login(api.person('ada'));
  const verification = ok(
    await ada.call(routes.recordIdentityVerification, {
      printedName: 'Noa Credential',
      evidence: 'Passport seen in person (fictional)',
    }),
  );
  const { person } = ok(
    await ada.call(routes.createAccount, { identityVerificationId: verification.id, username: 'noa.nocredential' }),
  );
  assert.equal(refusedWith(await enrol('noa.nocredential', 'Benchline-2026-noa'), 'badCredentials'), NOT_VALID);
  assert.deepEqual(await eventsOf(person.id), [{ kind: 'SignInFailed', failureReason: 'NoCredential' }]);

  const locked = await api.addPerson('lia.locked', ['Analyst']);
  await audited(api.superuser, { actor: 'svc:test', role: 'system', reason: 'Lock a person out' }, (tx) =>
    tx.updateTable('person').set({ lockedAt: sql`clock_timestamp()` }).where('id', '=', locked.id).execute(),
  );
  assert.equal(refusedWith(await enrol(locked.username, locked.password), 'badCredentials'), NOT_VALID);
  assert.deepEqual(await eventsOf(locked.id), [{ kind: 'SignInFailed', failureReason: 'AccountLocked' }]);
});

it('a Lockout that lands after the enrolment checked the password refuses it with the uniform sentence, and no authenticator is kept', async () => {
  const account = await api.addPerson('lex.lockedlate', ['Analyst']);
  const answer = await api.lockOutWhile(account, () =>
    new Client(decided.base).call(routes.enrolAuthenticator, {
      username: account.username,
      password: account.password,
    }),
  );
  assert.equal(refusedWith(answer, 'badCredentials'), NOT_VALID);
  assert.deepEqual(await eventsOf(account.id), [{ kind: 'SignInFailed', failureReason: 'AccountLocked' }]);
  assert.equal(
    await api.superuser
      .selectFrom('authenticator')
      .select('personId')
      .where('personId', '=', account.id)
      .executeTakeFirst(),
    undefined,
  );
});

it('under the decided login, unlocking a locked session needs the password and a fresh code', async () => {
  const { account, code } = await enrolled('ulla.unlock');
  const client = new Client(decided.base);
  ok(
    await client.call(routes.login, {
      username: account.username,
      password: account.password,
      labId: api.labId,
      code: code(),
    }),
  );
  ok(await client.call(routes.lock));
  const wrong = code(1) === '000000' ? '111111' : '000000';
  for (const typed of [{}, { code: wrong }, { code: code() }])
    assert.equal(
      refusedWith(await client.call(routes.unlock, { password: account.password, ...typed }), 'badCredentials'),
      'The password or code is not valid.',
    );
  assert.equal(
    ok(await client.call(routes.unlock, { password: account.password, code: code(1) })).person.id,
    account.id,
  );
  assert.deepEqual((await eventsOf(account.id)).map((event) => event.kind).slice(-5), [
    'Lock',
    'UnlockFailed',
    'UnlockFailed',
    'UnlockFailed',
    'Unlock',
  ]);
});

it('under the decided login, a Lab switch needs the user ID, the password and a fresh code', async () => {
  const { account, code } = await enrolled('sol.switch');
  await audited(api.superuser, { actor: 'svc:test', role: 'system', reason: 'Add a Membership' }, (tx) =>
    tx.insertInto('membership').values({ labId: api.qcLabId, personId: account.id, role: 'Reviewer' }).execute(),
  );
  const client = new Client(decided.base);
  ok(
    await client.call(routes.login, {
      username: account.username,
      password: account.password,
      labId: api.labId,
      code: code(),
    }),
  );
  const toQc = (typed: { code?: string }) =>
    client.call(routes.switchLab, {
      username: account.username,
      password: account.password,
      labId: api.qcLabId,
      ...typed,
    });
  assert.equal(refusedWith(await toQc({}), 'badCredentials'), NOT_VALID);
  assert.equal(refusedWith(await toQc({ code: code() }), 'badCredentials'), NOT_VALID);
  assert.equal(ok(await toQc({ code: code(1) })).lab.id, api.qcLabId);
  assert.deepEqual((await eventsOf(account.id)).slice(-3), [
    { kind: 'LabSwitchFailed', failureReason: 'WrongCode' },
    { kind: 'LabSwitchFailed', failureReason: 'WrongCode' },
    { kind: 'LabSwitch', failureReason: null },
  ]);
});

it('a Lab switch refused because the session had ended leaves its code unspent; the same code then signs the person in again', async () => {
  const { account, code } = await enrolled('sid.switchended');
  await audited(api.superuser, { actor: 'svc:test', role: 'system', reason: 'Add a Membership' }, (tx) =>
    tx.insertInto('membership').values({ labId: api.qcLabId, personId: account.id, role: 'Reviewer' }).execute(),
  );
  const client = new Client(decided.base);
  ok(
    await client.call(routes.login, {
      username: account.username,
      password: account.password,
      labId: api.labId,
      code: code(),
    }),
  );
  // The session is ended under the switch's feet: the person row is held until the switch waits on it, past the
  // request's own touch of the session, then the session is ended and both commit.
  const SYSTEM = { actor: 'svc:test', role: 'system', reason: 'End a session while its person switches Lab' } as const;
  const { answer } = await audited(api.superuser, SYSTEM, async (tx) => {
    await tx.updateTable('person').set({ failedLogins: sql`failed_logins` }).where('id', '=', account.id).execute();
    const answer = client.call(routes.switchLab, {
      username: account.username,
      password: account.password,
      labId: api.qcLabId,
      code: code(1),
    });
    answer.catch(() => {});
    await api.untilWaitingOnLocks(1);
    await tx
      .updateTable('session')
      .set({ endedAt: sql`clock_timestamp()` })
      .where('personId', '=', account.id)
      .where('endedAt', 'is', null)
      .execute();
    return { answer };
  });
  refusedWith(await answer, 'stale');
  assert.deepEqual((await eventsOf(account.id)).slice(-1), [
    { kind: 'LabSwitchFailed', failureReason: 'SessionEnded' },
  ]);
  ok(await signIn(account, account.password, code(1)));
});

it('a Signature given under the decided login records that the password and a code proved the signer; under the demo login, the password alone', async () => {
  const { account, code } = await enrolled('pam.proof');
  const client = new Client(decided.base);
  ok(
    await client.call(routes.login, {
      username: account.username,
      password: account.password,
      labId: api.labId,
      code: code(),
    }),
  );
  ok(await enterResult(client, await assignedTo(account), account, { code: code(1) }));
  const demo = await api.addPerson('dan.demo', ['Analyst'], { trained: true });
  ok(await enterResult(await api.login(demo), await assignedTo(demo), demo, {}));
  const proofsOf = (personId: string) =>
    api.superuser
      .selectFrom('signature')
      .innerJoin('reauthentication', 'reauthentication.id', 'signature.reauthenticationId')
      .select(['signature.authenticator', 'reauthentication.authenticator as proved'])
      .where('signature.personId', '=', personId)
      .execute();
  assert.deepEqual(await proofsOf(account.id), [{ authenticator: 'PasswordAndCode', proved: 'PasswordAndCode' }]);
  assert.deepEqual(await proofsOf(demo.id), [{ authenticator: 'Password', proved: 'Password' }]);
});

it('a password under 15 characters or missing a character type is refused with a sentence; a password that meets the rule is set', async () => {
  const ada = await api.login(api.person('ada'));
  const verification = ok(
    await ada.call(routes.recordIdentityVerification, {
      printedName: 'Pia Password',
      evidence: 'Passport seen in person (fictional)',
    }),
  );
  const { person, link } = ok(
    await ada.call(routes.createAccount, { identityVerificationId: verification.id, username: 'pia.password' }),
  );
  const set = (token: string, password: string) =>
    new Client(decided.base).call(routes.setPasswordThroughLink, { token, password });
  assert.equal(refusedWith(await set(link.token, 'Short-1a'), 'malformed'), 'A password needs at least 15 characters.');
  assert.equal(
    refusedWith(await set(link.token, 'longenoughbutplain'), 'malformed'),
    'A password needs an uppercase letter, a digit and a symbol.',
  );
  assert.deepEqual(ok(await set(link.token, 'Benchline-2026-first')), { username: 'pia.password' });
  assert.deepEqual(
    (await eventsOf(person.id)).map((event) => event.kind),
    ['PasswordSet'],
  );
});

it('an Admin signed in on their own browser cannot enrol the authenticator of an account they created; its holder then enrols it', async () => {
  const ada = await api.login(api.person('ada'));
  const verification = ok(
    await ada.call(routes.recordIdentityVerification, {
      printedName: 'Paz Holder',
      evidence: 'Passport seen in person (fictional)',
    }),
  );
  const { person, link } = ok(
    await ada.call(routes.createAccount, { identityVerificationId: verification.id, username: 'paz.holder' }),
  );
  const password = 'Benchline-2026-holder';
  ok(await new Client(decided.base).call(routes.setPasswordThroughLink, { token: link.token, password }));
  assert.equal(
    refusedWith(await ada.call(routes.enrolAuthenticator, { username: 'paz.holder', password }), 'guard'),
    'Sign out first. Only the holder of an account enrols its authenticator, in a browser where no one else is signed in.',
  );
  assert.deepEqual(await eventsOf(person.id), [
    { kind: 'PasswordSet', failureReason: null },
    { kind: 'SignInFailed', failureReason: 'OtherPersonSignedIn' },
  ]);
  // A user ID nobody holds gets the same guard, so the signed-in browser learns nothing about which IDs exist.
  assert.equal(
    refusedWith(await ada.call(routes.enrolAuthenticator, { username: 'nobody.signedin', password }), 'guard'),
    'Sign out first. Only the holder of an account enrols its authenticator, in a browser where no one else is signed in.',
  );
  assert.deepEqual(
    await api.superuser
      .selectFrom('accessEvent')
      .select(['kind', 'failureReason', 'subjectId', 'typedUserIdLength'])
      .where('typedUserIdHmac', '=', createHmac('sha256', api.accessEventKey).update('nobody.signedin').digest())
      .execute(),
    [{ kind: 'SignInFailed', failureReason: 'UnknownUserId', subjectId: null, typedUserIdLength: 15 }],
  );
  ok(await new Client(decided.base).call(routes.enrolAuthenticator, { username: 'paz.holder', password }));
  assert.deepEqual(
    (await eventsOf(person.id)).map((event) => event.kind),
    ['PasswordSet', 'SignInFailed', 'AuthenticatorEnrolled'],
  );
});

it('a signed-in person changes their password with the current password and a fresh code; a weak new password is refused first', async () => {
  const { account, code } = await enrolled('cal.change');
  const client = new Client(decided.base);
  ok(
    await client.call(routes.login, {
      username: account.username,
      password: account.password,
      labId: api.labId,
      code: code(),
    }),
  );
  const change = (password: string, newPassword: string) =>
    client.call(routes.changePassword, { password, code: code(1), newPassword });
  assert.equal(
    refusedWith(await change(account.password, 'longenoughbutplain'), 'malformed'),
    'A password needs an uppercase letter, a digit and a symbol.',
  );
  assert.equal(
    refusedWith(await change('not-the-password', 'Benchline-2026-second'), 'badCredentials'),
    'The password or code is not valid.',
  );
  ok(await change(account.password, 'Benchline-2026-second'));
  assert.deepEqual((await eventsOf(account.id)).map((event) => event.kind).slice(-2), [
    'ReauthenticationFailed',
    'PasswordChanged',
  ]);
  const codeless = (password: string) =>
    new Client(api.base).call(routes.login, { username: account.username, password, labId: api.labId });
  refusedWith(await codeless(account.password), 'badCredentials');
  ok(await codeless('Benchline-2026-second'));
});

it('5 consecutive failures, mixing sign-in and signing, lock the account; only the right password and code then learn of the lock', async () => {
  const { account, code } = await enrolled('lou.lockout');
  const client = new Client(decided.base);
  ok(
    await client.call(routes.login, {
      username: account.username,
      password: account.password,
      labId: api.labId,
      code: code(),
    }),
  );
  const wrong = [code(-1), code(), code(1)].includes('000000') ? '111111' : '000000';
  const testId = await assignedTo(account);
  for (let i = 0; i < 2; i++) refusedWith(await signIn(account, 'not-the-password', code(1)), 'badCredentials');
  for (let i = 0; i < 2; i++)
    refusedWith(
      await enterResult(client, testId, account, { password: 'not-the-password', code: code(1) }),
      'badCredentials',
    );
  refusedWith(await signIn(account, account.password, wrong), 'badCredentials');
  const kinds = (await eventsOf(account.id)).map((event) => event.kind);
  assert.deepEqual(kinds.slice(-2), ['SignInFailed', 'Lockout']);
  assert.equal(kinds.filter((kind) => kind === 'Lockout').length, 1);

  assert.equal(refusedWith(await signIn(account, 'not-the-password', code(1)), 'badCredentials'), NOT_VALID);
  assert.equal(refusedWith(await signIn(account, account.password, wrong), 'badCredentials'), NOT_VALID);
  assert.equal(
    refusedWith(await signIn(account, account.password, code(1)), 'accountLocked'),
    'This account is locked.',
  );
});
