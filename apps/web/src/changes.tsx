import {
  type ChangeStepName,
  type CriticalDataChange,
  changeStepRoute,
  changeSteps,
  type ReasonStep,
  type RouteReply,
  routes,
} from '@lims/domain';
import { api, useApi } from './api.ts';
import { type Field, type RailAction, Status } from './rail.tsx';
import { When } from './time.tsx';

type TestView = RouteReply<typeof routes.test>;

const changeUi: { [K in ChangeStepName]: { label: string; done: string } } = {
  proposeChange: { label: 'Propose change', done: 'The Critical Data Change is proposed and waits for a Reviewer.' },
  approveChange: { label: 'Approve change', done: 'Approved Signature recorded. The Result holds the new value.' },
  rejectChange: { label: 'Reject change', done: 'The Critical Data Change is rejected. The Result is unchanged.' },
  withdrawChange: { label: 'Withdraw change', done: 'The Critical Data Change is withdrawn. The Result is unchanged.' },
};

const valueLine = (c: CriticalDataChange) => `Result ${c.field}: ${c.oldValue} → ${c.newValue} ${c.unit}`;
const reasonLine = (reason: string, text: string | null) => (text ? `${reason}: ${text}` : reason);

/**
 * The rail's action for the first Critical Data Change step this person may take on the Test, or null. The reasons
 * come from the step's picklist on the server; an approval signs the pending change's own Record Version.
 */
export function useChangeAction(view: TestView | undefined, onDone: () => Promise<void>): RailAction | null {
  const name = view?.next ? undefined : view?.changeNext[0];
  const reasonStep: ReasonStep = name === undefined || name === 'approveChange' ? 'proposeChange' : name;
  const { data: reasons } = useApi(routes.reasons, { step: reasonStep });
  if (!view || !name || !reasons) return null;
  const pending = view.changes.find((c) => c.state === 'Pending');
  const takesReason = name !== 'approveChange';
  const fields: Field[] = [
    ...(name === 'proposeChange'
      ? [{ name: 'newValue', label: 'New value as written', kind: 'decimal' } as const]
      : []),
    ...(takesReason
      ? [
          { name: 'reason', label: 'Reason', kind: 'choice', options: reasons.map((r) => r.label) } as const,
          { name: 'reasonText', label: 'Reason text, for Other', kind: 'text', optional: true } as const,
        ]
      : []),
  ];
  const what = pending
    ? [
        valueLine(pending),
        `Reason: ${reasonLine(pending.reason, pending.reasonText)}`,
        `Proposed by ${pending.proposedBy}`,
      ]
    : [view.result ? `Result: ${view.result.analyte} ${view.result.value} ${view.result.unit}` : 'Result'];
  const step = changeSteps[name];
  return {
    label: changeUi[name].label,
    context: what[0] ?? '',
    fields,
    signs:
      step.signs && pending && view.statement
        ? {
            meaning: step.signs,
            what,
            role: step.role,
            recordVersion: pending.recordVersion,
            statement: view.statement,
          }
        : null,
    async run(input, credentials) {
      const testId = view.test.id;
      const reasonId = reasons.find((r) => r.label === input.reason)?.id ?? '';
      const reasonText = input.reasonText ? { reasonText: input.reasonText } : {};
      // The fields go as typed; the route's schema and the database refuse a value or a reason they do not take.
      if (name === 'proposeChange')
        await api(changeStepRoute(name), { testId, newValue: input.newValue ?? '', reasonId, ...reasonText });
      else if (pending && name === 'approveChange' && credentials && view.statement)
        await api(changeStepRoute(name), {
          testId,
          changeId: pending.id,
          signature: {
            ...credentials,
            recordVersion: { version: pending.recordVersion.version, contentHash: pending.recordVersion.contentHash },
            statementVersion: view.statement.version,
          },
        });
      else if (pending && name !== 'approveChange')
        await api(changeStepRoute(name), { testId, changeId: pending.id, reasonId, ...reasonText });
      await onDone();
      return changeUi[name].done;
    },
  };
}

/** The Test's Critical Data Changes, each with its Status, values, reason and decision. */
export function Changes({ rows }: { rows: CriticalDataChange[] }) {
  if (rows.length === 0) return <p className="muted">No Critical Data Change proposed.</p>;
  return (
    <ul className="changes">
      {rows.map((c) => (
        <li key={c.id}>
          <Status mark={c.state} /> <b className="value">{valueLine(c)}</b>
          <p>
            {reasonLine(c.reason, c.reasonText)}. Proposed by {c.proposedBy}, <When at={c.proposedAt} atLab={null} />.
          </p>
          {c.decidedBy && c.decidedAt && (
            <p>
              {c.state} by {c.decidedBy}, <When at={c.decidedAt} atLab={null} />
              {c.decisionReason && `: ${reasonLine(c.decisionReason, c.decisionReasonText)}`}.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
