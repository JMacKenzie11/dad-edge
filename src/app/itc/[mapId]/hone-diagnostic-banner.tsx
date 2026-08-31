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
  stale = false,
}: {
  mapId: string;
  content: string;
  /** True when the map has been edited since this audit was written.
   *  Banner renders in a dimmer, less-emphatic state and shows a
   *  one-line staleness notice at the top so the coachee sees the
   *  last audit's findings honestly stale rather than silently
   *  wrong. RE-RUN AUDIT button up top is the fix. */
  stale?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div
      className={`mb-4 overflow-hidden rounded-md border border-l-[3px] bg-[color:var(--color-surface)] shadow-sm ${
        stale
          ? "border-[color:var(--color-border)] border-l-[color:var(--color-text-muted)] opacity-70"
          : "border-[color:var(--color-warning)]/40 border-l-[color:var(--color-warning)]"
      }`}
    >
      <div
        className={`border-b border-[color:var(--color-border)] px-4 py-2 flex items-center justify-between gap-3 ${
          stale
            ? "bg-[color:var(--color-text-muted)]/[0.05]"
            : "bg-[color:var(--color-warning)]/[0.05]"
        }`}
      >
        <div
          className={`text-[11px] font-semibold uppercase tracking-widest ${
            stale
              ? "text-[color:var(--color-text-muted)]"
              : "text-[color:var(--color-warning)]"
          }`}
        >
          {stale ? "Coach's audit · stale" : "Coach's audit"}
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
      {stale ? (
        <div className="px-4 py-2 text-[11px] text-[color:var(--color-text-muted)] border-b border-[color:var(--color-border)] bg-[color:var(--color-text-muted)]/[0.03]">
          Map has moved since this audit ran. RE-RUN AUDIT (top right) to refresh.
        </div>
      ) : null}
      <div className="px-4 py-3 text-sm leading-relaxed text-white/90 whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}
