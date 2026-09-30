// Test-plan C14: every commit happens once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CredentialsSchema } from '@lims/contract';
import { defineCommand } from '../src/doors.ts';
import { reauthenticate } from '../src/identity/reauth.ts';
import { credentials, login, testApi, type Client, type TestApi } from '../src/testing/harness.ts';
import { cast, createWidget, installWidget, newWidget, note, recordWeight, widgetKind, type People } from './support.ts';

/** Re-authenticates, then fails with a bug: an error no refusal maps. */
const reauthThenBug = defineCommand({
  name: 'test.reauthThenBug',
  input: CredentialsSchema,
  acting: { as: 'session' },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx, creds) => {
    if (tx.actor.kind !== 'staff') throw new Error('acts in a Lab session');
    const signer = await reauthenticate(tx, tx.actor, 'Analyst', creds, 'signing');
    if ('kind' in signer) return signer;
    throw new Error('a bug after re-authentication');
  },
});

let api: TestApi;
let people: People;
let ann: Client;

beforeAll(async () => {
  api = await testApi({ kinds: [widgetKind], commands: [createWidget, note, reauthThenBug] });
  await installWidget(api);
  people = await cast(api);
  ann = await login(api, people.ann);
});
afterAll(() => api.close());

const notes = (text: string) => api.db.app.selectFrom('spec_gap').select('id').where('feature', '=', text).execute();
const failures = async (person: string) =>
  Number((await api.db.app.selectFrom('lockout_state').select('consecutive_failures').where('person_id', '=', person).executeTakeFirstOrThrow()).consecutive_failures);

describe('commit once', () => {
  it('two concurrent requests with one key give one effect; the second waits and returns the first receipt, replayed', async () => {
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([ann.command('test.note', { text: 'twice' }, key), ann.command('test.note', { text: 'twice' }, key)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const replayed = [a, b].filter((r) => r.body['replayed'] === true);
    expect(replayed).toHaveLength(1);
    expect(a.body['summary']).toBe(b.body['summary']);
    expect(a.body['at']).toBe(b.body['at']);
    expect(await notes('twice')).toHaveLength(1);
  });

  it('the same key with a different input is commit-key-reused, and nothing runs', async () => {
    const key = crypto.randomUUID();
    expect((await ann.command('test.note', { text: 'first' }, key)).status).toBe(200);
    const r = await ann.command('test.note', { text: 'second' }, key);
    expect(r.status).toBe(409);
    expect((r.body as { refusal: { kind: string } }).refusal.kind).toBe('commit-key-reused');
    expect(await notes('second')).toHaveLength(0);
  });

  it('a refused signing retried with its key returns the same refusal, and the failure count moves by one, not two', async () => {
    const widget = await newWidget(ann, 'W-refused');
    const v = await recordWeight(ann, widget, '1.5');
    const bob = await login(api, people.bob);
    const key = crypto.randomUUID();
    const input = { meaning: 'Verified', role: 'Reviewer', targets: [{ versionId: v.version.versionId, hash: v.version.hash }], attestation: null,
      credentials: { typedUserId: 'bob', password: 'wrong-password', totp: '000000' } };
    const before = await failures(people.bob.id);
    const first = await bob.command('signing.sign', input, key);
    expect(first.status).toBe(401);
    expect((first.body as { refusal: { kind: string; attemptsLeft: number } }).refusal).toMatchObject({ kind: 'credentials', attemptsLeft: 5 - before - 1 });
    const retry = await bob.command('signing.sign', input, key);
    expect(retry.body).toEqual({ ...first.body, replayed: true });
    expect(await failures(people.bob.id)).toBe(before + 1);
    expect(await api.db.app.selectFrom('signature').select('id').where('record_version_id', '=', v.version.versionId).execute()).toEqual([]);
  });

  it('the same key with a retyped password is a fresh attempt, not the old refusal (a refusal never consumes the key)', async () => {
    const widget = await newWidget(ann, 'W-retyped');
    const v = await recordWeight(ann, widget, '2.5');
    const bob = await login(api, people.bob);
    const key = crypto.randomUUID();
    const wrong = { meaning: 'Verified', role: 'Reviewer', targets: [{ versionId: v.version.versionId, hash: v.version.hash }], attestation: null,
      credentials: { typedUserId: 'bob', password: 'wrong-password', totp: '000000' } };
    expect((await bob.command('signing.sign', wrong, key)).status).toBe(401);
    const right = { ...wrong, credentials: await credentials(people.bob) };
    const r = await bob.command('signing.sign', right, key);
    expect(r.status).toBe(200);
    expect(r.body['act']).toBe('signed');
    expect(await api.db.app.selectFrom('signature').select('meaning').where('record_version_id', '=', v.version.versionId).execute()).toEqual([{ meaning: 'Verified' }]);
    const again = await bob.command('signing.sign', right, key);
    expect(again.body['replayed']).toBe(true);
  });

  it('a crash between the command\'s writes and COMMIT leaves no outcome; the retry with the same key runs once and succeeds', async () => {
    const key = crypto.randomUUID();
    const crashed = await ann.command('test.note', { text: 'crash', crash: true }, key);
    expect(crashed.status).toBe(500);
    expect(await notes('crash')).toHaveLength(0);
    expect(await api.db.app.selectFrom('commit_outcome').select('outcome').where('commit_key', '=', key).execute()).toEqual([]);
    const retry = await ann.command('test.note', { text: 'crash' }, key);
    expect(retry.status).toBe(200);
    expect(retry.body['replayed']).toBeUndefined();
    expect(await notes('crash')).toHaveLength(1);
  });

  it('a bug after re-authentication rolls the effect back but keeps the TOTP step used, so the code cannot be replayed', async () => {
    const typed = await credentials(people.ann);
    expect((await ann.command('test.reauthThenBug', typed)).status).toBe(500);
    const replay = await ann.command('test.reauthThenBug', typed);
    expect(replay.status).toBe(409);
    expect((replay.body as { refusal: { kind: string } }).refusal.kind).toBe('totp-already-used');
  });

  it('a not-built refusal rolls its effect back and keeps one spec_gap row', async () => {
    const r = await ann.command('test.note', { text: 'gap', notBuilt: true });
    expect(r.status).toBe(409);
    expect((r.body as { refusal: { message: string } }).refusal.message).toMatch(/not built in the skeleton/);
    expect(await notes('gap')).toHaveLength(0);
    const gaps = await api.db.app.selectFrom('spec_gap').select(['feature', 'command']).where('command', '=', 'test.note').where('feature', '=', 'import').execute();
    expect(gaps).toEqual([{ feature: 'import', command: 'test.note' }]);
  });

  it('a command the actor may not run is refused before any transaction opens', async () => {
    const r = await ann.command('authorisation.grant', { personId: people.bob.id, meaning: 'Performed', scope: 'x', validFrom: '2026-01-01', validUntil: '2027-01-01' });
    expect(r.status).toBe(403);
    expect((r.body as { refusal: { message: string } }).refusal.message).toMatch(/needs the QA role/);
  });
});
