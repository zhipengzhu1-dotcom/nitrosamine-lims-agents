import { useState } from 'react';
import { CHANGE_REASONS, type ValueSavedDto } from '@lims/contract/session';
import { useCommand } from '../api/hooks';
import { CommitButton } from '../components/CommitButton';
import { CriticalDataChangeDialog } from '../components/CriticalDataChangeDialog';
import { Glyph } from '../components/Glyph';
import { ValueField } from '../components/ValueField';
import type { CommitOutcome, LimitLine, ReasonForChange } from '../model';
import { useAttemptKey, useSession } from '../session/context';
import { useRailControl } from '../shell/rail';
import './values.css';

/** A Recorded Value as the server last confirmed it. */
export type SavedValue = {
  readonly valueId: string;
  /** The effective value as typed, with its written decimals. */
  readonly text: string;
  readonly versionNo: number;
  readonly standing: 'effective' | 'pending';
  /** A proposed Critical Data Change the effective value is waiting on. */
  readonly pendingText: string | null;
};

type TypedDecimal = { readonly type: 'decimal'; readonly value: string; readonly unit: string };

const DECIMAL = /^-?\d+(\.\d+)?$/;

const wireReason = (r: ReasonForChange) => (r.kind === 'other' ? { code: 'other', text: r.text } : { code: r.code });

/**
 * One typed value, saved to the server as it is made (ADR 0001, decision 23). The first save is
 * value.record and takes effect at once. Any later value is value.change with a Reason for Change
 * from the dialog; for a critical field the server keeps the earlier value current until a
 * second person approves the change, and this field says so.
 */
export function RecordedValueField(props: {
  parent: string;
  field: string;
  subject: string;
  label: string;
  unit: string;
  /** The role the entry is made under, as the command requires. */
  role: string;
  /** From the record kind's field register: whether a change needs a second person's approval. */
  critical: boolean;
  limits: readonly LimitLine[];
  saved: SavedValue | null;
  onSaved: (saved: SavedValue) => void;
}) {
  const { active } = useSession();
  const { showReceipt } = useRailControl();
  const record = useCommand<unknown, ValueSavedDto>('value.record');
  const change = useCommand<unknown, ValueSavedDto>('value.change');
  const attempt = useAttemptKey();
  const [draft, setDraft] = useState(props.saved?.pendingText ?? props.saved?.text ?? '');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [proposing, setProposing] = useState<string | null>(null);
  const [dialogRefusal, setDialogRefusal] = useState<string | null>(null);

  const typed = (text: string): TypedDecimal => ({ type: 'decimal', value: text, unit: props.unit });
  const current = props.saved?.pendingText ?? props.saved?.text ?? null;
  const savable = DECIMAL.test(draft) && draft !== current;

  const settle = (text: string, out: Awaited<ReturnType<typeof record.run>>): CommitOutcome => {
    if (out.kind !== 'receipt') {
      const message = out.kind === 'refusal' ? out.refusal.message : out.message;
      if (props.saved) setDialogRefusal(message);
      else setRefusal(message);
      return 'refused';
    }
    setRefusal(null);
    setDialogRefusal(null);
    showReceipt({ summary: out.summary, at: { utc: out.at, zone: active.zone }, kind: 'audited' });
    const pending = out.data.standing === 'pending';
    props.onSaved({
      valueId: out.data.value,
      text: pending && props.saved ? props.saved.text : text,
      versionNo: out.data.version.versionNo,
      standing: out.data.standing,
      pendingText: pending ? text : null,
    });
    return 'done';
  };

  const saveFirst = async () => {
    const text = draft;
    const out = await record.run({ role: props.role, parent: props.parent, field: props.field, subject: props.subject, value: typed(text) });
    settle(text, out);
  };

  const propose = async (reason: ReasonForChange, key: typeof attempt.key): Promise<CommitOutcome> => {
    if (!props.saved || proposing === null) return 'refused';
    const out = await change.run({ role: props.role, value: props.saved.valueId, to: typed(proposing), reason: wireReason(reason) }, key);
    attempt.next();
    return settle(proposing, out);
  };

  const saved = props.saved;
  return (
    <div className="rv">
      <div className="rv__entry">
        <ValueField
          label={props.label}
          unit={props.unit}
          value={draft}
          onChange={setDraft}
          limits={props.limits}
          status={saved?.pendingText ? { word: `Change to ${saved.pendingText} ${props.unit} pending approval; ${saved.text} ${props.unit} stays current`, tone: 'provisional' } : null}
        />
        <CommitButton
          tone="secondary"
          className="rv__save"
          disabled={!savable}
          onCommit={async () => {
            if (!savable) return;
            if (saved) {
              setDialogRefusal(null);
              setProposing(draft);
            } else await saveFirst();
          }}
        >
          <span className="sr-only">Save {props.label}</span>
          <span aria-hidden="true">Save</span>
        </CommitButton>
      </div>
      {refusal && (
        <p className="refusal" role="alert">
          <Glyph name="fail" size={18} />
          <span>{refusal} Nothing was saved.</span>
        </p>
      )}
      {saved && proposing !== null && (
        <CriticalDataChangeDialog
          record={props.label}
          changes={[{ field: props.label, from: saved.pendingText ?? saved.text, to: proposing, unit: props.unit }]}
          reasons={CHANGE_REASONS}
          refusal={dialogRefusal}
          requiresApproval={props.critical}
          commitKey={attempt.key}
          onSubmit={(r) => propose(r.reason, r.commitKey)}
          onClosed={() => setProposing(null)}
        />
      )}
    </div>
  );
}
