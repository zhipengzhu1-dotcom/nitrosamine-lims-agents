import { useState } from 'react';
import type { LabReferenceDto, QueueTestDto } from '@lims/contract';
import { useCommand, useView } from '../../api/hooks';
import { StatusWord } from '../../components/Status';
import { useRail } from '../../shell/rail';
import { Reading, Refusal, TestState, useAct, useRoles } from './common';

type Group = { readonly submissionId: string; readonly submissionNumber: string; readonly customer: string; readonly tests: readonly QueueTestDto[] };

const REPORT_STATE: Readonly<Record<string, string>> = { Draft: 'Draft', InQaReview: 'In QA Review', Released: 'Released', Superseded: 'Superseded' };

/**
 * Test Reports: a Reviewer or the Lab Manager drafts one from a Submission's Reviewed Tests, and
 * every report in the Lab is listed with its state.
 */
export function Reports() {
  const roles = useRoles();
  const queue = useView<{ tests: QueueTestDto[] }>('queue.tests', {});
  const lab = useView<LabReferenceDto>('lab.reference', {});
  const draft = useCommand<{ submissionId: string; testIds: string[]; role: string }, { reportId: string }>('report.draft');
  const { refusal, act } = useAct();
  const [picked, setPicked] = useState<string | null>(null);
  const role = roles.has('Reviewer') ? 'Reviewer' : roles.has('LabManager') ? 'LabManager' : null;

  const open = new Set(lab.status === 'ok' ? lab.data.reports.filter((r) => r.state === 'Draft' || r.state === 'InQaReview').map((r) => r.submissionNumber) : []);
  const groups: Group[] = [];
  for (const t of queue.status === 'ok' ? queue.data.tests : []) {
    if (t.state !== 'Reviewed' || open.has(t.submissionNumber)) continue;
    const g = groups.find((x) => x.submissionId === t.submissionId);
    if (g) groups[groups.indexOf(g)] = { ...g, tests: [...g.tests, t] };
    else groups.push({ submissionId: t.submissionId, submissionNumber: t.submissionNumber, customer: t.customer, tests: [t] });
  }
  const group = groups.find((g) => g.submissionId === picked) ?? null;

  useRail({
    context: group ? { main: `Submission ${group.submissionNumber}`, sub: `${group.tests.length} Reviewed Test${group.tests.length === 1 ? '' : 's'}` } : { main: 'Test Reports', sub: 'Choose a Submission with Reviewed Tests to draft its report' },
    primary: group
      ? role
        ? { kind: 'commit', label: `Draft a Test Report for ${group.submissionNumber}`, onCommit: () => act(draft, { submissionId: group.submissionId, testIds: group.tests.map((t) => t.id), role }, (d) => window.location.assign(`/reports/${d.reportId}`)) }
        : { kind: 'blocked', label: `Draft a Test Report for ${group.submissionNumber}`, reason: 'A Test Report is drafted by a Reviewer or the Lab Manager.' }
      : null,
  });

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="h-screen">Test Reports</h1>
      </header>
      <Refusal text={refusal} />
      <div className="split">
        <section className="panel" aria-label="Ready to report">
          <h2 className="h-sec">Ready to report</h2>
          <Reading view={queue}>
            {() =>
              groups.length === 0 ? (
                <p className="sub">No Submission has Reviewed Tests waiting for a report.</p>
              ) : (
                <ul className="picklist">
                  {groups.map((g) => (
                    <li key={g.submissionId}>
                      <button type="button" className="pick pick--row" aria-pressed={picked === g.submissionId} onClick={() => setPicked(g.submissionId)}>
                        <span>
                          <b>{g.submissionNumber}</b>
                          <span className="sub">
                            {g.customer}: {g.tests.map((t) => t.label).join(', ')}
                          </span>
                        </span>
                        {g.tests[0] && <TestState test={g.tests[0]} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            }
          </Reading>
        </section>
        <section className="panel" aria-label="Reports in this Lab">
          <h2 className="h-sec">Reports in this Lab</h2>
          <Reading view={lab}>
            {(l) =>
              l.reports.length === 0 ? (
                <p className="sub">No Test Report yet.</p>
              ) : (
                <ul className="picklist">
                  {l.reports.map((r) => (
                    <li key={r.id} className="pick pick--row">
                      <span>
                        <a className="row__link" href={`/reports/${r.id}`}>
                          {r.number}
                        </a>
                        <span className="sub">{r.submissionNumber}</span>
                      </span>
                      <StatusWord word={REPORT_STATE[r.state] ?? r.state} tone={r.state === 'Released' ? 'ok' : 'neutral'} />
                    </li>
                  ))}
                </ul>
              )
            }
          </Reading>
        </section>
      </div>
    </div>
  );
}
