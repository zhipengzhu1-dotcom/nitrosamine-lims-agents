import type { Sentence } from './sentence.ts';

export const checklistKinds = ['Run', 'Test', 'Released'] as const;
export type ChecklistKind = (typeof checklistKinds)[number];

/** The values the LIMS computes for an evidence item, mirroring `lims.evidence_source`. */
export const evidenceSources = [
  'runChecks',
  'runAdjustments',
  'msTune',
  'instrumentFitness',
  'standardLots',
  'performedSignature',
] as const;
export type EvidenceSource = (typeof evidenceSources)[number];

/** A ticked item is the Reviewer's to tick, with a comment when it needs one; an evidence item is shown, never ticked. */
export type ChecklistItem =
  | { key: string; text: string; ticked: true; needsComment: boolean }
  | { key: string; text: string; ticked: false; evidence: EvidenceSource };

/** What a Reviewer ticked, by item key, each with its comment or null. */
export type Ticks = Record<string, { comment: string | null }>;

/** The first ticked item, in checklist order, that the ticks leave unticked or without its comment; null once every item is done. */
export function checklistRefusal(items: readonly ChecklistItem[], ticks: Ticks): Sentence | null {
  for (const item of items) {
    if (!item.ticked) continue;
    const tick = ticks[item.key];
    if (!tick) return `Tick “${item.text}” before signing Reviewed.`;
    if (item.needsComment && !tick.comment?.trim()) return `Write a comment on “${item.text}” before signing Reviewed.`;
  }
  return null;
}

/** The first tick that names no ticked item of the checklist: an evidence item, or a key the checklist does not hold. */
export function unknownTick(items: readonly ChecklistItem[], ticks: Ticks): Sentence | null {
  for (const key of Object.keys(ticks)) {
    const item = items.find((i) => i.key === key);
    if (!item) return `The Test Review Checklist has no item “${key}”.`;
    if (!item.ticked) return `The item “${item.text}” is evidence the LIMS shows, so it is never ticked.`;
  }
  return null;
}
