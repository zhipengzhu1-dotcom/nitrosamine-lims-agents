// Test-plan C17: signing refusals. Plus the Recorded Value path the sample chain builds on:
// record, Verified group signing, a Critical Data Change approved or turned down, and "UNSIGNED,
// changed after signature" when a child value is added under a sealed record.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { credentials, login, signAs, testApi, type Client, type TestApi } from '../src/testing/harness.ts';
import { cast, createWidget, installWidget, newWidget, recordWeight, widgetKind, type People } from './support.ts';

let api: TestApi;
let people: People;
let ann: Client;
let bob: Client;

beforeAll(async () => {
  api = await testApi({ kinds: [widgetKind], commands: [createWidget] });
  await installWidget(api);
  people = await cast(api);
  ann = await login(api, people.ann);
  bob = await login(api, people.bob);
});
afterAll(() => api.close());

const failures = async (person: string) =>
  Number((await api.db.app.selectFrom('lockout_state').select('consecutive_failures').where('person_id', '=', person).executeTakeFirstOrThrow()).consecutive_failures);
const refusalOf = (r: { body: unknown }) => (r.body as { refusal: { kind: string; message: string; attemptsLeft?: number } }).refusal;

describe('signing refusals', () => {
  it('a typed user ID that is not the session\'s is wrong-user, alerted, and moves nobody\'s count', async () => {
    const widget = await newWidget(ann, 'W1');
    const v = await recordWeight(ann, widget, '100.12');
    const [annBefore, bobBefore] = [await failures(people.ann.id), await failures(people.bob.id)];
    const r = await bob.command('signing.sign', {
      meaning: 'Verified', role: 'Reviewer', targets: [v.version], attestation: null,
      credentials: { typedUserId: 'ann', password: people.ann.password, totp: '123456' },
    });
    expect(r.status).toBe(403);
    expect(refusalOf(r).kind).toBe('wrong-user');
    expect(await failures(people.ann.id)).toBe(annBefore);
    expect(await failures(people.bob.id)).toBe(bobBefore);
    const alerts = await api.db.app.selectFrom('alert').select(['kind', 'person_id', 'detail']).where('kind', '=', 'wrong-user-at-signing').execute();
    expect(alerts).toEqual([{ kind: 'wrong-user-at-signing', person_id: people.bob.id, detail: { typedUser: 'ann', purpose: 'signing' } }]);
    const events = await api.db.app.selectFrom('auth_event').select('counts_toward_lockout').where('kind', '=', 'wrong_user_at_signing').execute();
    expect(events).toEqual([{ counts_toward_lockout: false }]);
  });

  it('a reused TOTP step is "Wait for the next code"', async () => {
    const widget = await newWidget(ann, 'W2');
    const v = await recordWeight(ann, widget, '3.3');
    const r = await bob.command('signing.sign', {
      meaning: 'Verified', role: 'Reviewer', targets: [v.version], attestation: null,
      credentials: { typedUserId: 'bob', password: people.bob.password, totp: people.bob.auth.used() },
    });
    expect(r.status).toBe(409);
    expect(refusalOf(r).message).toBe('Wait for the next code.');
  });

  it('five failures mixing login and signing lock the account and write an alert', async () => {
    const widget = await newWidget(ann, 'W3');
    const v = await recordWeight(ann, widget, '4.4');
    const eve = await login(api, people.eve);
    const badSign = () => eve.command('signing.sign', {
      meaning: 'Verified', role: 'Analyst', targets: [v.version], attestation: null,
      credentials: { typedUserId: 'eve', password: 'wrong', totp: '000000' },
    });
    const badLogin = () => api.client().command('session.login', { typedUserId: 'eve', password: 'wrong', totp: '000000', workstation: 'bench-2' });
    expect(refusalOf(await badSign()).attemptsLeft).toBe(4);
    expect(refusalOf(await badLogin()).attemptsLeft).toBe(3);
    expect(refusalOf(await badSign()).attemptsLeft).toBe(2);
    expect(refusalOf(await badLogin()).attemptsLeft).toBe(1);
    const fifth = await badSign();
    expect(fifth.status).toBe(423);
    expect(refusalOf(fifth).kind).toBe('locked-out');
    expect(await api.db.app.selectFrom('alert').select('kind').where('person_id', '=', people.eve.id).execute()).toEqual([{ kind: 'lockout' }]);
    const right = await eve.command('signing.sign', { meaning: 'Verified', role: 'Analyst', targets: [v.version], attestation: null, credentials: await credentials(people.eve) });
    expect(right.status).toBe(423);
  });

  it('a hash the prompt showed that is no longer the version to sign is stale-version', async () => {
    const widget = await newWidget(ann, 'W4');
    const v1 = await recordWeight(ann, widget, '5.5');
    const prepared = await bob.command('signing.prepare', { meaning: 'Verified', role: 'Reviewer', targets: [v1.value], attestation: null });
    expect(prepared.status).toBe(200);
    const shown = (prepared.body as { data: { items: { version: { versionId: string; hash: string } }[] } }).data.items[0]!.version;
    expect(shown.versionId).toBe(v1.version.versionId);
    const changed = await bob.command('value.change', { role: 'Reviewer', value: v1.value, to: { type: 'decimal', value: '5.6', unit: 'mg' }, reason: { code: 'transcription-error' } });
    expect(changed.status).toBe(200);
    expect((changed.body as { data: { standing: string } }).data.standing).toBe('pending');
    const dee = await login(api, people.dee);
    const r = await dee.command('signing.sign', { meaning: 'Verified', role: 'Analyst', targets: [shown], attestation: null, credentials: await credentials(people.dee) });
    expect(r.status).toBe(409);
    expect(refusalOf(r).kind).toBe('stale-version');
    expect(refusalOf(r).message).toMatch(/changed after this prompt opened/);
  });

  it('Reviewed without its checklist attestation is refused', async () => {
    const widget = await newWidget(ann, 'W5');
    const r = await signAs(bob, people.bob, 'Reviewed', 'Reviewer', [widget], null);
    expect(r.status).toBe(403);
    expect(refusalOf(r).message).toMatch(/needs its Review Checklist/);
  });

  it('the prompt answers eligibility per role before any credential: bob is eligible as Reviewer, ann is not (she typed it)', async () => {
    const widget = await newWidget(ann, 'W6');
    const v = await recordWeight(ann, widget, '6.6');
    const forBob = await bob.command('signing.prepare', { meaning: 'Verified', role: 'Reviewer', targets: [v.value], attestation: null });
    const data = (forBob.body as { data: { statement: string; consequence: string; eligibility: { byRole: { role: string; eligible: boolean; authorisation: unknown }[]; attemptsLeft: number }; items: { version: { hash: string } }[] } }).data;
    expect(data.statement).toBe('I checked this entry against its source and it is correct.');
    expect(data.consequence).toMatch(/Verified/);
    expect(data.items[0]!.version.hash).toMatch(/^[0-9a-f]{64}$/);
    const asReviewer = data.eligibility.byRole.find((r) => r.role === 'Reviewer');
    expect(asReviewer).toMatchObject({ eligible: true, authorisation: { scope: 'METHOD-W', validUntil: '2027-01-01' } });
    expect(['Performed', 'Reviewed']).toContain((asReviewer!.authorisation as { meaning: string }).meaning);
    expect(data.eligibility.attemptsLeft).toBe(5);
    const forAnn = await ann.command('signing.prepare', { meaning: 'Verified', role: 'Analyst', targets: [v.value], attestation: null });
    const annRole = (forAnn.body as { data: { eligibility: { byRole: { role: string; eligible: boolean; reasons: string[] }[] } } }).data.eligibility.byRole[0]!;
    expect(annRole).toMatchObject({ role: 'Analyst', eligible: false });
    expect(annRole.reasons.join(' ')).toMatch(/someone else must verify it/);
  });
});

