import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type DocumentActor,
  type DocumentFacts,
  type DocumentStepName,
  documentRefusal,
  documentStepRole,
  openDocumentSteps,
} from '../src/index.ts';

const lena: DocumentActor = { username: 'lena.manager', roles: ['LabManager'] };
const rui: DocumentActor = { username: 'rui.reviewer', roles: ['Reviewer'] };
const quinn: DocumentActor = { username: 'quinn.qa', roles: ['QA'] };
const ana: DocumentActor = { username: 'ana.analyst', roles: ['Analyst'] };
const ada: DocumentActor = { username: 'ada.admin', roles: ['Admin'] };

const draft: DocumentFacts = { status: 'Draft', author: 'lena.manager', authored: [], reviewed: [] };
const inReview: DocumentFacts = { ...draft, status: 'InReview', authored: ['lena.manager'] };
const reviewed: DocumentFacts = { ...inReview, reviewed: ['rui.reviewer'] };

describe('the Document step registry', () => {
  const cases: [string, DocumentStepName, DocumentFacts, DocumentActor, string | null][] = [
    ['the author signs Authored on the Draft', 'signAuthored', draft, lena, null],
    [
      'someone else may not sign Authored',
      'signAuthored',
      draft,
      ana,
      'A Document version is signed Authored by its author.',
    ],
    [
      'Admin may not sign Authored',
      'signAuthored',
      draft,
      ada,
      'The signAuthored step is taken by the LabManager, Analyst, Reviewer, QA role.',
    ],
    [
      'Authored is signed on a Draft only',
      'signAuthored',
      inReview,
      lena,
      'The signAuthored step needs a Document version in Draft status, not InReview.',
    ],
    ['a Reviewer signs Reviewed in review', 'signReviewed', inReview, rui, null],
    [
      'the author may not review',
      'signReviewed',
      inReview,
      { username: 'lena.manager', roles: ['Reviewer'] },
      'The author of a Document version does not review it.',
    ],
    ['a Reviewer reviews once', 'signReviewed', reviewed, rui, 'You have already reviewed this Document version.'],
    ['QA signs Approved after a Reviewed', 'signApproved', reviewed, quinn, null],
    [
      'Approved waits for a Reviewed',
      'signApproved',
      inReview,
      quinn,
      'A Document version is Approved only after it is Reviewed.',
    ],
    [
      'the reviewer may not approve',
      'signApproved',
      reviewed,
      { username: 'rui.reviewer', roles: ['QA'] },
      'A Document version is Approved by someone who neither authored nor reviewed it.',
    ],
    [
      'the author may not approve',
      'signApproved',
      reviewed,
      { username: 'lena.manager', roles: ['QA'] },
      'A Document version is Approved by someone who neither authored nor reviewed it.',
    ],
    ['the author abandons a Draft', 'abandon', draft, lena, null],
    ['QA abandons a version in review', 'abandon', inReview, quinn, null],
    [
      'an Analyst who did not author it may not abandon',
      'abandon',
      draft,
      ana,
      'A Document version is Abandoned by its author or QA.',
    ],
    [
      'an Effective version is not abandoned',
      'abandon',
      { ...reviewed, status: 'Effective' },
      lena,
      'The abandon step needs a Document version in Draft or InReview or Approved status, not Effective.',
    ],
  ];
  for (const [name, step, facts, actor, message] of cases) {
    it(name, () => assert.equal(documentRefusal(step, facts, actor)?.message ?? null, message));
  }

  it('offers each person the steps they may take now', () => {
    assert.deepEqual(openDocumentSteps(draft, lena), ['signAuthored', 'abandon']);
    assert.deepEqual(openDocumentSteps(inReview, rui), ['signReviewed']);
    assert.deepEqual(openDocumentSteps(reviewed, quinn), ['signApproved', 'abandon']);
    assert.deepEqual(openDocumentSteps(reviewed, ada), []);
  });

  it('acts in QA when someone other than the author abandons, and in a role the author holds otherwise', () => {
    assert.equal(documentStepRole('abandon', inReview, quinn), 'QA');
    assert.equal(documentStepRole('abandon', draft, lena), 'LabManager');
    assert.equal(documentStepRole('signReviewed', inReview, rui), 'Reviewer');
  });
});
