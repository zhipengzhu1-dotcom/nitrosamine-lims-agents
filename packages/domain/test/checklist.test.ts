import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type ChecklistItem, checklistRefusal, type Ticks, unknownTick } from '../src/index.ts';

const items: ChecklistItem[] = [
  { key: 'auditTrailReviewed', text: 'Audit trail reviewed', ticked: true, needsComment: false },
  { key: 'performedSignature', text: 'Performed Signature', ticked: false, evidence: 'performedSignature' },
  { key: 'flagsAcknowledged', text: 'Flags acknowledged with a comment', ticked: true, needsComment: true },
];
const done = { comment: null };

describe('a Test Review against its checklist', () => {
  const incomplete: [string, Ticks, string | null][] = [
    [
      'every ticked item ticked and commented is complete',
      { auditTrailReviewed: done, flagsAcknowledged: { comment: 'None raised' } },
      null,
    ],
    ['no ticks names the first ticked item', {}, 'Tick “Audit trail reviewed” before signing Reviewed.'],
    [
      'a later unticked item is named',
      { auditTrailReviewed: done },
      'Tick “Flags acknowledged with a comment” before signing Reviewed.',
    ],
    [
      'a null comment on a needs-comment item is named',
      { auditTrailReviewed: done, flagsAcknowledged: done },
      'Write a comment on “Flags acknowledged with a comment” before signing Reviewed.',
    ],
    [
      'a blank comment on a needs-comment item is named',
      { auditTrailReviewed: done, flagsAcknowledged: { comment: '  ' } },
      'Write a comment on “Flags acknowledged with a comment” before signing Reviewed.',
    ],
  ];
  for (const [name, ticks, expected] of incomplete)
    it(`checklistRefusal: ${name}`, () => assert.equal(checklistRefusal(items, ticks), expected));

  const unknown: [string, Ticks, string | null][] = [
    ['ticks of ticked items are known', { auditTrailReviewed: done }, null],
    [
      'a tick of an evidence item is refused',
      { performedSignature: done },
      'The item “Performed Signature” is evidence the LIMS shows, so it is never ticked.',
    ],
    [
      'a tick of a key the checklist lacks is refused',
      { madeUp: done },
      'The Test Review Checklist has no item “madeUp”.',
    ],
  ];
  for (const [name, ticks, expected] of unknown)
    it(`unknownTick: ${name}`, () => assert.equal(unknownTick(items, ticks), expected));
});
