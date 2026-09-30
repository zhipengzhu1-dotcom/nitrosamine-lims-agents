// The issued Test Report PDF, rendered inside the releasing transaction from the signed content
// and the signature rows on the versions it cites. Limits and results print as the stored strings.
// Nothing here computes a verdict: it prints what the Test version's judgement recorded.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Canon } from '@lims/domain/canonical';
import type { LabId, RecordId } from '@lims/domain/ids';
import type { Meaning } from '@lims/domain/signing';
import { recordStanding, type Q, type ReportFacts, type SignatureFact } from './facts.ts';

export type RenderInput = {
  readonly report: ReportFacts;
  readonly lab: { readonly id: LabId; readonly code: string; readonly zone: string };
  readonly releasedSignature: { readonly id: string; readonly meaning: Meaning; readonly signedAt: Date; readonly printedName: string; readonly username: string; readonly role: string; readonly version: { readonly hash: string; readonly versionNo: number } };
  /** The Released version's body as sealed, for what the report says about itself. */
  readonly body: Canon;
};

const utc = (d: Date): string => d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
const local = (d: Date, zone: string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short', hour12: false }).format(d);

type Judgement = {
  kind: string;
  outcome?: string;
  sections?: { jurisdiction: string; ruleSetVersion: string; calculation: string; outcome: string;
    reportable: { kind: string; analyte: string; limit: string; compared?: string; conforms?: boolean; sharePercent?: string; because?: string }[];
    preparations: { preparation: string; lines: { analyte: string; compared: string; conforms: boolean }[] }[] }[];
};

class Writer {
  #page: PDFPage;
  #y: number;
  readonly #doc: PDFDocument;
  readonly #font: PDFFont;
  readonly #bold: PDFFont;
  readonly #mono: PDFFont;

  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont, mono: PDFFont) {
    this.#doc = doc; this.#font = font; this.#bold = bold; this.#mono = mono;
    this.#page = doc.addPage([595.28, 841.89]);
    this.#y = 800;
  }

  #ensure(height: number): void {
    if (this.#y - height < 50) {
      this.#page = this.#doc.addPage([595.28, 841.89]);
      this.#y = 800;
    }
  }

  line(text: string, opts: { size?: number; bold?: boolean; mono?: boolean; indent?: number } = {}): void {
    const size = opts.size ?? 10;
    this.#ensure(size + 4);
    this.#page.drawText(text, { x: 50 + (opts.indent ?? 0), y: this.#y, size, font: opts.mono ? this.#mono : opts.bold ? this.#bold : this.#font, color: rgb(0.1, 0.1, 0.1) });
    this.#y -= size + 4;
  }

  gap(h = 8): void { this.#y -= h; }

  mark(text: string): void {
    for (const page of this.#doc.getPages()) {
      page.drawText(text, { x: 50, y: 30, size: 8, font: this.#bold, color: rgb(0.6, 0.1, 0.1) });
    }
  }
}

function signatureBlock(w: Writer, s: SignatureFact | RenderInput['releasedSignature'], versionNo: number, hash: string, zone: string): void {
  w.line(`${s.meaning}: ${s.printedName} (${s.username}), ${s.role}`, { indent: 12 });
  w.line(`${utc(s.signedAt)}  |  ${local(s.signedAt, zone)}  |  version ${versionNo}, ${hash.slice(0, 8)}`, { indent: 12, mono: true, size: 8 });
}

export async function renderReportPdf(q: Q, input: RenderInput): Promise<Uint8Array> {
  const { report, lab } = input;
  const doc = await PDFDocument.create();
  doc.setTitle(`Test Report ${report.number}`);
  doc.setCreationDate(input.releasedSignature.signedAt);
  doc.setModificationDate(input.releasedSignature.signedAt);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const w = new Writer(doc, font, bold, mono);

  w.line(`Test Report ${report.number}`, { size: 16, bold: true });
  w.line('FICTIONAL DATA. Demo LIMS; every value, person and organisation on this report is invented.', { size: 9, bold: true });
  w.gap();
  w.line(`Customer: ${report.customer.name} (${report.customer.code})`);
  w.line(`Submission: ${report.submission.number}    Lab: ${lab.code} (${lab.zone})`);
  w.gap();

  for (const t of report.tests) {
    const version = t.standing.version;
    w.line(`${t.label}`, { size: 12, bold: true });
    w.line(`Sample ${t.sample.number ?? '(unnumbered)'}, lot ${t.sample.lotNumber}, ${t.sample.product.name} (${t.sample.product.code})`);
    if (t.method) w.line(`Method ${t.method.number} v${t.method.version}: ${t.method.title}`);
    if (t.specification) w.line(`Specification ${t.specification.purpose}, version ${t.specification.ref.versionNo} (${t.specification.ref.hash.slice(0, 8)})`);
    if (version) w.line(`Test version ${version.versionNo}, ${version.hash}`, { mono: true, size: 8 });
    w.gap(4);

    const body = version ? await bodyOf(q, version.versionId) : null;
    const j = body ? (body['judgement'] as Judgement | null) : null;
    if (j?.sections) {
      for (const s of j.sections) {
        w.line(`${s.jurisdiction} Section (Rule Set ${s.ruleSetVersion}, ${s.calculation}): ${s.outcome}`, { bold: true, indent: 12 });
        for (const line of s.reportable) {
          if (line.kind === 'judged') {
            w.line(`${line.analyte}: Reportable Result ${line.compared} ppm against NMT ${line.limit} ppm: ${line.conforms ? 'conforms' : 'does not conform'} (${line.sharePercent} % of limit)`, { indent: 24 });
          } else {
            w.line(`${line.analyte}: not judged (${line.because}); limit NMT ${line.limit} ppm`, { indent: 24 });
          }
        }
        for (const p of s.preparations) {
          w.line(`${p.preparation}: ${p.lines.map((l) => `${l.analyte} ${l.compared} ppm (${l.conforms ? 'conforms' : 'does not conform'})`).join('; ')}`, { indent: 24, size: 9 });
        }
      }
    } else {
      w.line('No judgement recorded on this version.', { indent: 12 });
    }
    w.gap(4);
    w.line('Preparations as recorded', { bold: true, indent: 12 });
    for (const p of t.preparations) {
      const results = [...p.results].map(([a, v]) => `${a} ${v?.effective.text ?? '(missing)'} ${v?.unit ?? ''}`).join(', ');
      w.line(`P${p.prepNo}: weight ${p.weight?.effective.text ?? '(missing)'} ${p.weight?.unit ?? ''}, dilution ${p.dilution?.effective.text ?? '(missing)'} ${p.dilution?.unit ?? ''}, ${results}`, { indent: 24, size: 9 });
    }
    w.gap(4);
    w.line('Signatures', { bold: true, indent: 12 });
    if (version) for (const s of t.standing.signatures) signatureBlock(w, s, version.versionNo, version.hash, lab.zone);
    for (const r of t.runs) {
      const rv = r.standing.version;
      if (!rv) continue;
      w.line(`Run ${r.number}, version ${rv.versionNo}, ${rv.hash}`, { indent: 12, mono: true, size: 8 });
      const standing = await recordStanding(q, r.id as RecordId);
      for (const s of standing.signatures) signatureBlock(w, s, rv.versionNo, rv.hash, lab.zone);
    }
    w.gap();
  }

  w.line('Release', { size: 12, bold: true });
  signatureBlock(w, input.releasedSignature, input.releasedSignature.version.versionNo, input.releasedSignature.version.hash, lab.zone);
  w.line(`Report version ${input.releasedSignature.version.versionNo}, ${input.releasedSignature.version.hash}`, { mono: true, size: 8 });
  w.mark(`Fictional data. Test Report ${report.number}. Rendered from the signed content; the PDF's SHA-256 is recorded with the Released signature.`);
  return doc.save({ useObjectStreams: false });
}

async function bodyOf(q: Q, versionId: string): Promise<Record<string, unknown>> {
  const v = await q.selectFrom('record_version').select('content').where('id', '=', versionId).executeTakeFirstOrThrow();
  return JSON.parse(v.content.toString('utf8')) as Record<string, unknown>;
}
