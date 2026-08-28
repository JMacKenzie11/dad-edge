"use client";

import { useTransition } from "react";
import { dismissHoneDiagnostic } from "../actions";

/**
 * Banner rendered at the top of the map canvas when a hone_diagnostic
 * message exists. Distinct amber accent so it reads as "the coach ran
 * an audit for you" rather than another mid-flow reaction. Dismiss
 * button wipes the persisted message; re-running the audit
 * (HoneButton) regenerates against fresh state.
 */
export function HoneDiagnosticBanner({
  mapId,
  content,
}: {
  mapId: string;
  content: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="mb-4 overflow-hidden rounded-md border border-[color:var(--color-warning)]/40 border-l-[3px] border-l-[color:var(--color-warning)] bg-[color:var(--color-surface)] shadow-sm">
      <div className="border-b border-[color:var(--color-border)] bg-[color:var(--color-warning)]/[0.05] px-4 py-2 flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-[color:var(--color-warning)]">
          Coach's audit
        </div>
        <form
          action={(fd: FormData) => {
            fd.set("map_id", mapId);
            startTransition(async () => {
              await dismissHoneDiagnostic(fd);
            });
          }}
        >
          <button
            type="submit"
            disabled={pending}
            aria-label="Dismiss the audit"
            className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-white disabled:opacity-50 cursor-pointer"
          >
            {pending ? "DISMISSING…" : "DISMISS"}
          </button>
        </form>
      </div>
      <div className="px-4 py-3 text-sm leading-relaxed text-white/90 whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}
