import { useState } from 'react';
import type { Person, Receipt as ReceiptFact, ServerInstant } from '../model';
import { shortLabTime } from '../time';
import { CommitButton } from './CommitButton';
import { Glyph } from './Glyph';
import { Receipt } from './Receipt';
import './buttons.css';
import './shell.css';

export type RailPrimary =
  | { readonly kind: 'commit'; readonly label: string; readonly tone?: 'primary' | 'danger'; readonly onCommit: () => Promise<unknown> }
  /** The next commit exists but the server's gate refuses it; pressing it says why (rule 15). */
  | { readonly kind: 'blocked'; readonly label: string; readonly reason: string };

export type RailIdentity = {
  readonly person: Person;
  readonly signedInAt: ServerInstant;
  readonly idleLockAt: ServerInstant;
  /** Set by the session layer in the last minute before the idle lock. */
  readonly idleSecondsLeft: number | null;
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

function IdentityPlate({ identity }: { identity: RailIdentity }) {
  const { person } = identity;
  const warn = identity.idleSecondsLeft !== null && identity.idleSecondsLeft <= 60;
  return (
    <div className="who">
      <span className="mono-av" aria-hidden="true">
        {initials(person.printedName)}
      </span>
      <div className="who__text">
        <span className="who__name">
          {person.printedName}
          {person.nativeName && <span className="who__native"> {person.nativeName}</span>}
        </span>
        <span className="who__meta">
          {person.role}, <span className="mono">{person.username}</span>, signed in {shortLabTime(identity.signedInAt)}
        </span>
        <span className={`who__idle${warn ? ' who__idle--warn' : ''}`}>
          {warn ? `Locks in ${identity.idleSecondsLeft} s without input` : `Idle lock at ${shortLabTime(identity.idleLockAt)}`}
        </span>
      </div>
    </div>
  );
}

/**
 * The bench rail, the same on every screen: who is signed in; what the next action acts on, or the
 * receipt of the last commit; the primary button named for the next commit; Switch user and Lock.
 */
export function Rail(props: {
  identity: RailIdentity;
  /** What the next action acts on. */
  context: { readonly main: string; readonly sub: string | null } | null;
  receipt: ReceiptFact | null;
  primary: RailPrimary | null;
  onSwitchUser: () => void;
  onLock: () => void;
  /** Ends the session on the server; the next person signs in afresh. */
  onSignOut?: () => void;
}) {
  const [refusedLabel, setRefusedLabel] = useState<string | null>(null);
  const primary = props.primary;
  const showRefusal = primary?.kind === 'blocked' && refusedLabel === primary.label;

  return (
    <footer className="rail" id="rail" aria-label="Signed-in person and actions">
      <IdentityPlate identity={props.identity} />
      {showRefusal && primary.kind === 'blocked' ? (
        <div className="rail__context rail__context--bad" role="status">
          <p className="ctx__main">
            <Glyph name="noentry" size={18} />
            <span>{primary.label} is not open</span>
          </p>
          <p className="ctx__sub ctx__sub--wrap">{primary.reason}</p>
        </div>
      ) : props.receipt ? (
        <Receipt receipt={props.receipt} />
      ) : (
        <div className="rail__context">
          {props.context && (
            <>
              <p className="ctx__main">{props.context.main}</p>
              {props.context.sub && <p className="ctx__sub">{props.context.sub}</p>}
            </>
          )}
        </div>
      )}
      <div className="rail__actions">
        {primary?.kind === 'commit' && (
          <CommitButton key={primary.label} tone={primary.tone ?? 'primary'} onCommit={primary.onCommit}>
            {primary.label}
          </CommitButton>
        )}
        {primary?.kind === 'blocked' && (
          <button type="button" className="rbtn rbtn--primary" aria-disabled="true" onClick={() => setRefusedLabel(primary.label)}>
            {primary.label}
          </button>
        )}
      </div>
      <div className="rail__session">
        <button type="button" className="rbtn rbtn--quiet" onClick={props.onSwitchUser}>
          <Glyph name="switch" size={20} />
          Switch user
        </button>
        <button type="button" className="rbtn rbtn--quiet" onClick={props.onLock}>
          <Glyph name="lock" size={20} />
          Lock
        </button>
        {props.onSignOut && (
          <button type="button" className="rbtn rbtn--quiet" onClick={props.onSignOut}>
            <Glyph name="back" size={20} />
            Sign out
          </button>
        )}
      </div>
    </footer>
  );
}
