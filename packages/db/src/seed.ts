import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import { dbConfig } from './config.ts';
import { hashPassword } from './credentials.ts';
import { audited, createDb, type DB, databaseUrl } from './db.ts';

// All fictional. Two Analysts so the assignment gate has someone to refuse.
const people = [
  { role: 'Customer', username: 'cora.customer', name: 'Cora Lindqvist' },
  { role: 'SampleCustodian', username: 'samir.custodian', name: 'Samir Okafor' },
  { role: 'LabManager', username: 'lena.manager', name: 'Lena Varga' },
  { role: 'Analyst', username: 'ana.analyst', name: 'Ana Ferreira', trained: true },
  { role: 'Analyst', username: 'theo.untrained', name: 'Theo Brandt' },
  { role: 'Reviewer', username: 'rui.reviewer', name: 'Rui Tanaka' },
  { role: 'QA', username: 'quinn.qa', name: 'Quinn Adeyemi' },
  { role: 'Admin', username: 'ada.admin', name: 'Ada Novak' },
] as const;

export interface SeededAccount {
  id: string;
  username: (typeof people)[number]['username'];
  role: (typeof people)[number]['role'];
  password: string;
}

/** Seeds one Lab with two Rooms, one Customer, one Method and the demo people, who all share one password, into an empty database. */
export async function seed(db: Kysely<DB>, password = randomBytes(6).toString('base64url')): Promise<SeededAccount[]> {
  if (await db.selectFrom('lab').select('labId').executeTakeFirst())
    throw new Error('already seeded; seed a fresh database');
  return audited(db, { actor: 'svc:seed', role: 'system', reason: 'Seed fictional demo data' }, async (tx) => {
    const customer = await tx
      .insertInto('customer')
      .values({ name: 'Northwind Generics (fictional)' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const method = await tx
      .insertInto('method')
      .values({ code: 'RD-MTH-0001', version: '1', title: 'NDMA in metformin hydrochloride by LC-MS/MS' })
      .returning('id')
      .executeTakeFirstOrThrow();
    // The Lab comes after the company rows: a transaction locks the company chain before any Lab's (lims.lock_chain).
    const { labId } = await tx
      .insertInto('lab')
      .values({ code: 'RD', name: 'R&D Laboratory (fictional)', timeZone: 'America/New_York' })
      .returning('labId')
      .executeTakeFirstOrThrow();
    await tx
      .insertInto('room')
      .values([
        { labId, name: 'LC-MS/MS Room (fictional)' },
        { labId, name: 'Sample Preparation Room (fictional)' },
      ])
      .execute();
    const out: SeededAccount[] = [];
    for (const p of people) {
      const { id } = await tx
        .insertInto('person')
        .values({
          username: p.username,
          displayName: p.name,
          passwordHash: await hashPassword(password),
          customerId: p.role === 'Customer' ? customer.id : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx.insertInto('membership').values({ labId, personId: id, role: p.role }).execute();
      if ('trained' in p)
        await tx.insertInto('trainingRecord').values({ labId, personId: id, methodId: method.id }).execute();
      out.push({ id, username: p.username, role: p.role, password });
    }
    return out;
  });
}

if (import.meta.main) {
  const { server, database, demoPassword } = dbConfig();
  const db = createDb(databaseUrl(server, database, 'lims_app'));
  try {
    const accounts = await seed(db, demoPassword);
    console.table(accounts.map((a) => ({ username: a.username, role: a.role })));
    const [first] = accounts;
    if (!first) throw new Error('the seed made no accounts');
    console.log(`Every account signs in with the password: ${first.password}`);
  } finally {
    await db.destroy();
  }
}
