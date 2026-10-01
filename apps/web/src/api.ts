import { pathOf, type Route, type RouteInput, type RouteReply, routes } from '@lims/domain';
import { useEffect, useState } from 'react';

export class Refused extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let signedOut = (_message: string) => {};
export const onSignedOut = (fn: (message: string) => void) => {
  signedOut = fn;
};

/**
 * Calls a route and gives its reply. A 401 returns to sign-in once `/api/me` confirms the session is gone,
 * because a wrong password on a signature is also a 401 and leaves the session open.
 */
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
  const message =
    typeof json === 'object' && json !== null && 'message' in json && typeof json.message === 'string'
      ? json.message
      : res.statusText;
  if (
    res.status === 401 &&
    route.url !== routes.login.url &&
    (route.url === routes.me.url || !(await fetch(routes.me.url)).ok)
  )
    signedOut(message);
  throw new Refused(res.status, message);
}

export async function signOut(): Promise<void> {
  await api(routes.logout).catch(() => {});
  location.hash = '';
  signedOut('');
}

export function useApi<R extends Route>(
  route: R,
  ...request: RouteInput<R>
): { data?: RouteReply<R>; error?: string; reload: () => void } {
  const [state, setState] = useState<{ data?: RouteReply<R>; error?: string }>({});
  const [version, setVersion] = useState(0);
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
  return { ...state, reload: () => setVersion((v) => v + 1) };
}
