import './keypad.css';

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back' | 'next';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * A calculator-style keypad at glove size. It reports keys and owns no field: its owner decides
 * which field a key goes to. The signing and sign-in owners send it to the code field only (rule 4).
 * Keys never take focus from the field being typed into.
 */
export function Keypad(props: {
  onKey: (key: KeypadKey) => void;
  /** Adds a decimal point key, for readings and Check values. */
  decimal?: boolean;
  nextLabel?: string;
  label: string;
  size?: 'check' | 'sign';
  surface?: 'sheet' | 'bench';
}) {
  const key = (k: KeypadKey, text: string, className = 'key', aria?: string) => (
    <button
      key={k}
      type="button"
      className={className}
      aria-label={aria}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => props.onKey(k)}
    >
      {text}
    </button>
  );
  return (
    <div className={`keypad keypad--${props.size ?? 'check'}${props.surface === 'bench' ? ' keypad--bench' : ''}`} role="group" aria-label={props.label}>
      {DIGITS.map((d) => key(d, d))}
      {props.decimal ? key('.', '.', 'key', 'Decimal point') : <span aria-hidden="true" />}
      {key('0', '0')}
      {key('back', '⌫', 'key key--fn', 'Delete last character')}
      {key('next', props.nextLabel ?? 'Next', 'key key--fn key--next')}
    </div>
  );
}

/** Applies a typing key to a string value at its end, like a calculator. Never parses a number. */
export function applyKey(value: string, key: Exclude<KeypadKey, 'next'>, maxLength = Infinity): string {
  if (key === 'back') return value.slice(0, -1);
  if (value.length >= maxLength) return value;
  if (key === '.') return value.includes('.') ? value : `${value === '' ? '0' : value}.`;
  return value + key;
}
