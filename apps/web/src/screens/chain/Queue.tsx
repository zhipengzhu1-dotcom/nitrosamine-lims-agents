import { useId, useState } from 'react';
import type { QueueTestDto } from '@lims/contract';
import { useView } from '../../api/hooks';
import { Glyph } from '../../components/Glyph';
import { GxpBadge } from '../../components/Status';
import { useRail } from '../../shell/rail';
import { Holds, Reading, TestState } from './common';

/** The pipeline in the order a Test moves through it; a state with no Test still shows its zero. */
const PIPELINE = ['Requested', 'Ready', 'Assigned', 'InProgress', 'SubmittedForReview', 'Reviewed', 'Reported'] as const;
const PIPELINE_LABEL: Readonly<Record<string, string>> = {
  Requested: 'Requested', Ready: 'Ready', Assigned: 'Assigned', InProgress: 'In Progress', SubmittedForReview: 'Submitted for Review', Reviewed: 'Reviewed', Reported: 'Reported',
};

type Filter = { readonly state: string; readonly gxp: string; readonly holdsOnly: boolean; readonly text: string };

const matches = (t: QueueTestDto, f: Filter): boolean =>
  (f.state === '' || t.state === f.state) &&
  (f.gxp === '' || t.gxpClass === f.gxp) &&
  (!f.holdsOnly || t.holds.length > 0) &&
  (f.text === '' || [t.label, t.customer, t.product, t.lotNumber, t.method, t.submissionNumber, t.assignedAnalyst?.printedName ?? ''].join(' ').toLowerCase().includes(f.text.toLowerCase()));

/** Where a Test's next act happens, so the row opens the screen that does it. */
export const screenOf = (t: Pick<QueueTestDto, 'id' | 'state'>): string =>
  t.state === 'Requested' || t.state === 'Accepted' ? '/intake' : t.state === 'Ready' ? `/assign?test=${t.id}` : `/tests/${t.id}`;

/** One row's step track: every step as a mark, the current one named, a blocked one with its reason. */
function Track({ test }: { test: QueueTestDto }) {
  const current = test.steps.find((s) => s.state === 'current' || s.state === 'blocked');
  return (
    <div className="track">
      <ol className="track__marks" aria-hidden="true">
        {test.steps.map((s) => (
          <li key={s.name} className={`track__mark is-${s.state}`} />
        ))}
      </ol>
      <span className={`track__now${current?.state === 'blocked' ? ' is-blocked' : ''}`}>
        {current ? (
          <>
            {current.state === 'blocked' ? <Glyph name="noentry" size={14} /> : null}
            {current.state === 'blocked' ? 'Blocked' : 'Now'}: {current.name}
          </>
        ) : (
          'All steps done'
        )}
      </span>
    </div>
  );
}

/**
 * The Lab's work queue (decision 23): a pipeline of state counts that doubles as the state filter,
 * filters for GxP Class, Holds and text, and one two-line row per Test with its state word, GxP
 * badge, Holds and step track. A blocked step's reason is on the row, never in a hover title.
 */
export function Queue() {
  const id = useId();
  const view = useView<{ tests: QueueTestDto[] }>('queue.tests', {});
  const [filter, setFilter] = useState<Filter>({ state: '', gxp: '', holdsOnly: false, text: '' });
  const tests = view.status === 'ok' ? view.data.tests : [];
  const shown = tests.filter((t) => matches(t, filter));
  useRail({ context: { main: 'Work queue', sub: view.status === 'ok' ? `${tests.length} Tests in this Lab, ${shown.length} shown` : 'Reading the queue' }, primary: null });
  const count = (state: string) => tests.filter((t) => t.state === state).length;

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="h-screen">Work</h1>
      </header>
      <nav className="pipeline" aria-label="Tests by state">
        <button type="button" className="pipeline__stage" aria-pressed={filter.state === ''} onClick={() => setFilter({ ...filter, state: '' })}>
          <span className="pipeline__n">{tests.length}</span>
          <span className="pipeline__label">All</span>
        </button>
        {PIPELINE.map((s) => (
          <button key={s} type="button" className="pipeline__stage" aria-pressed={filter.state === s} onClick={() => setFilter({ ...filter, state: filter.state === s ? '' : s })}>
            <span className="pipeline__n">{count(s)}</span>
            <span className="pipeline__label">{PIPELINE_LABEL[s]}</span>
          </button>
        ))}
      </nav>
      <div className="filters">
        <label className="filters__search" htmlFor={`${id}-q`}>
          <Glyph name="search" size={18} />
          <span className="sr-only">Search the queue</span>
          <input id={`${id}-q`} type="search" placeholder="Test, Customer, Product, lot, Method or Analyst" value={filter.text} onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
        </label>
        <label className="filters__opt" htmlFor={`${id}-gxp`}>
          GxP Class
          <select id={`${id}-gxp`} value={filter.gxp} onChange={(e) => setFilter({ ...filter, gxp: e.target.value })}>
            <option value="">Both</option>
            <option value="GMP">GMP</option>
            <option value="non-GMP">Non-GMP</option>
          </select>
        </label>
        <label className="filters__opt filters__check">
          <input type="checkbox" checked={filter.holdsOnly} onChange={(e) => setFilter({ ...filter, holdsOnly: e.target.checked })} />
          Only Tests with a Hold
        </label>
      </div>
      <Reading view={view}>
        {() =>
          shown.length === 0 ? (
            <p className="screen__note">{tests.length === 0 ? 'No Test has been requested in this Lab yet.' : 'No Test matches these filters.'}</p>
          ) : (
            <div className="rows" role="table" aria-label="Tests">
              <div className="rows__head" role="row">
                <span role="columnheader">Test</span>
                <span role="columnheader">Customer and Method</span>
                <span role="columnheader">State</span>
                <span role="columnheader">Steps</span>
              </div>
              {shown.map((t) => {
                const blocked = t.steps.find((s) => s.state === 'blocked');
                return (
                  <div className="row" role="row" key={t.id}>
                    <span role="cell" className="row__main">
                      <a className="row__link" href={screenOf(t)}>
                        {t.label}
                      </a>
                      <span className="sub">
                        {t.product} lot {t.lotNumber}, {t.submissionNumber}
                      </span>
                    </span>
                    <span role="cell">
                      {t.customer}
                      <span className="sub">
                        {t.method}
                        {t.assignedAnalyst && `, ${t.assignedAnalyst.printedName}`}
                      </span>
                    </span>
                    <span role="cell" className="row__state">
                      <TestState test={t} />
                      <span className="row__tags">
                        <GxpBadge gxpClass={t.gxpClass === 'GMP' ? 'GMP' : 'non-GMP'} />
                        <Holds holds={t.holds} compact />
                      </span>
                    </span>
                    <span role="cell">
                      <Track test={t} />
                      {blocked && <span className="row__why">{blocked.reasons.join(' ')}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )
        }
      </Reading>
    </div>
  );
}
