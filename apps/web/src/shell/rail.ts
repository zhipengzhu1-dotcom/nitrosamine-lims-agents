import { createContext, useContext, useEffect, useRef } from 'react';
import type { Receipt as ReceiptFact } from '../model';
import type { RailPrimary } from '../components/Rail';

/** What a screen puts in the rail: what the next act acts on, and the act. */
export type RailSlot = {
  readonly context: { readonly main: string; readonly sub: string | null } | null;
  readonly primary: RailPrimary | null;
};

export type RailControl = {
  readonly setSlot: (slot: RailSlot) => void;
  /** Called only with a receipt the server confirmed (rule 9). */
  readonly showReceipt: (receipt: ReceiptFact) => void;
};

export const RailContext = createContext<RailControl | null>(null);

export function useRailControl(): RailControl {
  const rail = useContext(RailContext);
  if (!rail) throw new Error('useRailControl outside the Workspace');
  return rail;
}

/**
 * A screen names its next act in the rail. The act's handler is read at press time, so the rail
 * never holds a stale closure; the slot is replaced only when what it shows changes.
 */
export function useRail(slot: RailSlot): void {
  const { setSlot } = useRailControl();
  const latest = useRef(slot);
  latest.current = slot;
  const p = slot.primary;
  const shown = [slot.context?.main, slot.context?.sub, p?.kind, p?.label, p?.kind === 'blocked' ? p.reason : null].join('\u0000');
  useEffect(() => {
    const s = latest.current;
    const primary: RailPrimary | null =
      s.primary?.kind === 'commit'
        ? { ...s.primary, onCommit: () => (latest.current.primary?.kind === 'commit' ? latest.current.primary.onCommit() : Promise.resolve()) }
        : s.primary;
    setSlot({ context: s.context, primary });
  }, [shown, setSlot]);
  useEffect(() => () => setSlot({ context: null, primary: null }), [setSlot]);
}
