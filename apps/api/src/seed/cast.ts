// The fictional people: one demo account per role, at most eight. Each is enrolled through the
// real link, identity-checked by the Admin, acknowledges the enabling documents and the Method
// versions they work on, and holds the Authorisations QA signs Approved. The Lab Manager also
// holds QA so that a second QA person can approve the QA person's own Authorisations (nobody
// grants their own); the demo-exception record names that doubling.

import { randomUUID } from 'node:crypto';
import { COMPANY_LEDGER, createLab as createLabDoor, runAudited, SERVICE } from '@lims/db';
import type { LabId } from '@lims/domain/ids';
import { ENABLEMENT_DOCUMENTS } from '../records/facts.ts';
import { CONFORMITY_SCOPE, RELEASE_SCOPE } from '../chain/facts.ts';
import type { Deps } from '../commit.ts';
import { enrol, login, mustSign, type Client, type Driver, type Person } from './drive.ts';

export type Lab = { readonly id: LabId; readonly code: string; readonly zone: string };

export type Cast = {
  readonly lab: Lab;
  readonly customers: { readonly acme: string; readonly beta: string };
  /** Customer User and Customer Approver for both ACME and BETA, acting for one at a time. */
  readonly cara: Person;
  readonly sam: Person; // Sample Custodian
  readonly lena: Person; // Lab Manager, and the second QA
  readonly ann: Person; // Analyst
  readonly dee: Person; // Analyst; the second person for Verified
  readonly bob: Person; // Reviewer
  readonly cid: Person; // QA
  readonly adam: Person; // Admin
  /** Each person's first tab: a login spends a TOTP step, so the seed keeps them. */
  readonly tabs: { readonly adam: Client; readonly sam: Client; readonly lena: Client; readonly ann: Client; readonly dee: Client; readonly bob: Client; readonly cid: Client };
};

export const DEMO_ACCOUNTS = [
  ['cara', 'Cara Okafor', 'Customer User'], ['sam', 'Sam Reyes', 'Sample Custodian'], ['lena', 'Lena Vogt', 'Lab Manager'],
  ['ann', 'Ann Kowalczyk', 'Analyst'], ['dee', 'Dee Nakamura', 'Analyst (second person for Verified)'], ['bob', 'Bob Achebe', 'Reviewer'],
  ['cid', 'Cid Marchetti', 'QA'], ['adam', 'Adam Lindqvist', 'Admin'],
] as const;

/** A Lab created as the seed service, the way the company's Labs come to exist. */
export async function createLab(deps: Deps, code: string, zone: string): Promise<Lab> {
  const id = randomUUID() as LabId;
  const out = await runAudited(deps.db, {
    person: SERVICE.seed.person, role: SERVICE.seed.role, actingLab: null, customer: null, action: 'seed.lab', reason: { kind: 'first_save' },
    appRelease: deps.release, session: null, commitKey: randomUUID() as never, ledgers: [COMPANY_LEDGER],
  }, { kind: 'company' }, async (tx) => {
    await createLabDoor(tx, { id, code, ianaZone: zone });
    return { commit: null };
  });
  if (!('commit' in out)) throw new Error('Lab not created');
  return { id, code, zone };
}

/** Opens Training Records on the documents and acknowledges them in one signing. */
export async function acknowledge(api: Driver, person: Person, role: string, documents: readonly string[]): Promise<Client> {
  const tab = await login(api, person);
  const ids: string[] = [];
  for (const doc of documents) ids.push((await tab.must('training.open', { documentVersion: doc, level: 'read-and-understood' })).recordId);
  await mustSign(tab, person, 'Acknowledged', role, ids);
  return tab;
}

export type AuthorisationGrant = { readonly person: Person; readonly meaning: string; readonly scope: string };

/** Twelve months from the first of this month (decision 19), so the seed's Authorisations are current whenever it runs. */
function twelveMonths(now: Date): { readonly validFrom: string; readonly validUntil: string } {
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return { validFrom: `${now.getUTCFullYear()}-${month}-01`, validUntil: `${now.getUTCFullYear() + 1}-${month}-01` };
}

