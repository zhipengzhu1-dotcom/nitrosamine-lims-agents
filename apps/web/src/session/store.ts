// The browser's copy of the server session (decision 23 rule 1, sessions.md). The server owns the
// state; this store only holds its last answer, asks again whenever anything suggests the answer
// changed, and tells the other tabs to ask too. It never decides who is signed in.

import type { SessionAnswer } from '@lims/contract/session';
import { STAFF_ROLE_LABEL } from '@lims/contract/session';
import type { Api } from '../api/client';
import type { LockReason, Person, ServerInstant } from '../model';

export type ActiveSession = {
  readonly person: Person;
  readonly roles: readonly string[];
  readonly lab: { readonly id: string; readonly code: string; readonly zone: string } | null;
  readonly workstation: string;
  /** The Lab's zone, or the browser's for a company session, which has no Lab. */
  readonly zone: string;
  readonly signedInAt: ServerInstant;
  readonly idleLockAt: ServerInstant;
  /** Changes on every sign-in and unlock; the routed screens are keyed on it. */
  readonly epoch: string;
};

export type LockedSession = {
  readonly owner: Person;
  readonly reason: LockReason;
  readonly lockedAt: ServerInstant;
  readonly workstation: string;
  readonly zone: string;
};

export type SessionPhase =
  | { readonly phase: 'asking' }
  | { readonly phase: 'unreachable'; readonly message: string }
  | { readonly phase: 'none' }
  | { readonly phase: 'locked'; readonly locked: LockedSession }
  | { readonly phase: 'active'; readonly active: ActiveSession };

/** The tab-to-tab signal: "the session changed, ask the server". It carries nothing else. */
export type SessionBus = { post(): void; listen(onChange: () => void): () => void };

export function broadcastBus(name = 'lims-session'): SessionBus {
  if (typeof BroadcastChannel === 'undefined') return { post: () => {}, listen: () => () => {} };
  const channel = new BroadcastChannel(name);
  return {
    post: () => channel.postMessage('changed'),
    listen: (onChange) => {
      const handler = () => onChange();
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },
  };
}

export const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const roleLabel = (role: string): string => STAFF_ROLE_LABEL[role] ?? role;

export function phaseOf(answer: SessionAnswer): SessionPhase {
  switch (answer.state) {
    case 'none':
      return { phase: 'none' };
    case 'locked': {
      const zone = answer.zone ?? browserZone();
      return {
        phase: 'locked',
        locked: {
          owner: {
            printedName: answer.owner.printedName,
            nativeName: answer.owner.nativeName,
            username: answer.owner.username,
            role: answer.owner.roles.map(roleLabel).join(', '),
          },
          reason: answer.lockReason,
          lockedAt: { utc: answer.lockedAt, zone },
          workstation: answer.workstation,
          zone,
        },
      };
    }
    case 'active': {
      const zone = answer.lab?.zone ?? browserZone();
      return {
        phase: 'active',
        active: {
          person: { ...answer.person, role: answer.roles.map(roleLabel).join(', ') },
          roles: answer.roles,
          lab: answer.lab,
          workstation: answer.workstation,
          zone,
          signedInAt: { utc: answer.startedAt, zone },
          idleLockAt: { utc: answer.idleLockAt, zone },
          epoch: answer.epoch,
        },
      };
    }
  }
}

export type SessionStore = {
  get(): SessionPhase;
  subscribe(listener: () => void): () => void;
  /** Asks GET /api/session and shows its answer. */
  refresh(): Promise<void>;
  /** After this tab changed the session: ask, and have every other tab ask. */
  changed(): Promise<void>;
  /**
   * The idle deadline passed on this tab's clock. Lock hides everything at once, before the
   * server is asked, because the server already refuses every request after the deadline.
   */
  idleDeadlinePassed(): void;
  /** The idle deadline this tab last locked for, so a disagreeing server is not asked in a loop. */
  idleFiredFor(): string | null;
  /** Milliseconds to add to the browser's clock to read the server's. */
  skewMs(): number;
};

export function createSessionStore(api: Pick<Api, 'session'>, bus: SessionBus): SessionStore {
  let phase: SessionPhase = { phase: 'asking' };
  let skew = 0;
  let asked = 0;
  let idleFired: string | null = null;
  const listeners = new Set<() => void>();
  const set = (next: SessionPhase) => {
    phase = next;
    for (const l of listeners) l();
  };

  const refresh = async () => {
    const ticket = ++asked;
    const read = await api.session();
    if (ticket !== asked) return;
    if ('kind' in read) {
      set({ phase: 'unreachable', message: read.message });
      return;
    }
    skew = read.skewMs;
    set(phaseOf(read.answer));
  };

  bus.listen(() => void refresh());

  return {
    get: () => phase,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    changed: async () => {
      await refresh();
      bus.post();
    },
    idleDeadlinePassed: () => {
      if (phase.phase !== 'active') return;
      const a = phase.active;
      idleFired = a.idleLockAt.utc;
      set({ phase: 'locked', locked: { owner: a.person, reason: 'idle', lockedAt: a.idleLockAt, workstation: a.workstation, zone: a.zone } });
      void refresh().then(() => bus.post());
    },
    idleFiredFor: () => idleFired,
    skewMs: () => skew,
  };
}
