import { type DB, postgresFault } from '@lims/db';
import type { ActorContext, Meaning, SignatureStatement } from '@lims/domain';
import { type Kysely, sql } from 'kysely';
import type { Reauthenticated } from './auth.ts';
import { refuse } from './refuse.ts';
import type { LabQueries, WriteQueries } from './scope.ts';

/** The records a Signature can be given on, each with its own canonical content in the database. */
export type Signable =
  | 'test'
  | 'test_report'
  | 'system_incident'
  | 'equipment'
  | 'equipment_event'
  | 'test_review'
  | 'review_checklist_version';

/** The Record Version the signer saw: its id and the hash the sheet showed. */
export interface Seen {
  id: string;
  contentHash: string;
}

/** What a signing of one record binds: its proof, the meaning, the record, the version seen, the statement version and the release. */
export interface RecordSigning {
  proof: string;
  sessionId: string;
  meaning: Meaning;
  table: Signable;
  recordId: string;
  seen: Seen;
  statementVersion: number;
  release: string;
}

/**
 * Writes the single-use re-authentication record a signing names, in the session's Lab, for the person the step
 * re-authenticated, naming what proved them; it is written only after `reauthenticate` proved the credentials, by the
 * write it enables.
 */
export async function proveReauthentication(
  q: WriteQueries,
  ctx: ActorContext,
  sessionId: string,
  meaning: Meaning,
  reauthenticated: Reauthenticated,
): Promise<string> {
  const proof = await q
    .insert('reauthentication', {
      sessionId,
      personId: ctx.person.id,
      meaning,
      authenticator: reauthenticated.authenticator,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return proof.id;
}

/** Signs through lims.sign, the only path to a Signature, against the re-authentication record written here. */
export async function signRecord(q: WriteQueries, signing: RecordSigning) {
  const { proof, sessionId, meaning, table, recordId, seen, statementVersion, release } = signing;
  await sql`select lims.sign(${proof}, ${sessionId}, ${table}, ${recordId}, ${seen.id},
                             decode(${seen.contentHash}, 'hex'), ${statementVersion}, ${meaning}, ${release})`
    .execute(q.company)
    .catch(signingRefused);
}

/** lims.sign's own refusal (LA010) reaches the bench as a refusal; any other failure is thrown with its cause. */
export function signingRefused(error: unknown): never {
  if (postgresFault(error)?.sqlstate === 'LA010' && error instanceof Error)
    refuse('signingRefused', `The Signature was refused: ${error.message}.`);
  throw new Error('signing failed', { cause: error });
}

/** The signature statement with the highest version: what the sheet shows and what lims.sign records. */
export function statementInForce(company: Kysely<DB>): Promise<SignatureStatement> {
  return company
    .selectFrom('signatureStatement')
    .select(['version', sql<string>`convert_from(statement, 'UTF8')`.as('text')])
    .orderBy('version', 'desc')
    .executeTakeFirstOrThrow();
}

/**
 * The record's latest Record Version, which the database wrote as it changed: what a Signature given now binds to. Every
 * signable row has one, because the `version_record` trigger writes it on insert, so a missing one throws as a broken
 * invariant.
 */
export function latestVersion(q: LabQueries, table: Signable, recordId: string) {
  return q
    .from('recordVersion')
    .select(['id', 'version', 'canonicalForm', sql<string>`encode(content_hash, 'hex')`.as('contentHash')])
    .where('recordTable', '=', table)
    .where('recordId', '=', recordId)
    .orderBy('version', 'desc')
    .executeTakeFirstOrThrow();
}