/** QA drafts each Authorisation, then signs them all Approved in one group signing. */
export async function grantAuthorisations(qaTab: Client, qa: Person, grants: readonly AuthorisationGrant[]): Promise<void> {
  const validity = twelveMonths(new Date());
  const drafted: string[] = [];
  for (const g of grants) {
    drafted.push((await qaTab.must('authorisation.grant', { personId: g.person.id, meaning: g.meaning, scope: g.scope, ...validity })).recordId);
  }
  await mustSign(qaTab, qa, 'Approved', 'QA', drafted);
}

export async function seedCast(api: Driver, deps: Deps, customers: { acme: string; beta: string }, methodDocuments: readonly string[]): Promise<Cast> {
  const lab = await createLab(deps, 'RD', 'America/New_York');
  const l = lab.id;
  const [cara, sam, lena, ann, dee, bob, cid, adam] = await Promise.all([
    enrol(api, { username: 'cara', printedName: 'Cara Okafor', grants: [{ role: 'CustomerUser', customer: customers.acme }, { role: 'CustomerApprover', customer: customers.acme }, { role: 'CustomerUser', customer: customers.beta }, { role: 'CustomerApprover', customer: customers.beta }] }),
    enrol(api, { username: 'sam', printedName: 'Sam Reyes', grants: [{ role: 'SampleCustodian', lab: l }] }),
    enrol(api, { username: 'lena', printedName: 'Lena Vogt', grants: [{ role: 'LabManager', lab: l }, { role: 'QA', lab: l }] }),
    enrol(api, { username: 'ann', printedName: 'Ann Kowalczyk', grants: [{ role: 'Analyst', lab: l }] }),
    enrol(api, { username: 'dee', printedName: 'Dee Nakamura', grants: [{ role: 'Analyst', lab: l }] }),
    enrol(api, { username: 'bob', printedName: 'Bob Achebe', grants: [{ role: 'Reviewer', lab: l }] }),
    enrol(api, { username: 'cid', printedName: 'Cid Marchetti', grants: [{ role: 'QA', lab: l }] }),
    enrol(api, { username: 'adam', printedName: 'Adam Lindqvist', grants: [{ role: 'Admin' }] }),
  ]);
  const adamTab = await login(api, adam);
  for (const p of [sam, lena, ann, dee, bob, cid]) await adamTab.must('identity.checkIdentity', { personId: p.id, method: 'passport seen in person' });

  const enabling = [ENABLEMENT_DOCUMENTS.policy, ENABLEMENT_DOCUMENTS.limsUse];
  const tabs = {
    adam: adamTab,
    sam: await acknowledge(api, sam, 'SampleCustodian', enabling),
    lena: await acknowledge(api, lena, 'LabManager', enabling),
    ann: await acknowledge(api, ann, 'Analyst', [...enabling, ...methodDocuments]),
    dee: await acknowledge(api, dee, 'Analyst', [...enabling, ...methodDocuments]),
    bob: await acknowledge(api, bob, 'Reviewer', [...enabling, ...methodDocuments]),
    cid: await acknowledge(api, cid, 'QA', enabling),
  };
  return { lab, customers, cara, sam, lena, ann, dee, bob, cid, adam, tabs };
}

/** The Method Authorisations QA signs, and QA's own Released Authorisations signed by the second QA. */
export async function authorise(cast: Cast, methodNumbers: readonly string[]): Promise<void> {
  const onMethods = (person: Person, meaning: string) => methodNumbers.map((m) => ({ person, meaning, scope: m }));
  await grantAuthorisations(cast.tabs.cid, cast.cid, [
    ...onMethods(cast.ann, 'Performed'), ...onMethods(cast.dee, 'Performed'), ...onMethods(cast.bob, 'Reviewed'),
  ]);
  await grantAuthorisations(cast.tabs.lena, cast.lena, [
    { person: cast.cid, meaning: 'Released', scope: RELEASE_SCOPE }, { person: cast.cid, meaning: 'Released', scope: CONFORMITY_SCOPE },
  ]);
}
