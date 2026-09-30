// What the screens print about a Test, computed here so the browser prints and never decides: the
// step model with each blocker in words (decision 23 rules 15 and 17), and the judgement grouped
// by Specification Section at full precision beside the value rounded once (rule 22).

import type { HoldDto, JudgementDto, StepDto } from '@lims/contract';
import { div, formatWritten, fullPrecision, mul, roundTo, toRational, type Rational } from '@lims/domain/decimal';
import type { AnalyteKey } from '@lims/domain/ids';
import type { TestJudgement } from '@lims/domain/verdict';
import { preparationSubject } from './model.ts';
import { signedAndStanding, type Q, type RunFacts, type TestFacts } from './facts.ts';

const DIGITS = 10;
const HUNDRED: Rational = { num: 100n, den: 1n };

type Draft = { readonly name: string; readonly done: boolean; readonly note: string | null; readonly reasons: readonly string[] };

const criterionText = (c: RunFacts['runChecks'][number]['check']['criterion']): string =>
  c.op === 'range' ? `${formatWritten(c.low)}–${formatWritten(c.high)}` : `${c.op} ${formatWritten(c.limit)}`;

function runBlockers(r: RunFacts): string[] {
  const out: string[] = [];
  for (const c of r.runChecks) {
    if (c.outcome.kind === 'judged' && !c.outcome.conforms) {
      out.push(`${r.label}: Run Check ${c.check.name} failed (${c.value?.effective.text ?? ''} against ${criterionText(c.check.criterion)}). The Deviation workflow is not built, so no Run Check Failure Deviation can be opened and the Run cannot be signed Performed.`);
    }
    if (c.outcome.kind === 'not-recorded') out.push(`${r.label}: Run Check ${c.check.name} is not recorded.`);
  }
  const unverified = r.values.filter((v) => !v.verified).length;
  if (unverified > 0) out.push(`${r.label}: ${unverified} value${unverified === 1 ? '' : 's'} not yet Verified by a second person.`);
  const pending = r.values.filter((v) => v.pending).length;
  if (pending > 0) out.push(`${r.label}: ${pending} change${pending === 1 ? '' : 's'} awaiting approval.`);
  if (r.standing.signatures.some((s) => s.meaning === 'Performed') && !r.standing.stands) out.push(`${r.label} changed after it was signed Performed; sign it again.`);
  return out;
}

function testBlockers(t: TestFacts): string[] {
  const out = t.missingValues.map((m) => `${m} not recorded.`);
  const unverified = t.values.filter((v) => !v.verified).length;
  if (unverified > 0) out.push(`${unverified} value${unverified === 1 ? '' : 's'} not yet Verified by a second person.`);
  const pending = t.values.filter((v) => v.pending).length;
  if (pending > 0) out.push(`${pending} change${pending === 1 ? '' : 's'} awaiting approval.`);
  if (t.judgement?.kind === 'judged') {
    for (const v of t.judgement.variability) {
      if (v.kind === 'judged' && !v.conforms) out.push(`${v.analyte}: the variability between Preparations is over ${formatWritten(v.limit)} %, so the Reportable Result is not judged.`);
      if (v.kind === 'not-built') out.push(`${v.analyte}: the ${v.statistic} variability statistic is not built.`);
    }
  }
  return out;
}

/**
 * The Test's steps from its facts. The first step not done is the current one; it reads Blocked,
 * with every reason, when something on the record stops its next act. A Hold blocks the step it
 * names. Rejected and Cancelled Tests end at Acceptance.
 */
