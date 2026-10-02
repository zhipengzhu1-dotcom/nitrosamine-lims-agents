const PAGE = { width: 595, height: 842, margin: 36 } as const;
const FONT_SIZE = 8;
const LEADING = 10;
const COURIER_ADVANCE_EM = 0.6;
export const PDF_COLUMNS = Math.floor((PAGE.width - 2 * PAGE.margin) / (FONT_SIZE * COURIER_ADVANCE_EM));
const LINES_PER_PAGE = Math.floor((PAGE.height - 2 * PAGE.margin - 2 * LEADING) / LEADING);

const cp1252 = new TextDecoder('windows-1252');
/** The characters Windows-1252 puts at 0x80-0x9F, such as curly quotes, dashes and the euro sign, by their byte. */
const CP1252_HIGH = new Map(
  Array.from({ length: 0x20 }, (_, i) => [cp1252.decode(Uint8Array.of(0x80 + i)), 0x80 + i] as const).filter(
    ([ch]) => (ch.codePointAt(0) ?? 0) > 0xff,
  ),
);
const octal = (byte: number) => `\\${byte.toString(8).padStart(3, '0')}`;

/** A character Courier's WinAnsi encoding cannot print becomes `?`; the data file beside the PDF keeps it as written. */
function winAnsi(line: string): string {
  return Array.from(line)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0x3f;
      if (code === 0x28 || code === 0x29 || code === 0x5c) return `\\${ch}`;
      if (code >= 0x20 && code <= 0x7e) return ch;
      if (code >= 0xa0 && code <= 0xff) return octal(code);
      const high = CP1252_HIGH.get(ch);
      return high === undefined ? '?' : octal(high);
    })
    .join('');
}

function wrapped(line: string): string[] {
  if (line.length <= PDF_COLUMNS) return [line];
  const out: string[] = [];
  for (let at = 0; at < line.length; at += PDF_COLUMNS - 4)
    out.push((at === 0 ? '' : '    ') + line.slice(at, at + PDF_COLUMNS - 4));
  return out;
}

/** A searchable A4 PDF that prints `lines` in Courier, wrapped to the page, with "Page n of m" on each page. */
export function textPdf(title: string, lines: readonly string[]): Buffer {
  const all = lines.flatMap((line) => wrapped(line));
  const pages: string[][] = [];
  for (let at = 0; at < Math.max(all.length, 1); at += LINES_PER_PAGE) pages.push(all.slice(at, at + LINES_PER_PAGE));
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  pages.forEach((page, i) => {
    const top = PAGE.height - PAGE.margin - FONT_SIZE;
    const text = [
      'BT',
      `/F1 ${FONT_SIZE} Tf`,
      `${LEADING} TL`,
      `${PAGE.margin} ${top} Td`,
      ...page.map((line) => `(${winAnsi(line)}) Tj T*`),
      'ET',
      'BT',
      `/F1 ${FONT_SIZE} Tf`,
      `${PAGE.margin} ${PAGE.margin} Td`,
      `(${winAnsi(`${title}. Page ${i + 1} of ${pages.length}`)}) Tj`,
      'ET',
    ].join('\n');
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`,
    );
    add(`<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`);
  });
  add(`<< /Title (${winAnsi(title)}) /Producer (Nitrosamine LIMS) >>`);
  let out = '%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
