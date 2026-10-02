import { type FormEvent, useRef, useState } from 'react';
import { Refused } from './api.ts';

interface Outcome {
  text: string;
  tone: 'ok' | 'bad';
}

function unanswered(err: unknown): string {
  if (err instanceof Refused) return `${err.kind === 'failure' ? 'Not finished' : 'Refused'}: ${err.message}`;
  if (err instanceof Error && !(err instanceof TypeError)) return `Refused: ${err.message}`;
  return 'The LIMS did not answer. Reload to see what was saved before you press again.';
}

/** A form whose submit button stays inert from the first press until the server answers, and which shows that answer. */
export function useCommit() {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inFlight = useRef(false);
  const commit = (e: FormEvent<HTMLFormElement>, send: (form: FormData) => Promise<string>): void => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const form = e.currentTarget;
    void send(new FormData(form))
      .then(
        (text) => {
          form.reset();
          return { text, tone: 'ok' } as const;
        },
        (err: unknown) => ({ text: unanswered(err), tone: 'bad' }) as const,
      )
      .then(setOutcome)
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };
  const shown = outcome && (
    <p className={`note note--${outcome.tone}`} role={outcome.tone === 'bad' ? 'alert' : 'status'}>
      {outcome.text}
    </p>
  );
  return { busy, commit, shown };
}

export const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};
