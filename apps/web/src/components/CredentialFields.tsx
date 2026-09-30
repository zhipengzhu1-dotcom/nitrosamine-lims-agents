import { useId, useRef } from 'react';
import type { Credentials } from '../model';
import { applyKey, Keypad, type KeypadKey } from './Keypad';
import './credentials.css';

export type SecondFactor = 'code' | 'passkey';

export type CredentialDraft = {
  readonly userId: string;
  readonly password: string;
  readonly code: string;
  readonly factor: SecondFactor;
};

export const CODE_LENGTH = 6;

export const emptyDraft: CredentialDraft = { userId: '', password: '', code: '', factor: 'code' };

/** After any answer the secrets go; the typed user ID stays. */
export function clearSecrets(draft: CredentialDraft): CredentialDraft {
  return { ...draft, password: '', code: '' };
}

export function toCredentials(draft: CredentialDraft): Credentials | null {
  if (draft.userId.trim() === '' || draft.password === '') return null;
  if (draft.factor === 'passkey') return { userId: draft.userId.trim(), password: draft.password, secondFactor: { kind: 'passkey' } };
  if (draft.code.length !== CODE_LENGTH) return null;
  return { userId: draft.userId.trim(), password: draft.password, secondFactor: { kind: 'code', code: draft.code } };
}

/**
 * User ID, password and a second factor, typed at every signing and every sign-in (decision 23).
 * There is no fill path and no simulated authenticator (rule 2). The keypad types into the code
 * field only, whichever field has focus (rule 4). A passkey is a roaming authenticator chosen here;
 * the owner of this component runs the real WebAuthn ceremony (rule 3).
 */
export function CredentialFields(props: {
  draft: CredentialDraft;
  onChange: (draft: CredentialDraft) => void;
  passkeyAllowed: boolean;
  surface: 'sheet' | 'bench';
  /** Called by the keypad's Next from the code field: the owner focuses its commit button. */
  onDone: () => void;
  disabled?: boolean;
}) {
  const id = useId();
  const userRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const { draft, onChange } = props;

  const onKey = (key: KeypadKey) => {
    if (key === 'next') {
      const active = document.activeElement;
      if (active === userRef.current) passwordRef.current?.focus();
      else if (active === passwordRef.current && draft.factor === 'code') codeRef.current?.focus();
      else if (active === passwordRef.current || active === codeRef.current) props.onDone();
      else userRef.current?.focus();
      return;
    }
    if (key === '.' || draft.factor !== 'code') return;
    onChange({ ...draft, code: applyKey(draft.code, key, CODE_LENGTH) });
  };

  return (
    <div className={`creds creds--${props.surface}`}>
      <div className="creds__fields">
        <div className="field">
          <label htmlFor={`${id}-user`}>User ID</label>
          <input
            ref={userRef}
            id={`${id}-user`}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={props.disabled}
            value={draft.userId}
            onChange={(e) => onChange({ ...draft, userId: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-password`}>Password</label>
          <input
            ref={passwordRef}
            id={`${id}-password`}
            type="password"
            autoComplete="off"
            disabled={props.disabled}
            value={draft.password}
            onChange={(e) => onChange({ ...draft, password: e.target.value })}
          />
        </div>
        {props.passkeyAllowed && (
          <div className="seg" role="radiogroup" aria-label="Second factor">
            {(['code', 'passkey'] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={draft.factor === f}
                className="seg__opt"
                disabled={props.disabled}
                onClick={() => onChange({ ...draft, factor: f, code: '' })}
              >
                {f === 'code' ? 'Authenticator code' : 'Security key or phone'}
              </button>
            ))}
          </div>
        )}
        {draft.factor === 'code' ? (
          <div className="field field--code">
            <label htmlFor={`${id}-code`}>Code</label>
            <input
              ref={codeRef}
              id={`${id}-code`}
              inputMode="none"
              autoComplete="off"
              disabled={props.disabled}
              value={draft.code}
              onChange={(e) => onChange({ ...draft, code: e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH) })}
            />
            <span className="field__hint">A fresh 6-digit code. The keypad types here.</span>
          </div>
        ) : (
          <p className="creds__passkey">
            After you press the button below, use your security key or phone. The PC&rsquo;s own sign-in is never used.
          </p>
        )}
      </div>
      <Keypad label="Code keypad" size="sign" surface={props.surface} onKey={onKey} />
    </div>
  );
}
