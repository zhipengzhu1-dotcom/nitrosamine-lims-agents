import { steps } from '@lims/domain';
import { useState } from 'react';
import { type AuditEntry, type Me, type Row, type Signature, type TestRow, type TestView, useApi } from './api.ts';
import { Shell, Status, stepAction } from './rail.tsx';

export const time = (iso: string | null) => (iso ? `${new Date(iso).toISOString().slice(0, 19).replace('T', ' ')} UTC` : '');
const testLine = (t: TestRow) => `Test of ${t.methodCode} v${t.methodVersion} on Sample ${t.sampleNumber}`;

export function Worklist({ me }: { me: Me }) {
  const { data: tests, error, reload } = useApi<TestRow[]>('/api/tests');
  const action = me.roles.includes(steps.submit.role) ? stepAction('submit', null, ['A new Submission with one Sample and one Test'], reload) : null;
  return (
    <Shell me={me} active="tests" action={action}>
      <h1>Tests</h1>
      {error && <p className="note--bad">{error}</p>}
      <table>
        <thead><tr><th>Sample</th><th>Description</th><th>Customer</th><th>Method</th><th>State</th><th>Analyst</th><th>Received</th></tr></thead>
        <tbody>
          {tests?.map((t) => (
            <tr key={t.id}>
              <td><a href={`#/tests/${t.id}`}>{t.sampleNumber}</a></td><td>{t.description}</td><td>{t.customer}</td>
              <td>{t.methodCode} v{t.methodVersion}</td><td><Status state={t.state} /></td><td>{t.assignee}</td><td>{time(t.receivedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tests?.length === 0 && <p className="muted">No Tests yet.</p>}
    </Shell>
  );
}

export function TestPage({ me, id }: { me: Me; id: string }) {
  const { data: view, error, reload } = useApi<TestView>(`/api/tests/${id}`);
  const what = view && [testLine(view.test), ...(view.result ? [resultLine(view.result)] : [])];
  const action = view?.next ? stepAction(view.next, id, what!, reload) : null;
  const fresh = useFresh(view);
  if (!view) return <Shell me={me} active="tests" action={null}>{error ? <p className="note--bad">{error}</p> : null}</Shell>;
  const { test, result, report } = view;
  return (
    <Shell me={me} active="tests" action={action}>
      <h1>{test.sampleNumber} <Status key={test.state} state={test.state} fresh={fresh.state} /></h1>
      <dl className="facts">
        <dt>Sample</dt><dd>{test.sampleNumber}, {test.description}</dd>
        <dt>Customer</dt><dd>{test.customer}</dd>
        <dt>Received</dt><dd>{time(test.receivedAt) || 'not yet'}</dd>
        <dt>Method</dt><dd>{test.methodCode} v{test.methodVersion}, {test.methodTitle}</dd>
        <dt>GxP Class</dt><dd>{test.gxpClass}</dd>
        <dt>Analyst</dt><dd>{test.assignee ?? 'not assigned'}</dd>
        <dt>Test Report</dt><dd>{report ? <a href={`#/tests/${id}/report`}>{report.number}</a> : 'not released'}</dd>
      </dl>
      <h2>Result</h2>
      {result ? (
        <dl className="facts">
          <dt>{result.analyte}</dt><dd className="value">{result.value} {result.unit}</dd>
          <dt>Injection sequence</dt><dd>{result.injectionSequenceRef}</dd>
          <dt>Notebook</dt><dd>{result.notebookRef}</dd>
          <dt>Performed on</dt><dd>{result.performedOn}</dd>
        </dl>
      ) : <p className="muted">No Result entered.</p>}
      <h2>Signatures</h2>
      <Signatures rows={view.signatures} fresh={fresh.signatures} />
      {me.person.customerId === null && <AuditTrail entries={view.auditTrail} />}
    </Shell>
  );
}

const signatureKey = (s: Signature) => s.meaning + s.signedAt;
const nothingFresh = { state: false, signatures: new Set<string>() };

/** What the latest server answer changed against the one before it on this page. A first load changes nothing. */
function useFresh(view: TestView | undefined): { state: boolean; signatures: Set<string> } {
  const [last, setLast] = useState(view);
  const [fresh, setFresh] = useState(nothingFresh);
  if (view !== last) {
    setLast(view);
    if (last && view) {
      const before = new Set(last.signatures.map(signatureKey));
      setFresh({ state: last.test.state !== view.test.state, signatures: new Set(view.signatures.map(signatureKey).filter((k) => !before.has(k))) });
    }
  }
  return fresh;
}

const resultLine = (r: NonNullable<TestView['result']>) => `Result: ${r.analyte} ${r.value} ${r.unit}, performed on ${r.performedOn}`;

/** Scrolls the plane just enough to show a row the server has just returned, so a phone shows the new Signature too. */
function reveal(row: HTMLTableRowElement | null) {
  const plane = row?.closest('.plane');
  if (!row || !plane) return;
  const below = row.getBoundingClientRect().bottom + 16 - plane.getBoundingClientRect().bottom;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (below > 0) plane.scrollBy({ top: below, behavior: still ? 'instant' : 'smooth' });
}

/** `fresh` holds the keys of rows the server has just returned on this page; only those animate in. */
export function Signatures({ rows, fresh }: { rows: Signature[]; fresh?: Set<string> }) {
  if (!rows.length) return <p className="muted">No Signatures yet.</p>;
  return (
    <table className="sigs">
      <thead><tr><th>Meaning</th><th>Signed by</th><th>Time</th><th>Record</th><th>SHA-256 of the signed Record Version</th></tr></thead>
      <tbody>
        {rows.map((s) => (
          <tr key={signatureKey(s)} {...(fresh?.has(signatureKey(s)) && { className: 'row--fresh', ref: reveal })}>
            <td className="sig" data-label="Meaning">{s.meaning}</td><td data-label="Signed by">{s.signer}</td>
            <td data-label="Time">{time(s.signedAt)}</td><td data-label="Record">{s.record}</td>
            <td data-label="SHA-256"><code className="hash">{s.contentHash}</code></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const shown = (v: unknown) => {
  const text = typeof v === 'string' ? v : JSON.stringify(v) ?? 'none';
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
};

function changes(e: AuditEntry): string {
  const before: Row = e.oldRow ?? {};
  const after: Row = e.newRow ?? {};
  return Object.keys({ ...before, ...after })
    .filter((k) => k !== 'lab_id' && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => (e.oldRow && e.newRow ? `${k}: ${shown(before[k])} → ${shown(after[k])}` : `${k}=${shown(e.newRow ? after[k] : before[k])}`))
    .join('; ');
}

function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  return (
    <>
      <h2>Audit Trail</h2>
      <div className="wide">
        <table className="audit">
          <thead><tr><th>#</th><th>Time</th><th>Who</th><th>Role</th><th>Reason</th><th>Record</th><th>Change</th></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.seq}>
                <td>{e.seq}</td><td>{time(e.at)}</td><td><code>{e.actor}</code></td><td>{e.role}</td><td>{e.reason}</td>
                <td>{e.op} {e.table}</td><td>{changes(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
