import type { DocumentStatus, DocumentStepInputs, Meaning, Role } from './http.ts';
import type { Sentence } from './sentence.ts';
import type { Refusal } from './steps.ts';

/** A role or status as the glossary spells it, as a refusal shows it at the bench: LabManager reads Lab Manager. */
const term = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2');

/** The roles that write and sign Authored on a Document; every business role of a Lab's staff. */
export const documentAuthors: readonly Role[] = ['LabManager', 'Analyst', 'Reviewer', 'QA'];
export const mayAuthorDocuments = (roles: readonly Role[]): boolean =>
  roles.some((role) => documentAuthors.includes(role));

/** Every person of the Lab's staff reads the vault: everyone but a Customer and the Platform Operator. */
export const mayReadDocuments = (roles: readonly Role[]): boolean =>
  roles.some((role) => role !== 'Customer' && role !== 'PlatformOperator');

/** What a Document version holds that decides which step may be taken on it: its status, its author, and who signed what. */
export interface DocumentFacts {
  status: DocumentStatus;
  author: string;
  authored: readonly string[];
  reviewed: readonly string[];
}

/** The person asking, by username, and the roles they hold in the session's Lab. */
export interface DocumentActor {
  username: string;
  roles: readonly Role[];
}

export const documentStepNames = ['signAuthored', 'signReviewed', 'signApproved', 'abandon'] as const;
export type DocumentStepName = (typeof documentStepNames)[number];

export interface DocumentStep<K extends DocumentStepName = DocumentStepName> {
  from: readonly DocumentStatus[];
  to: DocumentStatus;
  /** The roles that may take it, in the order the step acts in one the person holds. */
  roles: readonly Role[];
  signs: Meaning | null;
  /** Without `input` the guard says whether the step is open at all, which is what the web asks. */
  guard?: (f: DocumentFacts, actor: DocumentActor, input?: DocumentStepInputs[K]) => Sentence | null;
}

/**
 * How a Document version becomes Effective: its author signs Authored on the Draft, a Reviewer who did not author it
 * signs Reviewed, and QA, who neither authored nor reviewed it, signs Approved. All three sign the Effective Date the
 * author wrote on the Draft. Its author or QA may Abandon an open version with a reason. The API refuses and the web offers by this table, and the database
 * holds the same rules.
 */
export const documentSteps: { [K in DocumentStepName]: DocumentStep<K> } = {
  signAuthored: {
    from: ['Draft'],
    to: 'InReview',
    roles: documentAuthors,
    signs: 'Authored',
    guard: (f, actor) => (actor.username === f.author ? null : 'A Document version is signed Authored by its author.'),
  },
  signReviewed: {
    from: ['InReview'],
    to: 'InReview',
    roles: ['Reviewer'],
    signs: 'Reviewed',
    guard: (f, actor) => {
      if (f.authored.includes(actor.username)) return 'The author of a Document version does not review it.';
      if (f.reviewed.includes(actor.username)) return 'You have already reviewed this Document version.';
      return null;
    },
  },
  signApproved: {
    from: ['InReview'],
    to: 'Approved',
    roles: ['QA'],
    signs: 'Approved',
    guard: (f, actor) => {
      if (f.reviewed.length === 0) return 'A Document version is Approved only after it is Reviewed.';
      if (f.authored.includes(actor.username) || f.reviewed.includes(actor.username))
        return 'A Document version is Approved by someone who neither authored nor reviewed it.';
      return null;
    },
  },
  abandon: {
    from: ['Draft', 'InReview', 'Approved'],
    to: 'Abandoned',
    roles: documentAuthors,
    signs: null,
    guard: (f, actor) =>
      actor.username === f.author || actor.roles.includes('QA')
        ? null
        : 'A Document version is Abandoned by its author or QA.',
  },
};

/**
 * Why `name` may not be taken on the version by `actor`, or null when it may: the role first, then the guard, then
 * the status.
 */
export function documentRefusal<K extends DocumentStepName>(
  name: K,
  facts: DocumentFacts,
  actor: DocumentActor,
  input?: DocumentStepInputs[K],
): Refusal | null {
  const step: DocumentStep<K> = documentSteps[name];
  if (!step.roles.some((role) => actor.roles.includes(role)))
    return { kind: 'role', message: `The ${name} step is taken by the ${step.roles.map(term).join(', ')} role.` };
  const failed = step.guard?.(facts, actor, input);
  if (failed) return { kind: 'guard', message: failed };
  if (!step.from.includes(facts.status))
    return {
      kind: 'state',
      message: `The ${name} step needs a Document version in ${step.from.map(term).join(' or ')} status, not ${term(facts.status)}.`,
    };
  return null;
}

/** The role a step the actor may take acts in: QA for an abandon by someone other than the author, else the first of its roles the actor holds. */
export function documentStepRole(name: DocumentStepName, facts: DocumentFacts, actor: DocumentActor): Role | undefined {
  if (name === 'abandon' && actor.username !== facts.author) return 'QA';
  return documentSteps[name].roles.find((role) => actor.roles.includes(role));
}

/** The steps the actor may take on the version now, in registry order; the web offers these. */
export function openDocumentSteps(facts: DocumentFacts, actor: DocumentActor): DocumentStepName[] {
  return documentStepNames.filter((name) => documentRefusal(name, facts, actor) === null);
}
