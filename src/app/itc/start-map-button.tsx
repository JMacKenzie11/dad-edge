"use client";

import { useFormStatus } from "react-dom";

export function StartMapButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={
        "w-full h-10 rounded-md border border-[color:var(--color-warning)] " +
        "bg-transparent text-[color:var(--color-warning)] " +
        "font-heading text-xs tracking-widest uppercase " +
        "hover:bg-[color:var(--color-warning)]/10 " +
        "active:scale-[0.98] transition " +
        "disabled:opacity-50 disabled:cursor-not-allowed"
      }
    >
      <span className="inline-flex items-center justify-center gap-2">
        {pending ? (
          <>
            <span className="inline-block w-3 h-3 rounded-full border-2 border-[color:var(--color-warning)]/40 border-t-[color:var(--color-warning)] animate-spin" />
            STARTING…
          </>
        ) : (
          "START AN IMPROVEMENT MAP"
        )}
      </span>
    </button>
  );
}
