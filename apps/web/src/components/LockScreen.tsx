import { useRef, useState, type ReactNode } from 'react';
import type { DataClass } from '@lims/contract';
import type { CommitKey, CommitOutcome, Credentials, LockReason, Person, ServerInstant, Workstation } from '../model';
import { labTime, shortLabTime } from '../time';
import { CommitButton, useCommitKeyOnce } from './CommitButton';
import { clearSecrets, CredentialFields, emptyDraft, toCredentials, type CredentialDraft } from './CredentialFields';
import { Glyph } from './Glyph';
import { initials } from './Rail';
import './buttons.css';
import './lock.css';

type Submit = (credentials: Credentials, commitKey: CommitKey) => Promise<CommitOutcome>;

/** The dark full-screen frame both the lock and sign-in screens use. It shows no record. */
function BenchScreen(props: { workstation: Workstation; now: ServerInstant; dataClass: DataClass; children: ReactNode }) {
  const t = labTime(props.now);
  return (
    <div className="lock">
      <div className="lock__bar">
        <span className="brand__mark brand__mark--dark" aria-hidden="true">
          RD
        </span>
        <span className="lock__station">
          <Glyph name="pc" size={18} />
          {props.workstation.name}
          {props.workstation.room && `, in ${props.workstation.room}`}
        </span>
        {props.dataClass === 'fictional' && <span className="fict fict--dark">Fictional data</span>}
      </div>
      <div className="lock__body">
        <div className="lock__clock">
          <span className="lock__time">{t.time}</span>
          <span className="lock__date">
            {t.date} {t.zone}
          </span>
          <span className="lock__utc">{t.utcTime} UTC</span>
        </div>
        <main className="lock__main">{props.children}</main>
      </div>
    </div>
  );
}

/** Credentials plus the one commit button, sending each commit key at most once (rule 25). */
function CredentialForm(props: {
  actionLabel: string;
  refusal: string | null;
  passkeyAllowed: boolean;
  commitKey: CommitKey;
  /** Owned by the screen, so switching between unlock and takeover never reuses a spent key. */
  keyOnce: ReturnType<typeof useCommitKeyOnce>;
  onSubmit: Submit;
}) {
  const [draft, setDraft] = useState<CredentialDraft>(emptyDraft);
  const key = props.keyOnce;
  const goRef = useRef<HTMLDivElement>(null);
  const credentials = toCredentials(draft);

  const submit = async () => {
    if (!credentials || !key.spend()) return;
    await props.onSubmit(credentials, props.commitKey);
    setDraft(clearSecrets);
  };

  return (
    <div className="lock__form">
      <CredentialFields
        draft={draft}
        onChange={setDraft}
        passkeyAllowed={props.passkeyAllowed}
        surface="bench"
        onDone={() => goRef.current?.querySelector('button')?.focus()}
      />
      {props.refusal && (
        <p className="lock__error" role="alert">
          <Glyph name="fail" size={18} />
          {props.refusal}
        </p>
      )}
      <div ref={goRef} className="lock__go">
        <CommitButton disabled={!credentials || key.spent} onCommit={submit}>
          {props.actionLabel}
        </CommitButton>
      </div>
    </div>
  );
}

const WHY: Record<LockReason, (owner: string, at: string) => string> = {
  manual: (owner, at) => `${owner} locked this PC at ${at}.`,
  'switch-user': (owner, at) => `${owner} handed this PC over at ${at}.`,
  idle: (owner, at) => `This PC locked itself at ${at} after a spell with no input. ${owner} is still signed in.`,
};

/**
 * Lock hides everything (rule 1). The owner unlocks with a full re-authentication, or someone
 * else signs in, which ends the owner's session on the server. Nothing here fills a field or
 * simulates an authenticator (rule 2), and the user ID is always typed.
 */
