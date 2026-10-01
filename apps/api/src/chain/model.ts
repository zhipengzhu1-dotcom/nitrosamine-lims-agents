// The sample chain's data shapes. A Method version's and a Specification's structured data are
// stored as jsonb on their heads and sealed into their bytes; both hold decimal strings, never
// numbers, so the same object is canonical content. These schemas parse them at the wire and
// again when read back, and the domain types are built from the parsed value.

import { z } from 'zod';
import { BALANCE_KIND, uuid } from '@lims/contract';
import type { Canon } from '@lims/domain/canonical';
import { written } from '@lims/domain/decimal';
import type { AnalyteKey } from '@lims/domain/ids';
import type { DerivedSection } from '@lims/domain/limits';
import { transition, type Actor, type Machine } from '@lims/domain/machines';
import { refuse, type Refusal } from '@lims/domain/refusal';
import type { NonEmpty } from '@lims/domain/nonempty';
import type { Criterion, CriterionSource, ExportedRunCheck, SpecificationSection, VariabilityCriterion } from '@lims/domain/verdict';
import { DecimalSchema as Decimal } from '../wire.ts';

export const CriterionSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('compendial'), citation: z.string().min(1) }),
  z.object({ kind: z.literal('method'), methodVersion: z.string().min(1) }),
  z.object({ kind: z.literal('sop'), sopVersion: z.string().min(1) }),
]);

export const CriterionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('NMT'), limit: Decimal, source: CriterionSourceSchema }),
  z.object({ op: z.literal('NLT'), limit: Decimal, source: CriterionSourceSchema }),
  z.object({ op: z.literal('range'), low: Decimal, high: Decimal, source: CriterionSourceSchema }),
]);

export const MethodDataSchema = z.object({
  basis: z.enum(['compendial', 'alternative', 'in-house']),
  analytes: z.array(z.object({ key: z.string().min(1).max(32), substanceId: uuid, name: z.string().min(1) })).min(1),
  /** From the Method's calculation; the dilution factor is fixed by the procedure, never typed (decision 36). */
  dilutionFactor: Decimal,
  /** The number of Preparations, exact (usp 5): the Reportable Result is their mean, and preparation.create refuses beyond it. */
  preparations: z.string().regex(/^[1-9]\d*$/),
  variability: z.object({ statistic: z.enum(['relative-difference', 'rsd', 'absolute-difference']), limit: Decimal, source: CriterionSourceSchema }).nullable(),
  runChecks: z.array(z.object({ name: z.string().min(1).max(64), unit: z.string().min(1).max(16), comparedAs: z.literal('as-exported'), criterion: CriterionSchema })).min(1),
  /** Document versions an Analyst needs Training Records on, beyond the Method version itself. */
  prerequisiteDocuments: z.array(z.string().min(1)),
});
export type MethodData = z.infer<typeof MethodDataSchema>;

const PositiveDecimal = Decimal.refine((s) => !s.startsWith('-') && /[1-9]/.test(s), 'must be greater than zero');

/**
 * The agreed way a Reportable Result is judged against its limit (decision 29, ISO/IEC 17025
 * §7.1.3), with the words printed for each outcome. Only simple acceptance is built: guarded
 * acceptance needs the Uncertainty Evaluation, so the skeleton cannot hold it.
 */
export const DecisionRuleSchema = z.object({
  rule: z.literal('simple-acceptance'),
  riskBasis: z.string().min(1).max(500),
  wording: z.object({ conforms: z.string().min(1).max(300), doesNotConform: z.string().min(1).max(300) }),
});
export type DecisionRule = z.infer<typeof DecisionRuleSchema>;

export const SpecificationDataSchema = z.object({
  sections: z.array(z.object({
    jurisdiction: z.enum(['FDA', 'EMA', 'NMPA', 'MHLW']),
    ruleSetVersion: z.string().min(1),
    rounding: z.enum(['half-away-from-zero', 'half-even']),
    maximumDailyDose: z.object({ value: PositiveDecimal, unit: z.literal('mg/day') }),
    decisionRule: DecisionRuleSchema,
    /** Every line the skeleton holds is AI-derived; fixed-concentration, limit-test and report-only lines are not built. */
    lines: z.array(z.object({
      analyte: z.string().min(1).max(32),
      /** AI ÷ MDD rounded down to the decimals written here; the command refuses any other value. */
      limit: Decimal,
      unit: z.literal('ppm'),
      uspClaim: z.boolean(),
      /** The published Acceptable Intake the limit is derived from, and its source, kept as written. */
      basis: z.object({ acceptableIntakeNgPerDay: PositiveDecimal, source: z.string().min(1) }),
    })).min(1),
  })).min(1),
});
export type SpecificationData = z.infer<typeof SpecificationDataSchema>;

/** A parsed data object is canonical content already: strings, booleans, nulls, arrays, objects. */
export const asCanon = (data: MethodData | SpecificationData): Canon => data as unknown as Canon;

const nonEmpty = <T>(xs: readonly T[], what: string): NonEmpty<T> => {
  const [first, ...rest] = xs;
  if (first === undefined) throw new Error(`${what} is empty`);
  return [first, ...rest];
};

