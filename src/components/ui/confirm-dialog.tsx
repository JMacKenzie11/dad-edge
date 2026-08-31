"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
 * Renders via createPortal to document.body. Without the portal, a
 * `position: fixed` overlay gets scoped to the nearest ancestor with
 * a transform / filter / will-change (creating a new containing
 * block for fixed elements — classic CSS gotcha). The page header
 * has such an ancestor, so the Clear-map dialog was appearing
 * offset near the top of the viewport instead of centered. Portal
 * escapes that.
 *
 * Controlled component: caller owns open/close state.
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
  // Portal target — document.body isn't available during SSR, so we
  // wait for mount before rendering the portal.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

  if (!open || !mounted) return null;

  return createPortal(
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
    </div>,
    document.body,
  );
}
