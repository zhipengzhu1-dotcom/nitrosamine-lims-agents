import { api, type Me, type TestReport, useApi } from './api.ts';
import { demoSigning, type RailAction, Shell } from './rail.tsx';
import { Signatures, time } from './tests.tsx';

const verifyAction: RailAction = {
  label: 'Verify Audit Trail',
  context: 'Recompute the hash chains of this Lab and of the company',
  fields: [],
  signs: null,
  async run() {
    const { at, lab, company } = await api<{ at: string; lab: string | null; company: string | null }>(
      '/api/audit/verify',
      {},
    );
    const chain = (name: string, broken: string | null) =>
      broken === null ? `${name} chain internally consistent` : `${name} chain BROKEN at entry ${broken}`;
    return `Recomputed at ${time(at)}: ${chain('Lab', lab)}, ${chain('company', company)}. Not anchored off-server (demo).`;
  },
};

export function ReportPage({ me, id }: { me: Me; id: string }) {
  const { data, error } = useApi<TestReport>(`/api/tests/${id}/report`);
  return (
    <Shell me={me} active="tests" action={me.roles.includes('QA') ? verifyAction : null}>
      {error && <p className="note--bad">{error}</p>}
      {data && (
        <article className="report">
          <p className="fict">Fictional data only. Not a real Test Report.</p>
          <button type="button" className="print-hide" onClick={() => window.print()}>
            Print
          </button>
          <h1>Test Report {data.report.number}</h1>
          <p>{me.lab.name}</p>
          <dl className="facts">
            <dt>Customer</dt>
            <dd>{data.test.customer}</dd>
            <dt>Sample</dt>
            <dd>
              {data.test.sampleNumber}, {data.test.description}
            </dd>
            <dt>Received</dt>
            <dd>{time(data.test.receivedAt)}</dd>
            <dt>Method</dt>
            <dd>
              {data.test.methodCode} v{data.test.methodVersion}, {data.test.methodTitle}
            </dd>
            <dt>GxP Class</dt>
            <dd>{data.test.gxpClass} (demo: GMP controls are not built)</dd>
          </dl>
          <h2>Result</h2>
          {data.result && (
            <table>
              <thead>
                <tr>
                  <th>Analyte</th>
                  <th>Result</th>
                  <th>Unit</th>
                  <th>Performed on</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{data.result.analyte}</td>
                  <td className="value">{data.result.value}</td>
                  <td>{data.result.unit}</td>
                  <td>{data.result.performedOn}</td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="muted">Printed as entered. No Specification or limit is applied in this version.</p>
          <h2>Signatures</h2>
          <p className="fict">{demoSigning}</p>
          <Signatures rows={data.signatures} />
        </article>
      )}
    </Shell>
  );
}