export const criterionOf = (c: z.infer<typeof CriterionSchema>): Criterion => {
  const source: CriterionSource = c.source;
  return c.op === 'range' ? { op: 'range', low: written(c.low), high: written(c.high), source } : { op: c.op, limit: written(c.limit), source };
};

export const runChecksOf = (m: MethodData): readonly ExportedRunCheck[] =>
  m.runChecks.map((r) => ({ name: r.name, comparedAs: 'as-exported', criterion: criterionOf(r.criterion) }));

export const variabilityOf = (m: MethodData): VariabilityCriterion | null =>
  m.variability ? { statistic: m.variability.statistic, limit: written(m.variability.limit), source: m.variability.source } : null;

export const derivedSectionsOf = (s: SpecificationData): readonly DerivedSection[] =>
  s.sections.map((section) => ({
    jurisdiction: section.jurisdiction,
    maximumDailyDoseMgPerDay: written(section.maximumDailyDose.value),
    lines: section.lines.map((l) => ({ analyte: l.analyte, limit: written(l.limit), acceptableIntakeNgPerDay: written(l.basis.acceptableIntakeNgPerDay) })),
  }));

export const sectionsOf = (s: SpecificationData): NonEmpty<SpecificationSection> =>
  nonEmpty(s.sections.map((section) => ({
    jurisdiction: section.jurisdiction,
    ruleSetVersion: section.ruleSetVersion,
    rounding: section.rounding,
    lines: nonEmpty(section.lines.map((l) => ({ analyte: l.analyte as AnalyteKey, limit: written(l.limit), uspClaim: l.uspClaim })), 'section lines'),
  })), 'sections');

/** A lifecycle move as a command applies it: the target state, or the refusal to print. */
export function move(machine: Machine<string, string, string>, label: string, from: string, event: string, actor: Actor): { readonly to: string } | Refusal {
  const t = transition(machine, from, event, actor);
  return t.ok ? { to: t.to } : refuse.transition(machine, label, t);
}

/** The Document version a Training Record on a Method version names. */
export const methodTrainingDocument = (methodNumber: string, version: number): string => `${methodNumber}@${version}`;

// ---------------------------------------------------------------------------------------------
// Recorded Value fields per kind, and how subjects are written.
// ---------------------------------------------------------------------------------------------

export const TEST_FIELDS = { balance: 'prep.balance', weight: 'prep.weight', dilution: 'prep.dilution', result: 'prep.result' } as const;
export const RUN_FIELDS = { instrument: 'run.instrument', sequence: 'run.sequence', trueCopy: 'run.trueCopy', runCheck: 'runcheck.value' } as const;
export const REVIEW_FIELDS = { tick: 'checklist.item', verdict: 'verdict.confirmation' } as const;

export const preparationSubject = (prepNo: number): string => `P${prepNo}`;
export { BALANCE_KIND };
export const resultSubject = (prepNo: number, analyte: string): string => `P${prepNo}/${analyte}`;
/** Named by the Test's label, so the prompt QA signs from prints which Test and Section each confirmation is for. */
export const verdictSubject = (testLabel: string, jurisdiction: string): string => `${testLabel}, ${jurisdiction} Section`;

// ---------------------------------------------------------------------------------------------
// Review Checklists (decision 20 §7). Versioned documents once the vault exists; constants here.
// A version never changes its items, because each Reviewed signature keeps the version it used.
// These are §7's ticked items for typed entry, split by what each record holds. Fitness Status,
// Run Checks, Training and Authorisation are proved by the signing gates, so nobody ticks them.
// §7's items about Injections, Notebook Entries, the Integration Declaration and result flags wait
// for those records: a tick must never attest to something the LIMS cannot hold.
// ---------------------------------------------------------------------------------------------

export type Checklist = { readonly version: string; readonly items: readonly string[] };

export const RUN_CHECKLIST: Checklist = {
  version: 'CL-RUN@2',
  items: ['LIMS audit trail reviewed', 'chromatograms inspected'],
};
export const TEST_CHECKLIST: Checklist = {
  version: 'CL-TEST@2',
  items: ['LIMS audit trail reviewed', 'calculations checked'],
};
export const RELEASE_CHECKLIST: Checklist = {
  version: 'CL-RELEASE@1',
  items: ['audit trail reviewed', 'every Test Reviewed on its current version', 'report content matches the signed Tests'],
};

export const checklistFor = (reviewedKind: string): Checklist | null =>
  reviewedKind === 'run' ? RUN_CHECKLIST : reviewedKind === 'test' ? TEST_CHECKLIST : reviewedKind === 'test_report' ? RELEASE_CHECKLIST : null;

// ---------------------------------------------------------------------------------------------
// Numbers: every Lab-coded number carries the Lab code and the year in the Lab's zone.
// ---------------------------------------------------------------------------------------------

export const yearIn = (zone: string, at: Date): number =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric' }).format(at));

export const labNumber = (labCode: string, kind: 'S' | 'R' | 'TR', year: number, n: number): string =>
  `${labCode}-${kind}-${year}-${String(n).padStart(6, '0')}`;

export const submissionNumber = (year: number, n: number): string => `SUB-${year}-${String(n).padStart(6, '0')}`;
