"use client";

import { useState, useTransition } from "react";
import {
  regenerateAssumptionDrafts,
  regenerateCommitmentDrafts,
  regenerateWorryDrafts,
} from "../actions";
import { useConfirm } from "./use-confirm";

/**
 * "Regenerate drafts" affordance on Column 4 (commitments) and
 * Column 5 (assumptions). Wipes the existing coach-authored drafts
 * and re-fires the drafter against current upstream content.
 *
 * Why this exists: on advance into a column, the coach drafts
 * suggestions from the prior column's content. If the coachee later
 * goes back and sharpens a worry (Column 3) or commitment (Column 4),
 * the drafts one column downstream are still speaking to the pre-edit
 * text. Rather than auto-detect staleness, give the coachee an
 * explicit button — they know when they've edited enough to warrant
 * fresh drafts.
 *
 * Real accepted rows (itc_commitments / itc_assumptions) are left
 * alone by both server actions. Only the pending drafts are wiped.
 */
export function RegenerateDraftsButton({
  mapId,
  kind,
}: {
  mapId: string;
  /** Which drafts to regenerate. Determines the server action and
   *  the copy in the confirm dialog. */
  kind: "worries" | "commitments" | "assumptions";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, confirm] = useConfirm();

  const labelKind =
    kind === "worries"
      ? "worry"
      : kind === "commitments"
        ? "commitment"
        : "assumption";
  const columnLabel =
    kind === "worries"
      ? "Column 2 behaviors"
      : kind === "commitments"
        ? "Column 3 worries"
        : "Column 4 commitments";

  async function onClick() {
    const ok = await confirm({
      title: `Regenerate the coach's ${labelKind} drafts?`,
      body: `The coach will rewrite the drafts against your current ${columnLabel}. Any drafts you haven't accepted go away. Real ${labelKind}s you've already written stay.`,
      confirmLabel: "Regenerate",
    });
    if (!ok) return;
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    startTransition(async () => {
      const action =
        kind === "worries"
          ? regenerateWorryDrafts
          : kind === "commitments"
            ? regenerateCommitmentDrafts
            : regenerateAssumptionDrafts;
      const res = await action(fd);
      if (!res.ok) setError(res.reason ?? "Could not regenerate.");
    });
  }

  return (
    <>
      {dialog}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-text-muted)] hover:text-white disabled:opacity-50"
          title={`If you've edited upstream since these drafts were written, get fresh ones against current content.`}
        >
          {pending ? "Regenerating…" : "Regenerate drafts"}
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
