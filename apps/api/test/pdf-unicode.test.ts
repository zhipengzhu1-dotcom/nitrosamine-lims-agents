// A Customer or signer whose name is not Latin-1 must still get an issued PDF that prints the name,
// and the bytes must stay a pure function of the input, since their SHA-256 is recorded at release.
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { LabId, RecordId } from '@lims/domain/ids';
import { renderReportPdf, type RenderInput } from '../src/chain/pdf.ts';
import type { Q, RecordStanding } from '../src/chain/facts.ts';

const noStanding: RecordStanding = { version: null, signatures: [], stands: false };
const signedAt = new Date('2026-07-14T13:09:10Z');

function input(customerName: string, signerName: string): RenderInput {
  return {
    report: {
      id: 'rep-1' as RecordId, labId: 'lab-1' as LabId, number: 'TR-0001', label: 'Test Report TR-0001', state: 'Released',
      customer: { id: 'cus-1', code: 'C01', name: customerName }, submission: { id: 'sub-1', number: 'S-0001' },
      tests: [], standing: noStanding, issue: null,
    },
    lab: { id: 'lab-1' as LabId, code: 'NYC', zone: 'America/New_York' },
    releasedSignature: { id: 'sig-1', meaning: 'Released', signedAt, printedName: signerName, username: 'wfang', role: 'QA', version: { hash: 'ab'.repeat(32), versionNo: 1 } },
    body: {},
  };
}

/** Every code point the PDF's ToUnicode maps declare, i.e. what a reader extracts as text. */
function extractableCodePoints(pdf: Uint8Array): Set<number> {
  const raw = Buffer.from(pdf).toString('latin1');
  const found = new Set<number>();
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let text: string;
    try { text = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1'); } catch { continue; }
    if (!text.includes('beginbfchar') && !text.includes('beginbfrange')) continue;
    for (const [, utf16] of text.matchAll(/<[0-9A-Fa-f]+>\s*<([0-9A-Fa-f]+)>/g)) {
      found.add(String.fromCharCode(...utf16!.match(/.{4}/g)!.map((h) => parseInt(h, 16))).codePointAt(0)!);
    }
  }
  return found;
}

const q = {} as Q;

describe('the issued PDF prints names in any script', () => {
  it('renders a Chinese signer and a Vietnamese Customer, and their characters extract back', async () => {
    const pdf = await renderReportPdf(q, input('Công ty Dược phẩm Đặng', '王芳'));
    const mapped = extractableCodePoints(pdf);
    for (const ch of '王芳Đặượô') expect(mapped, `${ch} has a glyph that maps back to it`).toContain(ch.codePointAt(0));
  });

  it('renders the same input to the same bytes', async () => {
    const [a, b] = await Promise.all([renderReportPdf(q, input('Đặng Pharma', '王芳')), renderReportPdf(q, input('Đặng Pharma', '王芳'))]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
