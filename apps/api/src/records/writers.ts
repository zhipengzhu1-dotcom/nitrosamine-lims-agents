// Who may write a Recorded Value now (review fix 4). A field spec names its writer; the rule here
// resolves that name against the parent: the one person who writes it, and the parent state it is
// written in. Records.record and Records.change ask before any version is sealed.

import type { PersonId, RecordId } from '@lims/domain/ids';
import { TestMachine, type TestState } from '@lims/domain/machines';
import type { Refusal } from '@lims/domain/refusal';
import { recordStanding, signedAndStanding } from '../chain/facts.ts';
import type { Read, Writer } from './kinds.ts';

type Rule = (q: Read, parent: RecordId, person: PersonId) => Promise<string | null>;

/** Each rule answers with why the person may not write, or null when they may. */
const WRITERS: { readonly [W in Writer]: Rule } = {
  /** The assigned Analyst, while the Test is In Progress. */
  assignee: async (q, parent, person) => {
    const t = await q.selectFrom('test').select(['assigned_analyst', 'state']).where('id', '=', parent).executeTakeFirstOrThrow();
    if (t.assigned_analyst !== person) return 'This Test is assigned to another Analyst; its values are recorded by the assigned Analyst.';
    if (t.state !== 'InProgress') return `This Test is ${TestMachine.states[t.state as TestState]}; its values are recorded while it is In Progress.`;
    return null;
  },
  /** The Analyst who acquired the Run, while it is Open (no standing Performed signature). */
  acquirer: async (q, parent, person) => {
    const r = await q.selectFrom('run').select(['acquired_by', 'number']).where('id', '=', parent).executeTakeFirstOrThrow();
    if (r.acquired_by !== person) return `Run ${r.number} was acquired by another Analyst; its values are recorded by the Analyst who acquired it.`;
    if (signedAndStanding(await recordStanding(q, parent), 'Performed')) return `Run ${r.number} is Performed; its values are recorded while it is Open.`;
    return null;
  },
  /** The person who opened the Review, until a signature cites any version of it. */
  reviewer: async (q, parent, person) => {
    const r = await q.selectFrom('review').select('reviewer_id').where('id', '=', parent).executeTakeFirstOrThrow();
    if (r.reviewer_id !== person) return 'This Review was opened by another person; only its reviewer fills it.';
    const cited = await q.selectFrom('signature as s').innerJoin('record_version as v', 'v.id', 's.attestation_version_id')
      .select('s.id').where('v.record_id', '=', parent).executeTakeFirst();
    if (cited) return 'A signature cites this Review, so it can no longer change.';
    return null;
  },
  unrestricted: async () => null,
};

export async function writerRefusal(q: Read, writer: Writer, parent: RecordId, person: PersonId): Promise<Refusal | null> {
  const because = await WRITERS[writer](q, parent, person);
  return because === null ? null : { kind: 'not-permitted', message: because };
}