describe('Recorded Values through the pipeline', () => {
  it('Verified group signing by a second person, then a Critical Data Change: pending until another person approves it, and the standing follows', async () => {
    const widget = await newWidget(ann, 'W7');
    const w1 = await recordWeight(ann, widget, '100.12', 'P1');
    const w2 = await recordWeight(ann, widget, '99.87', 'P2');
    const twice = await ann.command('value.record', { role: 'Analyst', parent: widget, field: 'prep.weight', subject: 'P1', value: { type: 'decimal', value: '1', unit: 'mg' } });
    expect(twice.status).toBe(409);

    const verified = await signAs(bob, people.bob, 'Verified', 'Reviewer', [w1.value, w2.value]);
    expect(verified.status).toBe(200);
    expect((verified.body as { data: { signatures: unknown[] } }).data.signatures).toHaveLength(2);
    const standing = await ann.view('signing.standing', { versionId: w1.version.versionId });
    expect(standing.body).toMatchObject({ kind: 'signed', signatures: [{ meaning: 'Verified', username: 'bob', role: 'Reviewer' }] });

    const proposed = await bob.command('value.change', { role: 'Reviewer', value: w1.value, to: { type: 'decimal', value: '100.21', unit: 'mg' }, reason: { code: 'transcription-error' } });
    const v2 = (proposed.body as { data: { version: { versionId: string; hash: string }; standing: string } }).data;
    expect(v2.standing).toBe('pending');
    const effective = await api.db.app.selectFrom('effective_version').select('version_no').where('record_id', '=', w1.value).executeTakeFirstOrThrow();
    expect(effective.version_no).toBe(1);

    const self = await signAs(bob, people.bob, 'Verified', 'Reviewer', [w1.value]);
    expect(self.status).toBe(409);
    expect(refusalOf(self).message).toMatch(/You proposed the change/);

    const dee = await login(api, people.dee);
    const prepared = await dee.command('signing.prepare', { meaning: 'Verified', role: 'Analyst', targets: [w1.value], attestation: null });
    const item = (prepared.body as { data: { items: { version: { versionId: string }; pendingChanges: { from: { value: { value: string } }; to: { value: { value: string } } }[] }[] } }).data.items[0]!;
    expect(item.version.versionId).toBe(v2.version.versionId);
    expect(item.pendingChanges).toEqual([expect.objectContaining({ from: expect.objectContaining({ value: expect.objectContaining({ value: '100.12' }) }), to: expect.objectContaining({ value: expect.objectContaining({ value: '100.21' }) }) })]);
    const approved = await signAs(dee, people.dee, 'Verified', 'Analyst', [w1.value]);
    expect(approved.status).toBe(200);
    const now = await api.db.app.selectFrom('effective_version').select('version_no').where('record_id', '=', w1.value).executeTakeFirstOrThrow();
    expect(now.version_no).toBe(2);
    const trail = await ann.view('record.audit', { recordId: w1.value });
    const entries = (trail.body as { entries: { reason: string; afterFirstSave: boolean; changes: { field: string }[] }[] }).entries;
    expect(entries.some((e) => e.changes.some((c) => c.field === 'Record Version') && e.reason === 'Transcription error' && e.afterFirstSave)).toBe(true);
  });

  it('a proposal turned down never takes effect', async () => {
    const widget = await newWidget(ann, 'W8');
    const w = await recordWeight(ann, widget, '7.7');
    const proposed = await bob.command('value.change', { role: 'Reviewer', value: w.value, to: { type: 'decimal', value: '7.8', unit: 'mg' }, reason: { code: 'wrong-unit' } });
    const v2 = (proposed.body as { data: { version: { versionId: string; hash: string } } }).data.version;
    const turned = await ann.command('value.reject', { role: 'Analyst', version: v2, reason: { code: 'other', text: 'The printout says 7.7.' } });
    expect(turned.status).toBe(200);
    const effective = await api.db.app.selectFrom('effective_version').select('version_no').where('record_id', '=', w.value).executeTakeFirstOrThrow();
    expect(effective.version_no).toBe(1);
    expect(await api.db.app.selectFrom('pending_version').select('id').where('record_id', '=', w.value).execute()).toEqual([]);
    const again = await ann.command('value.reject', { role: 'Analyst', version: v2, reason: { code: 'other', text: 'again' } });
    expect(refusalOf(again).kind).toBe('stale-version');
  });

  it('a record signed Performed shows changed-after-signature once a value is added under it', async () => {
    const widget = await newWidget(ann, 'W9');
    await recordWeight(ann, widget, '8.8');
    const signed = await signAs(ann, people.ann, 'Performed', 'Analyst', [widget]);
    expect(signed.status).toBe(200);
    const version = (signed.body as { data: { signatures: { version: { versionId: string } }[] } }).data.signatures[0]!.version.versionId;
    expect((await ann.view('signing.standing', { versionId: version })).body).toMatchObject({ kind: 'signed' });
    await recordWeight(ann, widget, '9.9', 'P2');
    const after = await ann.view('signing.standing', { versionId: version });
    expect(after.body).toMatchObject({ kind: 'changed-after-signature', signed: [{ meaning: 'Performed' }] });
    expect((after.body as { because: string[] }).because.join(' ')).toMatch(/child-added|superseded/);
  });

  it('a signing by someone without a current Authorisation is refused with the reason, before credentials', async () => {
    const widget = await newWidget(ann, 'W10');
    const prepared = await ann.command('signing.prepare', { meaning: 'Performed', role: 'Analyst', targets: [widget], attestation: null });
    const qaTab = await login(api, people.qa);
    const forbidden = await qaTab.command('signing.prepare', { meaning: 'Performed', role: 'Analyst', targets: [widget], attestation: null });
    expect(forbidden.status).toBe(403);
    expect(prepared.status).toBe(200);
    void prepared;
  });
});
