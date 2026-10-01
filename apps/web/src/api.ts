import {
  isRefusalKind,
  pathOf,
  type RefusalKind,
  type Route,
  type RouteInput,
  type RouteReply,
  routes,
  type SignedInView,
} from '@lims/domain';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export class Refused extends Error {
  kind: RefusalKind;
  constructor(kind: RefusalKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

function refusedBy(json: unknown, fallback: string): Refused {
  const body: object = typeof json === 'object' && json !== null ? json : {};
  return new Refused(
    'kind' in body && isRefusalKind(body.kind) ? body.kind : 'failure',
    'message' in body && typeof body.message === 'string' ? body.message : fallback,
  );
}

let signedOut = (_message: string) => {};
export const onSignedOut = (fn: (message: string) => void) => {
  signedOut = fn;
};

/**
 * The session's end by this page's monotonic clock. Each answer restarts the idle count from when its request left,
 * which is no later than the server restarts its own, so the page never shows a session the server has ended.
 */
let session: { idleLimitMs: number; absoluteEndsAt: number; lastSentAt: number } | null = null;
let secondsLeft: number | null = null;
let ticker = 0;
const watchers = new Set<() => void>();
const SESSION_ENDED = 'the session has ended; sign in again';

function setSecondsLeft(left: number | null) {
  if (left === secondsLeft) return;
  secondsLeft = left;
  for (const watch of watchers) watch();
}

function tick() {
  if (!session) return;
  const endsAt = Math.min(session.lastSentAt + session.idleLimitMs, session.absoluteEndsAt);
  const left = Math.max(0, Math.ceil((endsAt - performance.now()) / 1000));
  if (left === 0) return endSession(SESSION_ENDED);
  setSecondsLeft(left);
}

function endSession(message: string) {
  clearInterval(ticker);
  session = null;
  setSecondsLeft(null);
  signedOut(message);
}

async function startSession(request: () => Promise<SignedInView>): Promise<SignedInView> {
  const sentAt = performance.now();
  const view = await request();
  const { idleLimitMs, absoluteLeftMs } = view.session;
  session = { idleLimitMs, absoluteEndsAt: sentAt + absoluteLeftMs, lastSentAt: sentAt };
  clearInterval(ticker);
  ticker = window.setInterval(tick, 1000);
  tick();
  return view;
}

/** Signs in and starts the session's countdown. */
export const signIn = (username: string, password: string) =>
  startSession(() => api(routes.login, { username, password }));

/** Reads who is signed in, if anyone, and starts the session's countdown. */
export const resume = () => startSession(() => api(routes.me));

/** Whole seconds until the session ends, or null when no one is signed in. */
export const useSecondsLeft = () =>
  useSyncExternalStore(
    (watch) => {
      watchers.add(watch);
      return () => watchers.delete(watch);
    },
    () => secondsLeft,
  );

/** Calls a route and gives its reply. A `noSession` refusal returns to sign-in before it is thrown. */
export function api<R extends Route>(route: R, ...request: RouteInput<R>): Promise<RouteReply<R>> {
  const [input] = request;
  return call(route, pathOf(route, input), input);
}

async function call<R extends Route>(route: R, path: string, body?: unknown): Promise<RouteReply<R>> {
  const sentAt = performance.now();
  const res = await fetch(
    path,
    route.method === 'GET'
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) },
  );
  const json: unknown = await res.json().catch(() => ({}));
  const refused = res.ok ? null : refusedBy(json, `the LIMS did not answer (${res.status})`);
  if (refused?.kind === 'noSession') {
    endSession(refused.message);
    throw refused;
  }
  if (session) session.lastSentAt = Math.max(session.lastSentAt, sentAt);
  if (refused) throw refused;
  // oxlint-disable-next-line typescript/consistent-type-assertions -- a wire body has no static type; the API serializes every 2xx through this route's reply schema, and the web does not repeat the check
  return json as RouteReply<R>;
}

export async function signOut(): Promise<void> {
  await api(routes.logout).catch(() => {});
  location.hash = '';
  endSession('');
}

/** Reads a route for a component. `reload` settles once the page holds the server's new answer, so a commit can wait until what it changed is on screen. */
export function useApi<R extends Route>(
  route: R,
  ...request: RouteInput<R>
): { data?: RouteReply<R>; error?: string; reload: () => Promise<void> } {
  const [state, setState] = useState<{ data?: RouteReply<R>; error?: string }>({});
  const [version, setVersion] = useState(0);
  const waiting = useRef<(() => void)[]>([]);
  const path = pathOf(route, request[0]);
  useEffect(() => {
    let live = true;
    call(route, path).then(
      (data) => live && setState({ data }),
      (e: Error) => live && setState({ error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [route, path, version]);
  useEffect(() => {
    for (const settle of waiting.current.splice(0)) settle();
  }, [state]);
  const reload = () =>
    new Promise<void>((settle) => {
      waiting.current.push(settle);
      setVersion((v) => v + 1);
    });
  return { ...state, reload };
}

/** The keys the latest server answer holds that the one before it on this page did not. A first answer holds nothing new. */
export function useFresh<T>(answer: T | undefined, keys: (answer: T) => string[]): ReadonlySet<string> {
  const [last, setLast] = useState(answer);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  if (answer !== last) {
    setLast(answer);
    if (last !== undefined && answer !== undefined) {
      const before = new Set(keys(last));
      setFresh(new Set(keys(answer).filter((k) => !before.has(k))));
    }
  }
  return fresh;
}
