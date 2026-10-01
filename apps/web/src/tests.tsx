import { type ActorContext, type Result, routes, type Signature, steps, type TestRow } from '@lims/domain';
import { useCallback, useState } from 'react';
import { useApi, useFresh } from './api.ts';
import { Shell, Status, stepAction } from './rail.tsx';
import { time } from './time.ts';
import { TestTrail } from './trail.tsx';
const testLine = (t: TestRow) => `Test of ${t.methodCode} v${t.methodVersion} on Sample ${t.sampleNumber}`;

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
      <table className="stack">
        <thead>
          <tr>
            <th>Sample</th>
            <th>Description</th>
            <th>Customer</th>
            <th>Method</th>
            <th>State</th>
            <th>Analyst</th>
            <th>Received</th>
          </tr>
        </thead>
        <tbody>
          {tests?.map((t) => (
            <tr key={t.id} className={freshTests.has(t.id) ? 'row--fresh' : undefined}>
              <td data-label="Sample">
                <a href={`#/tests/${t.id}`}>{t.sampleNumber}</a>
              </td>
              <td data-label="Description">{t.description}</td>
              <td data-label="Customer">{t.customer}</td>
              <td data-label="Method">
                {t.methodCode} v{t.methodVersion}
              </td>
              <td data-label="State">
                <Status state={t.state} />
              </td>
              <td data-label="Analyst">{t.assignee}</td>
              <td data-label="Received">{time(t.receivedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
    ? stepAction(view.next, id, [testLine(view.test), ...(view.result ? [resultLine(view.result)] : [])], async () => {
        await Promise.all([reload(), reloadTrail()]);
      })
    : null;
  if (!view)
    return (
      <Shell me={me} active="tests" action={null}>
        {error ? <p className="note--bad">{error}</p> : null}
      </Shell>
    );
  const { test, result, report } = view;
  return (
    <Shell me={me} active="tests" action={action}>
      <h1>
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

/** Only the rows whose keys are in `fresh`, which the server has just returned on this page, animate in. */
export function Signatures({ rows, fresh }: { rows: Signature[]; fresh?: ReadonlySet<string> }) {
  if (!rows.length) return <p className="muted">No Signatures yet.</p>;
  return (
    <table className="stack">
      <thead>
        <tr>
          <th>Meaning</th>
          <th>Signed by</th>
          <th>Time</th>
          <th>Record</th>
          <th>SHA-256 of the signed Record Version</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={signatureKey(s)} className={fresh?.has(signatureKey(s)) ? 'row--fresh' : undefined}>
            <td className="sig" data-label="Meaning">
              {s.meaning}
            </td>
            <td data-label="Signed by">{s.signer}</td>
            <td data-label="Time">{time(s.signedAt)}</td>
            <td data-label="Record">{s.record}</td>
            <td data-label="SHA-256">
              <code className="hash">{s.contentHash}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
