// Test-plan C15: GET never writes, and only the two doors and the fixed endpoints exist.
// Plus decision 23 rule 2: no endpoint returns a password, a TOTP secret or a current code.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openRead, type LabRead } from '@lims/db';
import { defineView } from '../src/doors.ts';
import { testApi, login, type TestApi } from '../src/testing/harness.ts';
import { cast, createWidget, installWidget, newWidget, note, recordWeight, widgetKind, type People } from './support.ts';

let api: TestApi;
let people: People;
let widget: string;
let valueVersion: string;

/** A View body that tries to write: the READ ONLY transaction must refuse it (25006). */
const writingView = defineView({
  name: 'test.writing',
  input: z.object({}),
  scope: 'lab',
  read: async (q) => {
    await (q as unknown as { updateTable: (t: string) => { set: (v: object) => { execute: () => Promise<unknown> } } })
      .updateTable('session_activity').set({ last_activity_at: new Date() }).execute();
    return {};
  },
});

beforeAll(async () => {
  api = await testApi({ kinds: [widgetKind], commands: [createWidget, note], views: [writingView] });
  await installWidget(api);
  people = await cast(api);
  const ann = await login(api, people.ann);
  widget = await newWidget(ann, 'W1');
  valueVersion = (await recordWeight(ann, widget, '100.12')).version.versionId;
});
afterAll(() => api.close());

describe('the routes', () => {
  it('every non-GET route is a command door or a fixed endpoint, and every GET is a view door or a fixed endpoint', () => {
    const routes = api.routes.filter((r) => r.method !== 'HEAD').map((r) => `${r.method} ${r.url}`);
    const fixed = ['GET /api/session', 'POST /api/session/activity', 'GET /files/:token'];
    const stray = routes.filter((r) => !fixed.includes(r) && r !== 'GET /api/views/:name' && r !== 'POST /api/commands/:name');
    expect(stray).toEqual([]);
    expect(routes).toContain('POST /api/commands/:name');
    expect(routes).toContain('GET /api/views/:name');
  });

  it('a command without the X-LIMS-Command header is refused before anything is read', async () => {
    const r = await api.client().command('session.login', {}, undefined, {});
    expect(r.status).toBe(403);
  });

  it('an unknown command or view is 404, a malformed envelope 400', async () => {
    const tab = await login(api, people.ann);
    expect((await tab.command('no.such', {})).status).toBe(404);
    expect((await tab.view('no.such')).status).toBe(404);
    expect((await tab.raw({ method: 'POST', url: '/api/commands/session.lock', headers: { 'x-lims-command': '1' }, payload: { nope: 1 } })).status).toBe(400);
    expect((await tab.view('record.audit', { recordId: 'not-a-uuid' })).status).toBe(400);
  });
});

describe('GET never writes', () => {
  it('a View body that tries an UPDATE fails with 25006 inside its READ ONLY transaction', async () => {
    const tab = await login(api, people.ann);
    const r = await tab.view('test.writing');
    expect(r.status).toBe(500);
    await expect(openRead(api.db.app, { kind: 'lab', labId: people.lab.id as never }, (q) => writingView.read(q as LabRead, {}, undefined as never, api.deps.kinds)))
      .rejects.toMatchObject({ code: '25006' });
  });

  it('every registered View runs over the door with no row inserted, updated or deleted', async () => {
    const inputs: Record<string, Record<string, string>> = {
      'record.audit': { recordId: widget },
      'record.values': { parent: widget },
      'signing.standing': { versionId: valueVersion },
      'test.writing': {},
      'admin.labs': {},
    };
    const missing = api.views.map((v) => v.name).filter((n) => !(n in inputs));
    expect(missing, 'every view needs an input in this test').toEqual([]);
    const tab = await login(api, people.ann);
    const admin = await login(api, people.admin);
    const before = await tableState();
    for (const view of api.views.filter((v) => v.name !== 'test.writing')) {
      const r = await (view.scope === 'company' ? admin : tab).view(view.name, inputs[view.name]);
      expect(r.status, view.name).toBe(200);
    }
    expect(await tableState(), 'every lims table, unchanged').toEqual(before);
  });

  it('GET /api/session does not move the idle timer', async () => {
    const tab = await login(api, people.bob);
    const before = await tab.session();
    await tab.session();
    await tab.view('record.audit', { recordId: widget });
    const after = await tab.session();
    expect(after.body['idleLockAt']).toBe(before.body['idleLockAt']);
  });
});

describe('no endpoint returns a secret', () => {
  it('the session, a view, a signing prompt and a refusal carry no password, TOTP secret or current code', async () => {
    const tab = await login(api, people.bob);
    const secret = people.bob.auth.secret;
    const password = people.bob.password;
    const seen: string[] = [];
    seen.push(JSON.stringify((await tab.session()).body));
    seen.push(JSON.stringify((await tab.view('record.audit', { recordId: widget })).body));
    seen.push(JSON.stringify((await tab.command('signing.prepare', { meaning: 'Verified', role: 'Reviewer', targets: [(await recordValueFor()).value], attestation: null })).body));
    seen.push(JSON.stringify((await tab.command('signing.sign', {
      meaning: 'Verified', role: 'Reviewer', targets: [{ versionId: valueVersion, hash: '0'.repeat(64) }], attestation: null,
      credentials: { typedUserId: 'bob', password, totp: '000000' },
    })).body));
    const hashRows = await api.db.app.selectFrom('account').select('password_hash').where('username', '=', 'bob').executeTakeFirstOrThrow();
    for (const s of seen) {
      expect(s).not.toContain(secret);
      expect(s).not.toContain(password);
      expect(s).not.toContain(hashRows.password_hash);
      expect(s).not.toMatch(/"totp"|"password"|"secret"/);
    }
  });
});

/** Every lims table's row count and its newest tuple: an insert or update moves the newest, a delete the count. */
async function tableState(): Promise<Record<string, [number, number]>> {
  const tables = await api.db.superuser.query<{ t: string }>(`select tablename as t from pg_tables where schemaname = 'lims' order by 1`);
  const out: Record<string, [number, number]> = {};
  for (const { t } of tables.rows) {
    const r = await api.db.superuser.query<{ n: string; newest: string }>(`select count(*)::text as n, coalesce(max(xmin::text::bigint), 0)::text as newest from lims.${t}`);
    out[t] = [Number(r.rows[0]!.n), Number(r.rows[0]!.newest)];
  }
  return out;
}

async function recordValueFor() {
  const ann = await login(api, people.ann);
  return recordWeight(ann, widget, '5.5', 'P9');
}
