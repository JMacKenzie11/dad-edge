"use client";

import { useEffect, useState } from "react";
import { AutoTextarea } from "./auto-textarea";

/**
 * Shared textarea Field with per-field validation styling. Standard
 * pattern across every ITC form:
 *   - When error is present: red border, aria-invalid, error text
 *     replaces the muted hint below the input.
 *   - When error is absent: normal border + muted italic hint.
 *
 * Keeps every form's visual treatment of "this field needs your
 * attention" identical, so a coachee only has to learn one language
 * for what red-border-plus-red-text means.
 */
export function FormField({
  label,
  hint,
  value,
  onChange,
  rows,
  disabled,
  placeholder,
  error,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  disabled: boolean;
  placeholder?: string;
  /** Per-field validation error. When present the border turns
   *  danger red and the hint below is replaced with this message. */
  error?: string;
}) {
  const invalid = Boolean(error);
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]">
        {label}
      </span>
      <AutoTextarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        minRows={rows}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={invalid ? "true" : undefined}
        className={
          "w-full rounded-md bg-black/30 px-3 py-2 text-sm leading-relaxed placeholder:text-[color:var(--color-text-muted)]/60 placeholder:italic border " +
          (invalid
            ? "border-[color:var(--color-danger)]"
            : "border-[color:var(--color-border)]")
        }
      />
      {invalid ? (
        <span className="block text-[11px] text-[color:var(--color-danger)]">
          {error}
        </span>
      ) : (
        <span className="block text-[11px] text-[color:var(--color-text-muted)]/70 italic">
          {hint}
        </span>
      )}
    </label>
  );
}

/**
 * Two-phase saving indicator. The row-based save actions block on
 * (a) the DB write and (b) an inline coach reaction LLM call. A
 * fast typist reads "Saving..." for 3-5 seconds after a one-line
 * entry and it feels wrong — the write took milliseconds.
 *
 * This component shows "Saving..." for the first ~700ms of pending
 * state, then swaps to "Saved · coach is reading..." — honest about
 * what the app is actually doing. The threshold is a heuristic
 * (the actual DB write completion isn't observable client-side)
 * but it's close enough that the perceived-latency story matches
 * reality.
 *
 * When pending resets to false, the label clears with the pending
 * state.
 */
export function SavingIndicator({
  pending,
  className = "text-xs text-[color:var(--color-text-muted)]",
}: {
  pending: boolean;
  className?: string;
}) {
  const [phase, setPhase] = useState<"saving" | "reading">("saving");
  useEffect(() => {
    if (!pending) {
      setPhase("saving");
      return;
    }
    setPhase("saving");
    const t = setTimeout(() => setPhase("reading"), 700);
    return () => clearTimeout(t);
  }, [pending]);
  if (!pending) return null;
  return (
    <p className={className}>
      {phase === "saving" ? "Saving…" : "Saved · coach is reading…"}
    </p>
  );
}

/**
 * Small inline spinner used inside action buttons while the server
 * action is pending. Same visual language as the ContinueBar spinner
 * in map-canvas — matching two-arc SVG, currentColor so it inherits
 * the button's text color, sized to sit alongside a text label.
 *
 * Reason for a shared component: three "Use this draft" buttons plus
 * the ContinueBar all needed the same "something is happening"
 * affordance; a static "…" or plain disabled state read as frozen.
 */
export function InlineSpinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`${className} animate-spin`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Standard top-level form error summary. Renders when there's a
 * server-side or top-level client-side error to surface. Uses
 * aria-live="polite" + role="status" so screen readers announce it
 * when it appears without stealing focus.
 */
export function FormErrorSummary({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className="text-sm text-[color:var(--color-danger)]"
    >
      {error}
    </p>
  );
}
