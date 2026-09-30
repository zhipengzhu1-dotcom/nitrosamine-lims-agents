// A Test's judgement as canonical content (inside the Test version's bytes) and as section_verdict
// rows beside that version. Both are written from the same pure judgement; rows exist so reports
// and queues never parse bytes.

import { randomUUID } from 'node:crypto';
import type { AuditedTx } from '@lims/db';
import type { Canon } from '@lims/domain/canonical';
import { formatWritten, type Rational } from '@lims/domain/decimal';
import type { LabId, VersionId } from '@lims/domain/ids';
import type { SectionVerdict, TestJudgement } from '@lims/domain/verdict';
import type { PreparationFacts } from './facts.ts';

const rational = (r: Rational): string => `${r.num}/${r.den}`;

export function judgementCanon(j: TestJudgement, preparations: readonly PreparationFacts[]): Canon {
  if (j.kind === 'result-missing') return { kind: 'result-missing', preparation: prepNo(preparations, j.preparation), analyte: j.analyte };
  return {
    kind: 'judged',
    outcome: j.outcome,
    variability: j.variability.map((v): Canon => {
      switch (v.kind) {
        case 'judged': return {
          kind: 'judged', analyte: v.analyte, limit: formatWritten(v.limit), conforms: v.conforms, calculation: v.calculation,
          pairs: v.pairs.map((p) => ({ preparations: [prepNo(preparations, p.preparations[0]), prepNo(preparations, p.preparations[1])], value: rational(p.value), compared: formatWritten(p.compared), within: p.within })),
        };
        case 'missing': return { kind: 'missing', analyte: v.analyte, because: v.because };
        case 'not-built': return { kind: 'not-built', analyte: v.analyte, statistic: v.statistic };
      }
    }),
    sections: j.sections.map((s) => sectionCanon(s, preparations)),
  };
}

function sectionCanon(s: SectionVerdict, preparations: readonly PreparationFacts[]): Canon {
  return {
    jurisdiction: s.jurisdiction,
    ruleSetVersion: s.ruleSetVersion,
    calculation: s.calculation,
    outcome: s.outcome,
    reportable: s.reportable.map((l): Canon => l.kind === 'judged'
      ? { kind: 'judged', analyte: l.analyte, limit: formatWritten(l.limit), rounding: l.rounding, value: rational(l.value), compared: formatWritten(l.compared), conforms: l.conforms, sharePercent: l.share.displayPercent }
      : { kind: 'not-judged', analyte: l.analyte, limit: formatWritten(l.limit), value: rational(l.value), because: l.because }),
    preparations: s.preparations.map((p) => ({
      preparation: prepNo(preparations, p.preparation),
      lines: p.lines.map((l) => ({ analyte: l.analyte, limit: formatWritten(l.limit), compared: formatWritten(l.compared), conforms: l.conforms })),
    })),
  };
}

const prepNo = (preparations: readonly PreparationFacts[], id: string): string => {
  const p = preparations.find((x) => x.id === id);
  if (!p) throw new Error(`Preparation ${id} is not on this Test`);
  return `P${p.prepNo}`;
};

/** One row per Section and Analyte of a judged Test version. */
export async function storeSectionVerdicts(
  tx: AuditedTx, lab: LabId, testVersion: VersionId, specificationVersion: VersionId, j: TestJudgement, preparations: readonly PreparationFacts[],
): Promise<void> {
  if (j.kind !== 'judged') return;
  for (const s of j.sections) {
    for (const line of s.reportable) {
      await tx.db.insertInto('section_verdict').values({
        lab_id: lab, id: randomUUID(), test_version_id: testVersion, specification_version_id: specificationVersion,
        jurisdiction: s.jurisdiction, rule_set_version: s.ruleSetVersion, calculation_version: s.calculation, analyte: line.analyte,
        limit_text: formatWritten(line.limit),
        compared_text: line.kind === 'judged' ? formatWritten(line.compared) : null,
        share_percent: line.kind === 'judged' ? line.share.displayPercent : null,
        outcome: line.kind === 'not-judged' ? 'not-judged' : line.conforms ? 'conforms' : 'does-not-conform',
        preparations: JSON.stringify(s.preparations.map((p) => {
          const l = p.lines.find((x) => x.analyte === line.analyte)!;
          return { preparation: prepNo(preparations, p.preparation), compared: formatWritten(l.compared), conforms: l.conforms };
        })),
      }).execute();
    }
  }
}
