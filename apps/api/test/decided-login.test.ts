import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
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
const NOT_VALID = 'The user ID or password is not valid.';

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

it('enrolment shows the secret as text and as a QR payload once; a second enrolment shows none, and one Access Event records it', async () => {
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
  refusedWith(second, 'state');
  assert.equal(JSON.stringify(second.body).includes(first.secret), false);
  refusedWith(
    await client.call(routes.enrolAuthenticator, { username: account.username, password: 'wrong-password' }),
    'badCredentials',
  );
  assert.deepEqual(await eventsOf(account.id), [
    { kind: 'AuthenticatorEnrolled', failureReason: null },
    { kind: 'SignInFailed', failureReason: 'WrongPassword' },
  ]);
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
  const testId = await assignedTo(account);
  for (let i = 0; i < 2; i++) refusedWith(await signIn(account, 'not-the-password', code(1)), 'badCredentials');
  for (let i = 0; i < 2; i++)
    refusedWith(
      await enterResult(client, testId, account, { password: 'not-the-password', code: code(1) }),
      'badCredentials',
    );
  refusedWith(await signIn(account, account.password, '000000'), 'badCredentials');
  const kinds = (await eventsOf(account.id)).map((event) => event.kind);
  assert.deepEqual(kinds.slice(-2), ['SignInFailed', 'Lockout']);
  assert.equal(kinds.filter((kind) => kind === 'Lockout').length, 1);

  assert.equal(refusedWith(await signIn(account, 'not-the-password', code(1)), 'badCredentials'), NOT_VALID);
  assert.equal(refusedWith(await signIn(account, account.password, '000000'), 'badCredentials'), NOT_VALID);
  assert.equal(
    refusedWith(await signIn(account, account.password, code(1)), 'accountLocked'),
    'This account is locked.',
  );
});
