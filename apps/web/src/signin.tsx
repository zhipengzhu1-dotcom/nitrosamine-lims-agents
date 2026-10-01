import { type FormEvent, useState } from 'react';
import { type ActorContext, routes } from '@lims/domain';
import { api } from './api.ts';
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
