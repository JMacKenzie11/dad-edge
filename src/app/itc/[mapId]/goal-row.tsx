"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { GOAL_STEM } from "@/lib/itc/stage";
import { requestSuggestions, saveGoal } from "../actions";

/**
 * Column 1 row — inline-editable at every stage. Goal text is a
 * textarea styled to read as plain text until focused. On blur or
 * Enter (without shift), the draft is saved if it changed. The
 * coach reaction fires from the server action and appears in the
 * goal's entry thread.
 *
 * Editable everywhere: backward edits from later stages (behaviors,
 * worries, etc.) never destroy downstream entries. The next coach
 * reaction on the active stage sees the updated goal in map state.
 */
export function GoalRow({
  mapId,
  goalText,
}: {
  mapId: string;
  goalText: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const initial = goalText ?? `${GOAL_STEM} `;
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const savedRef = useRef(initial);
  const inflightRef = useRef(false);

  // Sync state when server-side goal text changes (revalidation) so
  // the input reflects the just-saved value on next render.
  useEffect(() => {
    const next = goalText ?? `${GOAL_STEM} `;
    if (savedRef.current !== next) {
      savedRef.current = next;
      setDraft(next);
    }
  }, [goalText]);

  // Fill from a coach-suggested chip dispatched from the chat pane.
  useEffect(() => {
    function onFill(ev: Event) {
      const e = ev as CustomEvent<{ value: string }>;
      if (!e.detail?.value) return;
      const raw = e.detail.value.trim();
      const withStem = raw.toLowerCase().startsWith(GOAL_STEM.toLowerCase())
        ? raw
        : `${GOAL_STEM} ${raw}`;
      setDraft(withStem);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    window.addEventListener("itc-chip-fill", onFill as EventListener);
    return () => window.removeEventListener("itc-chip-fill", onFill as EventListener);
  }, []);

  function commit() {
    setError(null);
    if (inflightRef.current) return;
    const text = draft.trim();
    if (text.length < GOAL_STEM.length + 3) {
      setError("Add a few more words after the stem.");
      return;
    }
    if (text === savedRef.current.trim()) {
      return;
    }
    const priorSaved = savedRef.current;
    savedRef.current = text; // optimistic — dedupes concurrent commits
    inflightRef.current = true;
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("text", text);
    startTransition(async () => {
      const res = await saveGoal(fd);
      inflightRef.current = false;
      if (!res.ok) {
        savedRef.current = priorSaved; // rollback
        setError(res.reason ?? "Could not save.");
      }
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

  return (
    <div className="space-y-3">
      <textarea
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(savedRef.current);
            e.currentTarget.blur();
          }
        }}
        rows={3}
        disabled={pending}
        placeholder={`${GOAL_STEM} …`}
        className={
          "w-full resize-none rounded-md px-3 py-2 text-base leading-relaxed transition-colors " +
          (focused
            ? "bg-black/30 border border-[color:var(--color-primary)]/60 outline-none"
            : "bg-transparent border border-transparent hover:bg-black/20 hover:border-[color:var(--color-border)] cursor-text")
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        {pending ? (
          <span className="text-sm text-[color:var(--color-text-muted)]">
            Saving…
          </span>
        ) : focused ? (
          <span className="text-sm text-[color:var(--color-text-muted)]">
            Enter to save · Esc to cancel
          </span>
        ) : null}
        <button
          type="button"
          onClick={askForIdeas}
          disabled={pending}
          className="ml-auto rounded-md border border-[color:var(--color-border)] px-4 py-2 text-sm text-[color:var(--color-text-muted)] hover:text-white disabled:opacity-50"
          title="Ask the coach for options"
        >
          Give me ideas
        </button>
      </div>
      {error ? (
        <p className="text-sm text-[color:var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}
