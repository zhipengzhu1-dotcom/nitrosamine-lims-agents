import { useState } from 'react';
import type { AssignmentDto, QueueTestDto } from '@lims/contract';
import { useCommand, useView } from '../../api/hooks';
import { Glyph } from '../../components/Glyph';
import { GxpBadge, StatusWord } from '../../components/Status';
import { useRail } from '../../shell/rail';
import { Reading, Refusal, TestState, useAct } from './common';

/**
 * The Lab Manager assigns each Ready Test to an Analyst. Only the Analysts the server's assignment
 * gate lets through can be chosen; every other Analyst is listed with the gate's reasons, so the
 * refusal is visible before anyone presses anything (decision 19 §4).
 */
export function Assignment() {
  const queue = useView<{ tests: QueueTestDto[] }>('queue.tests', {});
  const [testId, setTestId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('test'));
  const [analyst, setAnalyst] = useState<string | null>(null);
  const ready = queue.status === 'ok' ? queue.data.tests.filter((t) => t.state === 'Ready') : [];
  const test = ready.find((t) => t.id === testId) ?? null;
  const assignment = useView<AssignmentDto>('test.assignment', test ? { testId: test.id } : null);
  const assign = useCommand<{ testId: string; analystId: string }>('test.assign');
  const { refusal, act } = useAct();
  const chosen = assignment.status === 'ok' ? assignment.data.candidates.find((c) => c.id === analyst && c.eligible) ?? null : null;

  useRail({
    context: test ? { main: test.label, sub: `${test.product} lot ${test.lotNumber}, ${test.method}` } : { main: 'Assignment', sub: `${ready.length} Ready Test${ready.length === 1 ? '' : 's'}` },
    primary: test
      ? chosen
        ? { kind: 'commit', label: `Assign ${test.label} to ${chosen.printedName}`, onCommit: () => act(assign, { testId: test.id, analystId: chosen.id }, () => { setTestId(null); setAnalyst(null); queue.reload(); }) }
        : { kind: 'blocked', label: `Assign ${test.label}`, reason: 'Choose an eligible Analyst.' }
      : null,
  });

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="h-screen">Assignment</h1>
        <p className="screen__lede">Choose a Ready Test, then an Analyst the server finds eligible: trained on the Method version and its prerequisites, authorised to perform it, and enabled to sign.</p>
      </header>
      <Refusal text={refusal} />
      <div className="split">
        <section className="panel" aria-label="Ready Tests">
          <h2 className="h-sec">Ready</h2>
          <Reading view={queue}>
            {() =>
              ready.length === 0 ? (
                <p className="sub">No Test is Ready.</p>
              ) : (
                <ul className="picklist">
                  {ready.map((t) => (
                    <li key={t.id}>
                      <button type="button" className="pick pick--row" aria-pressed={t.id === testId} onClick={() => { setTestId(t.id); setAnalyst(null); }}>
                        <span>
                          <b>{t.label}</b>
                          <span className="sub">
                            {t.customer}, {t.product} lot {t.lotNumber}, {t.method}
                          </span>
                        </span>
                        <TestState test={t} />
                        <GxpBadge gxpClass={t.gxpClass === 'GMP' ? 'GMP' : 'non-GMP'} />
                      </button>
                    </li>
                  ))}
                </ul>
              )
            }
          </Reading>
        </section>
        <section className="panel" aria-label="Analysts">
          <h2 className="h-sec">Analysts</h2>
          {!test ? (
            <p className="sub">Choose a Ready Test to see who may perform it.</p>
          ) : (
            <Reading view={assignment}>
              {(a) => (
                <ul className="picklist" role="radiogroup" aria-label={`Analysts for ${test.label}`}>
                  {a.candidates.map((c) => (
                    <li key={c.id}>
                      {c.eligible ? (
                        <button type="button" role="radio" aria-checked={analyst === c.id} className="pick pick--row" onClick={() => setAnalyst(c.id)}>
                          <span>
                            <b>{c.printedName}</b>
                            <span className="sub mono">{c.username}</span>
                          </span>
                          <StatusWord word="Eligible" tone="ok" />
                        </button>
                      ) : (
                        <div className="pick pick--row pick--refused" aria-label={`${c.printedName} is not eligible`}>
                          <span>
                            <b>{c.printedName}</b>
                            <span className="sub mono">{c.username}</span>
                            <span className="pick__why">
                              <Glyph name="noentry" size={14} />
                              {c.reasons.join(' ')}
                            </span>
                          </span>
                          <StatusWord word="Not eligible" tone="bad" />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Reading>
          )}
        </section>
      </div>
    </div>
  );
}
