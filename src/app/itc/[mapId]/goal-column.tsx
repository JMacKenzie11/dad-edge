"use client";

import { useState, useTransition } from "react";
import { GOAL_STEM } from "@/lib/itc/stage";
import type { ItcStage } from "@/lib/itc/stage";
import { advanceMapStage, saveGoal } from "../actions";

/**
 * Column 1 — Improvement Goal.
 *
 * Coach-as-advisor variant: state changes on this column happen HERE,
 * not through coach markers. Coach writes prose ("here's your goal
 * back — save it if it reads right"); the coachee types + hits Save.
 * "Next column" is also user-triggered.
 *
 * Read-only rendering for downstream stages (behaviors/worries/etc.)
 * kept simple — the input/buttons only render on the goal stage.
 */
export function GoalColumn({
  mapId,
  currentStage,
  goalText,
}: {
  mapId: string;
  currentStage: ItcStage;
  goalText: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(goalText === null);
  const [draft, setDraft] = useState(goalText ?? `${GOAL_STEM} `);
  const onGoalStage = currentStage === "goal";

  function submitSave() {
    setError(null);
    const text = draft.trim();
    if (text.length < GOAL_STEM.length + 3) {
      setError("Add a few more words after the stem.");
      return;
    }
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("text", text);
    startTransition(async () => {
      const res = await saveGoal(fd);
      if (!res.ok) setError(res.reason ?? "Could not save goal.");
      else setEditing(false);
    });
  }

  function submitAdvance() {
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("to", "behaviors");
    startTransition(async () => {
      const res = await advanceMapStage(fd);
      if (!res.ok) setError(res.reason ?? "Could not advance.");
    });
  }

  // Non-goal stages: read-only. Same look as before.
  if (!onGoalStage) {
    return goalText ? (
      <p className="text-sm leading-relaxed">{goalText}</p>
    ) : (
      <p className="text-xs italic text-[color:var(--color-muted)]/70">
        Not yet set.
      </p>
    );
  }

  // Goal stage, editing (either not yet saved OR user hit Refine).
  if (editing) {
    return (
      <div className="space-y-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          disabled={pending}
          placeholder={`${GOAL_STEM} …`}
          className="w-full resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-2.5 py-1.5 text-sm leading-relaxed"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={submitSave}
            disabled={pending}
            className="rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {pending ? "…" : goalText === null ? "Save goal" : "Save changes"}
          </button>
          {goalText !== null ? (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(goalText);
                setError(null);
              }}
              disabled={pending}
              className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Cancel
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="text-xs text-[color:var(--color-danger)]">{error}</p>
        ) : null}
      </div>
    );
  }

  // Goal stage, saved, read mode. Refine + Next column.
  return (
    <div className="space-y-2">
      <p className="text-sm leading-relaxed">{goalText}</p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={submitAdvance}
          disabled={pending}
          className="rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          {pending ? "…" : "Next column →"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            setError(null);
          }}
          disabled={pending}
          className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs disabled:opacity-50"
        >
          Refine
        </button>
      </div>
      {error ? (
        <p className="text-xs text-[color:var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}
