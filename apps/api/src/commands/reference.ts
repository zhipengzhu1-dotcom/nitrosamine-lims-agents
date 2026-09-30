// Reference data the seed drives through the real commands: Customers, Products, Substances,
// Methods and their versions, Specifications and the Customer's acceptance, Method Adoptions
// and Equipment. Versioned records are sealed here and take effect when QA signs them Approved.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { COMPANY_LEDGER, ledgerOf, versionStands } from '@lims/db';
import { uuid } from '@lims/contract';
import type { RecordId, VersionId } from '@lims/domain/ids';
import { toRefusal } from '@lims/domain/gates';
import { derivationGate } from '@lims/domain/limits';
import { derivedSectionsOf, MethodDataSchema, SpecificationDataSchema } from '../chain/model.ts';
import { receipt, type CommandTx } from '../commit.ts';
import { defineCommand } from '../doors.ts';
import { VersionRefSchema } from '../wire.ts';

const labOf = (tx: CommandTx) => {
  const a = tx.actor;
  return a.kind === 'staff' ? a.lab : a.kind === 'service' ? a.lab : null;
};

export const createCustomer = defineCommand({
  name: 'reference.customer',
  input: z.object({ code: z.string().regex(/^[A-Z0-9-]{2,16}$/), name: z.string().min(1).max(200) }),
  acting: { as: 'role', role: 'LabManager' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const id = randomUUID();
    await tx.db.insertInto('customer').values({ id, code: input.code, name: input.name }).execute();
    return receipt(`Created Customer ${input.code}.`, 'audited', { customerId: id });
  },
});

export const createSubstance = defineCommand({
  name: 'reference.substance',
  input: z.object({ cas: z.string().min(1).max(20), name: z.string().min(1).max(200), kind: z.enum(['api', 'small-nitrosamine', 'ndsri', 'other-impurity', 'internal-standard']) }),
  acting: { as: 'role', role: 'QA' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const id = randomUUID();
    await tx.db.insertInto('substance').values({ id, cas: input.cas, name: input.name, kind: input.kind }).execute();
    return receipt(`Created Substance ${input.name} (CAS ${input.cas}).`, 'audited', { substanceId: id });
  },
});

export const createProduct = defineCommand({
  name: 'reference.product',
  input: z.object({ customerId: uuid, code: z.string().min(1).max(32), name: z.string().min(1).max(200), apiSubstanceId: uuid }),
  acting: { as: 'role', role: 'LabManager' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const id = randomUUID();
    await tx.db.insertInto('product').values({ id, customer_id: input.customerId, code: input.code, name: input.name, api_substance_id: input.apiSubstanceId }).execute();
    return receipt(`Created Product ${input.code}.`, 'audited', { productId: id });
  },
});

export const createMethod = defineCommand({
  name: 'reference.method',
  input: z.object({ number: z.string().regex(/^[A-Z0-9-]{3,32}$/), title: z.string().min(1).max(200) }),
  acting: { as: 'role', role: 'QA' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const id = randomUUID();
    await tx.db.insertInto('method').values({ id, number: input.number, title: input.title }).execute();
    return receipt(`Created Method ${input.number}.`, 'audited', { methodId: id });
  },
});

export const createMethodVersion = defineCommand({
  name: 'reference.methodVersion',
  input: z.object({ methodId: uuid, version: z.number().int().min(1), data: MethodDataSchema }),
  acting: { as: 'role', role: 'QA' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const id = randomUUID() as RecordId;
    await tx.db.insertInto('record').values({ ledger_id: COMPANY_LEDGER, id, kind: 'method_version' }).execute();
    await tx.db.insertInto('method_version').values({ id, method_id: input.methodId, version: input.version, data: JSON.stringify(input.data) }).execute();
    const sealed = await tx.records.seal(id);
    return receipt(`Drafted ${sealed.label}. It takes effect when QA signs it Approved.`, 'audited', { recordId: id, version: sealed.version });
  },
});

export const createSpecification = defineCommand({
  name: 'reference.specification',
  input: z.object({ productId: uuid, purpose: z.string().min(1).max(64), data: SpecificationDataSchema }),
  acting: { as: 'role', role: 'QA' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const derivation = derivationGate(derivedSectionsOf(input.data));
    if (!derivation.go) return toRefusal(derivation);
    const id = randomUUID() as RecordId;
    await tx.db.insertInto('record').values({ ledger_id: COMPANY_LEDGER, id, kind: 'specification' }).execute();
    await tx.db.insertInto('specification').values({ id, product_id: input.productId, purpose: input.purpose, data: JSON.stringify(input.data) }).execute();
    const sealed = await tx.records.seal(id);
    return receipt(`Drafted ${sealed.label}. QA signs it Approved, then the Customer accepts it.`, 'audited', { recordId: id, version: sealed.version });
  },
});

