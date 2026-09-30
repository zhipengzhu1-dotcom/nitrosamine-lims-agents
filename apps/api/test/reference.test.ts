// The reference data the seed drives through the real commands: what a Specification version must
// hold before the Customer can accept it, which Method Adoption statuses QA may approve, who may
// hold which Authorisation and for how long, and the Review Checklists' pinned items.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ledgerOf } from '@lims/db';
import { uuid } from '@lims/contract';
import type { RecordId } from '@lims/domain/ids';
import { CHAIN } from '../src/chain/index.ts';
import { checklistFor, RELEASE_CHECKLIST, RUN_CHECKLIST, TEST_CHECKLIST } from '../src/chain/model.ts';
import { receipt } from '../src/commit.ts';
import { createAdoption, createSpecification } from '../src/commands/reference.ts';
import { defineCommand } from '../src/doors.ts';
import { seedCast, type Cast } from '../src/seed/cast.ts';
import { fdaSpecification, METHOD_DOCUMENTS, seedCustomers, seedReference, SIMPLE_ACCEPTANCE, type Reference } from '../src/seed/reference.ts';
import { signAs, testApi, type TestApi } from '../src/testing/harness.ts';

/** Drafts an Adoption without the command's status check, so the Approved signing's own check is proved. */
const draftAdoptionUnchecked = defineCommand({
  name: 'test.draftAdoptionUnchecked',
  input: z.object({ lab: uuid, methodVersionId: uuid, status: z.enum(['verified', 'verified-basic-compendial']), productId: uuid }),
  acting: { as: 'role', role: 'QA' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const id = randomUUID() as RecordId;
    await tx.db.insertInto('record').values({ ledger_id: ledgerOf(input.lab as never), id, kind: 'method_adoption' }).execute();
    await tx.db.insertInto('method_adoption').values({ lab_id: input.lab, id, method_version_id: input.methodVersionId, status: input.status }).execute();
    await tx.db.insertInto('method_adoption_scope').values({ lab_id: input.lab, adoption_id: id, product_id: input.productId }).execute();
    await tx.records.seal(id);
    return receipt('Drafted.', 'audited', { recordId: id });
  },
});

let api: TestApi;
let cast: Cast;
let reference: Reference;

beforeAll(async () => {
  api = await testApi({ ...CHAIN, commands: [...CHAIN.commands, draftAdoptionUnchecked] });
  const customers = await seedCustomers(api);
  cast = await seedCast(api, api.deps, customers, METHOD_DOCUMENTS);
  reference = await seedReference(api, cast, customers);
});
afterAll(() => api.close());

