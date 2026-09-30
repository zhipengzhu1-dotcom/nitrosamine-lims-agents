// Every Electronic Signature, of every meaning, on every record kind, goes through these two
// commands. The SignaturePrompt calls prepare when it opens and sign when the person presses the
// final button.
//
//   signing.prepare  seals each target (idempotent), returns what is being signed (version, full
//                    hash, body, pending changes old -> new), the consequence, and the server's
//                    eligibility answer per role, before any credential is asked for (rule 5).
//   signing.sign     re-authenticates in full, then Records.sign with the version refs the prompt
//                    showed. One commit key per attempt.
// Both act under the role the meaning requires: the signature row and the audit entry take it
// from the same context, so there is no "self" role.

import { z } from 'zod';
import { MeaningSchema, CredentialsSchema, type PreparedSigningDto } from '@lims/contract';
import { RecordIdSchema, VersionRefSchema } from '../wire.ts';
import { describeReasons } from '@lims/domain/refusal';
import { SIGNS_AS, STATEMENT, type Meaning } from '@lims/domain/signing';
import { holdsRole, type ActorContext } from '../actor.ts';
import { receipt, type CommandTx } from '../commit.ts';
import { defineCommand } from '../doors.ts';
import { LOCKOUT_AFTER, reauthenticate } from '../identity/reauth.ts';
import { authorisationStanding } from '../records/facts.ts';
import type { Sealed } from '../records/index.ts';

const roleAllowed = (meaning: Meaning, role: string): boolean => (SIGNS_AS[meaning] as readonly string[]).includes(role);

const versionDto = (v: Sealed['version']) => ({ versionId: v.versionId, versionNo: v.versionNo, hash: v.hash });

async function eligibility(tx: CommandTx, actor: ActorContext, meaning: Meaning, sealed: readonly Sealed[]): Promise<PreparedSigningDto['eligibility']> {
  const def = tx.deps.kinds.get(sealed[0]!.kind);
  const rule = def.signing[meaning];
  const roles = SIGNS_AS[meaning].filter((r) => holdsRole(actor, r));
  const scope = await def.authorisationScope(tx.db, sealed[0]!.record);
  const lab = actor.kind === 'staff' ? actor.lab : actor.kind === 'service' ? actor.lab : null;
  const byRole = await Promise.all(roles.map(async (role) => {
    const answer = rule ? await rule.check({ q: tx.db, dbNow: tx.dbNow, lab }, { person: actor.person, role }, sealed) : null;
    const reasons = answer === null ? [`${sealed[0]!.label} does not carry the meaning ${meaning}.`]
      : 'kind' in answer ? [answer.message]
      : answer.go ? [] : answer.reasons.map((r) => describeReasons([r]));
    let current: { meaning: Meaning; scope: string; validUntil: string } | null = null;
    for (const m of rule?.authorisations ?? [meaning]) {
      const standing = await authorisationStanding(tx.db, actor.person, m, scope, lab, tx.dbNow);
      if (standing.kind === 'current') { current = { meaning: standing.meaning, scope: standing.scope, validUntil: standing.validUntil }; break; }
    }
    return { role, eligible: reasons.length === 0, reasons, authorisation: current };
  }));
  const lockout = await tx.db.selectFrom('lockout_state').select('consecutive_failures').where('person_id', '=', actor.person).executeTakeFirst();
  return { byRole, attemptsLeft: Math.max(0, LOCKOUT_AFTER - Number(lockout?.consecutive_failures ?? 0)) };
}

export const prepareSigning = defineCommand({
  name: 'signing.prepare',
  input: z.object({
    meaning: MeaningSchema,
    role: z.string().min(1),
    targets: z.array(RecordIdSchema).min(1).max(50),
    attestation: RecordIdSchema.nullable().default(null),
  }),
  acting: { as: 'role-from-input', role: (i) => i.role },
  reason: { kind: 'first_save' }, // sealing a version is a first save
  ledgers: () => [],
  run: async (tx, input) => {
    if (!roleAllowed(input.meaning, input.role)) return { kind: 'not-permitted', message: `${input.meaning} is not signed as ${input.role}.` };
    const actor = tx.actor;
    if (actor.kind === 'nobody' || actor.kind === 'locked') throw new Error('prepare acts in a live session');
    const sealed: Sealed[] = [];
    for (const r of input.targets) sealed.push(await tx.records.seal(r));
    const attestation = input.attestation ? await tx.records.seal(input.attestation) : null;
    const def = tx.deps.kinds.get(sealed[0]!.kind);
    const data: PreparedSigningDto = {
      meaning: input.meaning,
      statement: STATEMENT[input.meaning],
      items: sealed.map((s) => ({
        record: s.record, kind: s.kind, label: s.label, version: versionDto(s.version), body: s.body,
        pendingChanges: s.pendingChanges.map((p) => ({ value: p.value, label: p.label, from: p.fromBody, to: p.toBody })),
      })),
      attestation: attestation ? versionDto(attestation.version) : null,
      consequence: def.signing[input.meaning]?.consequence ?? '',
      eligibility: await eligibility(tx, actor, input.meaning, sealed),
    };
    return receipt('Ready to sign.', 'audited', data);
  },
});

export const sign = defineCommand({
  name: 'signing.sign',
  input: z.object({
    meaning: MeaningSchema,
    role: z.string().min(1),
    targets: z.array(VersionRefSchema).min(1).max(50),
    attestation: VersionRefSchema.nullable().default(null),
    credentials: CredentialsSchema,
  }),
  acting: { as: 'role-from-input', role: (i) => i.role },
  reason: { kind: 'action' },
  ledgers: () => [],
  run: async (tx, input) => {
    if (!roleAllowed(input.meaning, input.role)) return { kind: 'not-permitted', message: `${input.meaning} is not signed as ${input.role}.` };
    const actor = tx.actor;
    if (actor.kind !== 'staff' && actor.kind !== 'admin' && actor.kind !== 'customer') {
      return { kind: 'not-permitted', message: 'A signature is given in the signer\'s own session.' };
    }
    const signer = await reauthenticate(tx, actor, input.role, input.credentials, 'signing');
    if ('kind' in signer) return signer;
    const rows = await tx.records.sign({ signer, meaning: input.meaning, targets: input.targets, attestation: input.attestation });
    if ('kind' in rows) return rows;
    return receipt(`Signed ${input.meaning}: ${rows.length} record${rows.length === 1 ? '' : 's'}.`, 'signed', {
      signatures: rows.map((r) => ({ id: r.id, record: r.record, version: versionDto(r.version), meaning: r.meaning, signedAtUtc: r.signedAt.toISOString() })),
    });
  },
});

export const signingCommands = [prepareSigning, sign];
