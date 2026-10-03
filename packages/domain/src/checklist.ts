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

/**
 * The key a new item of a draft takes from its text: its ASCII words as one camelCase key of at most 64 letters, with a
 * letter added while `taken` already holds it. Items copied from an earlier version keep their key, so ticks stay comparable.
 */
export function itemKeyOf(text: string, taken: readonly string[]): string {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? ['item'];
  const base = words.map((w, i) => (i === 0 ? w : w[0]?.toUpperCase() + w.slice(1))).join('');
  const letters = 'BCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let n = 0; ; n++) {
    const suffix = n === 0 ? '' : 'Z'.repeat(Math.floor((n - 1) / letters.length)) + letters[(n - 1) % letters.length];
    const key = base.slice(0, 64 - suffix.length) + suffix;
    if (!taken.includes(key)) return key;
  }
}

/** Refuses a QA approving a checklist version they drafted, so that a second QA has read every version put in force. */
export function selfApprovalRefusal(
  kind: ChecklistKind,
  version: { version: number; draftedBy: string | null },
  username: string,
): Sentence | null {
  return version.draftedBy === username
    ? `You drafted version ${version.version} of the ${kind} Review Checklist, so another QA approves it.`
    : null;
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
