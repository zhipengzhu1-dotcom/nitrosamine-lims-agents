import {
  isRefusalKind,
  pathOf,
  type RefusalKind,
  type Route,
  type RouteInput,
  type RouteReply,
  routes,
} from '@lims/domain';
import { useEffect, useRef, useState } from 'react';

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
export type LockMode = 'unlock' | 'switch';
let locked = (_message: string, _mode: LockMode) => {};
let nextLockMode: LockMode = 'unlock';
export const onLocked = (fn: (message: string, mode: LockMode) => void) => {
  locked = fn;
};

/** Calls a route and gives its reply. A `noSession` refusal returns to sign-in, and a `sessionLocked` one shows the lock screen, before it is thrown. */
export function api<R extends Route>(route: R, ...request: RouteInput<R>): Promise<RouteReply<R>> {
  const [input] = request;
  return call(route, pathOf(route, input), input);
}

async function call<R extends Route>(route: R, path: string, body?: unknown): Promise<RouteReply<R>> {
  const res = await fetch(
    path,
    route.method === 'GET'
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) },
  );
  const json: unknown = await res.json().catch(() => ({}));
  // oxlint-disable-next-line typescript/consistent-type-assertions -- a wire body has no static type; the API serializes every 2xx through this route's reply schema, and the web does not repeat the check
  if (res.ok) return json as RouteReply<R>;
  const refused = refusedBy(json, `the LIMS did not answer (${res.status})`);
  if (refused.kind === 'noSession') signedOut(refused.message);
  if (refused.kind === 'sessionLocked') {
    locked(refused.message, nextLockMode);
    nextLockMode = 'unlock';
  }
  throw refused;
}

/** Locks the session, then shows the lock screen with the server's words once a read is refused as locked; Switch user opens it on the sign-in form. */
export async function lock(mode: LockMode): Promise<void> {
  await api(routes.lock);
  nextLockMode = mode;
  await api(routes.me).catch(() => {});
}

export async function signOut(): Promise<void> {
  await api(routes.logout).catch(() => {});
  location.hash = '';
  signedOut('');
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