export function testSteps(t: TestFacts, runs: readonly RunFacts[], holds: readonly HoldDto[]): StepDto[] {
  const after = (states: readonly string[]) => states.includes(t.state);
  const runsDone = runs.length > 0 && runs.every((r) => signedAndStanding(r.standing, 'Performed'));
  const drafts: Draft[] = [
    {
      name: 'Accepted', done: !after(['Requested', 'Rejected', 'Cancelled']), note: null,
      reasons: t.state === 'Rejected' ? [`Rejected at Acceptance: ${t.acceptanceReason ?? 'no reason recorded'}`] : t.state === 'Cancelled' ? ['Cancelled.'] : [],
    },
    { name: 'Received', done: t.sample.state !== 'Expected', note: t.sample.number, reasons: [] },
    { name: 'Assigned', done: t.assignedAnalyst !== null, note: null, reasons: [] },
    { name: 'Run', done: runsDone, note: runs.map((r) => r.number).join(', ') || null, reasons: runs.flatMap(runBlockers) },
    { name: 'Performed', done: after(['SubmittedForReview', 'Reviewed', 'Reported']), note: null, reasons: runsDone ? testBlockers(t) : [] },
    { name: 'Reviewed', done: after(['Reviewed', 'Reported']), note: null, reasons: [] },
    { name: 'Reported', done: after(['Reported']), note: null, reasons: [] },
  ];
  const current = drafts.findIndex((d) => !d.done);
  return drafts.map((d, i): StepDto => {
    if (i < current || current === -1) return { name: d.name, state: 'done', note: d.note, reasons: [] };
    if (i > current) return { name: d.name, state: 'next', note: d.note, reasons: [] };
    const reasons = [...d.reasons, ...holds.filter((h) => h.blocks === d.name).map((h) => `Hold ${h.id} (${h.kind}) blocks this step.`)];
    return { name: d.name, state: reasons.length > 0 ? 'blocked' : 'current', note: d.note, reasons };
  });
}

export async function holdsOn(q: Q, testId: string): Promise<HoldDto[]> {
  const rows = await q.selectFrom('hold').select(['id', 'source', 'blocks_step']).where('test_id', '=', testId).where('released_at', 'is', null).execute();
  return rows.map((h) => ({ id: h.id, kind: h.source, blocks: h.blocks_step }));
}

const share = (value: Rational, limit: Rational): string => formatWritten(roundTo(mul(div(value, limit), HUNDRED), 1, 'half-away-from-zero'));

/** The judgement as the Test screen prints it: every Section, every line, every Preparation. */
export function judgementDto(t: TestFacts, j: TestJudgement | null): JudgementDto | null {
  if (!j || j.kind !== 'judged' || !t.specification) return null;
  const prepLabel = (id: string) => preparationSubject(t.preparations.find((p) => p.id === id)?.prepNo ?? 0);
  const valueOf = (prep: string, analyte: AnalyteKey): Rational | null => t.calculated.find((c) => c.preparation === prep)?.results.get(analyte) ?? null;
  return {
    outcome: j.outcome,
    variability: j.variability.map((v) => v.kind === 'judged'
      ? { analyte: v.analyte, limit: formatWritten(v.limit), outcome: v.conforms ? 'conforms' : 'does-not-conform', pairs: v.pairs.map((p) => ({ preparations: `${prepLabel(p.preparations[0])} and ${prepLabel(p.preparations[1])}`, fullPrecision: fullPrecision(p.value, DIGITS), compared: formatWritten(p.compared), within: p.within })) }
      : { analyte: v.analyte, limit: null, outcome: v.kind, pairs: [] }),
    sections: j.sections.map((s) => {
      const lines = t.specification!.data.sections.find((x) => x.jurisdiction === s.jurisdiction)?.lines ?? [];
      return {
        jurisdiction: s.jurisdiction, ruleSetVersion: s.ruleSetVersion, rounding: s.reportable[0]?.kind === 'judged' ? s.reportable[0].rounding : '', outcome: s.outcome,
        lines: s.reportable.map((l) => ({
          analyte: l.analyte, limit: formatWritten(l.limit), unit: lines.find((x) => x.analyte === l.analyte)?.unit ?? 'ppm',
          fullPrecision: fullPrecision(l.value, DIGITS),
          compared: l.kind === 'judged' ? formatWritten(l.compared) : null,
          sharePercent: l.kind === 'judged' ? l.share.displayPercent : null,
          outcome: l.kind === 'judged' ? (l.conforms ? 'conforms' : 'does-not-conform') : 'not-judged',
          because: l.kind === 'not-judged' ? l.because : null,
          preparations: s.preparations.map((p) => {
            const line = p.lines.find((x) => x.analyte === l.analyte)!;
            const value = valueOf(p.preparation, l.analyte);
            return {
              preparation: prepLabel(p.preparation), fullPrecision: value ? fullPrecision(value, DIGITS) : '', compared: formatWritten(line.compared),
              sharePercent: value ? share(value, toRational(l.limit)) : '', conforms: line.conforms,
            };
          }),
        })),
      };
    }),
  };
}
