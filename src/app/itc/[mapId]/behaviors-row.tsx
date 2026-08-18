"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ItcBehavior } from "@/lib/itc/maps";
import {
  addBehavior,
  removeBehavior,
  requestSuggestions,
  updateBehavior,
} from "../actions";

const FRESH_ROW_MS = 15_000;
function isFresh(iso: string, nowMs: number): boolean {
  const then = new Date(iso).getTime();
  return Number.isFinite(then) && nowMs - then < FRESH_ROW_MS;
}

const MAX_BEHAVIORS = 5;

/**
 * Column 2 row — inline-editable behaviors. Each row's text is a
 * textarea that reads as plain text until focused. Blur or Enter
 * commits; nothing changes if the text is unchanged. Remove is
 * retained as an explicit button (destructive). Add is a separate
 * form input at the bottom of the list.
 */
export function BehaviorsRow({
  mapId,
  behaviors,
  isActive,
  nowMs,
}: {
  mapId: string;
  behaviors: ItcBehavior[];
  isActive: boolean;
  nowMs: number;
}) {
  const selected = behaviors.filter((b) => b.selected);
  const capReached = selected.length >= MAX_BEHAVIORS;
  return (
    <div className="space-y-2">
      {selected.length === 0 ? (
        <p className="text-xs italic text-[color:var(--color-text-muted)]/70">
          None yet.
        </p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {selected.map((b, i) => (
            <BehaviorItem
              key={b.id}
              mapId={mapId}
              behavior={b}
              index={i + 1}
              fresh={isFresh(b.created_at, nowMs)}
              isActive={isActive}
            />
          ))}
        </ul>
      )}
      {isActive ? (
        capReached ? (
          <p className="text-[11px] italic text-[color:var(--color-text-muted)]/80 pt-1">
            5 on the map. Edit or remove one to add another.
          </p>
        ) : (
          <AddBehaviorForm mapId={mapId} />
        )
      ) : null}
    </div>
  );
}

function AddBehaviorForm({ mapId }: { mapId: string }) {
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onFill(ev: Event) {
      const e = ev as CustomEvent<{ value: string }>;
      if (!e.detail?.value) return;
      setText(e.detail.value);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    window.addEventListener("itc-chip-fill", onFill as EventListener);
    return () => window.removeEventListener("itc-chip-fill", onFill as EventListener);
  }, []);

  function submit() {
    setError(null);
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      setError("Type a behavior first.");
      return;
    }
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("text", trimmed);
    startTransition(async () => {
      const res = await addBehavior(fd);
      if (!res.ok) setError(res.reason ?? "Could not add.");
      else setText("");
    });
  }

  function askForIdeas() {
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("kind", "behavior");
    startTransition(async () => {
      const res = await requestSuggestions(fd);
      if (!res.ok) setError(res.reason ?? "Could not fetch suggestions.");
    });
  }

  return (
    <div className="space-y-1.5">
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        disabled={pending}
        placeholder="Add a behavior…"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (pending) return;
            submit();
          }
        }}
        className="w-full resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-2 py-1 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          {pending ? "…" : "Add"}
        </button>
        <button
          type="button"
          onClick={askForIdeas}
          disabled={pending}
          className="ml-auto rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-text-muted)] hover:text-white disabled:opacity-50"
          title="Ask the coach for options"
        >
          Give me ideas
        </button>
      </div>
      {error ? (
        <p className="text-[11px] text-[color:var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}

function BehaviorItem({
  mapId,
  behavior,
  index,
  fresh,
  isActive,
}: {
  mapId: string;
  behavior: ItcBehavior;
  index: number;
  fresh: boolean;
  isActive: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(behavior.text);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const savedRef = useRef(behavior.text);

  // Sync from server on revalidation.
  useEffect(() => {
    if (savedRef.current !== behavior.text) {
      savedRef.current = behavior.text;
      setDraft(behavior.text);
    }
  }, [behavior.text]);

  function commit() {
    setError(null);
    const text = draft.trim();
    if (text.length < 3) {
      setError("Too short.");
      setDraft(savedRef.current); // revert
      return;
    }
    if (text === savedRef.current.trim()) return; // no change
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("behavior_id", behavior.id);
    fd.set("text", text);
    startTransition(async () => {
      const res = await updateBehavior(fd);
      if (!res.ok) {
        setError(res.reason ?? "Could not save.");
        setDraft(savedRef.current);
      } else {
        savedRef.current = text;
      }
    });
  }

  function submitRemove() {
    if (!confirm(`Remove behavior #${index}: "${behavior.text}"?`)) return;
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("behavior_id", behavior.id);
    startTransition(async () => {
      const res = await removeBehavior(fd);
      if (!res.ok) setError(res.reason ?? "Could not remove.");
    });
  }

  return (
    <li
      className={
        "rounded-md border border-[color:var(--color-border)] bg-black/20 px-2 py-1 " +
        (fresh ? "itc-fresh-row" : "")
      }
    >
      <div className="flex items-start gap-2">
        <span className="mt-2 text-[11px] text-[color:var(--color-text-muted)] shrink-0">
          {index}.
        </span>
        <textarea
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
          rows={1}
          disabled={pending || !isActive}
          readOnly={!isActive}
          className={
            "flex-1 resize-none rounded-md px-2 py-1 text-sm transition-colors " +
            (focused
              ? "bg-black/30 border border-[color:var(--color-primary)]/60 outline-none"
              : "bg-transparent border border-transparent " +
                (isActive
                  ? "hover:bg-black/20 hover:border-[color:var(--color-border)] cursor-text"
                  : "cursor-default"))
          }
        />
        {isActive ? (
          <button
            type="button"
            onClick={submitRemove}
            disabled={pending}
            title="Remove behavior"
            className="mt-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger)] disabled:opacity-50"
          >
            Remove
          </button>
        ) : null}
      </div>
      {pending ? (
        <p className="pl-5 text-[10px] text-[color:var(--color-text-muted)]">
          Saving…
        </p>
      ) : null}
      {error ? (
        <p className="pl-5 text-[11px] text-[color:var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </li>
  );
}
