// A minimal signable head, `widget`, stands in for the sample chain's Test so the API core can be
// proved before those tables exist. Installing it is exactly the plug-in contract the next unit
// follows: one record_kind row, one head table, one register_signable_head call, one KindDef,
// and commands that create the head and act on it.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ledgerOf } from '@lims/db';
import { cite, type VersionBody } from '@lims/domain/canonical';
import type { RecordId, VersionRef } from '@lims/domain/ids';
import { refuse } from '@lims/domain/refusal';
import { receipt } from '../src/commit.ts';
import { defineCommand } from '../src/doors.ts';
import { gateOf, type KindDef } from '../src/records/kinds.ts';
import { authorisationStanding } from '../src/records/facts.ts';
import { enrol, login, signAs, type Client, type Person, type TestApi } from '../src/testing/harness.ts';
import { ENABLEMENT_DOCUMENTS } from '../src/records/facts.ts';

export const WIDGET_SCOPE = 'METHOD-W';

export const widgetKind: KindDef = {
  kind: 'widget',
  fields: {
    'prep.weight': { writer: 'unrestricted', label: 'weight', critical: true, type: 'decimal', unit: 'mg', subject: 'preparation', verifiedEach: true },
    'run.sequence': { writer: 'unrestricted', label: 'sequence ID', critical: false, type: 'text', subject: 'none', verifiedEach: true },
  },
  label: async (q, record) => {
    const w = await q.selectFrom('widget' as never).select('name' as never).where('id' as never, '=', record as never).executeTakeFirstOrThrow() as { name: string };
    return `Widget ${w.name}`;
  },
  authorisationScope: async () => WIDGET_SCOPE,
  content: async (q, record) => {
    const values = await q.selectFrom('recorded_value').innerJoin('effective_version', 'effective_version.record_id', 'recorded_value.record_id')
      .select(['recorded_value.field', 'recorded_value.subject', 'effective_version.id', 'effective_version.content_hash'])
      .where('recorded_value.parent_id', '=', record).orderBy('recorded_value.field').execute();
    const cites: VersionRef[] = values.map((v) => ({ versionId: v.id as never, hash: (v.content_hash as Buffer).toString('hex') as never }));
    const body: VersionBody<'widget@1'> = {
      schema: 'widget@1',
      widget: record,
      values: values.map((v, i) => ({ field: v.field, subject: v.subject, version: cite(cites[i]!) })),
    };
    return { body, cites };
  },
  signing: {
    Performed: {
      consequence: 'The widget is Performed.',
      check: async (ctx, signer) => {
        const a = await authorisationStanding(ctx.q, signer.person, 'Performed', WIDGET_SCOPE, ctx.lab, ctx.dbNow);
        return gateOf(a.kind === 'current' ? [] : [{ code: 'authorisation', standings: [a as never] }]);
      },
    },
    Reviewed: { consequence: 'The widget is Reviewed.', check: async () => gateOf([]) },
  },
};

export const createWidget = defineCommand({
  name: 'widget.create',
  input: z.object({ name: z.string().min(1), role: z.string().min(1) }),
  acting: { as: 'role-from-input', role: (i) => i.role },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const a = tx.actor;
    const lab = a.kind === 'staff' ? a.lab : null;
    if (!lab) return { kind: 'not-permitted', message: 'A widget lives in a Lab.' };
    const id = randomUUID() as RecordId;
    await tx.db.insertInto('record').values({ ledger_id: ledgerOf(lab), id, kind: 'widget' }).execute();
    await (tx.db as never as { insertInto: (t: string) => { values: (v: object) => { execute: () => Promise<unknown> } } })
      .insertInto('widget').values({ lab_id: lab, id, name: input.name, state: 'Open' }).execute();
    return receipt(`Created widget ${input.name}.`, 'audited', { widgetId: id });
  },
});

/** A command for the pipeline tests: one audited row, then optionally a crash or a not-built refusal. */
export const note = defineCommand({
  name: 'test.note',
  input: z.object({ text: z.string(), crash: z.boolean().default(false), notBuilt: z.boolean().default(false) }),
  acting: { as: 'session' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const a = tx.actor;
    if (a.kind === 'nobody' || a.kind === 'locked') throw new Error('note acts in a session');
    await tx.db.insertInto('spec_gap').values({ feature: input.text, command: 'test.note', person_id: a.person, detail: {} }).execute();
    if (input.crash) throw new Error('simulated crash between the writes and COMMIT');
    if (input.notBuilt) return refuse.notBuilt('import');
    return receipt(`Noted ${input.text}.`, 'audited', { text: input.text });
  },
});

export async function installWidget(api: TestApi): Promise<void> {
  await api.db.asOwner(`
    insert into lims.record_kind values ('widget', 'lab', false, array['Performed', 'Reviewed']);
    create table lims.widget (
      lab_id uuid not null references lims.lab (id),
      id     uuid not null,
      name   text not null,
      state  text not null,
      primary key (lab_id, id),
      foreign key (lab_id, id) references lims.record (ledger_id, id)
    );
    select lims.register_signable_head('lims.widget', array['state']);
  `);
}

export type Lab = { id: string; code: string };