/** The Customer Approver's audited accept of an Approved Specification version (decision 22): never a signature. */
export const acceptSpecification = defineCommand({
  name: 'specification.accept',
  input: z.object({ version: VersionRefSchema }),
  acting: { as: 'role', role: 'CustomerApprover' },
  reason: { kind: 'action' },
  ledgers: () => [],
  scope: () => ({ kind: 'company' }),
  run: async (tx, input) => {
    const a = tx.actor;
    if (a.kind !== 'customer') return { kind: 'not-permitted', message: 'A Specification is accepted by a Customer Approver in the portal.' };
    const v = await tx.db.selectFrom('record_version as v').innerJoin('specification as s', 's.id', 'v.record_id').innerJoin('product as p', 'p.id', 's.product_id')
      .select(['v.id', 'v.content_hash', 'p.customer_id', 'p.code']).where('v.id', '=', input.version.versionId).executeTakeFirst();
    if (!v || v.content_hash.toString('hex') !== input.version.hash) return { kind: 'stale-version', shown: input.version.versionId, current: null, message: 'This Specification version is not the one shown. Open it again.' };
    if (v.customer_id !== a.customer) return { kind: 'not-permitted', message: 'This Specification is for another Customer\'s Product.' };
    const approved = await tx.db.selectFrom('signature').select('id').where('record_version_id', '=', v.id).where('meaning', '=', 'Approved').executeTakeFirst();
    if (!approved || !(await versionStands(tx.db, v.id as VersionId))) return { kind: 'transition', message: 'Only a version QA has signed Approved can be accepted.' };
    await tx.db.insertInto('specification_acceptance').values({ id: randomUUID(), specification_version_id: v.id, content_hash: v.content_hash, customer_id: a.customer, accepted_by: a.person }).execute();
    return receipt(`Accepted the Specification for ${v.code}, version ${input.version.hash.slice(0, 8)}. Audited, not signed.`);
  },
});

export const createAdoption = defineCommand({
  name: 'reference.adoption',
  input: z.object({
    methodVersionId: uuid,
    status: z.enum(['in-development', 'validated-here', 'transferred-in', 'verified', 'verified-basic-compendial', 'retired']),
    productIds: z.array(uuid).min(1).max(50),
  }),
  acting: { as: 'role', role: 'QA' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const lab = labOf(tx);
    if (!lab) return { kind: 'not-permitted', message: 'A Method Adoption belongs to a Lab.' };
    const id = randomUUID() as RecordId;
    await tx.db.insertInto('record').values({ ledger_id: ledgerOf(lab), id, kind: 'method_adoption' }).execute();
    await tx.db.insertInto('method_adoption').values({ lab_id: lab, id, method_version_id: input.methodVersionId, status: input.status }).execute();
    await tx.db.insertInto('method_adoption_scope').values(input.productIds.map((p) => ({ lab_id: lab, adoption_id: id, product_id: p }))).execute();
    const sealed = await tx.records.seal(id);
    return receipt(`Drafted ${sealed.label}. It takes effect when QA signs it Approved.`, 'audited', { recordId: id, version: sealed.version });
  },
});

export const createEquipment = defineCommand({
  name: 'reference.equipment',
  input: z.object({ code: z.string().regex(/^[A-Z0-9-]{2,16}$/), kind: z.string().min(1).max(64) }),
  acting: { as: 'role', role: 'LabManager' },
  reason: { kind: 'first_save' },
  ledgers: () => [],
  run: async (tx, input) => {
    const lab = labOf(tx);
    if (!lab) return { kind: 'not-permitted', message: 'Equipment belongs to a Lab.' };
    const id = randomUUID();
    await tx.db.insertInto('equipment').values({ lab_id: lab, id, code: input.code, kind: input.kind, fitness_status: 'In use' }).execute();
    return receipt(`Registered ${input.code} as In use (a stub: Checks are not built in the skeleton).`, 'audited', { equipmentId: id });
  },
});

export const referenceCommands = [createCustomer, createSubstance, createProduct, createMethod, createMethodVersion, createSpecification, acceptSpecification, createAdoption, createEquipment];

