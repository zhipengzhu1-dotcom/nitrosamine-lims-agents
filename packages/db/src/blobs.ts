// The content-addressed file store on the report-store volume. A file's name is its SHA-256, so
// storing the same bytes twice is one file, and a stored hash is checkable by rehashing the file.
// The lims.blob row is written in the caller's audited transaction; the file is written before
// it, so a rolled-back transaction leaves at most an unreferenced file, never a row without a file.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuditedTx } from './audited.ts';
import type { LedgerId, Sha256Hex } from '@lims/domain/ids';

export const sha256Hex = (bytes: Uint8Array): Sha256Hex => createHash('sha256').update(bytes).digest('hex') as Sha256Hex;

const pathOf = (dir: string, ledger: LedgerId, sha256: Sha256Hex): string => join(dir, ledger, sha256);

export async function storeBlob(tx: AuditedTx, dir: string, ledger: LedgerId, bytes: Uint8Array, mediaType: string): Promise<Sha256Hex> {
  const sha256 = sha256Hex(bytes);
  const path = pathOf(dir, ledger, sha256);
  await mkdir(join(dir, ledger), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, bytes, { mode: 0o600 });
  await rename(tmp, path);
  await tx.db.insertInto('blob').values({ ledger_id: ledger, sha256: Buffer.from(sha256, 'hex'), size_bytes: bytes.byteLength, media_type: mediaType })
    .onConflict((oc) => oc.columns(['ledger_id', 'sha256']).doNothing()).execute();
  return sha256;
}

/** The stored bytes, rehashed on the way out so a corrupted file is never served as its hash. */
export async function readBlob(dir: string, ledger: LedgerId, sha256: Sha256Hex): Promise<Buffer | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(pathOf(dir, ledger, sha256));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  if (sha256Hex(bytes) !== sha256) throw new Error(`blob ${sha256} does not hash to its name`);
  return bytes;
}
