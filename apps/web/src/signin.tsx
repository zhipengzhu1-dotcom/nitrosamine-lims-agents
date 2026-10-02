import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { type ActorContext, type Lab, type RouteInput, type RouteReply, routes } from '@lims/domain';
import { encode } from 'uqr';
import {
  api,
  failureText,
  type LockMode,
  Refused,
  setPreferences,
  signIn,
  signOut,
  switchLab,
  unlock,
  useApi,
} from './api.ts';
import { Shell, TopBar } from './rail.tsx';
import { CodeField, field, useCommit, useSecondFactor } from './form.tsx';

type Credentials = RouteInput<typeof routes.switchLab>[0];

function CredentialsForm({
  title,
  intro,
  labs,
  except,
  commit,
  notice = '',
  children,
  onSubmit,
}: {
  title: string;
  intro?: string;
  labs: { data?: Lab[] | undefined; error?: string | undefined };
  except?: string;
  commit: string;
  notice?: string;
  children?: ReactNode;
  onSubmit: (credentials: Credentials) => Promise<unknown>;
}) {
  const [error, setError] = useState(notice);
  const offered = labs.data?.filter((lab) => lab.id !== except);
  const noOtherLab = offered?.length === 0;
  const reasonId = useId();
  const [busy, setBusy] = useState(false);
  const secondFactor = useSecondFactor();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    setBusy(true);
    onSubmit({
      username: field('username'),
      password: field('password'),
      labId: field('labId'),
      ...(secondFactor && { code: field('code') }),
    })
      .catch((err: unknown) => setError(failureText(err)))
      .finally(() => setBusy(false));
  }
  return (
    <form className="signin card" onSubmit={submit}>
      <fieldset disabled={busy}>
        <h1>{title}</h1>
        {intro && <p className="muted">{intro}</p>}
        {!noOtherLab && (
          <fieldset className="labs">
            <legend>Lab</legend>
            {labs.error && <p className="note--bad">{labs.error}</p>}
            {offered?.map((lab) => (
              <label key={lab.id} className="labs__option">
                <input type="radio" name="labId" value={lab.id} required />
                <span>
                  <b>{lab.code}</b> {lab.name}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <label>
          Username
          <input name="username" required autoComplete="username" />
        </label>
        <label>
          Password
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        {secondFactor && <CodeField />}
        {error && (
          <p className="note--bad" role="alert">
            {error}
          </p>
        )}
        {noOtherLab && (
          <p id={reasonId} className="muted">
            There is no other Lab to work in.
          </p>
        )}
        <button
          type="submit"
          className="rbtn"
          aria-busy={busy}
          disabled={!offered?.length}
          aria-describedby={noOtherLab ? reasonId : undefined}
        >
          {commit}
        </button>
        {children}
      </fieldset>
    </form>
  );
}

export function SignIn({ notice, onIn }: { notice: string; onIn: (me: ActorContext) => void }) {
  const labs = useApi(routes.labs);
  const secondFactor = useSecondFactor();
  return (
    <div className="frame frame--bare">
      <TopBar />
      <main className="plane">
        <CredentialsForm
          title="Sign in"
          labs={labs}
          commit="Sign in"
          notice={notice}
          onSubmit={(c) => signIn(c).then(onIn)}
        >
          {secondFactor && (
            <a className="signin__link" href="#/authenticator">
              Set up your authenticator
            </a>
          )}
        </CredentialsForm>
      </main>
    </div>
  );
}

export function LabSwitchPage({ me }: { me: ActorContext }) {
  const labs = useApi(routes.labs);
  return (
    <Shell me={me} active={null} action={null}>
      <CredentialsForm
        title="Switch Lab"
        intro={`You work in ${me.lab.name}. Sign in again with your username and password to work in another Lab.`}
        labs={labs}
        except={me.lab.id}
        commit="Switch Lab"
        onSubmit={switchLab}
      />
    </Shell>
  );
}

/** The person's own preferences, as the server holds them. A change applies once the server has saved it. */
export function PreferencesPage({ me }: { me: ActorContext }) {
  const { data, error, reload } = useApi(routes.me);
  const { busy, commit, shown } = useCommit();
  return (
    <Shell me={me} active={null} action={null}>
      <h1>Your preferences</h1>
      {error && <p className="note--bad">{error}</p>}
      {data && (
        <form
          className="card prefs"
          onSubmit={(e) =>
            commit(e, async (form) => {
              const { reducedMotion } = await setPreferences({ reducedMotion: form.has('reducedMotion') });
              // The form resets after a commit, so it must first hold the saved value as its default.
              await reload();
              return reducedMotion
                ? 'Saved. Motion is reduced wherever you sign in.'
                : 'Saved. Motion follows each device’s own setting.';
            })
          }
        >
          <fieldset className="lock__set" disabled={busy}>
            <legend>Motion</legend>
            <label className="check">
              <input type="checkbox" name="reducedMotion" defaultChecked={data.preferences.reducedMotion} />
              Reduce motion wherever I sign in
            </label>
            <p className="muted">
              Sheets, notes and status changes then appear without movement. With this off, a device set to reduce
              motion still reduces it.
            </p>
            {shown}
            <button type="submit" className="rbtn" aria-busy={busy}>
              Save preferences
            </button>
          </fieldset>
        </form>
      )}
    </Shell>
  );
}

/** Hides every record while the session is locked: the same person unlocks it with their password, or another person signs in over it. */
export function LockScreen({
  message,
  mode: opened,
  onIn,
}: {
  message: string;
  mode: LockMode;
  onIn: (me: ActorContext) => void;
}) {
  const [mode, setMode] = useState(opened);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const labs = useApi(routes.labs);
  const secondFactor = useSecondFactor();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    unlock({ password: field(form, 'password'), ...(secondFactor && { code: field(form, 'code') }) })
      .then(onIn)
      .catch((err: unknown) => {
        setError(failureText(err));
        setBusy(false);
      });
  }
  const otherWay = (
    <div className="lock__set">
      <button
        type="button"
        className="rbtn rbtn--plain"
        onClick={() => setMode(mode === 'unlock' ? 'switch' : 'unlock')}
      >
        {mode === 'unlock' ? 'Switch user' : 'Back to unlock'}
      </button>
      <button type="button" className="rbtn rbtn--plain" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );

  return (
    <div className="frame frame--bare">
      <TopBar />
      <main className="plane">
        {mode === 'switch' ? (
          <>
            <CredentialsForm
              title="Switch user"
              intro={message}
              labs={labs}
              commit="Sign in on this screen"
              onSubmit={(c) => signIn(c).then(onIn)}
            />
            <div className="signin">{otherWay}</div>
          </>
        ) : (
          <form className="signin card" onSubmit={submit} aria-labelledby="lock-title">
            <fieldset className="lock__set" disabled={busy}>
              <h1 id="lock-title">Locked</h1>
              <p className="muted">{message}</p>
              <label>
                Password
                <input name="password" type="password" required autoComplete="current-password" />
              </label>
              {secondFactor && <CodeField />}
              {error && (
                <p className="note--bad" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="rbtn" aria-busy={busy}>
                Unlock
              </button>
              {otherWay}
            </fieldset>
          </form>
        )}
      </main>
    </div>
  );
}

/** Where a person opens their one-time link and chooses their own password. Needs no session. */
export function WelcomePage({ token }: { token: string }) {
  const { busy, commit, shown } = useCommit();
  const secondFactor = useSecondFactor();
  const [username, setUsername] = useState<string | null>(null);
  return (
    <div className="frame frame--bare">
      <TopBar />
      <main className="plane">
        {username ? (
          <section className="signin card">
            <h1>Password set</h1>
            <p role="status">
              Your password is set for <code>{username}</code>. This link no longer works.
            </p>
            {secondFactor ? (
              <a className="btn" href="#/authenticator">
                Set up your authenticator
              </a>
            ) : (
              <a className="btn" href="/">
                Sign in
              </a>
            )}
          </section>
        ) : (
          <form
            className="signin card"
            onSubmit={(e) =>
              commit(e, async (form) => {
                const password = field(form, 'password');
                if (password !== field(form, 'confirm')) throw new Refused('malformed', 'The two passwords differ.');
                const set = await api(routes.setPasswordThroughLink, { token, password });
                setUsername(set.username);
                history.replaceState(null, '', location.pathname);
                return '';
              })
            }
          >
            <h1>Choose your password</h1>
            <p className="muted">Only you see the password you choose. The Admin never does.</p>
            <label>
              New password
              <input name="password" type="password" required autoComplete="new-password" />
            </label>
            <label>
              New password again
              <input name="confirm" type="password" required autoComplete="new-password" />
            </label>
            {shown}
            <button type="submit" className="rbtn" disabled={busy}>
              Set my password
            </button>
          </form>
        )}
      </main>
    </div>
  );
}

/** The key as a QR code, dark modules on white whatever the theme, because a scanner reads only that contrast. */
function QrCode({ text }: { text: string }) {
  const { data, size } = encode(text, { ecc: 'M', border: 4 });
  const modules = data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : [])));
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label="QR code">
      <rect width={size} height={size} fill="#fff" />
      <path d={modules.join('')} fill="#000" />
    </svg>
  );
}

/** Enrols the person's authenticator: their username and password show its key once, as a QR code and as text to type. */
export function AuthenticatorPage() {
  const { busy, commit, shown } = useCommit();
  const [enrolled, setEnrolled] = useState<RouteReply<typeof routes.enrolAuthenticator> | null>(null);
  return (
    <div className="frame frame--bare">
      <TopBar />
      <main className="plane">
        {enrolled ? (
          <section className="signin card">
            <h1>Add this key to your authenticator</h1>
            <p className="muted">Scan the QR code with your authenticator app, or type the key into it.</p>
            <QrCode text={enrolled.otpauth} />
            <p>
              Key <code className="secret">{enrolled.secret.replace(/(.{4})(?=.)/g, '$1 ')}</code>
            </p>
            <p role="status">The LIMS shows this key once. Sign in with your password and a code from the app.</p>
            <a className="btn" href="/">
              Sign in
            </a>
          </section>
        ) : (
          <form
            className="signin card"
            onSubmit={(e) =>
              commit(e, async (form) => {
                const credentials = { username: field(form, 'username'), password: field(form, 'password') };
                setEnrolled(await api(routes.enrolAuthenticator, credentials));
                history.replaceState(null, '', location.pathname);
                return '';
              })
            }
          >
            <h1>Set up your authenticator</h1>
            <p className="muted">Your username and password show your authenticator key once.</p>
            <p className="muted">
              Already enrolled? <a href="/">Sign in</a> with your password and a code from your authenticator.
            </p>
            <label>
              Username
              <input name="username" required autoComplete="username" />
            </label>
            <label>
              Password
              <input name="password" type="password" required autoComplete="current-password" />
            </label>
            {shown}
            <button type="submit" className="rbtn" disabled={busy}>
              Show my key
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
