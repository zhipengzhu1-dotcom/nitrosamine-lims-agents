import { type DB, postgresFault } from '@lims/db';
import type { ActorContext, Meaning, SignatureStatement } from '@lims/domain';
import { type Kysely, sql } from 'kysely';
import { refuse } from './refuse.ts';
import type { WriteQueries } from './scope.ts';

/** The records a Signature can be given on, each with its own canonical content in the database. */
export type Signable = 'test' | 'test_report' | 'system_incident' | 'equipment' | 'equipment_event';

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
 * re-authenticated; it is written only after `reauthenticate` proved the password, by the write it enables.
 */
export async function proveReauthentication(
  q: WriteQueries,
  ctx: ActorContext,
  sessionId: string,
  meaning: Meaning,
): Promise<string> {
  const proof = await q
    .insert('reauthentication', { sessionId, personId: ctx.person.id, meaning, authenticator: 'Password' })
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
