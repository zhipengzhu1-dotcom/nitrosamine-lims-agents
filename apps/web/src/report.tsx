import { type ActorContext, routes, unsignedMeanings } from '@lims/domain';
import { useApi, useFictional } from './api.ts';
import { Shell, Status } from './rail.tsx';
import { Signatures, signingNotes, unsignedNotice } from './tests.tsx';
import { When } from './time.tsx';

export function ReportPage({ me, id }: { me: ActorContext; id: string }) {
  const { data, error } = useApi(routes.report, { id });
  const fictional = useFictional();
  return (
    <Shell me={me} active="tests" action={null} notice={data && unsignedNotice(data.signatures)}>
      {error && <p className="note--bad">{error}</p>}
      {data && (
        <article className="report">
          {fictional && <p className="fict">Fictional data only. Not a real Test Report.</p>}
          <button type="button" className="btn print-hide" onClick={() => window.print()}>
            Print
          </button>
          <h1>
            Test Report <span className="record-number">{data.report.number}</span>
            {unsignedMeanings(data.signatures).length > 0 && <Status mark="Signatures unsigned" />}
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
            <dd>{data.test.receivedAt && <When at={data.test.receivedAt} atLab={data.test.receivedAtLab} />}</dd>
            <dt>Method</dt>
            <dd>
              {data.test.methodCode} v{data.test.methodVersion}, {data.test.methodTitle}
            </dd>
            <dt>GxP Class</dt>
            <dd>{data.test.gxpClass} (demo: GMP controls are not built)</dd>
            <dt>Record Version</dt>
            <dd>
              {data.recordVersion.version} · <code className="hash">{data.recordVersion.contentHash}</code>
            </dd>
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
          {/* Each note comes from the Signatures as recorded, so a login switched since still describes them truly. */}
          {signingNotes(data.signatures).map((note) => (
            <p key={note} className="fict">
              {note}
            </p>
          ))}
          <Signatures rows={data.signatures} />
        </article>
      )}
    </Shell>
  );
}
