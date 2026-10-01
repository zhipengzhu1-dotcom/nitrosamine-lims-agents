/** The kinds `lims.numbered_kind` counts, in its order. */
export const numberedKinds = ['Submission', 'Sample', 'TestReport'] as const;
export type NumberedKind = (typeof numberedKinds)[number];

/** A number as `lims.take_number` hands it out: the counter's value, and the Lab's code and local date (`YYYY-MM-DD`) at assignment. */
export interface NumberTaken {
  kind: NumberedKind;
  seq: number;
  labCode: string;
  localDate: string;
}

const LETTER: { readonly [K in Exclude<NumberedKind, 'Submission'>]: string } = { Sample: 'S', TestReport: 'R' };

/** Formats a taken number with the Lab's local year at assignment: `SUB-2026-000045`, `RD-S-2026-000123`, `RD-R-2026-000045`. */
export function recordNumber({ kind, seq, labCode, localDate }: NumberTaken): string {
  const tail = `${localDate.slice(0, 4)}-${String(seq).padStart(6, '0')}`;
  return kind === 'Submission' ? `SUB-${tail}` : `${labCode}-${LETTER[kind]}-${tail}`;
}

/** A Container takes its Sample's number and a two-digit suffix: `RD-S-2026-000123-C02`. */
export function containerNumber(sampleNumber: string, container: number): string {
  return `${sampleNumber}-C${String(container).padStart(2, '0')}`;
}
