// Test-plan A3: capture is complete.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAudited } from '../src/audited.ts';
import { COMPANY_LEDGER } from '../src/ledgers.ts';
import { seedFixture, type Fixture } from '../src/testing/fixture.ts';
import { testDatabase, type TestDb } from '../src/testing/harness.ts';
import { installWidget, newWidget, widgets, committed } from './support.ts';

let db: TestDb;
let fx: Fixture;

beforeAll(async () => {
  db = await testDatabase();
  fx = await seedFixture(db.app);
  await installWidget(db);
});
afterAll(() => db.close());

const companyEntries = () =>
  db.app.selectFrom('audit_entry').selectAll().where('ledger_id', '=', COMPANY_LEDGER).orderBy('seq').execute();

describe('capture', () => {
  it('one UPDATE of two columns writes exactly one entry with both [old, new] pairs, the release, the session and a DB-clock time', async () => {
    const before = await companyEntries();
    const started = new Date();
    const out = await runAudited(db.app, fx.ctx(fx.adam, 'Admin', { action: 'person.rename', reason: { kind: 'picklist', code: 'transcription-error' } }), { kind: 'company' }, async (tx) => {
      await tx.db.updateTable('person').set({ printed_name: 'Ann Analyste', native_name: '安' }).where('id', '=', fx.ann.id).execute();
      return { commit: tx.dbNow };
    });
    const after = await companyEntries();
    expect(after.length).toBe(before.length + 1);
    const e = after.at(-1)!;
    expect(e.changes).toEqual({ printed_name: ['Ann Analyst', 'Ann Analyste'], native_name: [null, '安'] });
    expect(e.table_name).toBe('person');
    expect(JSON.parse(e.row_pk)).toEqual([fx.ann.id]);
    expect(e.op).toBe('update');
    expect(e.action).toBe('person.rename');
    expect(e.reason_code).toBe('transcription-error');
    expect(e.app_release).toBe('test');
    expect(e.session_id).toBe(fx.adam.session);
    expect(e.person_id).toBe(fx.adam.id);
    expect(e.role).toBe('Admin');
    expect(e.at.getTime()).toBeGreaterThanOrEqual(committed(out).getTime());
    expect(e.at.getTime()).toBeGreaterThanOrEqual(started.getTime() - 1000);
    expect(e.at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('a no-op UPDATE writes nothing', async () => {
    const before = await companyEntries();
    await runAudited(db.app, fx.ctx(fx.adam, 'Admin', { reason: { kind: 'picklist', code: 'transcription-error' } }), { kind: 'company' }, async (tx) => {
      await tx.db.updateTable('person').set({ printed_name: 'Ann Analyste' }).where('id', '=', fx.ann.id).execute();
      return { commit: null };
    });
    expect(await companyEntries()).toEqual(before);
  });

  it('LA007: an UPDATE under a first_save reason is refused', async () => {
    await expect(
      runAudited(db.app, fx.ctx(fx.adam, 'Admin'), { kind: 'company' }, async (tx) => {
        await tx.db.updateTable('person').set({ printed_name: 'Ann' }).where('id', '=', fx.ann.id).execute();
        return { commit: null };
      }),
    ).rejects.toMatchObject({ code: 'LA007' });
  });

  it('a Lab row lands on the Lab chain with its composite key and its record id', async () => {
    const out = await runAudited(db.app, fx.ctx(fx.ann, 'Analyst', { action: 'widget.create' }), { kind: 'lab', labId: fx.labA }, async (tx) => ({
      commit: await newWidget(tx, fx.labA, 'W1'),
    }));
    const id = committed(out);
    const entries = await db.app.selectFrom('audit_entry').selectAll().where('ledger_id', '=', fx.labA).orderBy('seq').execute();
    expect(entries.map((e) => [e.table_name, e.op, e.record_id, JSON.parse(e.row_pk)])).toEqual([
      ['record', 'insert', id, [id]],
      ['widget', 'insert', id, [fx.labA, id]],
    ]);
    expect(entries[1]!.changes).toMatchObject({ name: [null, 'W1'], state: [null, 'Open'] });
  });

  it('redacted columns show [changed] in the trail', async () => {
    await runAudited(db.app, fx.ctx(fx.adam, 'Admin', { reason: { kind: 'action' } }), { kind: 'company' }, async (tx) => {
      await tx.db.updateTable('account').set({ password_hash: 'argon2id$new' }).where('person_id', '=', fx.ann.id).execute();
      return { commit: null };
    });
    const e = (await companyEntries()).at(-1)!;
    expect(e.table_name).toBe('account');
    expect(e.changes).toEqual({ password_hash: ['[changed]', '[changed]'] });
  });

  it('a head table refuses an in-place change to an identity column and allows a lifecycle column', async () => {
    const out = await runAudited(db.app, fx.ctx(fx.ann, 'Analyst'), { kind: 'lab', labId: fx.labA }, async (tx) => ({ commit: await newWidget(tx, fx.labA, 'W2') }));
    const id = committed(out);
    const change = (set: Partial<{ name: string; state: string }>) =>
      runAudited(db.app, fx.ctx(fx.ann, 'Analyst', { reason: { kind: 'action' } }), { kind: 'lab', labId: fx.labA }, async (tx) => {
        await widgets(tx).updateTable('widget').set(set).where('id', '=', id).execute();
        return { commit: null };
      });
    await expect(change({ name: 'renamed' })).rejects.toMatchObject({ code: 'LR002' });
    await change({ state: 'Assigned' });
    const row = await db.superuser.query<{ name: string; state: string }>('select name, state from lims.widget where id = $1', [id]);
    expect(row.rows[0]).toEqual({ name: 'W2', state: 'Assigned' });
  });
});
