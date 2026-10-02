import {
  type ActorContext,
  type Result,
  routes,
  type Signature,
  steps,
  type TestRow,
  type TestState,
} from '@lims/domain';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useApi, useFresh } from './api.ts';
import { Shell, Status, stateOrder, stepAction, words } from './rail.tsx';
import { Split } from './split.tsx';
import { type Column, StackTable } from './stack.tsx';
import { When } from './time.tsx';
import { TestTrail } from './trail.tsx';
const testLine = (t: TestRow) => `Test of ${t.methodCode} v${t.methodVersion} on Sample ${t.sampleNumber}`;
const methodLine = (t: TestRow) => `${t.methodCode} v${t.methodVersion}`;

const noTests: TestRow[] = [];
const worklistColumns = (open: string | null): Column<TestRow>[] => [
  {
    head: 'Sample',
    cell: (t) => (
      <a href={`#/tests/${t.id}/beside`} aria-current={t.id === open ? 'true' : undefined}>
        {t.sampleNumber}
      </a>
    ),
  },
  { head: 'Description', cell: (t) => t.description },
  { head: 'Customer', cell: (t) => t.customer },
  { head: 'Method', cell: methodLine },
  { head: 'State', cell: (t) => <Status state={t.state} /> },
  { head: 'Analyst', cell: (t) => t.assignee },
  { head: 'Received', cell: (t) => t.receivedAt && <When at={t.receivedAt} atLab={t.receivedAtLab} /> },
];
const besideHeads = new Set(['Sample', 'State', 'Received']);

const searchText = (t: TestRow) =>
  [t.sampleNumber, t.description, t.customer, methodLine(t), t.methodTitle].join('\n').toLowerCase();

/** The Test states the found Tests are in, each with its count. A state no found Test is in is hidden unless chosen. */
function Pipeline({
  found,
  chosen,
  onChoose,
}: {
  found: readonly TestRow[];
  chosen: TestState | null;
  onChoose: (state: TestState | null) => void;
}) {
  const counts = stateOrder.map((state) => ({ state, n: found.filter((t) => t.state === state).length }));
  return (
    <div className="pipeline" role="group" aria-label="Filter by Test state">
      <button type="button" className="pipe" aria-pressed={chosen === null} onClick={() => onChoose(null)}>
        All <b>{found.length}</b>
      </button>
      {counts
        .filter(({ state, n }) => n > 0 || state === chosen)
        .map(({ state, n }) => (
          <button
            key={state}
            type="button"
            className="pipe"
            aria-pressed={chosen === state}
            onClick={() => onChoose(state)}
          >
            <Status state={state} /> <b>{n}</b>
          </button>
        ))}
    </div>
  );
}

/** The Lab's Tests, filtered by state and search. `open` is the Test shown beside the list. */
export function Worklist({ me, open }: { me: ActorContext; open: string | null }) {
  const { data: tests, error, reload } = useApi(routes.tests);
  const freshTests = useFresh(tests, (rows) => rows.map((t) => t.id));
  const [chosen, setChosen] = useState<TestState | null>(null);
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const found = useMemo(
    () => (tests ?? noTests).filter((t) => needle === '' || searchText(t).includes(needle)),
    [tests, needle],
  );
  const shown = useMemo(() => (chosen ? found.filter((t) => t.state === chosen) : found), [found, chosen]);
  const columns = useMemo(() => worklistColumns(open).filter((c) => !open || besideHeads.has(c.head)), [open]);
  const Title = open ? 'h2' : 'h1';
  const list = (
    <>
      <Title className="worklist__head">Tests</Title>
      {error && <p className="note--bad">{error}</p>}
      <div className="worklist__tools">
        <Pipeline found={found} chosen={chosen} onChoose={setChosen} />
        <label>
          Search Tests
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>
      <StackTable
        columns={columns}
        rows={shown}
        rowKey={(t) => t.id}
        rowClass={(t) =>
          [freshTests.has(t.id) ? 'row--fresh' : '', t.id === open ? 'row--open' : ''].join(' ').trim() || undefined
        }
      />
      {tests?.length === 0 ? (
        <p className="muted">No Tests yet.</p>
      ) : (
        tests && shown.length === 0 && <p className="muted">No Test matches.</p>
      )}
    </>
  );
  if (open) return <TestPage me={me} id={open} list={list} afterStep={reload} />;
  const action = me.roles.includes(steps.submit.role)
    ? stepAction('submit', null, ['A new Submission with one Sample and one Test'], reload)
    : null;
  return (
    <Shell me={me} active="tests" action={action}>
      {list}
    </Shell>
  );
}

