import { useMemo } from 'react';
import { createApi, type Api } from './api/client';
import { ApiContext } from './api/hooks';
import { Enrol } from './screens/Enrol';
import { SessionGate } from './session/SessionGate';
import { broadcastBus, createSessionStore, type SessionBus, type SessionStore } from './session/store';
import { resolve } from './shell/routes';
import { Workspace } from './shell/Workspace';
import './styles/tokens.css';
import './styles/base.css';

export type Wiring = { readonly api: Api; readonly store: SessionStore };

/** One API client and one session store per tab; any answer that says the session is gone asks again. */
export function wire(opts: { fetch?: typeof fetch; bus?: SessionBus } = {}): Wiring {
  let store: SessionStore | null = null;
  const api = createApi({ ...(opts.fetch ? { fetch: opts.fetch } : {}), onSessionLost: () => void store?.refresh() });
  store = createSessionStore(api, opts.bus ?? broadcastBus());
  return { api, store };
}

/**
 * The enrolment link is the one page outside the session: the person has no account to sign in
 * with yet. Every other path goes through the gate, and the path is only ever a destination.
 */
export function App({ location, wiring }: { location: { pathname: string; hash: string }; wiring?: Wiring }) {
  const { api, store } = useMemo(() => wiring ?? wire(), [wiring]);
  if (location.pathname === '/enrol') {
    return (
      <ApiContext value={api}>
        <Enrol hash={location.hash} />
      </ApiContext>
    );
  }
  const route = resolve(location.pathname);
  return (
    <ApiContext value={api}>
      <SessionGate store={store} destination={location.pathname === '/' ? null : (route?.title ?? location.pathname)}>
        <Workspace path={location.pathname} />
      </SessionGate>
    </ApiContext>
  );
}