/** A Lab created as the seed service, the way the seed script creates the company's Labs. */
export async function createLab(api: TestApi, code: string): Promise<Lab> {
  const id = randomUUID();
  const { runAudited, createLab: createLabDoor, COMPANY_LEDGER, SERVICE } = await import('@lims/db');
  const out = await runAudited(api.db.app, {
    person: SERVICE.seed.person, role: SERVICE.seed.role, actingLab: null, customer: null, action: 'seed.lab', reason: { kind: 'first_save' },
    appRelease: 'test', session: null, commitKey: randomUUID() as never, ledgers: [COMPANY_LEDGER],
  }, { kind: 'company' }, async (tx) => {
    await createLabDoor(tx, { id: id as never, code, ianaZone: 'America/New_York' });
    return { commit: null };
  });
  if (!('commit' in out)) throw new Error('lab not created');
  return { id, code };
}

export type People = { admin: Person; qa: Person; ann: Person; bob: Person; dee: Person; eve: Person; lab: Lab; adminTab: Client };

/**
 * The cast every signing test needs, enrolled through the real link and enabled through the real
 * signings: the Admin checks identities, each person acknowledges the two enabling documents in
 * one group signing, and QA signs the Authorisations Approved.
 */
export async function cast(api: TestApi): Promise<People> {
  const lab = await createLab(api, 'RD');
  const l = lab.id as never;
  const admin = await enrol(api, { username: 'adam', printedName: 'Adam Admin', grants: [{ role: 'Admin' }] });
  const qa = await enrol(api, { username: 'cid', printedName: 'Cid Quality', grants: [{ role: 'QA', lab: l }] });
  const ann = await enrol(api, { username: 'ann', printedName: 'Ann Analyst', grants: [{ role: 'Analyst', lab: l }] });
  const bob = await enrol(api, { username: 'bob', printedName: 'Bob Reviewer', grants: [{ role: 'Reviewer', lab: l }, { role: 'Analyst', lab: l }] });
  const dee = await enrol(api, { username: 'dee', printedName: 'Dee Analyst', grants: [{ role: 'Analyst', lab: l }] });
  const eve = await enrol(api, { username: 'eve', printedName: 'Eve Analyst', grants: [{ role: 'Analyst', lab: l }] });
  const adminTab = await login(api, admin);
  for (const p of [qa, ann, bob, dee]) {
    const checked = await adminTab.command('identity.checkIdentity', { personId: p.id, method: 'passport seen in person' });
    if (checked.status !== 200) throw new Error(`checkIdentity: ${JSON.stringify(checked.body)}`);
  }
  await enable(api, qa, 'QA');
  await enable(api, ann, 'Analyst');
  await enable(api, bob, 'Reviewer');
  await enable(api, dee, 'Analyst');
  const qaTab = await login(api, qa);
  const grants: [Person, string][] = [[ann, 'Performed'], [bob, 'Reviewed'], [bob, 'Performed'], [dee, 'Performed']];
  const drafted: string[] = [];
  for (const [p, meaning] of grants) {
    const g = await qaTab.command('authorisation.grant', { personId: p.id, meaning, scope: WIDGET_SCOPE, validFrom: '2026-01-01', validUntil: '2027-01-01' });
    if (g.status !== 200) throw new Error(`grant: ${JSON.stringify(g.body)}`);
    drafted.push((g.body as { data: { recordId: string } }).data.recordId);
  }
  const approved = await signAs(qaTab, qa, 'Approved', 'QA', drafted);
  if (approved.status !== 200) throw new Error(`approve authorisations: ${JSON.stringify(approved.body)}`);
  return { admin, qa, ann, bob, dee, eve, lab, adminTab };
}

/** Opens the two enabling Training Records and acknowledges both in one signing. */
export async function enable(api: TestApi, person: Person, role: string): Promise<void> {
  const tab = await login(api, person);
  const ids: string[] = [];
  for (const doc of [ENABLEMENT_DOCUMENTS.policy, ENABLEMENT_DOCUMENTS.limsUse]) {
    const r = await tab.command('training.open', { documentVersion: doc, level: 'read-and-understood' });
    if (r.status !== 200) throw new Error(`training.open: ${JSON.stringify(r.body)}`);
    ids.push((r.body as { data: { recordId: string } }).data.recordId);
  }
  const signed = await signAs(tab, person, 'Acknowledged', role, ids);
  if (signed.status !== 200) throw new Error(`acknowledge: ${JSON.stringify(signed.body)}`);
  await tab.command('session.logout', {});
}

export async function newWidget(tab: Client, name: string, role = 'Analyst'): Promise<string> {
  const r = await tab.command('widget.create', { name, role });
  if (r.status !== 200) throw new Error(`widget.create: ${JSON.stringify(r.body)}`);
  return (r.body as { data: { widgetId: string } }).data.widgetId;
}

export async function recordWeight(tab: Client, widget: string, text: string, subject = 'P1', role = 'Analyst') {
  const r = await tab.command('value.record', { role, parent: widget, field: 'prep.weight', subject, value: { type: 'decimal', value: text, unit: 'mg' } });
  if (r.status !== 200) throw new Error(`value.record: ${JSON.stringify(r.body)}`);
  return (r.body as { data: { value: string; version: { versionId: string; hash: string; versionNo: number }; standing: string } }).data;
}