/** A Test alone, or beside the Worklist's `list`, which `afterStep` refetches once a step on the Test commits. */
export function TestPage({
  me,
  id,
  list,
  afterStep,
}: {
  me: ActorContext;
  id: string;
  list?: ReactNode;
  afterStep?: () => Promise<void>;
}) {
  const { data: answer, error, reload } = useApi(routes.test, { id });
  // Beside the Worklist this page stays mounted when another Test opens, so the answer for the Test before is not shown.
  const view = answer?.test.id === id ? answer : undefined;
  const [reloadTrail, setReloadTrail] = useState<() => Promise<void>>(() => async () => {});
  const onTrailReload = useCallback((fn: () => Promise<void>) => setReloadTrail(() => fn), []);
  const freshState = useFresh(view, (v) => [v.test.state]);
  const freshSignatures = useFresh(view, (v) => v.signatures.map(signatureKey));
  const action = view?.next
    ? stepAction(
        view.next,
        id,
        [testLine(view.test), ...(view.result ? [resultLine(view.result)] : [])],
        async () => {
          await Promise.all([reload(), reloadTrail(), afterStep?.()]);
        },
        view.recordVersion && view.statement ? { recordVersion: view.recordVersion, statement: view.statement } : null,
      )
    : null;
  const frame = (record: ReactNode) => (
    <Shell me={me} active="tests" action={action} notice={view && unsignedNotice(view.signatures)} record={id}>
      {list ? <Split list={list} record={record} close="#/tests" /> : record}
    </Shell>
  );
  if (!view) return frame(error ? <p className="note--bad">{error}</p> : null);
  const { test, result, report } = view;
  return frame(
    <>
      <h1 className="record-head">
        {test.sampleNumber} <Status key={test.state} state={test.state} fresh={freshState.has(test.state)} />
        {view.signatures.some((s) => s.unsigned) && <Status mark="Signatures unsigned" />}
      </h1>
      <dl className="facts">
        <dt>Sample</dt>
        <dd>
          {test.sampleNumber}, {test.description}
        </dd>
        <dt>Customer</dt>
        <dd>{test.customer}</dd>
        <dt>Received</dt>
        <dd>{test.receivedAt ? <When at={test.receivedAt} atLab={test.receivedAtLab} /> : 'not yet'}</dd>
        <dt>Method</dt>
        <dd>
          {test.methodCode} v{test.methodVersion}, {test.methodTitle}
        </dd>
        <dt>GxP Class</dt>
        <dd>{test.gxpClass}</dd>
        <dt>Analyst</dt>
        <dd>{test.assignee ?? 'not assigned'}</dd>
        <dt>Test Report</dt>
        <dd>{report ? <a href={`#/tests/${id}/report`}>{report.number}</a> : 'not released'}</dd>
        {view.recordVersion && (
          <>
            <dt>Record Version</dt>
            <dd>
              {view.recordVersion.version} · <code className="hash">{view.recordVersion.contentHash}</code>
            </dd>
          </>
        )}
      </dl>
      <h2>Result</h2>
      {view.withheld ? (
        <p className="muted">The Result is not released yet. It shows here when the Test Report is released.</p>
      ) : result ? (
        <dl className="facts">
          <dt>{result.analyte}</dt>
          <dd className="value">
            {result.value} {result.unit}
          </dd>
          <dt>Injection sequence</dt>
          <dd>{result.injectionSequenceRef}</dd>
          <dt>Notebook</dt>
          <dd>{result.notebookRef}</dd>
          <dt>Performed on</dt>
          <dd>{result.performedOn}</dd>
        </dl>
      ) : (
        <p className="muted">No Result entered.</p>
      )}
      <h2>Signatures</h2>
      {view.withheld ? (
        <p className="muted">The Signatures are not released yet. They show here with the Result.</p>
      ) : (
        <Signatures rows={view.signatures} fresh={freshSignatures} />
      )}
      {me.person.customerId === null && <TestTrail key={id} me={me} id={id} onReload={onTrailReload} />}
    </>,
  );
}

const resultLine = (r: Result) => `Result: ${r.analyte} ${r.value} ${r.unit}, performed on ${r.performedOn}`;

const signatureKey = (s: Signature) => s.meaning + s.signedAt;

/** The rail's line for a record with Signatures the server returns as unsigned, or nothing to say. */
export function unsignedNotice(rows: Signature[]): string | undefined {
  const unsigned = rows.filter((s) => s.unsigned).map((s) => s.meaning);
  return unsigned.length ? `Unsigned: ${unsigned.join(', ')}. The record changed after signing.` : undefined;
}
const rowClass = (s: Signature, fresh?: ReadonlySet<string>) =>
  [fresh?.has(signatureKey(s)) ? 'row--fresh' : '', s.unsigned ? 'row--unsigned' : ''].join(' ').trim() || undefined;

const signatureColumns: Column<Signature>[] = [
  {
    head: 'Meaning',
    cell: (s) => (
      <span className="sig-line">
        <span className="sig">{s.meaning}</span>
        {s.unsigned && <Status mark="Unsigned" />}
      </span>
    ),
  },
  { head: 'Signed by', cell: (s) => `${s.signer} (${s.username}, ${words(s.role)})` },
  { head: 'Time', cell: (s) => <When at={s.signedAt} atLab={s.signedAtLab} /> },
  { head: 'Record', cell: (s) => s.record },
  { head: 'Record Version', cell: (s) => s.recordVersion.version },
  {
    head: 'SHA-256 of the signed Record Version',
    label: 'SHA-256',
    cell: (s) => <code className="hash">{s.recordVersion.contentHash}</code>,
  },
];

/** Only the rows whose keys are in `fresh`, which the server has just returned on this page, animate in. */
export function Signatures({ rows, fresh }: { rows: Signature[]; fresh?: ReadonlySet<string> }) {
  if (!rows.length) return <p className="muted">No Signatures yet.</p>;
  return (
    <StackTable columns={signatureColumns} rows={rows} rowKey={signatureKey} rowClass={(s) => rowClass(s, fresh)} />
  );
}
