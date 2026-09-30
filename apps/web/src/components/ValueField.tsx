import { useId, type Ref } from 'react';
import type { LimitLine, ServerStatus } from '../model';
import { limitText } from './LimitText';
import { StatusWord } from './Status';
import './valuefield.css';

/**
 * A glove-sized entry field: the unit sits inside it and the limits print under it exactly as
 * stored (rule 20). The value is the string as typed; nothing here parses it, rounds it or judges
 * it. A status shows only when the server sends one (rule 14). `inputMode="none"` keeps the touch
 * keyboard down, because the keypad types here.
 */
export function ValueField(props: {
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  limits: readonly LimitLine[];
  status?: ServerStatus | null;
  inputRef?: Ref<HTMLInputElement>;
  onFocus?: () => void;
}) {
  const id = useId();
  const limitsId = `${id}-limits`;
  const tone = props.status?.tone;
  return (
    <div className={`nf${tone === 'bad' ? ' nf--bad' : tone === 'ok' ? ' nf--ok' : ''}`}>
      <label className="nf__label" htmlFor={id}>
        {props.label}
      </label>
      <div className="nf__box">
        <input
          ref={props.inputRef}
          id={id}
          className="nf__input"
          inputMode="none"
          autoComplete="off"
          aria-describedby={props.limits.length > 0 ? limitsId : undefined}
          value={props.value}
          onFocus={props.onFocus}
          onChange={(e) => props.onChange(e.target.value.replace(/[^0-9.-]/g, ''))}
        />
        <span className="nf__unit">{props.unit}</span>
      </div>
      {props.limits.length > 0 && (
        <ul className="nf__limits" id={limitsId}>
          {props.limits.map((l) => (
            <li key={l.label}>
              <span className="nf__limit-label">{l.label}</span> <span className="limit">{limitText(l.limit)}</span>
            </li>
          ))}
        </ul>
      )}
      {props.status && <StatusWord word={props.status.word} tone={props.status.tone} />}
    </div>
  );
}
