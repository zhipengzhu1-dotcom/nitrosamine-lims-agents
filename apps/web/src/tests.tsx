import { type ActorContext, type Result, routes, type Signature, steps, type TestRow } from '@lims/domain';
import { useCallback, useState } from 'react';
import { useApi, useFresh } from './api.ts';
import { Shell, Status, stepAction, words } from './rail.tsx';
import { type Column, StackTable } from './stack.tsx';
import { time } from './time.ts';
import { TestTrail } from './trail.tsx';
const testLine = (t: TestRow) => `Test of ${t.methodCode} v${t.methodVersion} on Sample ${t.sampleNumber}`;

const noTests: TestRow[] = [];
const worklistColumns: Column<TestRow>[] = [
  { head: 'Sample', cell: (t) => <a href={`#/tests/${t.id}`}>{t.sampleNumber}</a> },
  { head: 'Description', cell: (t) => t.description },
  { head: 'Customer', cell: (t) => t.customer },
  { head: 'Method', cell: (t) => `${t.methodCode} v${t.methodVersion}` },
  { head: 'State', cell: (t) => <Status state={t.state} /> },
  { head: 'Analyst', cell: (t) => t.assignee },
  { head: 'Received', cell: (t) => time(t.receivedAt) },
];

export function Worklist({ me }: { me: ActorContext }) {
  const { data: tests, error, reload } = useApi(routes.tests);
  const freshTests = useFresh(tests, (rows) => rows.map((t) => t.id));
  const action = me.roles.includes(steps.submit.role)
    ? stepAction('submit', null, ['A new Submission with one Sample and one Test'], reload)
    : null;
  return (
    <Shell me={me} active="tests" action={action}>
      <h1>Tests</h1>
      {error && <p className="note--bad">{error}</p>}
      <StackTable
        columns={worklistColumns}
        rows={tests ?? noTests}
        rowKey={(t) => t.id}
        rowClass={(t) => (freshTests.has(t.id) ? 'row--fresh' : undefined)}
      />
      {tests?.length === 0 && <p className="muted">No Tests yet.</p>}
    </Shell>
  );
}

export function TestPage({ me, id }: { me: ActorContext; id: string }) {
  const { data: view, error, reload } = useApi(routes.test, { id });
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
          await Promise.all([reload(), reloadTrail()]);
        },
        view.recordVersion && view.statement ? { recordVersion: view.recordVersion, statement: view.statement } : null,
      )
    : null;
  if (!view)
    return (
      <Shell me={me} active="tests" action={null}>
        {error ? <p className="note--bad">{error}</p> : null}
      </Shell>
    );
  const { test, result, report } = view;
  return (
    <Shell me={me} active="tests" action={action} notice={unsignedNotice(view.signatures)}>
      <h1 className="record-head">
        {test.sampleNumber} <Status key={test.state} state={test.state} fresh={freshState.has(test.state)} />
      </h1>
      <dl className="facts">
        <dt>Sample</dt>
        <dd>
          {test.sampleNumber}, {test.description}
        </dd>
        <dt>Customer</dt>
        <dd>{test.customer}</dd>
        <dt>Received</dt>
        <dd>{time(test.receivedAt) || 'not yet'}</dd>
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
      {result ? (
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
      <Signatures rows={view.signatures} fresh={freshSignatures} />
      {me.person.customerId === null && <TestTrail me={me} id={id} onReload={onTrailReload} />}
    </Shell>
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
    className: 'sig',
    cell: (s) => (
      <>
        {s.meaning}
        {s.unsigned && (
          <>
            {' '}
            <span className="unsigned">unsigned</span>
          </>
        )}
      </>
    ),
  },
  { head: 'Signed by', cell: (s) => `${s.signer} (${s.username}, ${words(s.role)})` },
  { head: 'Time', cell: (s) => time(s.signedAt) },
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
