"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Submit button with a visible pending state. Every server-action
 * form in the app should use this so users get a clear "you clicked
 * something and it's working" signal — no more triple-clicks.
 *
 * `variant` controls color scheme:
 *   primary  — brand blue, the default confirmation action
 *   warning  — brand orange/warning, used for Send Invite affordances
 *   danger   — brand red, destructive actions
 *   ghost    — outlined subtle button (e.g., inline row actions)
 *
 * `formAction` lets one form drive multiple actions (invite vs.
 * delete on the same selection). Passes through to the underlying
 * <button>.
 */
type Variant = "primary" | "warning" | "danger" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-[color:var(--color-primary)] text-white",
  warning: "bg-[color:var(--color-warning)] text-black",
  danger: "bg-[color:var(--color-danger)] text-white",
  ghost:
    "bg-transparent text-[color:var(--color-text)] border border-[color:var(--color-border)]",
};

export function SubmitButton({
  label,
  pendingLabel,
  variant = "primary",
  className = "",
  formAction,
  disabled,
}: {
  label: ReactNode;
  pendingLabel: ReactNode;
  variant?: Variant;
  className?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const isDisabled = pending || disabled;
  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={isDisabled}
      aria-busy={pending}
      className={
        "h-11 px-4 rounded-md font-heading text-sm tracking-widest " +
        "disabled:opacity-60 disabled:cursor-not-allowed " +
        "inline-flex items-center justify-center gap-2 " +
        VARIANT_CLASSES[variant] +
        " " +
        className
      }
    >
      {pending ? (
        <>
          <Spinner />
          <span>{pendingLabel}</span>
        </>
      ) : (
        label
      )}
    </button>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current"
      aria-hidden="true"
    />
  );
}
