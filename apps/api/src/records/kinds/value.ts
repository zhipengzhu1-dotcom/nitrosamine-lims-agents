// The Recorded Value kind: the atom of Critical Data. Its versions are written by Records.record
// and Records.change, so it has no content builder. Verified (before Performed) and Approved
// (after) are the two meanings that make a pending change effective (ADR 0001).

import { verifiedGate } from '@lims/domain/gates';
import type { RecordId } from '@lims/domain/ids';
import type { KindDef, Read } from '../kinds.ts';
import { verifiedFacts, verifierFacts } from '../facts.ts';

async function parentOf(q: Read, value: RecordId) {
  const rv = await q.selectFrom('recorded_value').innerJoin('record', 'record.id', 'recorded_value.parent_id')
    .select(['record.id', 'record.kind']).where('recorded_value.record_id', '=', value).executeTakeFirstOrThrow();
  return { id: rv.id as RecordId, kind: rv.kind };
}

/** The scope is the parent's: a value on a Test needs an Authorisation on the Test's Method. */
export function valueKind(scopeOfParent: (q: Read, parent: { id: RecordId; kind: string }) => Promise<string>): KindDef {
  return {
    kind: 'value',
    fields: {},
    label: async (q, record) => `value ${record}`,
    authorisationScope: async (q, record) => scopeOfParent(q, await parentOf(q, record)),
    content: null,
    signing: {
      Verified: {
        consequence: 'The values are Verified, and any change waiting on them takes effect.',
        authorisations: ['Performed', 'Reviewed'],
        check: async (ctx, signer, sealed) => {
          const scope = await scopeOfParent(ctx.q, await parentOf(ctx.q, sealed[0]!.record));
          const facts = await verifierFacts(ctx.q, signer.person, scope, ctx.lab, ctx.dbNow, ['Performed', 'Reviewed']);
          return verifiedGate(await verifiedFacts(ctx.q, facts, sealed));
        },
      },
      Approved: {
        consequence: 'The proposed values take effect as Approved corrections.',
        authorisations: ['Reviewed', 'Approved'],
        check: async (ctx, signer, sealed) => {
          const scope = await scopeOfParent(ctx.q, await parentOf(ctx.q, sealed[0]!.record));
          const facts = await verifierFacts(ctx.q, signer.person, scope, ctx.lab, ctx.dbNow, ['Reviewed', 'Approved']);
          return verifiedGate(await verifiedFacts(ctx.q, facts, sealed));
        },
      },
    },
  };
}
