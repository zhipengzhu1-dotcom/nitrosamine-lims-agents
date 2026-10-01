import { type FormEvent, useState } from 'react';
import { api, type Me } from './api.ts';
import { TopBar } from './rail.tsx';

export function SignIn({ notice, onIn }: { notice: string; onIn: (me: Me) => void }) {
  const [error, setError] = useState(notice);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    api<Me>('/api/login', { username: form.get('username'), password: form.get('password') }).then(onIn, (err: Error) =>
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
