import type { DB } from '@lims/db';
import { type Kysely, sql, type Transaction } from 'kysely';
import { acceptedStep, openSecret } from './totp.ts';

export type CodeFailure = 'WrongCode' | 'NoAuthenticator';

/** A code `checkCode` found current and unspent: the time step it is the code of, or null under a login with no second factor. */
export interface CodeProof {
  step: number | null;
}
export type CodeCheck = CodeProof | { refused: CodeFailure };

/**
 * Checks `code` against the person's authenticator at the database clock's time step, writing nothing: answers the
 * step it is the code of, or why it is refused. The caller spends the step with `spendCode` in the transaction that
 * writes what the code enables, so a request refused after the check leaves the code unspent.
 */
export async function checkCode(
  db: Kysely<DB>,
  totp: { secondFactor: boolean; key: Buffer },
  personId: string,
  code: string | undefined,
): Promise<CodeCheck> {
  if (!totp.secondFactor) return { step: null };
  const enrolled = await db
    .selectFrom('authenticator')
    .select(['secretCiphertext', 'lastUsedStep'])
    .where('personId', '=', personId)
    .executeTakeFirst();
  if (!enrolled) return { refused: 'NoAuthenticator' };
  const { rows } = await sql<{
    ms: string;
  }>`select (extract(epoch from clock_timestamp()) * 1000)::bigint as ms`.execute(db);
  const step = acceptedStep(
    openSecret(totp.key, enrolled.secretCiphertext),
    code ?? '',
    Number(rows[0]?.ms),
    enrolled.lastUsedStep === null ? null : Number(enrolled.lastUsedStep),
  );
  return step === null ? { refused: 'WrongCode' } : { step };
}

/**
 * Spends the checked step in `tx`, the arbiter between requests with one code: the conditional update moves the last
 * used step forward or touches no row, and answers false when another request spent this step, or a later one, first.
 * The caller then refuses as a wrong code and writes nothing. Call it after the person's row is held, so every
 * transaction takes the person before the authenticator.
 */
export async function spendCode(tx: Transaction<DB>, personId: string, proof: CodeProof): Promise<boolean> {
  if (proof.step === null) return true;
  const step = String(proof.step);
  const spent = await tx
    .updateTable('authenticator')
    .set({ lastUsedStep: step })
    .where('personId', '=', personId)
    .where((eb) => eb.or([eb('lastUsedStep', 'is', null), eb('lastUsedStep', '<', step)]))
    .executeTakeFirst();
  return spent.numUpdatedRows > 0n;
}
