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

// oxlint-disable-next-line no-restricted-globals, no-restricted-properties -- elapsed time on this page only; no instant is shown or sent
const wallOffset = Date.now() - performance.now();
let pageLatest = 0;
/**
 * The page's clock for the countdown. It never runs backwards, and it counts time the device slept, which
 * performance.now() skips on some platforms, so a page woken after its session ended does not show it as live.
 */
function pageNow(): number {
  // oxlint-disable-next-line no-restricted-globals, no-restricted-properties -- elapsed time on this page only; no instant is shown or sent
  pageLatest = Math.max(pageLatest, performance.now(), Date.now() - wallOffset);
  return pageLatest;
}

/**
 * The session's end by the page's clock. Each reply restarts the idle count from when its request left, which is no
 * later than the server restarts its own, so the page never shows a session the server has ended. Only a reply
 * restarts it: a refusal or a failure may not have reached the session.
 */
let session: { idleLimitMs: number; absoluteEndsAt: number; lastSentAt: number } | null = null;
let secondsLeft: number | null = null;
let ticker = 0;
const watchers = new Set<() => void>();

function setSecondsLeft(left: number | null) {
  if (left === secondsLeft) return;
  secondsLeft = left;
  for (const watch of watchers) watch();
}

/** Longer than any request takes, so that by then the server's own count has run out too. */
const END_GRACE_MS = 5000;
let askedAt: number | null = null;

/**
 * Counts down, and once the page's count has run out by more than END_GRACE_MS asks the server. Only the server's
 * refusal ends the session on screen; if the server still answers, the count restarts from its reply.
 */
function tick() {
  if (!session) return;
  const now = pageNow();
  const endsAt = Math.min(session.lastSentAt + session.idleLimitMs, session.absoluteEndsAt);
  setSecondsLeft(Math.max(0, Math.ceil((endsAt - now) / 1000)));
  if (now < endsAt + END_GRACE_MS || (askedAt !== null && now < askedAt + END_GRACE_MS)) return;
  askedAt = now;
  // A noSession refusal ends the session in call(). Any other failure is asked again a grace period later, and is
  // rethrown with its context, so it reaches the console instead of vanishing.
  resume().catch((err: unknown) => {
    if (err instanceof Refused && err.kind === 'noSession') return;
    throw new Error('could not ask the LIMS whether the session has ended', { cause: err });
  });
}

function endSession(message: string) {
  clearInterval(ticker);
  session = null;
  setSecondsLeft(null);
  signedOut(message);
}

async function startSession(request: () => Promise<SignedInView>): Promise<SignedInView> {
  const sentAt = pageNow();
  const view = await request();
  const { idleLimitMs, absoluteLeftMs } = view.session;
  session = { idleLimitMs, absoluteEndsAt: sentAt + absoluteLeftMs, lastSentAt: sentAt };
  clearInterval(ticker);
  ticker = window.setInterval(tick, 1000);
  tick();
  return view;
}

addEventListener('visibilitychange', tick);

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
  const sentAt = pageNow();
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
  if (refused) throw refused;
  if (session) session.lastSentAt = Math.max(session.lastSentAt, sentAt);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- a wire body has no static type; the API serializes every 2xx through this route's reply schema, and the web does not repeat the check
  return json as RouteReply<R>;
}

export async function signOut(): Promise<void> {
  await api(routes.logout).catch(() => {});
  location.hash = '';
  if (session) endSession('');
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
