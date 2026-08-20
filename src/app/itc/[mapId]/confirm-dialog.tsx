"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Styled confirm dialog. Replaces native window.confirm() everywhere
 * in the ITC UI so we get:
 *   - Consistent dark-theme styling (native confirm shows a browser
 *     OS chrome dialog against the dark app).
 *   - Explicit destructive-action framing (labeled action button in
 *     danger red rather than an ambiguous "OK").
 *   - Keyboard-accessible focus trap + Escape to cancel.
 *   - Screen-reader accessible via role="alertdialog".
 *
 * Renders as a fixed overlay when `open`. Controlled component:
 * caller owns open/close state.
 *
 * Usage:
 *   const [confirmOpen, setConfirmOpen] = useState(false);
 *   ...
 *   <ConfirmDialog
 *     open={confirmOpen}
 *     title="Remove behavior?"
 *     body="You wrote a worry paired to this behavior."
 *     confirmLabel="Remove"
 *     onConfirm={() => { setConfirmOpen(false); doRemove(); }}
 *     onCancel={() => setConfirmOpen(false)}
 *     destructive
 *   />
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as a destructive action (red). Also
   *  moves focus to the Cancel button on open so a stray Enter
   *  keystroke doesn't trigger the destructive action by default. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!open) return;
    // Focus the safer button on open. Destructive → cancel; non-
    // destructive → confirm.
    const target = destructive ? cancelRef.current : confirmRef.current;
    setTimeout(() => target?.focus(), 30);
    // Escape to cancel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, destructive, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5 shadow-2xl"
      >
        <h2
          id={titleId}
          className="text-base font-semibold text-white mb-2"
        >
          {title}
        </h2>
        <p
          id={bodyId}
          className="text-sm text-[color:var(--color-text-muted)] leading-relaxed whitespace-pre-line"
        >
          {body}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[color:var(--color-border)] px-4 py-2 text-sm hover:bg-white/5"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={
              "rounded-md px-4 py-2 text-sm font-semibold text-white " +
              (destructive
                ? "bg-[color:var(--color-danger)] hover:opacity-90"
                : "bg-[color:var(--color-primary)] hover:opacity-90")
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
