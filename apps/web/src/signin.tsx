import { type FormEvent, useState } from 'react';
import { type ActorContext, routes } from '@lims/domain';
import { api, type LockMode } from './api.ts';
import { TopBar } from './rail.tsx';

export function SignIn({ notice, onIn }: { notice: string; onIn: (me: ActorContext) => void }) {
  const [error, setError] = useState(notice);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    api(routes.login, { username: field('username'), password: field('password') }).then(onIn, (err: Error) =>
      setError(err.message),
    );
  }
  return (
    <div className="frame frame--bare">
      <TopBar />
      <main className="plane">
        <form className="signin card" onSubmit={submit}>
          <h1>Sign in</h1>
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
          <button type="submit" className="rbtn">
            Sign in
          </button>
        </form>
      </main>
    </div>
  );
}

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

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

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    const answer =
      mode === 'unlock'
        ? api(routes.unlock, { password: field(form, 'password') })
        : api(routes.login, { username: field(form, 'username'), password: field(form, 'password') });
    answer.then(onIn, (err: Error) => {
      setError(err.message);
      setBusy(false);
    });
  }
  function choose(next: LockMode) {
    setMode(next);
    setError('');
  }

  return (
    <div className="frame frame--bare">
      <TopBar />
      <main className="plane">
        <form key={mode} className="signin card" onSubmit={submit} aria-labelledby="lock-title">
          <fieldset className="lock__set" disabled={busy}>
            <h1 id="lock-title">{mode === 'unlock' ? 'Locked' : 'Switch user'}</h1>
            <p className="muted">{`${message.charAt(0).toUpperCase()}${message.slice(1)}.`}</p>
            {mode === 'switch' && (
              <label>
                Username
                <input name="username" required autoComplete="username" />
              </label>
            )}
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                autoComplete={mode === 'unlock' ? 'current-password' : 'off'}
              />
            </label>
            {error && (
              <p className="note--bad" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="rbtn" aria-busy={busy}>
              {mode === 'unlock' ? 'Unlock' : 'Sign in on this screen'}
            </button>
            <button
              type="button"
              className="rbtn rbtn--plain"
              onClick={() => choose(mode === 'unlock' ? 'switch' : 'unlock')}
            >
              {mode === 'unlock' ? 'Switch user' : 'Back to unlock'}
            </button>
          </fieldset>
        </form>
      </main>
    </div>
  );
}
