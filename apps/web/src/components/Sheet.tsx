import { useCallback, useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react';
import './sheet.css';

/** Matches --dur-exit in tokens.css. */
export const SHEET_EXIT_MS = 180;

/** A sheet closes by playing its exit, then telling its owner to unmount it. */
export function useSheetExit(onClosed: () => void) {
  const [leaving, setLeaving] = useState(false);
  const closed = useEffectEvent(onClosed);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => closed(), SHEET_EXIT_MS);
    return () => clearTimeout(t);
  }, [leaving]);
  return { leaving, close: useCallback(() => setLeaving(true), []) };
}

/**
 * A sheet that rises out of the rail and keeps the record's top visible above it. It is a modal
 * <dialog>, so the page behind is inert. Escape and Cancel always close it; clicking the scrim
 * does nothing. Focus returns to whatever opened it.
 */
export function Sheet(props: {
  title: ReactNode;
  leaving: boolean;
  onEscape: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const escape = useEffectEvent(props.onEscape);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    (dialog.querySelector<HTMLElement>('input:not([disabled])') ?? dialog).focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        escape();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      data-leaving={props.leaving || undefined}
      // The browser's own Escape would close the dialog at once; the sheet plays its exit instead.
      onCancel={(e) => e.preventDefault()}
    >
      <div className="sheet__body">
        <h2 className="sheet__title" id={titleId}>
          {props.title}
        </h2>
        {props.children}
      </div>
      <footer className="sheet__rail">{props.footer}</footer>
    </dialog>
  );
}
