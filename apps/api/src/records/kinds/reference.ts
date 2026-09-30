// The seeded reference kinds: a Method version and a Specification (company records) and a
// Method Adoption (a Lab record). Each takes effect when QA signs it Approved. Their structured
// data lives on the head as identity and is sealed into the version's bytes unchanged.

import { cite } from '@lims/domain/canonical';
import type { RecordId } from '@lims/domain/ids';
import { adoptionStatusGate, toRefusal, type AdoptionStatusFacts } from '@lims/domain/gates';
import { adoptionStatusFacts, loadMethodVersion } from '../../chain/facts.ts';
import { MethodDataSchema, SpecificationDataSchema, asCanon } from '../../chain/model.ts';
import { signingEnablement } from '../facts.ts';
import { gateOf, type KindDef, type SigningRule } from '../kinds.ts';

/** QA signs reference data Approved; the enabling steps are the only person-level check (decision 13 §1). */
const approvedByQa = (consequence: string): SigningRule => ({
  consequence,
  authorisations: [],
  check: async (ctx, signer) => {
    if (signer.role !== 'QA') return { kind: 'not-permitted', message: 'Only QA signs this Approved.' };
    const enablement = await signingEnablement(ctx.q, signer.person);
    return gateOf(enablement.kind === 'enabled' ? [] : [{ code: 'signing-not-enabled', missingSteps: enablement.missingSteps }]);
  },
});

export const methodVersionKind: KindDef = {
  kind: 'method_version',
  fields: {},
  label: async (q, record) => {
    const mv = await q.selectFrom('method_version as mv').innerJoin('method as m', 'm.id', 'mv.method_id').select(['m.number', 'mv.version']).where('mv.id', '=', record).executeTakeFirstOrThrow();
    return `Method ${mv.number} v${mv.version}`;
  },
  authorisationScope: async () => 'method_version',
  content: async (q, record) => {
    const mv = await q.selectFrom('method_version as mv').innerJoin('method as m', 'm.id', 'mv.method_id')
      .select(['m.number', 'm.title', 'mv.version', 'mv.data']).where('mv.id', '=', record).executeTakeFirstOrThrow();
    return { body: { schema: 'method_version@1', method: mv.number, title: mv.title, version: String(mv.version), data: asCanon(MethodDataSchema.parse(mv.data)) }, cites: [] };
  },
  signing: { Approved: approvedByQa('The Method version is Approved and may be adopted and pinned by Tests.') },
};

export const specificationKind: KindDef = {
  kind: 'specification',
  fields: {},
  label: async (q, record) => {
    const s = await q.selectFrom('specification as s').innerJoin('product as p', 'p.id', 's.product_id').select(['p.code', 's.purpose']).where('s.id', '=', record).executeTakeFirstOrThrow();
    return `Specification ${s.code} (${s.purpose})`;
  },
  authorisationScope: async () => 'specification',
  content: async (q, record) => {
    const s = await q.selectFrom('specification as s').innerJoin('product as p', 'p.id', 's.product_id')
      .select(['s.id', 's.purpose', 's.data', 'p.id as product_id', 'p.code', 'p.name']).where('s.id', '=', record).executeTakeFirstOrThrow();
    return {
      body: { schema: 'specification@2', specification: s.id, product: { id: s.product_id, code: s.code, name: s.name }, purpose: s.purpose, data: asCanon(SpecificationDataSchema.parse(s.data)) },
      cites: [],
    };
  },
  signing: { Approved: approvedByQa('The Specification version is Approved; it becomes selectable once the Customer accepts it.') },
};

export const methodAdoptionKind: KindDef = {
  kind: 'method_adoption',
  fields: {},
  label: async (q, record) => {
    const a = await q.selectFrom('method_adoption').select(['method_version_id', 'status']).where('id', '=', record).executeTakeFirstOrThrow();
    const mv = await loadMethodVersion(q, a.method_version_id);
    return `Method Adoption of ${mv.number} v${mv.version} (${a.status})`;
  },
  authorisationScope: async (q, record) => {
    const a = await q.selectFrom('method_adoption').select('method_version_id').where('id', '=', record).executeTakeFirstOrThrow();
    return (await loadMethodVersion(q, a.method_version_id)).number;
  },
  content: async (q, record) => {
    const a = await q.selectFrom('method_adoption').select(['lab_id', 'method_version_id', 'status']).where('id', '=', record).executeTakeFirstOrThrow();
    const mv = await loadMethodVersion(q, a.method_version_id);
    if (!mv.ref) throw new Error(`Method version ${mv.number} v${mv.version} is not sealed`);
    const scope = await q.selectFrom('method_adoption_scope').select('product_id').where('adoption_id', '=', record).orderBy('product_id').execute();
    return {
      body: { schema: 'method_adoption@1', adoption: record, lab: a.lab_id, method: { number: mv.number, version: String(mv.version), ...(cite(mv.ref) as object) }, status: a.status, products: scope.map((s) => s.product_id) },
      cites: [mv.ref],
    };
  },
  signing: {
    Approved: {
      ...approvedByQa('The Adoption takes effect: GMP Tests on these Products may be accepted in this Lab.'),
      check: async (ctx, signer, sealed) => {
        for (const s of sealed) {
          const a = await ctx.q.selectFrom('method_adoption').select(['method_version_id', 'status']).where('id', '=', s.record as RecordId).executeTakeFirstOrThrow();
          const mv = await loadMethodVersion(ctx.q, a.method_version_id);
          if (!mv.approved) return { kind: 'not-permitted', message: `${mv.number} v${mv.version} is not Approved, so it cannot be adopted.` };
          const gate = adoptionStatusGate(await adoptionStatusFacts(ctx.q, mv, a.status as AdoptionStatusFacts['status']));
          if (!gate.go) return toRefusal(gate);
        }
        return approvedByQa('').check(ctx, signer, sealed, null);
      },
    },
  },
};
