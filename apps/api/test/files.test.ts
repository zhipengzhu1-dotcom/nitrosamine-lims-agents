// The report store and the file door: a stored file is named by its SHA-256 and served once per
// token, and a token is spent by its first use.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMPANY_LEDGER, SERVICE, readBlob, runAudited, sha256Hex, storeBlob } from '@lims/db';
import type { Sha256Hex } from '@lims/domain/ids';
import { FILE_TOKEN_SECONDS, FileTokens } from '../src/files.ts';
import { testApi, type TestApi } from '../src/testing/harness.ts';

let api: TestApi;
const bytes = new TextEncoder().encode('%PDF-1.7 fictional');
let sha: Sha256Hex;

beforeAll(async () => {
  api = await testApi();
  const out = await runAudited(api.db.app, {
    person: SERVICE.seed.person, role: SERVICE.seed.role, actingLab: null, customer: null, action: 'test.store', reason: { kind: 'first_save' },
    appRelease: 'test', session: null, commitKey: randomUUID() as never, ledgers: [COMPANY_LEDGER],
  }, { kind: 'company' }, async (tx) => ({ commit: await storeBlob(tx, api.deps.reportStore, COMPANY_LEDGER, bytes, 'application/pdf') }));
  if (!('commit' in out)) throw new Error('store rolled back');
  sha = out.commit;
});
afterAll(() => api.close());

describe('the blob store', () => {
  it('names the file by its hash, records the blob row once, and reads it back rehashed', async () => {
    expect(sha).toBe(sha256Hex(bytes));
    expect(await readBlob(api.deps.reportStore, COMPANY_LEDGER, sha)).toEqual(Buffer.from(bytes));
    const rows = await api.db.app.selectFrom('blob').select(['media_type', 'size_bytes']).where('ledger_id', '=', COMPANY_LEDGER).execute();
    expect(rows).toEqual([{ media_type: 'application/pdf', size_bytes: String(bytes.byteLength) }]);
    expect(await readBlob(api.deps.reportStore, COMPANY_LEDGER, '0'.repeat(64) as Sha256Hex)).toBeNull();
  });

  it('refuses to serve a file whose bytes no longer hash to its name', async () => {
    const tampered = new TextEncoder().encode('tampered');
    const name = sha256Hex(tampered);
    await writeFile(join(api.deps.reportStore, COMPANY_LEDGER, name), 'changed after storage');
    await expect(readBlob(api.deps.reportStore, COMPANY_LEDGER, name)).rejects.toThrow(/does not hash to its name/);
  });
});

describe('GET /files/:token', () => {
  it('serves the file once for a minted token, with its hash in a header, and refuses the second use', async () => {
    const token = api.deps.fileTokens.mint({ ledger: COMPANY_LEDGER, sha256: sha, mediaType: 'application/pdf', filename: 'RD-TR-2026-000001.pdf' });
    const first = await api.app.inject({ method: 'GET', url: `/files/${token}` });
    expect(first.statusCode).toBe(200);
    expect(first.headers['x-lims-sha256']).toBe(sha);
    expect(first.headers['content-disposition']).toBe('attachment; filename="RD-TR-2026-000001.pdf"');
    expect(sha256Hex(first.rawPayload)).toBe(sha);
    expect((await api.app.inject({ method: 'GET', url: `/files/${token}` })).statusCode).toBe(404);
    expect((await api.app.inject({ method: 'GET', url: '/files/no-such-token' })).statusCode).toBe(404);
  });

  it('a token older than 60 seconds is spent', () => {
    const tokens = new FileTokens();
    const minted = new Date('2026-09-30T10:00:00Z');
    const t = tokens.mint({ ledger: COMPANY_LEDGER, sha256: sha, mediaType: 'application/pdf', filename: 'x.pdf' }, minted);
    expect(tokens.consume(t, new Date(minted.getTime() + FILE_TOKEN_SECONDS * 1000))).toBeNull();
    const t2 = tokens.mint({ ledger: COMPANY_LEDGER, sha256: sha, mediaType: 'application/pdf', filename: 'x.pdf' }, minted);
    expect(tokens.consume(t2, new Date(minted.getTime() + FILE_TOKEN_SECONDS * 1000 - 1))).toMatchObject({ sha256: sha });
  });
});
