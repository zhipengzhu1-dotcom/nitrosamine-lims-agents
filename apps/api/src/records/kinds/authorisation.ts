// An Authorisation: QA's grant of one meaning within a scope in one Lab (decision 13 §1). It takes
// effect when QA signs it Approved. Nobody grants their own. The QA signer's own standing to sign
// Approved on Authorisations is not itself an Authorisation (that would never bootstrap), so the
// rule asks for the QA role and the three enabling steps.

import { sql } from 'kysely';
import type { RecordId } from '@lims/domain/ids';
import { gateOf, type KindDef } from '../kinds.ts';
import { signingEnablement } from '../facts.ts';

export const authorisationKind: KindDef = {
  kind: 'authorisation',
  fields: {},
  label: async (q, record) => {
    const a = await q.selectFrom('authorisation').innerJoin('person', 'person.id', 'authorisation.person_id')
      .select(['authorisation.meaning', 'authorisation.scope', 'person.printed_name']).where('authorisation.id', '=', record).executeTakeFirstOrThrow();
    return `${a.meaning} Authorisation for ${a.scope} (${a.printed_name})`;
  },
  authorisationScope: async () => 'authorisation',
  content: async (q, record) => {
    const a = await q.selectFrom('authorisation')
      .select(['person_id', 'meaning', 'scope', 'lab_id', sql<string>`valid_from::text`.as('valid_from'), sql<string>`valid_until::text`.as('valid_until')])
      .where('id', '=', record).executeTakeFirstOrThrow();
    return {
      body: { schema: 'authorisation@1', person: a.person_id, meaning: a.meaning, scope: a.scope, lab: a.lab_id, validFrom: a.valid_from, validUntil: a.valid_until },
      cites: [],
    };
  },
  signing: {
    Approved: {
      consequence: 'The Authorisation takes effect from its valid-from date.',
      authorisations: [],
      check: async (ctx, signer, sealed) => {
        if (signer.role !== 'QA') return { kind: 'not-permitted', message: 'Only QA signs an Authorisation Approved.' };
        const grantees = await ctx.q.selectFrom('authorisation').select('person_id').where('id', 'in', sealed.map((s) => s.record as RecordId)).execute();
        if (grantees.some((g) => g.person_id === signer.person)) return { kind: 'not-permitted', message: 'Nobody grants their own Authorisation.' };
        const enablement = await signingEnablement(ctx.q, signer.person);
        return gateOf(enablement.kind === 'enabled' ? [] : [{ code: 'signing-not-enabled', missingSteps: enablement.missingSteps }]);
      },
    },
  },
};
