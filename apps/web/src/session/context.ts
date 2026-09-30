import { createContext, useContext, useEffect, useState } from 'react';
import type { Credentials as WireCredentials } from '@lims/contract';
import { newCommitKey } from '../api/hooks';
import type { CommitKey, Credentials, ServerInstant } from '../model';
import type { ActiveSession, SessionStore } from './store';

export type SessionContextValue = { readonly active: ActiveSession; readonly store: SessionStore };

export const SessionContext = createContext<SessionContextValue | null>(null);

/** The signed-in session, as the server last described it. Only screens inside SessionGate have one. */
export function useSession(): SessionContextValue {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionGate');
  return s;
}

/** The prompt's credentials as the commands take them. A passkey is not built (not-built: passkey). */
export function wireCredentials(c: Credentials): WireCredentials {
  return { typedUserId: c.userId, password: c.password, totp: c.secondFactor.kind === 'code' ? c.secondFactor.code : '' };
}

/**
 * The commit key a sheet or form carries for its next attempt. The owner calls next() once the
 * server has answered, so each attempt has its own key and a key is never sent for two attempts.
 */
export function useAttemptKey(): { readonly key: CommitKey; readonly next: () => void } {
  const [key, setKey] = useState(newCommitKey);
  return { key, next: () => setKey(newCommitKey()) };
}

/** The server's clock, read through the browser's, ticking once a second. */
export function useServerNow(skewMs: number, zone: string): ServerInstant {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return { utc: new Date(now + skewMs).toISOString(), zone };
}

const WORKSTATION_KEY = 'lims.workstation';

/**
 * This PC's name, set once by the bench PC's configuration (decision 23 rule 3 records it with the
 * workstation). It names the PC, never a person, so it is the one thing the browser keeps.
 */
export function workstationName(): string {
  try {
    const name = localStorage.getItem(WORKSTATION_KEY);
    if (name && name.trim() !== '') return name.trim().slice(0, 64);
  } catch {
    // Storage blocked: the PC is simply unnamed.
  }
  return 'Unnamed workstation';
}
