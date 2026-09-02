"use client";

import { useFormStatus } from "react-dom";

export function StartMapButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      // Filled primary blue, the app's one look for a primary action
      // (ContinueBar, message send, goal review). It was amber-outline,
      // which reads as a secondary or warning action next to them.
      className={
        "w-full h-10 rounded-md bg-[color:var(--color-primary)] text-white " +
        "font-heading text-xs tracking-widest uppercase " +
        "hover:bg-[color:var(--color-primary)]/90 " +
        "active:scale-[0.98] transition cursor-pointer " +
        "disabled:opacity-50 disabled:cursor-not-allowed"
      }
    >
      <span className="inline-flex items-center justify-center gap-2">
        {pending ? (
          <>
            <span className="inline-block w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            STARTING…
          </>
        ) : (
          "START AN IMPROVEMENT MAP"
        )}
      </span>
    </button>
  );
}
