"use client";

import { useState, useTransition } from "react";
import { previewHoneDiagnosticAdmin } from "../../actions";

/**
 * Admin-only audit preview. Runs the whole-map audit on demand and
 * shows the result inline on /itc/admin/[mapId]. Nothing persists — the
 * coachee sees no banner, no message row, no notification. Facilitator
 * can re-run freely to check current state without spamming.
 */
export function AuditPreview({ mapId }: { mapId: string }) {
  const [pending, startTransition] = useTransition();
  const [prose, setProse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      const res = await previewHoneDiagnosticAdmin(mapId);
      if (res.ok) {
        setProse(res.prose);
      } else {
        setError(res.reason);
      }
    });
  };

  return (
    <div className="rounded-md border border-[color:var(--color-border)] bg-black/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted)]">
          Audit preview
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-warning)] disabled:opacity-50 cursor-pointer"
        >
          {pending ? "RUNNING…" : prose ? "RE-RUN" : "RUN AUDIT"}
        </button>
      </div>
      <div className="text-[10px] italic text-[color:var(--color-muted)] mb-2">
        Preview only. Nothing is written to the map or shown to the coachee.
      </div>
      {error ? (
        <p className="text-[11px] text-[color:var(--color-danger)] leading-snug">
          {error}
        </p>
      ) : null}
      {prose ? (
        <div className="mt-1 rounded border border-[color:var(--color-warning)]/40 border-l-[3px] border-l-[color:var(--color-warning)] bg-[color:var(--color-surface)] px-3 py-2 text-[12px] leading-relaxed text-white/90 whitespace-pre-wrap">
          {prose}
        </div>
      ) : null}
    </div>
  );
}
