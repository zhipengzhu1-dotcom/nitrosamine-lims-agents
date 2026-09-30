import { useRef, useState, type ReactNode } from 'react';
import type { PreparedSigningDto } from '@lims/contract';
import { SIGNS_AS } from '@lims/contract/session';
import { useCommand } from '../api/hooks';
import { SignaturePrompt, type SignRequest } from '../components/SignaturePrompt';
import { sha256Hex, type CommitOutcome, type EligibilityAnswer, type NonEmpty, type SignatureMeaning, type SigningItem } from '../model';
import { useAttemptKey, useSession, wireCredentials } from '../session/context';
import { roleLabel } from '../session/store';
import { useRailControl } from '../shell/rail';
import { shownValue, signedValues, sourceFilesOf } from './values';

export type SigningRequest = {
  readonly meaning: SignatureMeaning;
  /** The records to sign; several make a group signing (rule 8). */
  readonly targets: readonly string[];
  /** The Review record whose version a Reviewed or Released signature cites. */
  readonly attestation: string | null;
  /** The final button's words, naming the act, e.g. "Sign Test RD-S-2026-000123/T1 as Performed". */
  readonly actionLabel: string;
  readonly failing?: boolean;
  /** The role to sign under; otherwise the first eligible one the person holds for the meaning. */
  readonly role?: string;
  readonly onSigned?: () => void;
};

type Open = {
  readonly request: SigningRequest;
  readonly prepared: PreparedSigningDto;
  readonly role: string;
  readonly attemptsLeft: number;
  readonly refusal: string | null;
};

type Version = PreparedSigningDto['items'][number]['version'];

const ref = (v: Version) => ({ versionId: v.versionId, hash: v.hash });

function items(prepared: PreparedSigningDto): NonEmpty<SigningItem> | null {
  const mapped = prepared.items.map(
    (i): SigningItem => ({
      version: { record: i.label, versionNo: i.version.versionNo, versionId: i.version.versionId, hash: sha256Hex(i.version.hash) },
      values: signedValues(i),
      sourceFiles: sourceFilesOf(i),
    }),
  );
  const [head, ...rest] = mapped;
  return head ? [head, ...rest] : null;
}

/** The server's answer for the role the prompt signs under, shown before credentials (rule 5). */
function eligibilityFor(prepared: PreparedSigningDto, role: string): EligibilityAnswer {
  const answer = prepared.eligibility.byRole.find((r) => r.role === role);
  if (!answer) return { eligible: false, reason: `You hold no role that signs ${prepared.meaning} here.` };
  if (!answer.eligible) return { eligible: false, reason: answer.reasons.join(' ') };
  return {
    eligible: true,
    authorisation: answer.authorisation ? { meaning: answer.authorisation.meaning as SignatureMeaning, scope: answer.authorisation.scope, validUntil: answer.authorisation.validUntil } : null,
    trainingRecord: null,
  };
}

/**
 * Every Electronic Signature goes through here: signing.prepare seals what is shown and answers
 * who may sign; signing.sign re-authenticates in full and signs exactly the versions shown. Each
 * attempt carries its own commit key. A version that changed after it was shown is prepared again
 * and shown, and nothing is signed until the person presses again.
 */
export function useSigning(): { readonly open: (request: SigningRequest) => Promise<void>; readonly sheet: ReactNode; readonly refusal: string | null; readonly busy: boolean } {
  const { active } = useSession();
  const { showReceipt } = useRailControl();
  const prepare = useCommand<{ meaning: string; role: string; targets: readonly string[]; attestation: string | null }, PreparedSigningDto>('signing.prepare');
  const sign = useCommand<unknown, unknown>('signing.sign');
  const attempt = useAttemptKey();
  const [current, setCurrent] = useState<Open | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const opening = useRef(false);

  const held = (meaning: SignatureMeaning) => SIGNS_AS[meaning].filter((r) => active.roles.includes(r));

  const runPrepare = (request: SigningRequest, role: string) => prepare.run({ meaning: request.meaning, role, targets: request.targets, attestation: request.attestation });

  const open = async (request: SigningRequest) => {
    if (opening.current || current) return;
    opening.current = true;
    try {
      const firstRole = request.role ?? held(request.meaning)[0] ?? SIGNS_AS[request.meaning][0];
      const out = await runPrepare(request, firstRole);
      if (out.kind !== 'receipt') {
        setRefusal(out.kind === 'refusal' ? out.refusal.message : out.message);
        return;
      }
      setRefusal(null);
      const byRole = out.data.eligibility.byRole;
      const role = request.role ?? byRole.find((r) => r.eligible)?.role ?? firstRole;
      setCurrent({ request, prepared: out.data, role, attemptsLeft: out.data.eligibility.attemptsLeft, refusal: null });
    } finally {
      opening.current = false;
    }
  };

  const onSign = async (open: Open, req: SignRequest): Promise<CommitOutcome> => {
    const out = await sign.run(
      {
        meaning: open.request.meaning,
        role: open.role,
        targets: req.versions,
        attestation: open.prepared.attestation ? ref(open.prepared.attestation) : null,
        credentials: wireCredentials(req.credentials),
      },
      req.commitKey,
    );
    attempt.next();
    if (out.kind === 'receipt') {
      showReceipt({ summary: out.summary, at: { utc: out.at, zone: active.zone }, kind: 'signed' });
      open.request.onSigned?.();
      return 'done';
    }
    if (out.kind === 'unreachable') {
      setCurrent({ ...open, refusal: out.message });
      return 'refused';
    }
    const r = out.refusal;
    if (r.kind === 'stale-version') {
      const again = await runPrepare(open.request, open.role);
      if (again.kind === 'receipt') {
        setCurrent({ ...open, prepared: again.data, refusal: `${r.message} The prompt now shows the version to sign.` });
        return 'refused';
      }
    }
    setCurrent({ ...open, attemptsLeft: r.attemptsLeft ?? open.attemptsLeft, refusal: r.message });
    return 'refused';
  };

  const shown = current ? items(current.prepared) : null;
  const sheet =
    current && shown ? (
      <SignaturePrompt
        meaning={current.request.meaning}
        statement={current.prepared.statement}
        items={shown}
        attestation={
          current.prepared.attestation
            ? { record: current.prepared.attestation.label, versionNo: current.prepared.attestation.versionNo, hash: sha256Hex(current.prepared.attestation.hash), values: current.prepared.attestation.values.map(shownValue) }
            : null
        }
        consequences={current.prepared.consequence ? [current.prepared.consequence] : []}
        signer={{ ...active.person, role: roleLabel(current.role) }}
        lab={active.lab?.code ?? ''}
        workstation={active.workstation}
        eligibility={eligibilityFor(current.prepared, current.role)}
        attemptsLeft={current.attemptsLeft}
        refusal={current.refusal}
        actionLabel={current.request.actionLabel}
        {...(current.request.failing ? { failing: true } : {})}
        passkeyAllowed={false}
        commitKey={attempt.key}
        onSign={(req) => onSign(current, req)}
        onClosed={() => setCurrent(null)}
      />
    ) : null;

  return { open, sheet, refusal, busy: prepare.busy || sign.busy };
}
