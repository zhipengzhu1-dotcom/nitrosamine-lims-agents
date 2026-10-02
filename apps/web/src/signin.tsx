import { type FormEvent, useState } from 'react';
import { type ActorContext, type Lab, type RouteInput, routes } from '@lims/domain';
import { api, type LockMode, signIn, signOut, switchLab, unlock, useApi } from './api.ts';
import { Shell, TopBar } from './rail.tsx';
import { field, useCommit } from './staff.tsx';

type Credentials = RouteInput<typeof routes.switchLab>[0];

function CredentialsForm({
  title,
  intro,
  labs,
  except,
  commit,
  notice = '',
  onSubmit,
}: {
  title: string;
  intro?: string;
  labs: { data?: Lab[] | undefined; error?: string | undefined };
  except?: string;
  commit: string;
  notice?: string;
  onSubmit: (credentials: Credentials) => Promise<unknown>;
}) {
  const [error, setError] = useState(notice);
  const offered = labs.data?.filter((lab) => lab.id !== except);
  const [busy, setBusy] = useState(false);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    setBusy(true);
    onSubmit({ username: field('username'), password: field('password'), labId: field('labId') })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  }
  return (
    <form className="signin card" onSubmit={submit}>
      <fieldset disabled={busy}>
        <h1>{title}</h1>
        {intro && <p className="muted">{intro}</p>}
        <fieldset className="labs">
          <legend>Lab</legend>
          {labs.error && <p className="note--bad">{labs.error}</p>}
          {offered?.length === 0 && <p className="muted">There is no other Lab to work in.</p>}
          {offered?.map((lab) => (
            <label key={lab.id} className="labs__option">
              <input type="radio" name="labId" value={lab.id} required />
              <span>
                <b>{lab.code}</b> {lab.name}
              </span>
            </label>
          ))}
        </fieldset>
        <label>
          Username
          <input name="username" required autoComplete="username" />
        </label>
        <label>
          Password
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        {error && (
          <p className="note--bad" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="rbtn" aria-busy={busy} disabled={!offered?.length}>
          {commit}
        </button>
      </fieldset>
    </form>
  );
}

export function SignIn({ notice, onIn }: { notice: string; onIn: (me: ActorContext) => void }) {
  const labs = useApi(routes.labs);
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
        />
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

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const password = new FormData(e.currentTarget).get('password');
    setBusy(true);
    setError('');
    unlock(typeof password === 'string' ? password : '')
      .then(onIn)
      .catch((err: Error) => {
        setError(err.message);
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
              intro={`${message}.`}
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
              <p className="muted">{message}.</p>
              <label>
                Password
                <input name="password" type="password" required autoComplete="current-password" />
              </label>
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
            <a className="btn" href="/">
              Sign in
            </a>
          </section>
        ) : (
          <form
            className="signin card"
            onSubmit={(e) =>
              commit(e, async (form) => {
                const password = field(form, 'password');
                if (password !== field(form, 'confirm')) throw new Error('the two passwords differ');
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
