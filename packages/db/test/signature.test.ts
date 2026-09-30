// Test-plan A5: the signature binds to stored bytes.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextRow, runAudited } from '../src/audited.ts';
import { seal, sign, type Sealed } from '../src/doors.ts';
import { ledgerOf } from '../src/ledgers.ts';
import type { RecordId, Sha256Hex } from '@lims/domain/ids';
import { seedFixture, type Fixture } from '../src/testing/fixture.ts';
import { testDatabase, type TestDb } from '../src/testing/harness.ts';
import { bodyBytes, expectSqlState, installWidget, newWidget, committed } from './support.ts';

let db: TestDb;
let fx: Fixture;
let widget: RecordId;
let v1: Sealed;

beforeAll(async () => {
  db = await testDatabase();
  fx = await seedFixture(db.app);
  await installWidget(db);
  const out = await runAudited(db.app, fx.ctx(fx.ann, 'Analyst'), { kind: 'lab', labId: fx.labA }, async (tx) => {
    widget = await newWidget(tx, fx.labA, 'W');
    return { commit: await seal(tx, widget, bodyBytes({ kind: 'widget', name: 'W' }), 'widget@1') };
  });
  v1 = committed(out);
});
afterAll(() => db.close());

const signAs = (who: Fixture['ann'], role: string, signer: Fixture['ann'], hash: Sha256Hex) =>
  runAudited(db.app, fx.ctx(who, role), { kind: 'lab', labId: fx.labA }, async (tx) => ({
    commit: await sign(tx, { signer: signer.id, target: { versionId: v1.versionId, hash }, meaning: 'Performed', authenticator: 'totp', group: randomUUID() }),
  }));

describe('signature binding', () => {
  it('a signature whose content_hash differs from the stored hash fails on the foreign key', async () => {
    const wrong = v1.hash.replace(/^../, v1.hash.startsWith('00') ? 'ff' : '00') as Sha256Hex;
    await expectSqlState(signAs(fx.ann, 'Analyst', fx.ann, wrong), '23503');
  });

  it('the same signature with the stored hash is accepted and carries the context\'s role, session and release', async () => {
    committed(await signAs(fx.ann, 'Analyst', fx.ann, v1.hash));
    const row = await db.app.selectFrom('signature').selectAll().where('record_version_id', '=', v1.versionId).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ meaning: 'Performed', signer_person_id: fx.ann.id, username: 'ann', printed_name: 'Ann Analyst',
      role: 'Analyst', signer_lab_id: fx.labA, session_id: fx.ann.session, app_release: 'test', authenticator: 'totp' });
    expect(row.content_hash.toString('hex')).toBe(v1.hash);
  });

  it('LS000: a signature whose signer is not the audit context\'s person is refused', async () => {
    await expectSqlState(signAs(fx.bob, 'Reviewer', fx.ann, v1.hash), 'LS000');
  });

  it('a version\'s created_by is the context\'s person whatever the app passed', async () => {
    const seen = await runAudited(db.app, fx.ctx(fx.bob, 'Reviewer'), { kind: 'lab', labId: fx.labA }, async (tx) => ({
      commit: await seal(tx, widget, bodyBytes({ kind: 'widget', name: 'W', note: 'second' }), 'widget@1'),
    }));
    const v2 = committed(seen);
    const row = await db.app.selectFrom('record_version').select(['created_by', 'app_release', 'version_no']).where('id', '=', v2.versionId).executeTakeFirstOrThrow();
    expect(row).toEqual({ created_by: fx.bob.id, app_release: 'test', version_no: 2 });

    const c = await db.superuser.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('lims.ctx', $1, true)`, [JSON.stringify(contextRow(fx.ctx(fx.ann, 'Analyst')))]);
      const direct = await c.query<{ created_by: string; app_release: string }>(
        `insert into lims.record_version (ledger_id, id, record_id, version_no, content, content_schema, created_by, app_release)
         values ($1, gen_random_uuid(), $2, 3, 'x'::bytea, 'widget@1', $3, 'forged') returning created_by, app_release`,
        [ledgerOf(fx.labA), widget, fx.eve.id]);
      expect(direct.rows[0]).toEqual({ created_by: fx.ann.id, app_release: 'test' });
      await c.query('rollback');
    } finally {
      c.release();
    }
  });

  it('sealing identical bytes reuses the latest version instead of making a new one', async () => {
    const again = await runAudited(db.app, fx.ctx(fx.bob, 'Reviewer'), { kind: 'lab', labId: fx.labA }, async (tx) => ({
      commit: await seal(tx, widget, bodyBytes({ kind: 'widget', name: 'W', note: 'second' }), 'widget@1'),
    }));
    expect(committed(again)).toMatchObject({ versionNo: 2, reused: true });
  });

  it('LS003: a meaning the record kind does not carry is refused', async () => {
    await expectSqlState(
      runAudited(db.app, fx.ctx(fx.cid, 'QA'), { kind: 'lab', labId: fx.labA }, async (tx) => ({
        commit: await sign(tx, { signer: fx.cid.id, target: v1, meaning: 'Acknowledged', authenticator: 'totp', group: randomUUID() }),
      })),
      'LS003',
    );
  });
});
