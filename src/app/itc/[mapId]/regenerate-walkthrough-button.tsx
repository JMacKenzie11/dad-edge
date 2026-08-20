"use client";

import { useState, useTransition } from "react";
import { regenerateWalkthrough } from "../actions";
import { useConfirm } from "./use-confirm";

/**
 * "Regenerate walkthrough" affordance on the immune-system section.
 * Wipes the existing walkthrough stage_note and asks the coach to
 * write a fresh one against current map state.
 *
 * Why this exists: the walkthrough quotes goal, behaviors, worries,
 * commitments, and assumptions verbatim. If the coachee edits any
 * of those after the walkthrough was first delivered, the persuasion
 * is speaking to the pre-edit map. Rather than auto-detect staleness
 * (which is fragile — we'd need per-row updated_at timestamps that
 * don't exist), give the coachee an explicit affordance. They know
 * when they've edited enough to warrant a rewrite.
 */
export function RegenerateWalkthroughButton({ mapId }: { mapId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, confirm] = useConfirm();

  async function onClick() {
    const ok = await confirm({
      title: "Rewrite the walkthrough?",
      body: "The coach will write a fresh walkthrough against the current map. The old one goes away.",
      confirmLabel: "Rewrite it",
    });
    if (!ok) return;
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    startTransition(async () => {
      const res = await regenerateWalkthrough(fd);
      if (!res.ok) setError(res.reason ?? "Could not regenerate.");
    });
  }

  return (
    <>
      {dialog}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-text-muted)] hover:text-white disabled:opacity-50"
          title="If you've edited your map since this was written, rewrite it against the current version."
        >
          {pending ? "Rewriting…" : "Rewrite the walkthrough"}
        </button>
        {error ? (
          <span className="text-xs text-[color:var(--color-danger)]">
            {error}
          </span>
        ) : null}
      </div>
    </>
  );
}
