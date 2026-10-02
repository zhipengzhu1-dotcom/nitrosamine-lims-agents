import { type ActorContext, routes } from '@lims/domain';
import { useApi } from './api.ts';
import { demoSigning, Shell } from './rail.tsx';
import { Signatures, unsignedNotice } from './tests.tsx';
import { time } from './time.ts';

export function ReportPage({ me, id }: { me: ActorContext; id: string }) {
  const { data, error } = useApi(routes.report, { id });
  return (
    <Shell me={me} active="tests" action={null} notice={data && unsignedNotice(data.signatures)}>
      {error && <p className="note--bad">{error}</p>}
      {data && (
        <article className="report">
          <p className="fict">Fictional data only. Not a real Test Report.</p>
          <button type="button" className="btn print-hide" onClick={() => window.print()}>
            Print
          </button>
          <h1>
            Test Report <span className="record-number">{data.report.number}</span>
          </h1>
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
