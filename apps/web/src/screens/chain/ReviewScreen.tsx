import { useId, useState } from 'react';
import type { ReviewDetailDto, ReviewRefDto, RunDetailDto, TestDetailDto } from '@lims/contract';
import { useCommand, useView } from '../../api/hooks';
import { CommitButton } from '../../components/CommitButton';
import { Glyph } from '../../components/Glyph';
import type { RailPrimary } from '../../components/Rail';
import { useSession } from '../../session/context';
import { useRail } from '../../shell/rail';
import { useSigning } from '../../signing/useSigning';
import { RecordAuditTrail } from '../../values/RecordAuditTrail';
import { Reading, Refusal, Signatures, TestPlate, useAct } from './common';
import { Results } from './Results';
import { RunPanel } from './RunPanel';

/** The Review Checklist: each item ticked by the reviewer, never pre-ticked (decision 20 §7). */
export function Checklist({ review, onTick }: { review: ReviewDetailDto; onTick: (item: string) => Promise<void> }) {
  return (
    <section className="panel" aria-label={`Review Checklist ${review.checklistVersion}`}>
      <h2 className="h-sec">Review Checklist {review.checklistVersion}</h2>
      <ul className="checklist">
        {review.items.map((i) => (
          <li key={i.item} className={i.ticked ? 'is-ticked' : undefined}>
            {i.ticked ? (
              <span className="checklist__done">
                <Glyph name="tick" size={18} />
                {i.item}
              </span>
            ) : (
              <CommitButton tone="secondary" onCommit={() => onTick(i.item)}>
                Tick: {i.item}
              </CommitButton>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The Reviewer's screen for a Run or a Test: the record, its signatures and its inline Audit Trail
 * (the record's own entries and every value's), the checklist on the reviewer's own Review record,
 * then Reviewed with that Review as attestation, or, for a Test, Return with a reason.
 */
export function ReviewScreen({ kind, recordId }: { kind: 'run' | 'test'; recordId: string }) {
  const id = useId();
  const { active } = useSession();
  const test = useView<TestDetailDto>('test.detail', kind === 'test' ? { testId: recordId } : null);
  const run = useView<RunDetailDto>('run.detail', kind === 'run' ? { runId: recordId } : null);
  const reviews: readonly ReviewRefDto[] = kind === 'test' ? (test.status === 'ok' ? test.data.reviews : []) : run.status === 'ok' ? run.data.reviews : [];
  const mine = reviews.find((r) => r.reviewer.username === active.person.username) ?? null;
  const review = useView<ReviewDetailDto>('review.detail', mine ? { reviewId: mine.id } : null);
  const open = useCommand<{ recordId: string; role: 'Reviewer' }>('review.open');
  const tick = useCommand<{ reviewId: string; item: string; role: 'Reviewer' }>('review.tick');
  const giveBack = useCommand<{ testId: string; reason: { code: 'other'; text: string } }>('test.return');
  const signing = useSigning();
  const { refusal, act } = useAct();
  const [reason, setReason] = useState('');
  const [generation, setGeneration] = useState(0);

  const reload = () => {
    test.reload();
    run.reload();
    review.reload();
    setGeneration((g) => g + 1);
  };

  const label = kind === 'test' ? (test.status === 'ok' ? test.data.test.label : 'the Test') : run.status === 'ok' ? `Run ${run.data.run.number}` : 'the Run';
  const loaded = kind === 'test' ? test.status === 'ok' : run.status === 'ok';
  const reviewed = kind === 'test' ? test.status === 'ok' && test.data.test.state !== 'SubmittedForReview' : run.status === 'ok' && run.data.run.state === 'Reviewed';
  const r = review.status === 'ok' ? review.data : null;
  const unticked = r ? r.items.filter((i) => !i.ticked).map((i) => i.item) : [];

  const primary = ((): RailPrimary | null => {
    if (!loaded || reviewed) return null;
    if (!mine) return { kind: 'commit', label: `Open a Review of ${label}`, onCommit: () => act(open, { recordId, role: 'Reviewer' }, reload) };
    if (!r) return null;
    const signLabel = `Sign ${label} as Reviewed`;
    if (unticked.length > 0) return { kind: 'blocked', label: signLabel, reason: `Tick every checklist item first: ${unticked.join('; ')}.` };
    return { kind: 'commit', label: signLabel, onCommit: () => signing.open({ meaning: 'Reviewed', role: 'Reviewer', targets: [recordId], attestation: r.reviewId, actionLabel: signLabel, onSigned: reload }) };
  })();
  useRail({ context: { main: `Review of ${label}`, sub: reviewed ? 'Reviewed' : mine ? `Your Review on ${mine.checklistVersion}` : 'No Review of yours yet' }, primary });

  return (
    <div className="screen">
      {kind === 'test' ? (
        <Reading view={test}>
          {(d) => (
            <>
              <TestPlate test={d.test} />
              <Results detail={d} />
              <Signatures lines={d.signatures} record={d.test.label} title="Signatures on the Test" />
            </>
          )}
        </Reading>
      ) : (
        <Reading view={run}>
          {(d) => (
            <>
              <header className="screen__head">
                <h1 className="h-screen">Review of Run {d.run.number}</h1>
                <p className="screen__lede">
                  {d.run.method}, feeding {d.run.tests.map((t) => t.label).join(', ')}
                </p>
              </header>
              <RunPanel run={d} editable={false} onSaved={reload} />
            </>
          )}
        </Reading>
      )}
      <Refusal text={refusal ?? signing.refusal} />
      {loaded && <RecordAuditTrail key={`trail-${generation}`} recordId={recordId} zone={active.zone} title={`Audit Trail of ${label}`} />}
      {r && !reviewed && <Checklist review={r} onTick={(item) => act(tick, { reviewId: r.reviewId, item, role: 'Reviewer' }, reload)} />}
      {kind === 'test' && test.status === 'ok' && test.data.test.state === 'SubmittedForReview' && (
        <section className="panel reject" aria-label="Return to the Analyst">
          <label htmlFor={`${id}-reason`}>Reason to return {label} to the Analyst</label>
          <textarea id={`${id}-reason`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          <CommitButton tone="danger" disabled={reason.trim() === ''} onCommit={() => act(giveBack, { testId: recordId, reason: { code: 'other', text: reason.trim() } }, () => { setReason(''); reload(); })}>
            Return {label} with this reason
          </CommitButton>
        </section>
      )}
      {signing.sheet}
    </div>
  );
}
