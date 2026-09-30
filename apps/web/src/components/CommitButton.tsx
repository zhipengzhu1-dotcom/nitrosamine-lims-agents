import { useRef, useState, type ReactNode } from 'react';
import type { CommitKey } from '../model';
import './buttons.css';

export type ButtonTone = 'primary' | 'danger' | 'secondary' | 'quiet';

/**
 * The button for anything that commits (rule 25). It disables on the first press and stays
 * disabled until `onCommit` settles. The guard is a ref, so a second press in the same frame
 * cannot slip through before React re-renders.
 */
export function CommitButton(props: {
  children: ReactNode;
  onCommit: () => Promise<unknown>;
  tone?: ButtonTone;
  /** Disabled for a reason the caller owns (incomplete fields, a closing sheet, a spent key). */
  disabled?: boolean;
  className?: string;
}) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const unavailable = pending || props.disabled === true;

  const press = async () => {
    if (inFlight.current || props.disabled === true) return;
    inFlight.current = true;
    setPending(true);
    try {
      await props.onCommit();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      className={`rbtn rbtn--${props.tone ?? 'primary'}${props.className ? ` ${props.className}` : ''}`}
      aria-disabled={unavailable}
      aria-busy={pending}
      data-pending={pending || undefined}
      onClick={press}
    >
      {props.children}
    </button>
  );
}

/**
 * Remembers every commit key this sheet has sent, so a key is used at most once (rule 25). After a
 * refusal the owner hands the sheet a fresh key for the next attempt.
 */
export function useCommitKeyOnce(key: CommitKey) {
  const spent = useRef(new Set<CommitKey>());
  return {
    spent: spent.current.has(key),
    spend: (): boolean => {
      if (spent.current.has(key)) return false;
      spent.current.add(key);
      return true;
    },
  };
}
