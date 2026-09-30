// The reference data the seed drives through the real commands: what a Specification version must
// hold before the Customer can accept it, which Method Adoption statuses QA may approve, who may
// hold which Authorisation and for how long, and the Review Checklists' pinned items.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHAIN } from '../src/chain/index.ts';
import { createSpecification } from '../src/commands/reference.ts';
import { seedCast, type Cast } from '../src/seed/cast.ts';
import { fdaSpecification, METHOD_DOCUMENTS, seedCustomers, seedReference, SIMPLE_ACCEPTANCE, type Reference } from '../src/seed/reference.ts';
import { testApi, type TestApi } from '../src/testing/harness.ts';

let api: TestApi;
let cast: Cast;
let reference: Reference;

beforeAll(async () => {
  api = await testApi(CHAIN);
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
