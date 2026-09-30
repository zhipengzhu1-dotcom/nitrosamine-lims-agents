// The browser's side of the two doors. Every read is GET /api/views/:name, every change is
// POST /api/commands/:name with a commit key, and the session is GET /api/session. This module is
// the boundary: it parses what came back into the three outcomes the screens handle, and it
// tells the session layer when an answer says the session is locked or gone (sessions.md,
// "Refusals from any request").

import { COMMAND_HEADER } from '@lims/contract';
import type { SessionAnswer } from '@lims/contract/session';
import type { CommitKey } from '../model';

/** The server's refusal as sent. The message is the sentence to print; the rest is for branching. */
export type Refusal = {
  readonly kind: string;
  readonly message: string;
  readonly attemptsLeft?: number;
  readonly state?: 'none' | 'locked' | 'ended';
  /** For `choose-place`: the Labs and Customers the person's grants span. */
  readonly places?: readonly Place[];
};

export type Place = { readonly kind: 'lab' | 'customer'; readonly id: string; readonly name: string };

export type Receipt<D> = {
  readonly kind: 'receipt';
  readonly summary: string;
  /** Server time of the commit, ISO-8601 UTC. */
  readonly at: string;
  readonly act: 'audited' | 'signed';
  readonly data: D;
  /** Delivered with the first answer only: an enrolment link, an otpauth URI. */
  readonly once: unknown;
  readonly replayed: boolean;
};

/** No answer reached the browser, so nothing is known about the commit. */
export type Unreachable = { readonly kind: 'unreachable'; readonly message: string };

export type CommandOutcome<D> = Receipt<D> | { readonly kind: 'refusal'; readonly refusal: Refusal } | Unreachable;

export type ViewOutcome<T> = { readonly kind: 'ok'; readonly data: T } | { readonly kind: 'refusal'; readonly refusal: Refusal } | Unreachable;

export type SessionRead = { readonly answer: SessionAnswer; readonly skewMs: number } | Unreachable;

export type Api = {
  session(): Promise<SessionRead>;
  /** "The person touched the screen." Moves only the idle timer; never audited. */
  activity(): Promise<void>;
  command<D>(name: string, input: unknown, key: CommitKey): Promise<CommandOutcome<D>>;
  view<T>(name: string, query: Readonly<Record<string, string>>): Promise<ViewOutcome<T>>;
};

const UNREACHABLE: Unreachable = {
  kind: 'unreachable',
  message: 'The server did not answer. Nothing is confirmed; check the record before trying again.',
};

type Body = { readonly kind?: unknown; readonly refusal?: Refusal } & Record<string, unknown>;

function isRefusal(body: Body): body is Body & { refusal: Refusal } {
  return body.kind === 'refusal' && typeof body.refusal?.message === 'string';
}

/**
 * @param onSessionLost called when any answer says the session is locked, ended or absent. The
 * session layer then asks GET /api/session and shows the lock or sign-in screen. A refusal of a
 * credential (401 `credentials`, 423 `locked-out`) is not a session answer and does not call it.
 */
export function createApi(opts: { readonly fetch?: typeof fetch; readonly onSessionLost: () => void }): Api {
  const http = opts.fetch ?? ((input, init) => fetch(input, init));

  type Answered = { readonly kind: 'answered'; readonly status: number; readonly body: Body; readonly date: string | null };

  const call = async (path: string, init: RequestInit): Promise<Answered | Unreachable> => {
    try {
      const res = await http(path, { credentials: 'same-origin', cache: 'no-store', ...init });
      const text = await res.text();
      const body = (text === '' ? {} : JSON.parse(text)) as Body;
      if (isRefusal(body) && body.refusal.kind === 'session') opts.onSessionLost();
      return { kind: 'answered', status: res.status, body, date: res.headers.get('date') };
    } catch {
      return UNREACHABLE;
    }
  };

  return {
    async session() {
      const r = await call('/api/session', { method: 'GET' });
      if (r.kind === 'unreachable') return r;
      const serverNow = r.date ? Date.parse(r.date) : Number.NaN;
      return { answer: r.body as unknown as SessionAnswer, skewMs: Number.isNaN(serverNow) ? 0 : serverNow - Date.now() };
    },

    async activity() {
      const r = await call('/api/session/activity', { method: 'POST', headers: { [COMMAND_HEADER]: '1' } });
      if (r.kind === 'answered' && (r.status === 401 || r.status === 423)) opts.onSessionLost();
    },

    async command<D>(name: string, input: unknown, key: CommitKey): Promise<CommandOutcome<D>> {
      const r = await call(`/api/commands/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [COMMAND_HEADER]: '1' },
        body: JSON.stringify({ commitKey: key, input }),
      });
      if (r.kind === 'unreachable') return r;
      if (isRefusal(r.body)) return { kind: 'refusal', refusal: r.body.refusal };
      if (r.body.kind !== 'receipt') return UNREACHABLE;
      const b = r.body as unknown as Omit<Receipt<D>, 'once' | 'replayed'> & { once?: unknown; replayed?: true };
      return { kind: 'receipt', summary: b.summary, at: b.at, act: b.act, data: b.data, once: b.once ?? null, replayed: b.replayed === true };
    },

    async view<T>(name: string, query: Readonly<Record<string, string>>): Promise<ViewOutcome<T>> {
      const qs = new URLSearchParams(query).toString();
      const r = await call(`/api/views/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`, { method: 'GET' });
      if (r.kind === 'unreachable') return r;
      if (isRefusal(r.body)) return { kind: 'refusal', refusal: r.body.refusal };
      if (r.status !== 200) return UNREACHABLE;
      return { kind: 'ok', data: r.body as T };
    },
  };
}
