import { useState } from 'react';
import type { PortalReportDto, PortalSubmissionDto } from '@lims/contract';
import { useCommand, useView } from '../../api/hooks';
import { CommitButton } from '../../components/CommitButton';
import { Hash } from '../../components/Hash';
import { StatusWord } from '../../components/Status';
import { sha256Hex, type Tone } from '../../model';
import { useSession } from '../../session/context';
import { useRail, useRailControl } from '../../shell/rail';
import { labTime } from '../../time';
import { Reading, Refusal } from '../chain/common';
import '../chain/chain.css';

const TONE: Readonly<Record<string, Tone>> = { Rejected: 'bad', Reported: 'ok', 'Report released': 'ok', Released: 'ok' };

/**
 * The Customer's portal: every Submission with each Sample and Test's state as the Customer sees
 * it, a rejection's reason in full, and every released report with its SHA-256 beside the download.
 * A download is an audited act; the link it returns works once, for 60 seconds.
 */
export function Portal() {
  const { active } = useSession();
  const { showReceipt } = useRailControl();
  const submissions = useView<{ submissions: PortalSubmissionDto[] }>('portal.submissions', {});
  const reports = useView<{ reports: PortalReportDto[] }>('portal.reports', {});
  const download = useCommand<{ reportId: string; labId: string }, { sha256: string }>('report.download');
  const [refusal, setRefusal] = useState<string | null>(null);

  useRail({ context: { main: 'Submissions and reports', sub: submissions.status === 'ok' ? `${submissions.data.submissions.length} Submissions` : 'Reading' }, primary: null });

  const fetchPdf = async (r: PortalReportDto) => {
    const out = await download.run({ reportId: r.id, labId: r.labId });
    if (out.kind !== 'receipt') {
      setRefusal(out.kind === 'refusal' ? out.refusal.message : out.message);
      return;
    }
    setRefusal(null);
    showReceipt({ summary: out.summary, at: { utc: out.at, zone: active.zone }, kind: 'audited' });
    const url = (out.once as { url?: string } | null)?.url;
    if (url) window.location.assign(url);
  };

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="h-screen">Submissions</h1>
        <p className="screen__lede">
          <a href="/submit">Submit a new Submission</a>
        </p>
      </header>
      <Refusal text={refusal} />
      <section className="panel" aria-label="Released reports">
        <h2 className="h-sec">Released reports</h2>
        <Reading view={reports}>
          {(d) =>
            d.reports.length === 0 ? (
              <p className="sub">No report has been released to you yet.</p>
            ) : (
              <ul className="portal-reports">
                {d.reports.map((r) => {
                  const t = labTime({ utc: r.releasedAtUtc, zone: active.zone });
                  return (
                    <li key={r.id} className="portal-report" aria-label={`Test Report ${r.number}`}>
                      <div>
                        <b>Test Report {r.number}</b>
                        <span className="sub">
                          {r.submissionNumber}, released {t.date} {t.time} {t.zone}
                        </span>
                        <span className="portal-report__hash">
                          SHA-256 <Hash value={sha256Hex(r.pdfSha256)} />
                        </span>
                      </div>
                      <CommitButton onCommit={() => fetchPdf(r)}>Download the PDF of {r.number}</CommitButton>
                    </li>
                  );
                })}
              </ul>
            )
          }
        </Reading>
      </section>
      <Reading view={submissions}>
        {(d) =>
          d.submissions.length === 0 ? (
            <p className="screen__note">No Submission yet.</p>
          ) : (
            <>
              {d.submissions.map((s) => (
                <section key={s.id} className="panel portal-sub" aria-label={`Submission ${s.number}`}>
                  <h2 className="h-sec">
                    {s.number}
                    <StatusWord word={s.status} tone={TONE[s.status] ?? 'neutral'} />
                  </h2>
                  <p className="sub">
                    {s.labCode && `Lab ${s.labCode}`}
                    {s.submittedAt && `, submitted ${labTime({ utc: s.submittedAt, zone: active.zone }).date}`}
                  </p>
                  {s.samples.map((sm) => (
                    <div key={sm.id} className="portal-sample">
                      <p>
                        <b>
                          {sm.product}, lot {sm.lotNumber}
                        </b>
                        {sm.number && <span className="mono"> {sm.number}</span>} <StatusWord word={sm.status} tone={TONE[sm.status] ?? 'neutral'} />
                      </p>
                      <ul className="portal-tests">
                        {sm.tests.map((t) => (
                          <li key={t.id}>
                            <span>{t.method}</span>
                            <StatusWord word={t.status} tone={TONE[t.status] ?? 'neutral'} />
                            {t.rejectionReason && <span className="portal-tests__why">Reason: {t.rejectionReason}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))}
            </>
          )
        }
      </Reading>
    </div>
  );
}
