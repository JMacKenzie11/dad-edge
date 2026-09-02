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
  step,
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
  /** Optional 1-based step number. When set, renders a numbered
   *  badge beside the label and a colored left-border accent on the
   *  input. Used on multi-field forms (test design, results debrief)
   *  where the fields form an ordered sequence and reading them as a
   *  wall of identical inputs is hard on the eye. */
  step?: number;
}) {
  const invalid = Boolean(error);
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-2">
        {step !== undefined ? (
          <span
            aria-hidden="true"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary)]/20 text-[11px] font-bold text-[color:var(--color-primary)] border border-[color:var(--color-primary)]/40"
          >
            {step}
          </span>
        ) : null}
        <span className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]">
          {label}
        </span>
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
            : "border-[color:var(--color-border)]") +
          (step !== undefined && !invalid
            ? " border-l-2 border-l-[color:var(--color-primary)]/60"
            : "")
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
 * Three-phase saving indicator. The row-based save actions block on
 * (a) the DB write and (b) the coach's rubric + rewrite calls. A
 * fast typist reads "Saving..." for 3-5 seconds after a one-line
 * entry and it feels wrong — the write took milliseconds.
 *
 * Phases (thresholds are heuristics; the DB write completing isn't
 * observable client-side, but the story matches reality closely):
 *   0-700ms    "Saving…"
 *   0.7-6s     "Saved · coach is reading…"
 *   6s+        "Saved · coach is still reading…"
 *
 * The spinner and the third phase exist for the same reason: the
 * coach's calls can run several seconds, and a label that never
 * changes reads as frozen. Something moving, plus text that updates
 * once on a long wait, says the app is still working without
 * claiming anything untrue.
 *
 * Uses the shared InlineSpinner so every "something is happening"
 * affordance in the map is the same mark.
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
  const [phase, setPhase] = useState<"saving" | "reading" | "still">("saving");
  useEffect(() => {
    if (!pending) {
      setPhase("saving");
      return;
    }
    setPhase("saving");
    const toReading = setTimeout(() => setPhase("reading"), 700);
    const toStill = setTimeout(() => setPhase("still"), 6000);
    return () => {
      clearTimeout(toReading);
      clearTimeout(toStill);
    };
  }, [pending]);
  if (!pending) return null;
  const label =
    phase === "saving"
      ? "Saving…"
      : phase === "reading"
        ? "Saved · coach is reading…"
        : "Saved · coach is still reading…";
  return (
    <p role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 ${className}`}>
      <InlineSpinner className="h-3 w-3 shrink-0" />
      {label}
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
