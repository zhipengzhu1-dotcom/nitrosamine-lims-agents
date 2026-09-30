// Test-plan A4: chains under concurrency, and verify_chain after tampering.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAudited } from '../src/audited.ts';
import { verifyChain } from '../src/doors.ts';
import { COMPANY_LEDGER } from '../src/ledgers.ts';
import { seedFixture, type Fixture } from '../src/testing/fixture.ts';
import { testDatabase, type TestDb } from '../src/testing/harness.ts';
import { installWidget, newWidget } from './support.ts';

let db: TestDb;
let fx: Fixture;

beforeAll(async () => {
  db = await testDatabase();
  fx = await seedFixture(db.app);
  await installWidget(db);
});
afterAll(() => db.close());

const sha256 = (...parts: Buffer[]) => createHash('sha256').update(Buffer.concat(parts)).digest();

describe('the hash chains', () => {
  it('50 concurrent audited transactions across two Labs and the company give gapless, linked, time-ordered chains', async () => {
    const jobs = Array.from({ length: 50 }, (_, i) => {
      switch (i % 3) {
        case 0:
          return runAudited(db.app, fx.ctx(fx.ann, 'Analyst'), { kind: 'lab', labId: fx.labA }, async (tx) => ({ commit: await newWidget(tx, fx.labA, `A${i}`) }));
        case 1:
          return runAudited(db.app, fx.ctx(fx.eve, 'Analyst'), { kind: 'lab', labId: fx.labB }, async (tx) => ({ commit: await newWidget(tx, fx.labB, `B${i}`) }));
        default:
          return runAudited(db.app, fx.ctx(fx.adam, 'Admin'), { kind: 'company' }, async (tx) => {
            await tx.db.insertInto('spec_gap').values({ feature: 'f', command: `c${i}`, person_id: fx.adam.id, detail: {} }).execute();
            return { commit: null };
          });
      }
    });
    const settled = await Promise.allSettled(jobs);
    const failures = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected').map((s) => String(s.reason));
    expect(failures).toEqual([]);

    for (const ledger of [fx.labA, fx.labB, COMPANY_LEDGER]) {
      const entries = await db.app.selectFrom('audit_entry').selectAll().where('ledger_id', '=', ledger).orderBy('seq').execute();
      expect(entries.length).toBeGreaterThan(0);
      let running = Buffer.from([0]);
      let lastAt = 0;
      entries.forEach((e, i) => {
        expect(Number(e.seq)).toBe(i + 1);
        expect(e.prev_hash.equals(running), `prev_hash links at seq ${e.seq}`).toBe(true);
        expect(e.entry_hash.equals(sha256(e.entry_bytes))).toBe(true);
        running = sha256(running, e.entry_hash);
        expect(e.at.getTime()).toBeGreaterThanOrEqual(lastAt);
        lastAt = e.at.getTime();
      });
      const head = await db.app.selectFrom('audit_chain_head').selectAll().where('ledger_id', '=', ledger).executeTakeFirstOrThrow();
      expect(Number(head.head_seq)).toBe(entries.length);
      expect(head.head_hash.equals(running)).toBe(true);
      expect(await verifyChain(db.app, ledger)).toEqual({ intactThrough: entries.length, firstBreak: null, headMatches: true });
    }
  });

  it('a superuser edit to one entry_bytes is reported by verify_chain as the first break at that seq', async () => {
    const total = Number((await db.app.selectFrom('audit_chain_head').select('head_seq').where('ledger_id', '=', fx.labA).executeTakeFirstOrThrow()).head_seq);
    const target = Math.floor(total / 2);
    const c = await db.superuser.connect();
    try {
      await c.query('set session_replication_role = replica');
      const r = await c.query(`update lims.audit_entry set entry_bytes = entry_bytes || ' '::bytea where ledger_id = $1 and seq = $2`, [fx.labA, target]);
      expect(r.rowCount).toBe(1);
    } finally {
      c.release();
    }
    expect(await verifyChain(db.app, fx.labA)).toEqual({ intactThrough: target - 1, firstBreak: target, headMatches: false });
    expect(await verifyChain(db.app, fx.labB)).toMatchObject({ firstBreak: null, headMatches: true });
  });
});
