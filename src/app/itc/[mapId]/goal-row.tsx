"use client";

import { useState, useTransition } from "react";
import { saveGoal } from "../actions";

/**
 * Column 1 row — read-only display with a small edit icon for quick
 * typo fixes. All state changes (initial save, refinement) normally
 * happen via coach-fired proposal cards in chat. This lets the coachee
 * fix a stray character without going through the coach.
 */
export function GoalRow({
  mapId,
  goalText,
}: {
  mapId: string;
  goalText: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goalText ?? "");
  const [error, setError] = useState<string | null>(null);

  if (!goalText) {
    return (
      <p className="text-xs italic text-[color:var(--color-text-muted)]/70">
        Not yet set.
      </p>
    );
  }

  if (editing) {
    function submit() {
      setError(null);
      const text = draft.trim();
      if (text.length < 10) {
        setError("Goal is too short.");
        return;
      }
      const fd = new FormData();
      fd.set("map_id", mapId);
      fd.set("text", text);
      startTransition(async () => {
        const res = await saveGoal(fd);
        if (!res.ok) setError(res.reason ?? "Could not save.");
        else setEditing(false);
      });
    }
    return (
      <div className="space-y-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          disabled={pending}
          className="w-full resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-2.5 py-1.5 text-sm leading-relaxed"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {pending ? "…" : "Save"}
          </button>
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
        </div>
        {error ? (
          <p className="text-xs text-[color:var(--color-danger)]">{error}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <p className="flex-1 text-sm leading-relaxed">{goalText}</p>
      <button
        type="button"
        onClick={() => {
          setDraft(goalText);
          setEditing(true);
        }}
        title="Edit goal"
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[color:var(--color-text-muted)] hover:text-white"
      >
        Edit
      </button>
    </div>
  );
}
