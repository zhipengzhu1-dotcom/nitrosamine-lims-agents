// The demo dataset, built through the real commands and signings. Every person is enrolled
// through the real link and signs with full re-authentication; the seed acts as their phone.
// It refuses to run twice on a database that already holds a Customer.

import type { Kysely } from 'kysely';
import type { DB } from '@lims/db';
import type { Deps } from '../commit.ts';
import { reenrol } from '../commands/identity.ts';
import type { DataClass } from '../config.ts';
import { authorise, DEMO_ACCOUNTS, seedCast, type Cast } from './cast.ts';
import { acceptAndReceive, assign, fullChain, openTabs, PASSING, submitOne, typeRun, type Submitted, type Tabs } from './chain.ts';
import type { Driver } from './drive.ts';
import { METHOD_DOCUMENTS, METHOD_GCMS, METHOD_LCMS, seedCustomers, seedReference, type Reference } from './reference.ts';

/** 30 % of the #23 prototype's counts, the owner's cap for the seed and the tests. */
export const SEED_CAP = { people: 8, customers: 4, products: 13, methods: 3, submissions: 135 } as const;

export type SeedResult = {
  readonly cast: Cast;
  readonly reference: Reference;
  readonly tabs: Tabs;
  readonly submissions: {
    /** SUB 1: through every step to a Released report the Customer downloaded. */
    readonly released: Awaited<ReturnType<typeof fullChain>>;
    /** SUB 2: two Tests accepted and received (Ready), the first assigned. */
    readonly ready: Submitted;
    /** SUB 3: Requested, awaiting the Sample Custodian. */
    readonly requested: Submitted;
    /** SUB 4 (BETA): In Progress with a typed Run, nothing signed yet. */
    readonly inProgress: Submitted & { readonly runId: string };
    /** SUB 5: one Test on the GC-MS Method, refused at Acceptance (Adoption in development) and rejected with a reason. */
    readonly rejected: Submitted;
  };
};

export async function alreadySeeded(db: Kysely<DB>): Promise<boolean> {
  return (await db.selectFrom('customer').select('id').executeTakeFirst()) !== undefined;
}

export async function seedDemo(api: Driver, deps: Deps, log: (line: string) => void = () => {}): Promise<SeedResult> {
  if (await alreadySeeded(deps.db)) throw new Error('this database is already seeded');
  log('Customers');
  const customers = await seedCustomers(api);
  log('People: enrolment, identity checks, Training Records');
  const cast = await seedCast(api, deps, customers, METHOD_DOCUMENTS);
  log('Methods, Specifications, Adoptions, Equipment');
  const reference = await seedReference(api, cast, customers);
  log('Authorisations');
  await authorise(cast, [METHOD_LCMS, METHOD_GCMS]);
  const tabs = openTabs(cast, reference);

  log('Submission 1: the whole chain to a Released report');
  const released = await fullChain(tabs, cast, reference, tabs.acme, reference.products.fic01, 'FIC-26-0417');

  log('Submission 2: Ready, one Test assigned');
  const ready = await submitOne(tabs.acme, cast.lab.id, reference.products.fic02, 'FIC-26-0422', [reference.methods.lcms.id, reference.methods.lcms.id]);
  await acceptAndReceive(tabs, ready);
  await assign(tabs, ready.samples[0]!.tests[0]!, cast.ann);

  log('Submission 3: Requested');
  const requested = await submitOne(tabs.acme, cast.lab.id, reference.products.zel01, 'ZEL-26-0031', [reference.methods.lcms.id]);

  log('Submission 4: In Progress with a typed Run');
  const inProgressSubmitted = await submitOne(tabs.beta, cast.lab.id, reference.products.betaApi, 'BB7-26-0102', [reference.methods.lcms.id]);
  await acceptAndReceive(tabs, inProgressSubmitted);
  const inProgressTest = inProgressSubmitted.samples[0]!.tests[0]!;
  await assign(tabs, inProgressTest, cast.ann);
  const typed = await typeRun(tabs, reference, inProgressTest, PASSING);

  log('Submission 5: rejected at Acceptance');
  const rejected = await submitOne(tabs.acme, cast.lab.id, reference.products.zel01, 'ZEL-26-0032', [reference.methods.gcms.id]);
  const refused = await tabs.sam.command('test.accept', { testId: rejected.samples[0]!.tests[0]! });
  if (refused.status !== 409) throw new Error(`expected the Adoption gate to refuse, got ${refused.status}`);
  await tabs.sam.must('test.reject', { testId: rejected.samples[0]!.tests[0]!, reason: `${METHOD_GCMS} is still in development in this Lab; request ${METHOD_LCMS} instead.` });

  return { cast, reference, tabs, submissions: { released, ready, requested, inProgress: { ...inProgressSubmitted, runId: typed.runId }, rejected } };
}

export type HandoverLink = { readonly username: string; readonly printedName: string; readonly role: string; readonly token: string };

/**
 * Revokes the seed's authenticators on the demo accounts and mints one enrolment link each, for
 * the owner to scan into a real authenticator app. Only on a fictional-data deployment: one person
 * then holds every demo account, which the demo exception allows only while the data is fictional.
 */
export async function handover(api: Driver, dataClass: DataClass): Promise<readonly HandoverLink[]> {
  if (dataClass !== 'fictional') throw new Error(`the handover gives one person every demo account, so it runs only on fictional data, not ${dataClass}`);
  const links: HandoverLink[] = [];
  for (const [username, printedName, role] of DEMO_ACCOUNTS) {
    const out = await api.run(api.seed, reenrol, { username });
    if (out.kind !== 'receipt') throw new Error(`reenrol ${username}: ${out.refusal.message}`);
    links.push({ username, printedName, role, token: (out.once?.data as { enrolmentToken: string }).enrolmentToken });
  }
  return links;
}

/** The counts the cap test compares. */
export async function seedCounts(db: Kysely<DB>): Promise<Record<keyof typeof SEED_CAP, number>> {
  const count = async (table: 'person' | 'customer' | 'product' | 'method' | 'submission') =>
    Number((await db.selectFrom(table).select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n);
  return {
    people: (await count('person')) - 3, // the three service identities are not people
    customers: await count('customer'),
    products: await count('product'),
    methods: await count('method'),
    submissions: await count('submission'),
  };
}
