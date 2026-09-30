import { useId, useState } from 'react';
import type { CommitKey, CommitOutcome, CriticalChange, NonEmpty, ReasonForChange, ReasonOption } from '../model';
import { CommitButton, useCommitKeyOnce } from './CommitButton';
import { Glyph } from './Glyph';
import { Sheet, useSheetExit } from './Sheet';
import './credentials.css';
import './cdc.css';

const OTHER = 'other';

export type CriticalDataChangeRequest = { readonly commitKey: CommitKey; readonly reason: ReasonForChange };

/**
 * A change to Critical Data after its first save (ADR 0001, rule 12): each field's old → new
 * value, a Reason for Change from the picklist with free text required for Other, and the plain
 * statement that the change stays pending until a second person approves it.
 */
export function CriticalDataChangeDialog(props: {
  record: string;
  changes: NonEmpty<CriticalChange>;
  /** The server's picklist. Other is always offered after it. */
  reasons: readonly ReasonOption[];
  refusal: string | null;
  commitKey: CommitKey;
  onSubmit: (request: CriticalDataChangeRequest) => Promise<CommitOutcome>;
  onClosed: () => void;
}) {
  const id = useId();
  const [code, setCode] = useState('');
  const [otherText, setOtherText] = useState('');
  const { leaving, close } = useSheetExit(props.onClosed);
  const key = useCommitKeyOnce(props.commitKey);

  const reason: ReasonForChange | null =
    code === OTHER ? (otherText.trim() === '' ? null : { kind: 'other', text: otherText.trim() }) : code === '' ? null : { kind: 'picklist', code };

  const submit = async () => {
    if (leaving || !reason || !key.spend()) return;
    const outcome = await props.onSubmit({ commitKey: props.commitKey, reason });
    if (outcome === 'done') close();
  };

  return (
    <Sheet
      title={
        <>
          <Glyph name="pencil" size={22} />
          Change {props.record} after its first save
        </>
      }
      leaving={leaving}
      onEscape={close}
      footer={
        <>
          <div className="sheet__rail-who">
            <b>Critical Data Change</b>
            <span>Pending until a second person approves it</span>
          </div>
          <button type="button" className="rbtn rbtn--secondary" onClick={close}>
            Cancel
          </button>
          <CommitButton className="rbtn--commit" disabled={leaving || !reason || key.spent} onCommit={submit}>
            Propose the change for approval
          </CommitButton>
        </>
      }
    >
      <div className="cdc">
        <section className="panel" aria-labelledby={`${id}-changes`}>
          <h3 className="h-mini" id={`${id}-changes`}>
            What changes
          </h3>
          <table className="cdc__table">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Current value</th>
                <th scope="col">Proposed value</th>
              </tr>
            </thead>
            <tbody>
              {props.changes.map((c) => (
                <tr key={c.field}>
                  <th scope="row">{c.field}</th>
                  <td className="cdc__old">
                    {c.from}
                    {c.unit && ` ${c.unit}`}
                  </td>
                  <td className="cdc__new">
                    <span aria-hidden="true">→ </span>
                    {c.to}
                    {c.unit && ` ${c.unit}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="cdc__pending">
            <Glyph name="clock" size={16} />
            The current value stays in effect until someone other than you approves this change with their signature.
          </p>
        </section>
        <section className="panel cdc__why" aria-labelledby={`${id}-why`}>
          <h3 className="h-mini" id={`${id}-why`}>
            Reason for Change
          </h3>
          <div className="field">
            <label htmlFor={`${id}-reason`}>Reason</label>
            <select id={`${id}-reason`} value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="" disabled>
                Choose a reason
              </option>
              {props.reasons.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
              <option value={OTHER}>Other (describe it)</option>
            </select>
          </div>
          {code === OTHER && (
            <div className="field">
              <label htmlFor={`${id}-other`}>Describe the reason</label>
              <textarea id={`${id}-other`} value={otherText} onChange={(e) => setOtherText(e.target.value)} />
              <span className="field__hint">Required for Other. It is kept in the Audit Trail with the change.</span>
            </div>
          )}
          {props.refusal && (
            <p className="refusal" role="alert">
              <Glyph name="fail" size={18} />
              <span>{props.refusal} Nothing has changed.</span>
            </p>
          )}
        </section>
      </div>
    </Sheet>
  );
}
