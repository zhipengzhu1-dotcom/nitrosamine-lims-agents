import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { commitKey, type CommitKey } from '../model';
import type { Api, CommandOutcome, Refusal } from './client';

export const ApiContext = createContext<Api | null>(null);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi outside ApiContext');
  return api;
}

export const newCommitKey = (): CommitKey => commitKey(crypto.randomUUID());

export type Command<I, D> = {
  /** The key the next attempt will carry. A sheet is handed it and sends it back. */
  readonly key: CommitKey;
  /**
   * The one mutation path (module map). Run it from an event handler, never from render or an
   * effect (src/structure.test.ts). Each attempt carries one commit key; the key rotates when the
   * server answers, so a retry after a refusal is a new attempt, and two calls before that answer
   * carry the same key and commit once on the server.
   */
  readonly run: (input: I, key?: CommitKey) => Promise<CommandOutcome<D>>;
  readonly busy: boolean;
};

export function useCommand<I, D = unknown>(name: string): Command<I, D> {
  const api = useApi();
  const [key, setKey] = useState(newCommitKey);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (input: I, withKey: CommitKey = key) => {
      setBusy(true);
      try {
        return await api.command<D>(name, input, withKey);
      } finally {
        setKey(newCommitKey());
        setBusy(false);
      }
    },
    [api, name, key],
  );
  return { key, run, busy };
}

export type ViewState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ok'; readonly data: T }
  | { readonly status: 'refused'; readonly refusal: Refusal }
  | { readonly status: 'unreachable'; readonly message: string };

/**
 * Reads a View. Its data lives only in this component's state, so when the session locks and the
 * routed screens unmount, nothing read from a record survives in the browser (rule 1).
 */
export function useView<T>(name: string, query: Readonly<Record<string, string>> | null): ViewState<T> & { readonly reload: () => void } {
  const api = useApi();
  const [state, setState] = useState<ViewState<T>>({ status: 'loading' });
  const [generation, setGeneration] = useState(0);
  const queryKey = query === null ? null : new URLSearchParams(query).toString();
  const latest = useRef(0);
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (queryKey === null) return;
    const ticket = ++latest.current;
    // A reload of the query already on screen keeps it there until the new answer arrives, so the
    // fields under it are not unmounted mid-entry; a new query starts from nothing.
    if (shown.current !== queryKey) setState({ status: 'loading' });
    shown.current = queryKey;
    void api.view<T>(name, Object.fromEntries(new URLSearchParams(queryKey))).then((r) => {
      if (ticket !== latest.current) return;
      setState(r.kind === 'ok' ? { status: 'ok', data: r.data } : r.kind === 'refusal' ? { status: 'refused', refusal: r.refusal } : { status: 'unreachable', message: r.message });
    });
  }, [api, name, queryKey, generation]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  return { ...state, reload };
}
