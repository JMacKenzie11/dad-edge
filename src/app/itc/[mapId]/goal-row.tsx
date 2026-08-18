"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { GOAL_STEM } from "@/lib/itc/stage";
import { requestSuggestions, saveGoal } from "../actions";

/**
 * Column 1 row — form-first. When no goal is set, shows a stem-
 * prefixed input + Save button + "Give me ideas" trigger. When set,
 * shows the goal text + Edit + "Give me ideas". All writes go
 * through the map panel; the coach never writes here.
 *
 * Listens for `itc-chip-fill` events dispatched by tap-to-fill chips
 * in the chat pane so a coach-suggested phrasing can pre-populate
 * the input without copy/paste.
 */
export function GoalRow({
  mapId,
  goalText,
  isActive,
}: {
  mapId: string;
  goalText: string | null;
  isActive: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(goalText === null);
  const [draft, setDraft] = useState(goalText ?? `${GOAL_STEM} `);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isActive) return;
    function onFill(ev: Event) {
      const e = ev as CustomEvent<{ value: string }>;
      if (!e.detail?.value) return;
      const raw = e.detail.value.trim();
      const withStem = raw.toLowerCase().startsWith(GOAL_STEM.toLowerCase())
        ? raw
        : `${GOAL_STEM} ${raw}`;
      setDraft(withStem);
      setEditing(true);
      // Focus the input so he can review and hit Save.
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    window.addEventListener("itc-chip-fill", onFill as EventListener);
    return () => window.removeEventListener("itc-chip-fill", onFill as EventListener);
  }, [isActive]);

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

  function askForIdeas() {
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("kind", "goal");
    startTransition(async () => {
      const res = await requestSuggestions(fd);
      if (!res.ok) setError(res.reason ?? "Could not fetch suggestions.");
    });
  }

  if (!goalText || editing) {
    return (
      <div className="space-y-2">
        <textarea
          ref={inputRef}
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
            {pending ? "…" : goalText === null ? "Save goal" : "Save"}
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
          {isActive ? (
            <button
              type="button"
              onClick={askForIdeas}
              disabled={pending}
              className="ml-auto rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-text-muted)] hover:text-white disabled:opacity-50"
              title="Ask the coach for options"
            >
              Give me ideas
            </button>
          ) : null}
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
