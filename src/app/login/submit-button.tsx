"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button with a visible pending state for server-action forms
 * on the auth pages (login, forgot, magic, set-password). Server
 * actions can take a few seconds — without this the button looks dead
 * and users click it three times.
 *
 * Disables + dims + swaps to `pendingLabel` while the action is in
 * flight. Sits inside a <form action={serverAction}> to read status
 * from useFormStatus().
 */
export function SubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="w-full h-11 rounded-md font-heading text-sm bg-[color:var(--color-primary)] text-white tracking-wide disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
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
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
      aria-hidden="true"
    />
  );
}
