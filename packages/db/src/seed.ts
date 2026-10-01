import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import { hashPassword } from './credentials.ts';
import { audited, createDb, type DB } from './db.ts';

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

/** Seeds one Lab, one Customer, one Method and the demo people, who all share one password, into an empty database. */
export async function seed(
  db: Kysely<DB>,
  password = process.env.DEMO_PASSWORD ?? randomBytes(6).toString('base64url'),
): Promise<SeededAccount[]> {
  if (await db.selectFrom('lab').select('lab_id').executeTakeFirst())
    throw new Error('already seeded; seed a fresh database');
  return audited(db, { actor: 'svc:seed', role: 'system', reason: 'Seed fictional demo data' }, async (tx) => {
    const { lab_id } = await tx
      .insertInto('lab')
      .values({ code: 'RD', name: 'R&D Laboratory (fictional)' })
      .returning('lab_id')
      .executeTakeFirstOrThrow();
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
    const out: SeededAccount[] = [];
    for (const p of people) {
      const { id } = await tx
        .insertInto('person')
        .values({
          username: p.username,
          display_name: p.name,
          password_hash: await hashPassword(password),
          customer_id: p.role === 'Customer' ? customer.id : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx.insertInto('membership').values({ lab_id, person_id: id, role: p.role }).execute();
      if ('trained' in p)
        await tx.insertInto('training_record').values({ lab_id, person_id: id, method_id: method.id }).execute();
      out.push({ id, username: p.username, role: p.role, password });
    }
    return out;
  });
}

if (import.meta.main) {
  const db = createDb();
  try {
    const accounts = await seed(db);
    console.table(accounts.map((a) => ({ username: a.username, role: a.role })));
    console.log(`Every account signs in with the password: ${accounts[0]!.password}`);
  } finally {
    await db.destroy();
  }
}
