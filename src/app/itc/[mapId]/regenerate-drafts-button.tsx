"use client";

import { useState, useTransition } from "react";
import {
  regenerateAssumptionDrafts,
  regenerateWorryDrafts,
} from "../actions";
import { useConfirm } from "@/components/ui/use-confirm";

/**
 * "Regenerate drafts" affordance on Column 3 (worries) and Column 5
 * (assumptions). Wipes the existing coach-authored drafts and re-fires
 * the drafter against current upstream content.
 *
 * Column 4 (commitments) is not on this list — competing commitments
 * auto-derive from worries directly on save now, no draft/accept step,
 * so there's nothing to regenerate as a batch.
 *
 * Why this exists on the two remaining columns: on advance into a
 * column, the coach drafts suggestions from the prior column's content.
 * If the coachee later goes back and sharpens a behavior (Column 2)
 * or commitment (Column 4), the drafts one column downstream are still
 * speaking to the pre-edit text. Rather than auto-detect staleness,
 * give the coachee an explicit button.
 *
 * Real accepted rows are left alone by both server actions. Only the
 * pending drafts are wiped.
 */
export function RegenerateDraftsButton({
  mapId,
  kind,
}: {
  mapId: string;
  /** Which drafts to regenerate. Determines the server action and
   *  the copy in the confirm dialog. */
  kind: "worries" | "assumptions";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dialog, confirm] = useConfirm();

  // The coach writes the OPENING of each entry now, not a whole
  // draft to accept, so the copy says so. "Drafts" implied something
  // finished sitting above waiting for a yes.
  const labelKind = kind === "worries" ? "worry" : "assumption";
  const upstream =
    kind === "worries" ? "behaviors" : "competing commitments";

  async function onClick() {
    const ok = await confirm({
      title: `Rewrite the coach's ${labelKind} openings?`,
      body: `The coach will write fresh openings against your current ${upstream}. Anything you've written yourself stays.`,
      confirmLabel: "Rewrite",
    });
    if (!ok) return;
    setError(null);
    setInfo(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    startTransition(async () => {
      const action =
        kind === "worries" ? regenerateWorryDrafts : regenerateAssumptionDrafts;
      const res = await action(fd);
      if (!res.ok) {
        setError(res.reason ?? "Could not regenerate.");
        return;
      }
      // Silent-zero was the bug: action succeeded but the drafter
      // returned nothing (or every draft got filtered for missing
      // links). Coachee saw the spinner then nothing. Surface it.
      if (res.draftsWritten === 0) {
        setInfo(
          `The coach couldn't write fresh openings against your current ${upstream}. Try sharpening one of them first, then try again.`,
        );
        return;
      }
      const n = res.draftsWritten;
      setInfo(
        kind === "worries"
          ? `${n} fresh ${n === 1 ? "opening" : "openings"} in the boxes above.`
          : `Fresh opening in the box above.`,
      );
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
          title={`If you've changed your ${upstream} since these openings were written, get fresh ones.`}
        >
          {pending ? "Rewriting…" : "Rewrite openings"}
        </button>
        {error ? (
          <span className="text-xs text-[color:var(--color-danger)]">
            {error}
          </span>
        ) : null}
        {info ? (
          <span className="text-xs text-[color:var(--color-text-muted)]">
            {info}
          </span>
        ) : null}
      </div>
    </>
  );
}
