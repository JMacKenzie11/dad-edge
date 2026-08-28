"use client";

import { useState, useTransition } from "react";
import { runHoneDiagnostic } from "../actions";

/**
 * "HONE THIS MAP" trigger. Persistent affordance on the map canvas
 * (any stage past goal). Click → runHoneDiagnostic server action
 * generates the whole-map audit and persists it as an
 * itc_messages row with surface=hone_diagnostic. HoneDiagnosticBanner
 * renders it at the top of the canvas.
 *
 * Client-side because we want the pending "AUDITING…" state and a
 * clear error surface if the LLM call fails. Server action revalidates
 * the map page on success so the banner appears without a manual
 * refresh.
 */
export function HoneButton({
  mapId,
  hasDiagnostic,
}: {
  mapId: string;
  hasDiagnostic: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={(fd: FormData) => {
          fd.set("map_id", mapId);
          setError(null);
          startTransition(async () => {
            const result = await runHoneDiagnostic(fd);
            if (result && !result.ok) {
              setError(result.reason ?? "Audit failed. Try again.");
            }
          });
        }}
      >
        <button
          type="submit"
          disabled={pending}
          aria-label="Run a whole-map audit"
          title={
            hasDiagnostic
              ? "Re-run the audit against the current map"
              : "Get the coach's take on the whole map"
          }
          className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-warning)] disabled:opacity-50 cursor-pointer"
        >
          {pending
            ? "AUDITING…"
            : hasDiagnostic
              ? "RE-RUN AUDIT"
              : "HONE THIS MAP"}
        </button>
      </form>
      {error ? (
        <p className="text-[10px] text-[color:var(--color-danger)] max-w-[260px] text-right leading-snug">
          {error}
        </p>
      ) : null}
    </div>
  );
}
