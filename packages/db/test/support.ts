// A minimal signable head, `widget`, stands in for the sample chain's Test and Test Report so the
// core can be proved before those tables exist. Installing it is exactly the plug-in contract:
// one record_kind row, one head table, one register_signable_head call.
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../src/generated.ts';
import type { AuditedTx, TxOutcome } from '../src/audited.ts';
import { seal, type Sealed } from '../src/doors.ts';
import { ledgerOf } from '../src/ledgers.ts';
import type { LabId, PersonId, RecordId, VersionRef } from '@lims/domain/ids';
import { GENERATED_CLASSES, type TableClasses } from '../src/scope.ts';
import { sqlState, type TestDb } from '../src/testing/harness.ts';

export type WidgetRow = { lab_id: string; id: string; name: string; state: string; spec_pin: string | null };
export type TestDB = DB & { widget: WidgetRow };

export const WIDGET_CLASSES: TableClasses = { ...GENERATED_CLASSES, lab: new Set([...GENERATED_CLASSES.lab, 'widget']) };

export async function installWidget(db: TestDb): Promise<void> {
  await db.asOwner(`
    insert into lims.record_kind values ('widget', 'lab', false, array['Performed', 'Reviewed', 'Released']);
    create table lims.widget (
      lab_id   uuid not null references lims.lab (id),
      id       uuid not null,
      name     text not null,
      state    text not null,
      spec_pin uuid,
      primary key (lab_id, id),
      foreign key (lab_id, id) references lims.record (ledger_id, id)
    );
    select lims.register_signable_head('lims.widget', array['state']);
  `);
}

/** The write handle with the test-only table in its type. */
export const widgets = (tx: AuditedTx): Kysely<TestDB> => tx.db as unknown as Kysely<TestDB>;

export async function newWidget(tx: AuditedTx, lab: LabId, name: string): Promise<RecordId> {
  const id = randomUUID() as RecordId;
  await tx.db.insertInto('record').values({ ledger_id: ledgerOf(lab), id, kind: 'widget' }).execute();
  await widgets(tx).insertInto('widget').values({ lab_id: lab, id, name, state: 'Open' }).execute();
  return id;
}

/** Canonical bytes for a value body; hashes of cited versions appear in the text as the seal checks. */
export function bodyBytes(body: Record<string, unknown>, cites: readonly VersionRef[] = []): Uint8Array {
  const withCites = cites.length ? { ...body, cites: cites.map((c) => ({ versionId: c.versionId, hash: c.hash })) } : body;
  return new TextEncoder().encode(JSON.stringify(withCites));
}

export async function newValue(
  tx: AuditedTx,
  lab: LabId,
  parent: RecordId,
  field: string,
  critical: boolean,
  text: string,
): Promise<{ record: RecordId; v1: Sealed }> {
  const id = randomUUID() as RecordId;
  const ledger = ledgerOf(lab);
  await tx.db.insertInto('record').values({ ledger_id: ledger, id, kind: 'value', parent_id: parent }).execute();
  await tx.db.insertInto('recorded_value').values({ ledger_id: ledger, record_id: id, parent_id: parent, field, critical, value_type: 'decimal', unit: 'mg' }).execute();
  const v1 = await recordValue(tx, lab, id, text);
  return { record: id, v1 };
}

export async function recordValue(tx: AuditedTx, lab: LabId, record: RecordId, text: string): Promise<Sealed> {
  const v = await seal(tx, record, bodyBytes({ type: 'decimal', value: text, unit: 'mg' }), 'value@1');
  if (!v.reused) {
    await tx.db.insertInto('recorded_value_version').values({ ledger_id: ledgerOf(lab), version_id: v.versionId, value_text: text, decimals: text.split('.')[1]?.length ?? 0 }).execute();
  }
  return v;
}

let step = 1_000_000;

/** The re-authentication a signing needs: one TOTP step consumed for the signer in this commit. */
export async function reauth(tx: AuditedTx, person: PersonId, purpose = 'signing'): Promise<void> {
  await tx.db.insertInto('totp_step_used').values({ person_id: person, step: ++step, purpose }).execute();
}

/** The committed value of an audited transaction; a rollback is a test failure. */
export function committed<T>(out: TxOutcome<T>): T {
  if (!('commit' in out)) throw new Error('transaction rolled back');
  return out.commit;
}

export async function expectSqlState(p: Promise<unknown>, code: string): Promise<Error> {
  let thrown: unknown = null;
  try {
    await p;
  } catch (e) {
    thrown = e;
  }
  expect(thrown, `expected SQLSTATE ${code}, nothing was thrown`).not.toBeNull();
  expect(sqlState(thrown), `expected SQLSTATE ${code}, got: ${(thrown as Error).message}`).toBe(code);
  return thrown as Error;
}

/** A write as lims_app under a hand-built lims.ctx, the way a buggy or hostile app could set it. */
export async function withRawContext<T>(db: Kysely<DB>, ctx: Record<string, unknown> | null, fn: (trx: Kysely<DB>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    if (ctx) await sql`select set_config('lims.ctx', ${JSON.stringify(ctx)}, true)`.execute(trx);
    return fn(trx);
  });
}
