import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type ChecklistItem,
  checklistRefusal,
  itemKeyOf,
  selfApprovalRefusal,
  type Ticks,
  unknownTick,
  versionStateOf,
} from '../src/index.ts';

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

describe('a Review Checklist version as QA drafts and approves it', () => {
  const keys: [string, string, string[], string][] = [
    ['words become one camelCase key', 'Audit trail reviewed', [], 'auditTrailReviewed'],
    ['digits, marks and accents are dropped', 'Peaks (n = 2) integrated: résumé', [], 'peaksNIntegratedRSum'],
    [
      'a key already in the draft gains a letter',
      'Audit trail reviewed',
      ['auditTrailReviewed'],
      'auditTrailReviewedB',
    ],
    [
      'the next letter follows when that is taken too',
      'Audit trail reviewed',
      ['auditTrailReviewed', 'auditTrailReviewedB'],
      'auditTrailReviewedC',
    ],
    ['text with no letters is an item', '42', [], 'item'],
  ];
  for (const [name, text, taken, expected] of keys)
    it(`itemKeyOf: ${name}`, () => assert.equal(itemKeyOf(text, taken), expected));

  it('itemKeyOf: a long text gives a key of at most 64 letters', () =>
    assert.equal(itemKeyOf('word '.repeat(40), []).length, 64));

  const states: [string, number, number, number | null, ReturnType<typeof versionStateOf>][] = [
    ['the version in force is In force', 1, 1, 1, 'In force'],
    ['the newest version above the version in force is the Draft QA may approve', 2, 2, 1, 'Draft'],
    ['the newest version is a Draft while none is in force', 1, 1, null, 'Draft'],
    ['an older draft below the newest version is Superseded', 2, 3, 1, 'Superseded'],
    ['a version below the version in force is Superseded', 1, 2, 2, 'Superseded'],
  ];
  for (const [name, version, newest, inForce, expected] of states)
    it(`versionStateOf: ${name}`, () => assert.equal(versionStateOf(version, newest, inForce), expected));

  it('selfApprovalRefusal: the QA who drafted a version is refused, naming it', () =>
    assert.equal(
      selfApprovalRefusal('Test', { version: 3, draftedBy: 'quinn' }, 'quinn'),
      'You drafted version 3 of the Test Review Checklist, so another QA approves it.',
    ));
  it('selfApprovalRefusal: another QA, or a version the LIMS seeded, is not refused', () => {
    assert.equal(selfApprovalRefusal('Run', { version: 2, draftedBy: 'quinn' }, 'qiao'), null);
    assert.equal(selfApprovalRefusal('Run', { version: 1, draftedBy: null }, 'quinn'), null);
  });
});
