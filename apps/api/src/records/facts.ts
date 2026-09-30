// Fact loaders for the person-level checks every signing gate makes. Each reads through the
// scoped handle and computes every "is it current at dbNow" standing here, from the database
// clock. Gates never see a row or a clock. Method training and the per-record facts (assignment,
// Performed, Reviewed, Released) belong to the sample-chain kinds, built on these.

import { sql } from 'kysely';
import { versionStands, type DB, type ReadDb } from '@lims/db';
import type { AuthorisationStanding, SigningEnablement, TrainingStanding, VerifiedFacts, VerifierFacts } from '@lims/domain/gates';
import type { LabId, PersonId, VersionId } from '@lims/domain/ids';
import { nonEmpty } from '@lims/domain/nonempty';
import type { Meaning } from '@lims/domain/signing';
import type { Sealed } from './index.ts';

type Q = ReadDb<DB>;

/** The Document versions decision 13's enabling steps name. Their identities are a spec gap the design records. */
export const ENABLEMENT_DOCUMENTS = { policy: 'POL-ESIG@1', limsUse: 'SOP-LIMS@1' } as const;

/** Current when the person's Acknowledged signature stands on their Training Record for the document. */
export async function trainingStanding(q: Q, person: PersonId, documentVersion: string): Promise<TrainingStanding> {
  const rows = await q.selectFrom('training_record').innerJoin('effective_version', 'effective_version.record_id', 'training_record.id')
    .innerJoin('signature', 'signature.record_version_id', 'effective_version.id')
    .select('effective_version.id')
    .where('training_record.person_id', '=', person).where('training_record.document_version', '=', documentVersion)
    .where('signature.meaning', '=', 'Acknowledged').where('signature.signer_person_id', '=', person).execute();
  for (const r of rows) {
    if (await versionStands(q, r.id as VersionId)) return { kind: 'current', documentVersion };
  }
  return { kind: 'missing', documentVersion };
}

/** Decision 13 §1's three enabling steps, plus decision 19 §7's LIMS-use training. */
export async function signingEnablement(q: Q, person: PersonId): Promise<SigningEnablement> {
  const account = await q.selectFrom('account').select('identity_checked_at').where('person_id', '=', person).executeTakeFirst();
  const missing = [
    ...(account?.identity_checked_at ? [] : ['identity-check' as const]),
    ...((await trainingStanding(q, person, ENABLEMENT_DOCUMENTS.policy)).kind === 'current' ? [] : ['policy-acknowledged' as const]),
    ...((await trainingStanding(q, person, ENABLEMENT_DOCUMENTS.limsUse)).kind === 'current' ? [] : ['lims-use-training' as const]),
  ];
  const steps = nonEmpty(missing);
  return steps ? { kind: 'not-enabled', missingSteps: steps } : { kind: 'enabled' };
}

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The best standing among the person's Authorisations for one meaning and scope in one Lab: current
 * when an effective version carries a standing Approved signature, today is inside its validity,
 * and it is not suspended.
 */
export async function authorisationStanding(q: Q, person: PersonId, meaning: Meaning, scope: string, lab: LabId | null, dbNow: Date): Promise<AuthorisationStanding> {
  if (!lab) return { kind: 'missing', meaning, scope };
  const rows = await q.selectFrom('authorisation').innerJoin('effective_version', 'effective_version.record_id', 'authorisation.id')
    .select([sql<string>`authorisation.valid_from::text`.as('valid_from'), sql<string>`authorisation.valid_until::text`.as('valid_until'), 'authorisation.suspended_at', 'effective_version.id as version'])
    .where('authorisation.person_id', '=', person).where('authorisation.meaning', '=', meaning).where('authorisation.scope', '=', scope)
    .where('authorisation.lab_id', '=', lab).execute();
  const today = dateOnly(dbNow);
  let best: AuthorisationStanding = { kind: 'missing', meaning, scope };
  for (const r of rows) {
    const approved = await q.selectFrom('signature').select('id').where('record_version_id', '=', r.version).where('meaning', '=', 'Approved').executeTakeFirst();
    if (!approved || !(await versionStands(q, r.version as VersionId))) continue;
    const from = r.valid_from;
    const until = r.valid_until;
    if (r.suspended_at) best = { kind: 'suspended', meaning, scope };
    else if (today < from || today >= until) { if (best.kind === 'missing') best = { kind: 'expired', meaning, scope, validUntil: until }; }
    else return { kind: 'current', meaning, scope, validUntil: until };
  }
  return best;
}

/** Verified needs a current Performed or Reviewed Authorisation on the record's scope (decision 19). */
export async function verifierFacts(q: Q, person: PersonId, scope: string, lab: LabId | null, dbNow: Date, meanings: readonly [Meaning, ...Meaning[]]): Promise<VerifierFacts> {
  const [first, ...rest] = meanings;
  return {
    person,
    authorisations: [await authorisationStanding(q, person, first, scope, lab, dbNow), ...(await Promise.all(rest.map((m) => authorisationStanding(q, person, m, scope, lab, dbNow))))],
    signing: await signingEnablement(q, person),
  };
}

/** The value versions a Verified group signing covers: who typed each, and who proposed the pending one. */
export async function verifiedFacts(q: Q, signer: VerifierFacts, sealed: readonly Sealed[]): Promise<VerifiedFacts> {
  const values = await Promise.all(sealed.map(async (s) => {
    const versions = await q.selectFrom('record_version').select(['id', 'created_by', 'requires_approval']).where('record_id', '=', s.record).execute();
    const target = versions.find((v) => v.id === s.version.versionId);
    return {
      label: s.label,
      authors: [...new Set(versions.map((v) => v.created_by as PersonId))],
      proposer: target?.requires_approval ? (target.created_by as PersonId) : null,
    };
  }));
  const list = nonEmpty(values);
  if (!list) throw new Error('a Verified signing covers at least one value');
  return { signer, values: list };
}
