// Fictional reference data, through the real commands. The one real value is the published NDMA
// Acceptable Intake, cited with its source; every organisation, product, lot and result is
// invented. Sizes stay well under the cap (4 Customers, 13 Products, 3 Methods): two Customers,
// four Products, two Methods.

import type { DecisionRule, MethodData, SpecificationData } from '../chain/model.ts';
import { methodTrainingDocument } from '../chain/model.ts';
import { createAdoption, createCustomer, createEquipment, createMethod, createMethodVersion, createProduct, createSpecification, createSubstance } from '../commands/reference.ts';
import type { Cast } from './cast.ts';
import { login, mustSign, type Client, type Driver } from './drive.ts';

export const METHOD_LCMS = 'NA-LCMS-001';
export const METHOD_GCMS = 'NA-GCMS-002';
export const PREREQUISITE_SOP = 'SOP-PREP-011@1';

/** Documents an Analyst or Reviewer needs Training Records on for the seeded Methods. */
export const METHOD_DOCUMENTS = [methodTrainingDocument(METHOD_LCMS, 1), methodTrainingDocument(METHOD_GCMS, 1), PREREQUISITE_SOP] as const;

/** FDA, Control of Nitrosamine Impurities in Human Drugs, Guidance for Industry, Rev. 2 (September 2024), Table 1: NDMA AI 96 ng/day. */
export const NDMA_AI = { acceptableIntakeNgPerDay: '96', source: 'FDA, Control of Nitrosamine Impurities in Human Drugs, Guidance for Industry, Rev. 2 (Sept 2024), Table 1' } as const;

export type Reference = {
  readonly customers: { readonly acme: string; readonly beta: string };
  readonly substances: { readonly ndma: string; readonly fictionib: string; readonly zelotrin: string };
  readonly products: { readonly fic01: string; readonly fic02: string; readonly zel01: string; readonly betaApi: string };
  readonly methods: { readonly lcms: { id: string; versionId: string }; readonly gcms: { id: string; versionId: string } };
  readonly equipment: { readonly lcms1: string };
  /** Cara's portal tabs, one per Customer she acts for. */
  readonly portal: { readonly acme: Client; readonly beta: Client };
};

async function runAs(api: Driver, def: Parameters<Driver['run']>[1], input: unknown, lab?: string): Promise<any> {
  const who = lab ? { ...api.seed, lab } as never : api.seed;
  const out = await api.run(who, def, input);
  if (out.kind !== 'receipt') throw new Error(`${def.name} refused: ${out.refusal.message}`);
  return out.receipt.data;
}

/** A seeded Method version's data. Its criteria are the lab's own, so each cites the Method version that sets it. */
export const methodData = (number: string, basis: MethodData['basis'], variability: boolean): MethodData => {
  const source = { kind: 'method', methodVersion: `${number}@1` } as const;
  return {
    basis,
    analytes: [],
    dilutionFactor: '1',
    preparations: '2',
    variability: variability ? { statistic: 'relative-difference', limit: '20.0', source } : null,
    runChecks: [
      { name: 'S/N at LOQ standard', unit: 'ratio', comparedAs: 'as-exported', criterion: { op: 'NLT', limit: '10', source } },
      { name: 'Check standard recovery', unit: '%', comparedAs: 'as-exported', criterion: { op: 'range', low: '80.0', high: '120.0', source } },
    ],
    prerequisiteDocuments: [PREREQUISITE_SOP],
  };
};

/** Simple acceptance (ILAC-G8:09/2019, binary statement): the result at the limit's decimals is compared with the limit, without its uncertainty. */
export const SIMPLE_ACCEPTANCE: DecisionRule = {
  rule: 'simple-acceptance',
  riskBasis: 'Simple acceptance, ILAC-G8:09/2019 binary statement: the Reportable Result, rounded to the limit\'s decimals, is compared with the limit without taking measurement uncertainty into account. The Customer accepts the risk of a false acceptance or rejection near the limit.',
  wording: {
    conforms: 'Conforms: the result does not exceed the limit (simple acceptance; measurement uncertainty not taken into account).',
    doesNotConform: 'Does not conform: the result exceeds the limit (simple acceptance; measurement uncertainty not taken into account).',
  },
};

/** FDA Section only: NDMA at 96 ng/day over a maximum daily dose of 320 mg/day is 0.30 ppm, two significant figures. */
export const fdaSpecification = (): SpecificationData => ({
  sections: [{
    jurisdiction: 'FDA', ruleSetVersion: 'FDA-RS@1', rounding: 'half-away-from-zero', maximumDailyDose: { value: '320', unit: 'mg/day' },
    decisionRule: SIMPLE_ACCEPTANCE,
    lines: [{ analyte: 'NDMA', limit: '0.30', unit: 'ppm', uspClaim: false, basis: NDMA_AI }],
  }],
});

/** Before the cast exists: company reference rows the people's grants refer to. */
export async function seedCustomers(api: Driver): Promise<Reference['customers']> {
  return {
    acme: (await runAs(api, createCustomer, { code: 'ACME', name: 'Acme Pharma (fictional)' })).customerId,
    beta: (await runAs(api, createCustomer, { code: 'BETA', name: 'Beta Biologics (fictional)' })).customerId,
  };
}

