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
        "group w-full rounded-md px-4 py-2.5 text-sm font-semibold transition " +
        "bg-[color:var(--color-primary)] " +
        "hover:brightness-110 " +
        "active:scale-[0.98] active:brightness-95 " +
        "disabled:opacity-70 disabled:cursor-not-allowed"
      }
    >
      <span className="inline-flex items-center justify-center gap-2">
        {pending ? (
          <>
            <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            Starting…
          </>
        ) : (
          "Start map"
        )}
      </span>
    </button>
  );
}
