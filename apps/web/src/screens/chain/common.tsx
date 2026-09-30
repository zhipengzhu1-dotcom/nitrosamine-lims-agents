// Pieces every sample-chain screen shares. Each prints a server fact: the step model and its
// blocked reasons, the state word, the signatures, a refusal. Nothing here decides anything.
import { useState, type ReactNode } from 'react';
import type { HoldDto, QueueTestDto, SignatureLineDto, StepDto } from '@lims/contract';
import type { Command } from '../../api/hooks';
import type { ViewState } from '../../api/hooks';
import { Glyph } from '../../components/Glyph';
import { SignatureLine } from '../../components/Signature';
import { GxpBadge, HoldTag, StatusWord } from '../../components/Status';
import { StepBar } from '../../components/StepBar';
import { sha256Hex, type Hold, type NonEmpty, type Signature, type SignatureMeaning, type Step, type Tone } from '../../model';
import { useSession } from '../../session/context';
import { roleLabel } from '../../session/store';
import { useRailControl } from '../../shell/rail';
import './chain.css';

export function stepsOf(steps: readonly StepDto[]): NonEmpty<Step> | null {
  const mapped = steps.map((s): Step => {
    const [first, ...rest] = s.reasons;
    return s.state === 'blocked' && first !== undefined ? { name: s.name, state: 'blocked', note: s.note, reasons: [{ text: first }, ...rest.map((text) => ({ text }))] } : { name: s.name, state: s.state === 'blocked' ? 'current' : s.state, note: s.note };
  });
  const [head, ...tail] = mapped;
  return head ? [head, ...tail] : null;
}

/** The blocked step's reasons, as the rail prints them when it refuses the next act (rule 15). */
export const blockedReasons = (steps: readonly StepDto[]): string | null => {
  const b = steps.find((s) => s.state === 'blocked');
  return b ? b.reasons.join(' ') : null;
};

const TONE: Readonly<Record<string, Tone>> = {
  Requested: 'neutral', Accepted: 'neutral', Ready: 'neutral', Assigned: 'neutral', InProgress: 'warn', SubmittedForReview: 'warn',
  Reviewed: 'ok', Reported: 'ok', Rejected: 'bad', Cancelled: 'idle', Invalidated: 'bad',
};

export const TestState = ({ test }: { test: Pick<QueueTestDto, 'state' | 'stateLabel'> }) => <StatusWord word={test.stateLabel} tone={TONE[test.state] ?? 'neutral'} />;

const holdOf = (h: HoldDto): Hold => ({ id: h.id, kind: h.kind, reason: `Blocks ${h.blocks}`, blocks: [h.blocks] });

export function Holds({ holds, compact = false }: { holds: readonly HoldDto[]; compact?: boolean }) {
  const [first, ...rest] = holds.map(holdOf);
  return first ? <HoldTag holds={[first, ...rest]} compact={compact} /> : null;
}

/** A Test's name plate: its label, state, GxP Class, Holds and the step bar from the server's step model. */
export function TestPlate({ test, children }: { test: QueueTestDto; children?: ReactNode }) {
  const steps = stepsOf(test.steps);
  return (
    <header className="plate">
      <div className="plate__title">
        <h1 className="h-screen">{test.label}</h1>
        <TestState test={test} />
        <GxpBadge gxpClass={test.gxpClass === 'GMP' ? 'GMP' : 'non-GMP'} />
        <Holds holds={test.holds} />
      </div>
      <p className="plate__meta">
        {test.customer}, {test.product} lot {test.lotNumber}, {test.submissionNumber}, {test.method}
        {test.assignedAnalyst && `, assigned to ${test.assignedAnalyst.printedName}`}
      </p>
      {steps && <StepBar steps={steps} label={`Steps of ${test.label}`} />}
      {children}
    </header>
  );
}

export function lineOf(s: SignatureLineDto, record: string, lab: string, zone: string): Signature {
  return {
    meaning: s.meaning as SignatureMeaning,
    statement: s.statement,
    signer: { printedName: s.printedName, nativeName: null, username: s.username, role: roleLabel(s.role) },
    lab,
    workstation: null,
    signedAt: { utc: s.signedAtUtc, zone },
    version: { record, versionNo: s.version.versionNo, versionId: s.version.versionId, hash: sha256Hex(s.version.hash) },
    standing: s.stands ? 'stands' : 'changed-after-signature',
  };
}

/** Every signature on the record's current version as a SignatureLine (rule 10). */
export function Signatures({ lines, record, title = 'Signatures' }: { lines: readonly SignatureLineDto[]; record: string; title?: string }) {
  const { active } = useSession();
  return (
    <section className="panel" aria-label={`${title} on ${record}`}>
      <h2 className="h-sec">{title}</h2>
      {lines.length === 0 ? (
        <p className="sub">Not signed.</p>
      ) : (
        <div className="siglist">
          {lines.map((s) => (
            <SignatureLine key={s.id} signature={lineOf(s, record, active.lab?.code ?? '', active.zone)} />
          ))}
        </div>
      )}
    </section>
  );
}

export function Refusal({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="refusal" role="alert">
      <Glyph name="fail" size={18} />
      <span>{text}</span>
    </p>
  );
}

/** What a View's state shows while it is not ready: a reading line or the server's refusal. */
export function Reading<T>({ view, children }: { view: ViewState<T>; children: (data: T) => ReactNode }) {
  if (view.status === 'loading') return <p className="screen__reading">Reading from the server.</p>;
  if (view.status === 'refused') return <Refusal text={view.refusal.message} />;
  if (view.status === 'unreachable') return <Refusal text={view.message} />;
  return <>{children(view.data)}</>;
}

/**
 * Runs a command from an event handler and answers in the rail: the server's receipt on a commit,
 * or its refusal where the hand acted. `then` runs only after a receipt, e.g. to read the record again.
 */
export function useAct(): { readonly refusal: string | null; readonly act: <I, D>(command: Command<I, D>, input: I, then?: (data: D) => void | Promise<void>) => Promise<void> } {
  const { active } = useSession();
  const { showReceipt } = useRailControl();
  const [refusal, setRefusal] = useState<string | null>(null);
  const act = async <I, D>(command: Command<I, D>, input: I, then?: (data: D) => void | Promise<void>) => {
    if (command.busy) return;
    const out = await command.run(input);
    if (out.kind === 'receipt') {
      setRefusal(null);
      showReceipt({ summary: out.summary, at: { utc: out.at, zone: active.zone }, kind: out.act });
      await then?.(out.data);
    } else setRefusal(out.kind === 'refusal' ? out.refusal.message : out.message);
  };
  return { refusal, act };
}

/** The roles this session holds, by the server's names. */
export function useRoles(): { readonly has: (role: string) => boolean } {
  const { active } = useSession();
  return { has: (role) => active.roles.includes(role) };
}
