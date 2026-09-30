import type { ReportDetailDto, ReviewDetailDto } from '@lims/contract';
import { useCommand, useView } from '../../api/hooks';
import { CommitButton } from '../../components/CommitButton';
import { Glyph } from '../../components/Glyph';
import { Hash } from '../../components/Hash';
import type { RailPrimary } from '../../components/Rail';
import { StatusWord } from '../../components/Status';
import { sha256Hex } from '../../model';
import { useSession } from '../../session/context';
import { useRail } from '../../shell/rail';
import { useSigning } from '../../signing/useSigning';
import { RecordAuditTrail } from '../../values/RecordAuditTrail';
import { Reading, Refusal, Signatures, TestState, useAct, useRoles } from './common';
import { Checklist } from './ReviewScreen';

const STATE: Readonly<Record<string, string>> = { Draft: 'Draft', InQaReview: 'In QA Review', Released: 'Released', Superseded: 'Superseded' };
const OUTCOME: Readonly<Record<string, string>> = { conforms: 'Conforms', 'does-not-conform': 'Does not conform', 'not-judged': 'Not judged' };

/** The subject QA's confirmation of one Test's Section verdict is filed under. */
const subjectOf = (testId: string, jurisdiction: string) => `${testId}/${jurisdiction}`;

/**
 * A Test Report: the drafter sends it to QA; QA opens a release Review, ticks its checklist and
 * confirms or disagrees with every verdict (nothing pre-ticked, decision 29), then signs Released,
 * which issues the PDF and records its SHA-256.
 */