export function LockScreen(props: {
  workstation: Workstation;
  now: ServerInstant;
  owner: Person;
  reason: LockReason;
  lockedAt: ServerInstant;
  dataClass: DataClass;
  refusal: string | null;
  passkeyAllowed: boolean;
  commitKey: CommitKey;
  onUnlock: Submit;
  onTakeover: Submit;
}) {
  const [path, setPath] = useState<'owner' | 'other'>(props.reason === 'switch-user' ? 'other' : 'owner');
  const keyOnce = useCommitKeyOnce(props.commitKey);
  const owner = props.owner;
  return (
    <BenchScreen workstation={props.workstation} now={props.now} dataClass={props.dataClass}>
      <h1>
        <Glyph name="lock" size={28} />
        Locked
      </h1>
      <p className="lock__why">{WHY[props.reason](owner.printedName, shortLabTime(props.lockedAt))}</p>
      <div className="tiles" role="radiogroup" aria-label="Who is at the PC">
        <button type="button" role="radio" aria-checked={path === 'owner'} className="tile" onClick={() => setPath('owner')}>
          <span className="mono-av mono-av--lg" aria-hidden="true">
            {initials(owner.printedName)}
          </span>
          <span className="tile__text">
            <span className="tile__name">{owner.printedName}</span>
            {owner.nativeName && <span className="tile__native">{owner.nativeName}</span>}
            <span className="tile__meta">Unlock and carry on, {owner.role}</span>
          </span>
        </button>
        <button type="button" role="radio" aria-checked={path === 'other'} className="tile tile--other" onClick={() => setPath('other')}>
          <span className="mono-av mono-av--lg" aria-hidden="true">
            <Glyph name="switch" size={24} />
          </span>
          <span className="tile__text">
            <span className="tile__name">Someone else</span>
            <span className="tile__meta">Signing in ends {owner.printedName}&rsquo;s session</span>
          </span>
        </button>
      </div>
      <CredentialForm
        key={path}
        actionLabel={path === 'owner' ? `Unlock as ${owner.printedName}` : `Sign in and end ${owner.printedName}'s session`}
        refusal={props.refusal}
        passkeyAllowed={props.passkeyAllowed}
        commitKey={props.commitKey}
        keyOnce={keyOnce}
        onSubmit={path === 'owner' ? props.onUnlock : props.onTakeover}
      />
    </BenchScreen>
  );
}

/** Sign-in. A deep link opens only after it, and the destination is only a destination (rule 1). */
export function SignIn(props: {
  /** Set when the server asked which Lab or Customer to sign in for (decision 22: one at a time). */
  places?: readonly { readonly id: string; readonly name: string }[];
  place?: string | null;
  onPlace?: (id: string) => void;
  workstation: Workstation;
  now: ServerInstant;
  /** Where the person goes after signing in, as a person reads it, e.g. "Test T26-04175". */
  destination: string | null;
  dataClass: DataClass;
  refusal: string | null;
  passkeyAllowed: boolean;
  commitKey: CommitKey;
  onSignIn: Submit;
}) {
  const keyOnce = useCommitKeyOnce(props.commitKey);
  return (
    <BenchScreen workstation={props.workstation} now={props.now} dataClass={props.dataClass}>
      <h1>Sign in</h1>
      <p className="lock__why">
        {props.destination ? `After you sign in, ${props.destination} opens.` : 'Type your user ID, password and a fresh code.'}
      </p>
      {props.places && props.places.length > 0 && (
        <div className="tiles tiles--places" role="radiogroup" aria-label="Sign in for">
          {props.places.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={props.place === p.id} className="tile" onClick={() => props.onPlace?.(p.id)}>
              <span className="tile__text">
                <span className="tile__name">{p.name}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <CredentialForm
        actionLabel="Sign in"
        refusal={props.refusal}
        passkeyAllowed={props.passkeyAllowed}
        commitKey={props.commitKey}
        keyOnce={keyOnce}
        onSubmit={props.onSignIn}
      />
    </BenchScreen>
  );
}
