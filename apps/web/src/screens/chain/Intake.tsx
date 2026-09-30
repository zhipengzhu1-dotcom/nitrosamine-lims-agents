import { useId, useState } from 'react';
import type { QueueTestDto } from '@lims/contract';
import { useCommand, useView } from '../../api/hooks';
import { CommitButton } from '../../components/CommitButton';
import { GxpBadge } from '../../components/Status';
import { useRail } from '../../shell/rail';
import { Reading, Refusal, TestState, useAct } from './common';

type Selected = { readonly kind: 'test' | 'sample'; readonly id: string } | null;

type SampleGroup = { readonly sampleId: string; readonly tests: readonly QueueTestDto[] };

const groups = (tests: readonly QueueTestDto[]): SampleGroup[] => {
  const by = new Map<string, QueueTestDto[]>();
  for (const t of tests) by.set(t.sampleId, [...(by.get(t.sampleId) ?? []), t]);
  return [...by].map(([sampleId, ts]) => ({ sampleId, tests: ts }));
};

/** A Sample still at intake: Expected, or holding a Test still Requested. */
const atIntake = (g: SampleGroup) => g.tests.some((t) => t.sampleState === 'Expected' || t.state === 'Requested');

/**
 * The Sample Custodian's intake: each Test is Accepted or Rejected with a reason the Customer sees,
 * and each Sample is received, which numbers it and its Tests. Select a Test or a Sample; the rail
 * offers its next act.
 */
export function Intake() {
  const id = useId();
  const view = useView<{ tests: QueueTestDto[] }>('queue.tests', {});
  const accept = useCommand<{ testId: string }>('test.accept');
  const reject = useCommand<{ testId: string; reason: string }>('test.reject');
  const receive = useCommand<{ sampleId: string }>('sample.receive');
  const { refusal, act } = useAct();
  const [selected, setSelected] = useState<Selected>(null);
  const [reason, setReason] = useState('');

  const all = view.status === 'ok' ? groups(view.data.tests).filter(atIntake) : [];
  const tests = all.flatMap((g) => g.tests);
  const test = selected?.kind === 'test' ? tests.find((t) => t.id === selected.id) ?? null : null;
  const sample = selected?.kind === 'sample' ? all.find((g) => g.sampleId === selected.id) ?? null : null;
  const lotOf = (g: SampleGroup) => g.tests[0]?.lotNumber ?? '';

  useRail({
    context: test ? { main: test.label, sub: `${test.customer}, ${test.method}` } : sample ? { main: `Sample lot ${lotOf(sample)}`, sub: `${sample.tests.length} Test${sample.tests.length === 1 ? '' : 's'}` } : { main: 'Intake', sub: 'Select a Test to accept or a Sample to receive' },
    primary: test
      ? test.state === 'Requested'
        ? { kind: 'commit', label: `Accept ${test.label}`, onCommit: () => act(accept, { testId: test.id }, view.reload) }
        : { kind: 'blocked', label: `Accept ${test.label}`, reason: `${test.label} is ${test.stateLabel}.` }
      : sample
        ? sample.tests[0]?.sampleState === 'Expected'
          ? { kind: 'commit', label: `Receive Sample lot ${lotOf(sample)}`, onCommit: () => act(receive, { sampleId: sample.sampleId }, view.reload) }
          : { kind: 'blocked', label: `Receive Sample lot ${lotOf(sample)}`, reason: 'This Sample is already received.' }
        : null,
  });

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="h-screen">Intake</h1>
        <p className="screen__lede">Accept or reject each Test the Customer requested, then receive the Sample. A Test is Ready once it is Accepted and its Sample is Received.</p>
      </header>
      <Refusal text={refusal} />
      <Reading view={view}>
        {() =>
          all.length === 0 ? (
            <p className="screen__note">Nothing is waiting at intake.</p>
          ) : (
            <div className="intake">
              {all.map((g) => {
                const first = g.tests[0]!;
                return (
                  <section key={g.sampleId} className={`panel intake__sample${selected?.id === g.sampleId ? ' is-selected' : ''}`} aria-label={`Sample lot ${first.lotNumber}`}>
                    <div className="intake__head">
                      <button type="button" className="pick" aria-pressed={selected?.id === g.sampleId} onClick={() => setSelected({ kind: 'sample', id: g.sampleId })}>
                        <b>Sample lot {first.lotNumber}</b>
                        <span className="sub">
                          {first.sampleNumber ?? first.sampleState}, {first.product}, {first.customer}, {first.submissionNumber}
                        </span>
                      </button>
                    </div>
                    <ul className="intake__tests">
                      {g.tests.map((t) => (
                        <li key={t.id}>
                          <button type="button" className="pick pick--row" aria-pressed={selected?.id === t.id} onClick={() => setSelected({ kind: 'test', id: t.id })}>
                            <span>
                              <b>{t.label}</b>
                              <span className="sub">{t.method}</span>
                            </span>
                            <TestState test={t} />
                            <GxpBadge gxpClass={t.gxpClass === 'GMP' ? 'GMP' : 'non-GMP'} />
                          </button>
                          {selected?.id === t.id && t.state === 'Requested' && (
                            <div className="reject">
                              <label htmlFor={`${id}-reason`}>Reason to reject, shown to the Customer</label>
                              <textarea id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
                              <CommitButton tone="danger" disabled={reason.trim() === ''} onCommit={() => act(reject, { testId: t.id, reason: reason.trim() }, () => { setReason(''); view.reload(); })}>
                                Reject {t.label} with this reason
                              </CommitButton>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )
        }
      </Reading>
    </div>
  );
}