const specificationCount = async () => Number((await api.db.app.selectFrom('specification').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n);

const withLine = (line: Partial<ReturnType<typeof fdaSpecification>['sections'][0]['lines'][0]>, mdd = '320') => {
  const spec = fdaSpecification();
  const [section] = spec.sections;
  return { sections: [{ ...section!, maximumDailyDose: { value: mdd, unit: 'mg/day' as const }, lines: [{ ...section!.lines[0]!, ...line }] }] };
};

describe('an AI-derived limit is checked against AI ÷ MDD (usp 1, decision 29)', () => {
  it('refuses a version whose limit is not AI ÷ MDD rounded down to its decimals, and writes nothing', async () => {
    const before = await specificationCount();
    const out = await api.run(api.seed, createSpecification, { productId: reference.products.fic01, purpose: 'shelf-life', data: withLine({ limit: '0.31' }) });
    expect(out.kind).toBe('refusal');
    if (out.kind !== 'refusal') return;
    expect(out.refusal).toMatchObject({ kind: 'gate', reasons: [{ code: 'limit-not-derived', jurisdiction: 'FDA', analyte: 'NDMA', limit: '0.31', derived: '0.30' }] });
    expect(out.refusal.message).toBe('The FDA limit for NDMA is written 0.31 ppm, but 96 ng/day ÷ 320 mg/day rounded down to 2 decimals is 0.30 ppm.');
    expect(await specificationCount()).toBe(before);
  });

  it('rounds down, so 96 ng/day over 330 mg/day is 0.29, never 0.30', async () => {
    const refused = await api.run(api.seed, createSpecification, { productId: reference.products.fic01, purpose: 'shelf-life', data: withLine({ limit: '0.30' }, '330') });
    expect(refused.kind).toBe('refusal');
    const drafted = await api.run(api.seed, createSpecification, { productId: reference.products.fic01, purpose: 'shelf-life', data: withLine({ limit: '0.29' }, '330') });
    expect(drafted.kind).toBe('receipt');
  });

  it('requires the Acceptable Intake behind every line, and a positive AI and MDD', () => {
    const parse = (data: unknown) => createSpecification.input.safeParse({ productId: reference.products.fic01, purpose: 'release', data }).success;
    expect(parse(fdaSpecification())).toBe(true);
    expect(parse(withLine({ basis: null as never }))).toBe(false);
    expect(parse(withLine({}, '0'))).toBe(false);
    expect(parse(withLine({}, '-320'))).toBe(false);
    expect(parse(withLine({ basis: { acceptableIntakeNgPerDay: '0.0', source: 'x' } }))).toBe(false);
  });
});

describe('the Decision Rule is part of the Specification version the Customer accepts (iso 4, ISO/IEC 17025 §7.1.3)', () => {
  it('refuses a Section without one', () => {
    const [section] = fdaSpecification().sections;
    const { decisionRule: _dropped, ...without } = section!;
    expect(createSpecification.input.safeParse({ productId: reference.products.fic01, purpose: 'release', data: { sections: [without] } }).success).toBe(false);
  });

  it('seals each Section\'s rule and wording into the bytes the Customer accepted', async () => {
    const accepted = await api.db.app.selectFrom('specification_acceptance as a').innerJoin('record_version as v', 'v.id', 'a.specification_version_id')
      .select(['v.content', 'v.content_hash', 'a.content_hash as accepted_hash']).execute();
    expect(SIMPLE_ACCEPTANCE.rule).toBe('simple-acceptance');
    expect(accepted).toHaveLength(4);
    for (const a of accepted) {
      expect(a.accepted_hash.equals(a.content_hash!)).toBe(true);
      const body = JSON.parse(a.content!.toString('utf8')) as { data: { sections: { decisionRule: unknown }[] } };
      expect(body.data.sections.map((s) => s.decisionRule)).toEqual([SIMPLE_ACCEPTANCE]);
    }
  });
});

describe('a Method Adoption\'s status suits the Method\'s basis (usp 6, decision 36 §4)', () => {
  const inLab = () => ({ ...api.seed, lab: cast.lab.id }) as never;

  it('refuses to draft the in-house LC-MS/MS Method as verified or verified (basic compendial)', async () => {
    const verified = await api.run(inLab(), createAdoption, { methodVersionId: reference.methods.lcms.versionId, status: 'verified', productIds: [reference.products.fic01] });
    expect(verified).toMatchObject({ kind: 'refusal', refusal: { kind: 'gate', reasons: [{ code: 'adoption-status-for-basis', status: 'verified', basis: 'in-house' }] } });
    const basic = await api.run(inLab(), createAdoption, { methodVersionId: reference.methods.lcms.versionId, status: 'verified-basic-compendial', productIds: [reference.products.fic01] });
    expect(basic).toMatchObject({ kind: 'refusal', refusal: { kind: 'gate', reasons: [{ code: 'adoption-status-for-basis' }, { code: 'basic-compendial-nitrosamine', analytes: ['NDMA'] }] } });
  });

  it('refuses QA\'s Approved signing on such an Adoption however it was drafted', async () => {
    const drafted = await api.run(inLab(), draftAdoptionUnchecked, { lab: cast.lab.id, methodVersionId: reference.methods.lcms.versionId, status: 'verified', productId: reference.products.fic01 });
    if (drafted.kind !== 'receipt') throw new Error('draft refused');
    const signed = await signAs(cast.tabs.cid, cast.cid, 'Approved', 'QA', [(drafted.receipt.data as { recordId: string }).recordId]);
    expect(signed.status).toBe(409);
    expect(signed.body.refusal.message).toMatch(/An in-house Method can't be adopted as verified/);
  });

  it('seeds the LC-MS/MS Method adopted as validated here, and it stands Approved', async () => {
    const rows = await api.db.app.selectFrom('method_adoption as a').innerJoin('method_version as mv', 'mv.id', 'a.method_version_id').innerJoin('method as m', 'm.id', 'mv.method_id')
      .innerJoin('effective_version as v', 'v.record_id', 'a.id').innerJoin('signature as s', 's.record_version_id', 'v.id')
      .select(['m.number', 'a.status', 's.meaning']).orderBy('m.number').execute();
    expect(rows).toEqual([{ number: 'NA-GCMS-002', status: 'in-development', meaning: 'Approved' }, { number: 'NA-LCMS-001', status: 'validated-here', meaning: 'Approved' }]);
  });
});

describe('a Run Check criterion cites the Method version that sets it (usp 4)', () => {
  it('the S/N check on each seeded in-house or alternative Method cites that Method\'s own version, not <621>', async () => {
    const versions = await api.db.app.selectFrom('method_version as mv').innerJoin('method as m', 'm.id', 'mv.method_id').select(['m.number', 'mv.version', 'mv.data']).execute();
    expect(versions).toHaveLength(2);
    for (const v of versions) {
      const data = v.data as { runChecks: { name: string; criterion: { source: unknown } }[]; variability: { source: unknown } | null };
      for (const check of data.runChecks) expect(check.criterion.source, `${v.number} ${check.name}`).toEqual({ kind: 'method', methodVersion: `${v.number}@${v.version}` });
      if (data.variability) expect(data.variability.source).toEqual({ kind: 'method', methodVersion: `${v.number}@${v.version}` });
    }
  });
});

describe('who may hold which Authorisation, and for how long (iso 6, iso 8, decision 19)', () => {
  const grant = (personId: string, meaning: string, validFrom: string, validUntil: string) =>
    cast.tabs.cid.command('authorisation.grant', { personId, meaning, scope: 'NA-LCMS-001', validFrom, validUntil });

  it('refuses a Released Authorisation to the Lab Manager of this Lab', async () => {
    const r = await grant(cast.lena.id, 'Released', '2026-10-01', '2027-10-01');
    expect(r.status).toBe(403);
    expect(r.body.refusal).toEqual({ kind: 'not-permitted', message: 'Lena Vogt is the Lab Manager in this Lab, and the Lab Manager never holds a Released Authorisation in the Lab they manage.' });
    expect((await grant(cast.lena.id, 'Reviewed', '2026-10-01', '2027-10-01')).status).toBe(200);
  });

  it('refuses validity beyond 12 months, and allows exactly 12', async () => {
    const r = await grant(cast.ann.id, 'Performed', '2026-10-01', '2027-10-02');
    expect(r.status).toBe(403);
    expect(r.body.refusal).toEqual({ kind: 'not-permitted', message: 'An Authorisation is valid for at most 12 months: from 2026-10-01 it ends by 2027-10-01. Renew it through a Competence Assessment.' });
    expect((await grant(cast.ann.id, 'Performed', '2026-10-01', '2027-10-01')).status).toBe(200);
    expect((await grant(cast.ann.id, 'Performed', '2026-10-01', '2026-10-01')).body.refusal).toEqual({ kind: 'not-permitted', message: 'An Authorisation ends after the day it starts.' });
  });

  it('seeds Specifications signed Approved by the QA person, not the Lab Manager', async () => {
    const signers = await api.db.app.selectFrom('signature as s').innerJoin('record_version as v', 'v.id', 's.record_version_id').innerJoin('specification as sp', 'sp.id', 'v.record_id')
      .select(['s.signer_person_id', 's.meaning']).execute();
    expect(signers).toHaveLength(4);
    expect(new Set(signers.map((x) => `${x.meaning} ${x.signer_person_id}`))).toEqual(new Set([`Approved ${cast.cid.id}`]));
  });
});

describe('a Training Record is Read and Understood until Training Runs exist (iso 8)', () => {
  it('refuses Demonstrated as not built and logs the gap', async () => {
    const before = (await api.db.app.selectFrom('spec_gap').select('id').where('feature', '=', 'training-run').execute()).length;
    const r = await cast.tabs.ann.command('training.open', { documentVersion: 'SOP-PREP-011@2', level: 'demonstrated' });
    expect(r.status).toBe(409);
    expect(r.body.refusal).toEqual({ kind: 'not-built', feature: 'training-run', message: 'Training Runs not built in the skeleton, so a Training Record can only be Read and Understood' });
    expect((await api.db.app.selectFrom('spec_gap').select('id').where('feature', '=', 'training-run').execute()).length).toBe(before + 1);
    expect(await api.db.app.selectFrom('training_record').select('id').where('document_version', '=', 'SOP-PREP-011@2').execute()).toEqual([]);
  });
});

describe('the Review Checklists follow decision 20 §7 for typed entry (iso 7)', () => {
  // A checklist version never changes its items: a Reviewed signature keeps the version it used.
  // Changing an item means a new version here and in chain/model.ts.
  it('pins each version\'s items', () => {
    expect([RUN_CHECKLIST, TEST_CHECKLIST, RELEASE_CHECKLIST]).toEqual([
      { version: 'CL-RUN@2', items: ['LIMS audit trail reviewed', 'chromatograms inspected', 'excluded Injections justified', 'Notebook Entries read'] },
      { version: 'CL-TEST@2', items: ['LIMS audit trail reviewed', 'calculations checked', 'Notebook Entries read', 'outlier, OOT, trend and Conditional Pass flags acknowledged with a comment'] },
      { version: 'CL-RELEASE@1', items: ['audit trail reviewed', 'every Test Reviewed on its current version', 'report content matches the signed Tests'] },
    ]);
    expect([checklistFor('run'), checklistFor('test'), checklistFor('test_report')]).toEqual([RUN_CHECKLIST, TEST_CHECKLIST, RELEASE_CHECKLIST]);
  });

  it('ticks no item the system proves as evidence (Fitness Status, Run Checks, Training and Authorisation)', () => {
    for (const item of [...RUN_CHECKLIST.items, ...TEST_CHECKLIST.items]) expect(item).not.toMatch(/In use|Run Checks|Training|Authoris|Verified|True Copy/);
  });
});
