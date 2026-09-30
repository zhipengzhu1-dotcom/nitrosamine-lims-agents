// Download tokens for GET /files/:token. A token is minted by an audited command (the download
// event is the command's row), lives 60 seconds, and is spent by one GET. Tokens are process
// state, never stored: the regulated fact is the audited download, not the token.

import { randomBytes } from 'node:crypto';
import type { LedgerId, Sha256Hex } from '@lims/domain/ids';

export type FileGrant = { readonly ledger: LedgerId; readonly sha256: Sha256Hex; readonly mediaType: string; readonly filename: string };

export const FILE_TOKEN_SECONDS = 60;

export class FileTokens {
  readonly #grants = new Map<string, FileGrant & { readonly expiresAt: number }>();

  mint(grant: FileGrant, now: Date = new Date()): string {
    const token = randomBytes(32).toString('base64url');
    this.#grants.set(token, { ...grant, expiresAt: now.getTime() + FILE_TOKEN_SECONDS * 1000 });
    return token;
  }

  /** The grant a token names, once; null when unknown, spent or expired. */
  consume(token: string, now: Date = new Date()): FileGrant | null {
    const g = this.#grants.get(token);
    if (!g) return null;
    this.#grants.delete(token);
    for (const [t, other] of this.#grants) if (other.expiresAt <= now.getTime()) this.#grants.delete(t);
    if (g.expiresAt <= now.getTime()) return null;
    return { ledger: g.ledger, sha256: g.sha256, mediaType: g.mediaType, filename: g.filename };
  }
}