export function ReportScreen({ reportId }: { reportId: string }) {
  const { active } = useSession();
  const roles = useRoles();
  const detail = useView<ReportDetailDto>('report.detail', { reportId });
  const d = detail.status === 'ok' ? detail.data : null;
  const mine = d?.reviews.find((r) => r.reviewer.username === active.person.username) ?? null;
  const review = useView<ReviewDetailDto>('review.detail', mine ? { reviewId: mine.id } : null);
  const toQa = useCommand<{ reportId: string; role: string }>('report.submitToQa');
  const open = useCommand<{ recordId: string; role: 'QA' }>('review.open');
  const tick = useCommand<{ reviewId: string; item: string; role: 'QA' }>('review.tick');
  const confirm = useCommand<{ reviewId: string; testId: string; jurisdiction: string; confirmation: 'confirmed' | 'disagreed' }>('review.confirmVerdict');
  const signing = useSigning();
  const { refusal, act } = useAct();
  const reload = () => {
    detail.reload();
    review.reload();
  };
  const r = review.status === 'ok' ? review.data : null;
  const confirmationOf = (testId: string, jurisdiction: string) => r?.confirmations.find((c) => c.subject === subjectOf(testId, jurisdiction))?.confirmation ?? null;
  const drafter = roles.has('Reviewer') ? 'Reviewer' : roles.has('LabManager') ? 'LabManager' : null;

  const primary = ((): RailPrimary | null => {
    if (!d) return null;
    const label = `Test Report ${d.report.number}`;
    if (d.report.state === 'Draft') {
      return drafter ? { kind: 'commit', label: `Send ${label} to QA`, onCommit: () => act(toQa, { reportId, role: drafter }, reload) } : null;
    }
    if (d.report.state !== 'InQaReview' || !roles.has('QA')) return null;
    if (!mine) return { kind: 'commit', label: `Open the release Review of ${label}`, onCommit: () => act(open, { recordId: reportId, role: 'QA' }, reload) };
    if (!r) return null;
    const missing = [
      ...r.items.filter((i) => !i.ticked).map((i) => `tick "${i.item}"`),
      ...d.tests.flatMap((t) => t.jurisdictions.filter((j) => confirmationOf(t.id, j) === null).map((j) => `confirm or disagree with the ${j} verdict of ${t.label}`)),
    ];
    const signLabel = `Sign ${label} as Released`;
    return missing.length > 0
      ? { kind: 'blocked', label: signLabel, reason: `Still to do: ${missing.join('; ')}.` }
      : { kind: 'commit', label: signLabel, onCommit: () => signing.open({ meaning: 'Released', role: 'QA', targets: [reportId], attestation: r.reviewId, actionLabel: signLabel, onSigned: reload }) };
  })();
  useRail({ context: d ? { main: `Test Report ${d.report.number}`, sub: `${STATE[d.report.state] ?? d.report.state}, ${d.report.customer}, ${d.report.submissionNumber}` } : { main: 'Test Report', sub: 'Reading' }, primary });

  return (
    <div className="screen">
      <Reading view={detail}>
        {(dd) => (
          <>
            <header className="screen__head">
              <div className="plate__title">
                <h1 className="h-screen">Test Report {dd.report.number}</h1>
                <StatusWord word={STATE[dd.report.state] ?? dd.report.state} tone={dd.report.state === 'Released' ? 'ok' : 'neutral'} />
              </div>
              <p className="screen__lede">
                {dd.report.customer}, Submission {dd.report.submissionNumber}
                {dd.report.version && `, Record Version ${dd.report.version.versionNo}`}
              </p>
            </header>
            {dd.issue && (
              <section className="panel issued" aria-label="Issued PDF">
                <h2 className="h-sec">
                  <Glyph name="file" size={18} />
                  Issued PDF
                </h2>
                <p>
                  SHA-256 <Hash value={sha256Hex(dd.issue.pdfSha256)} />
                </p>
              </section>
            )}
            <Refusal text={refusal ?? signing.refusal} />
            <section className="panel" aria-label="Tests on this report">
              <h2 className="h-sec">Tests on this report</h2>
              <ul className="report-tests">
                {dd.tests.map((t) => (
                  <li key={t.id} className="report-test">
                    <div className="report-test__head">
                      <a className="row__link" href={`/tests/${t.id}`}>
                        {t.label}
                      </a>
                      <TestState test={t} />
                      <span className="sub">
                        {t.product} lot {t.lotNumber}, {t.method}
                        {t.version && `, Record Version ${t.version.versionNo} (${t.version.hash.slice(0, 8)})`}
                      </span>
                      <span className="sub">
                        Performed {t.performedStands ? 'stands' : 'does not stand'}, Reviewed {t.reviewedStands ? 'stands' : 'does not stand'}
                      </span>
                    </div>
                    {t.jurisdictions.map((j) => {
                      const confirmation = confirmationOf(t.id, j);
                      return (
                        <div key={j} className="verdict-confirm" role="group" aria-label={`${j} verdict of ${t.label}`}>
                          <span className="verdict-confirm__what">
                            <b>{j} Section</b>
                            {t.verdicts
                              .filter((v) => v.jurisdiction === j)
                              .map((v) => (
                                <span key={v.analyte} className="sub">
                                  {v.analyte}: {v.compared ?? 'not judged'} ppm against NMT {v.limit} ppm, {OUTCOME[v.outcome] ?? v.outcome}
                                  {v.sharePercent && `, ${v.sharePercent} % of limit`}
                                </span>
                              ))}
                          </span>
                          {confirmation ? (
                            <StatusWord word={confirmation === 'confirmed' ? 'Confirmed by you' : 'You disagreed'} tone={confirmation === 'confirmed' ? 'ok' : 'bad'} />
                          ) : r && dd.report.state === 'InQaReview' ? (
                            <span className="verdict-confirm__acts">
                              <CommitButton tone="secondary" onCommit={() => act(confirm, { reviewId: r.reviewId, testId: t.id, jurisdiction: j, confirmation: 'confirmed' }, reload)}>
                                Confirm the {j} verdict of {t.label}
                              </CommitButton>
                              <CommitButton tone="danger" onCommit={() => act(confirm, { reviewId: r.reviewId, testId: t.id, jurisdiction: j, confirmation: 'disagreed' }, reload)}>
                                Disagree
                              </CommitButton>
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </li>
                ))}
              </ul>
            </section>
            {r && dd.report.state === 'InQaReview' && <Checklist review={r} onTick={(item) => act(tick, { reviewId: r.reviewId, item, role: 'QA' }, reload)} />}
            <Signatures lines={dd.signatures} record={`Test Report ${dd.report.number}`} title="Signatures on the report" />
            <RecordAuditTrail recordId={dd.report.id} zone={active.zone} title={`Audit Trail of Test Report ${dd.report.number}`} />
          </>
        )}
      </Reading>
      {signing.sheet}
    </div>
  );
}
