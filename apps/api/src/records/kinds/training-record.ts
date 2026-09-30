// A Training Record: the person's own Acknowledged signature on one Document version. Acknowledged
// needs no Authorisation (decision 13 §1); it needs the Admin's identity check, because the
// e-signature policy acknowledgement is the signing that turns signing on.

import type { RecordId } from '@lims/domain/ids';
import { gateOf, type KindDef } from '../kinds.ts';

export const trainingRecordKind: KindDef = {
  kind: 'training_record',
  fields: {},
  label: async (q, record) => {
    const t = await q.selectFrom('training_record').innerJoin('person', 'person.id', 'training_record.person_id')
      .select(['training_record.document_version', 'person.printed_name']).where('training_record.id', '=', record).executeTakeFirstOrThrow();
    return `Training Record on ${t.document_version} (${t.printed_name})`;
  },
  authorisationScope: async () => 'training_record',
  content: async (q, record) => {
    const t = await q.selectFrom('training_record').selectAll().where('id', '=', record).executeTakeFirstOrThrow();
    return { body: { schema: 'training_record@1', person: t.person_id, documentVersion: t.document_version, level: t.level }, cites: [] };
  },
  signing: {
    Acknowledged: {
      consequence: 'The Training Record becomes current for you.',
      authorisations: [],
      check: async (ctx, signer, sealed) => {
        const owners = await ctx.q.selectFrom('training_record').select('person_id').where('id', 'in', sealed.map((s) => s.record as RecordId)).execute();
        if (owners.some((o) => o.person_id !== signer.person)) return { kind: 'not-permitted', message: 'A Training Record is acknowledged by its own person.' };
        const account = await ctx.q.selectFrom('account').select('identity_checked_at').where('person_id', '=', signer.person).executeTakeFirst();
        return gateOf(account?.identity_checked_at ? [] : [{ code: 'signing-not-enabled', missingSteps: ['identity-check'] }]);
      },
    },
  },
};