export async function seedReference(api: Driver, cast: Cast, customers: Reference['customers']): Promise<Reference> {
  const lab = cast.lab.id;
  const substances = {
    ndma: (await runAs(api, createSubstance, { cas: '62-75-9', name: 'N-Nitrosodimethylamine', kind: 'small-nitrosamine' })).substanceId,
    fictionib: (await runAs(api, createSubstance, { cas: '0000-00-1', name: 'Fictionib (fictional API)', kind: 'api' })).substanceId,
    zelotrin: (await runAs(api, createSubstance, { cas: '0000-00-2', name: 'Zelotrin (fictional API)', kind: 'api' })).substanceId,
  };
  const products = {
    fic01: (await runAs(api, createProduct, { customerId: customers.acme, code: 'FIC-01', name: 'Fictionib API, route A', apiSubstanceId: substances.fictionib })).productId,
    fic02: (await runAs(api, createProduct, { customerId: customers.acme, code: 'FIC-02', name: 'Fictionib API, route B', apiSubstanceId: substances.fictionib })).productId,
    zel01: (await runAs(api, createProduct, { customerId: customers.acme, code: 'ZEL-01', name: 'Zelotrin API', apiSubstanceId: substances.zelotrin })).productId,
    betaApi: (await runAs(api, createProduct, { customerId: customers.beta, code: 'BB-API-7', name: 'Zelotrin API (Beta)', apiSubstanceId: substances.zelotrin })).productId,
  };
  const analytes = [{ key: 'NDMA', substanceId: substances.ndma, name: 'N-Nitrosodimethylamine' }];
  const lcmsId = (await runAs(api, createMethod, { number: METHOD_LCMS, title: 'Nitrosamines in APIs by LC-MS/MS' })).methodId;
  const gcmsId = (await runAs(api, createMethod, { number: METHOD_GCMS, title: 'Volatile nitrosamines by GC-MS' })).methodId;
  const lcmsVersion = (await runAs(api, createMethodVersion, { methodId: lcmsId, version: 1, data: { ...methodData(METHOD_LCMS, 'in-house', true), analytes } })).recordId;
  const gcmsVersion = (await runAs(api, createMethodVersion, { methodId: gcmsId, version: 1, data: { ...methodData(METHOD_GCMS, 'alternative', false), analytes } })).recordId;
  await mustSign(cast.tabs.cid, cast.cid, 'Approved', 'QA', [lcmsVersion, gcmsVersion]);

  const specs: { id: string; customer: string }[] = [];
  for (const [productId, customer] of [[products.fic01, customers.acme], [products.fic02, customers.acme], [products.zel01, customers.acme], [products.betaApi, customers.beta]] as const) {
    specs.push({ id: (await runAs(api, createSpecification, { productId, purpose: 'release', data: fdaSpecification() })).recordId, customer });
  }
  await mustSign(cast.tabs.cid, cast.cid, 'Approved', 'QA', specs.map((s) => s.id));
  const portal = await acceptSpecifications(api, cast, specs);

  const adoptions = [
    (await runAs(api, createAdoption, { methodVersionId: lcmsVersion, status: 'validated-here', productIds: [products.fic01, products.fic02, products.zel01, products.betaApi] }, lab)).recordId,
    (await runAs(api, createAdoption, { methodVersionId: gcmsVersion, status: 'in-development', productIds: [products.zel01] }, lab)).recordId,
  ];
  await mustSign(cast.tabs.cid, cast.cid, 'Approved', 'QA', adoptions);

  const equipment = { lcms1: (await runAs(api, createEquipment, { code: 'LCMS-01', kind: 'LC-MS/MS' }, lab)).equipmentId };
  return { customers, substances, products, methods: { lcms: { id: lcmsId, versionId: lcmsVersion }, gcms: { id: gcmsId, versionId: gcmsVersion } }, equipment, portal };
}

/** The Customer Approver accepts each Approved Specification version for their Customer (audited, never signed). */
async function acceptSpecifications(api: Driver, cast: Cast, specs: readonly { id: string; customer: string }[]): Promise<Reference['portal']> {
  const portal = {
    acme: await login(api, cast.cara, { customer: cast.customers.acme, workstation: 'portal' }),
    beta: await login(api, cast.cara, { customer: cast.customers.beta, workstation: 'portal' }),
  };
  for (const s of specs) {
    const tab = s.customer === cast.customers.acme ? portal.acme : portal.beta;
    await tab.must('specification.accept', { version: await versionOf(cast.tabs.cid, s.id) });
  }
  return portal;
}

/** The version and hash a prompt would show for a record, via the same prepare call the sheet makes. */
export async function versionOf(tab: Client, record: string): Promise<{ versionId: string; hash: string }> {
  const prepared = await tab.must('signing.prepare', { meaning: 'Approved', role: 'QA', targets: [record], attestation: null });
  return { versionId: prepared.items[0].version.versionId, hash: prepared.items[0].version.hash };
}
