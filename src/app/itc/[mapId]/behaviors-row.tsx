"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ItcBehavior, ItcMessage } from "@/lib/itc/maps";
import {
  addBehavior,
  removeBehavior,
  requestSuggestions,
  updateBehavior,
} from "../actions";
import { EntryThread } from "./entry-thread";

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
  nowMs,
  threads,
}: {
  mapId: string;
  behaviors: ItcBehavior[];
  nowMs: number;
  /** Per-behavior coach reaction threads. Non-empty only when
   *  the behaviors stage is currently active. Rendered above
   *  each item's input so read-then-edit stays adjacent. */
  threads: Map<string, ItcMessage[]>;
}) {
  const selected = behaviors.filter((b) => b.selected);
  const capReached = selected.length >= MAX_BEHAVIORS;
  return (
    <div className="space-y-3">
      {selected.length === 0 ? (
        <p className="text-sm italic text-[color:var(--color-text-muted)]/70">
          None yet.
        </p>
      ) : (
        <ul className="space-y-2 text-base">
          {selected.map((b, i) => (
            <BehaviorItem
              key={b.id}
              mapId={mapId}
              behavior={b}
              index={i + 1}
              fresh={isFresh(b.created_at, nowMs)}
              thread={threads.get(b.id) ?? []}
            />
          ))}
        </ul>
      )}
      {capReached ? (
        <p className="text-sm italic text-[color:var(--color-text-muted)]/80 pt-1">
          5 on the map. Edit or remove one to add another.
        </p>
      ) : (
        <AddBehaviorForm mapId={mapId} initiallyExpanded={selected.length === 0} />
      )}
    </div>
  );
}

/**
 * Progressive disclosure: expands to a form on first render when
 * the list is empty (no ceremony for the first behavior), otherwise
 * shows a "+ Add another behavior" button that expands on click.
 * The explicit click means the user has considered the coach's
 * reaction on the previous behavior before opening a new input,
 * eliminating the "two open fields at once" confusion.
 */
function AddBehaviorForm({
  mapId,
  initiallyExpanded,
}: {
  mapId: string;
  initiallyExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onFill(ev: Event) {
      const e = ev as CustomEvent<{
        value: string;
        target?: string;
        entryId?: string;
      }>;
      if (!e.detail?.value) return;
      if (e.detail.target !== "behavior") return;
      // Chips carrying an entryId are refinements for a specific
      // existing behavior — those route to that BehaviorItem's inline
      // input, not to this Add form. This Add form only accepts
      // suggestion chips (no entryId).
      if (e.detail.entryId) return;
      setExpanded(true);
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
      else {
        setText("");
        // Collapse after a successful add so the next behavior
        // requires a fresh explicit click — the user has considered
        // the coach's reaction before opening another input.
        setExpanded(false);
      }
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

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => {
          setExpanded(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className="w-full rounded-md border border-dashed border-[color:var(--color-border)] px-4 py-3 text-sm text-[color:var(--color-text-muted)] hover:text-white hover:border-[color:var(--color-text-muted)] transition-colors text-left"
      >
        + Add another behavior
      </button>
    );
  }

  return (
    <div className="space-y-2">
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
          } else if (e.key === "Escape") {
            setText("");
            setError(null);
            setExpanded(false);
          }
        }}
        className="w-full resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-base leading-relaxed"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-[color:var(--color-primary)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {pending ? "…" : "Add"}
        </button>
        {text.length === 0 ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setExpanded(false);
            }}
            disabled={pending}
            className="rounded-md border border-[color:var(--color-border)] px-3 py-2 text-xs text-[color:var(--color-text-muted)] hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
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

function BehaviorItem({
  mapId,
  behavior,
  index,
  fresh,
  thread,
}: {
  mapId: string;
  behavior: ItcBehavior;
  index: number;
  fresh: boolean;
  thread: ItcMessage[];
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(behavior.text);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const savedRef = useRef(behavior.text);
  const inflightRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync from server on revalidation.
  useEffect(() => {
    if (savedRef.current !== behavior.text) {
      savedRef.current = behavior.text;
      setDraft(behavior.text);
    }
  }, [behavior.text]);

  // Refinement-chip fill: coach's chip on THIS behavior's thread
  // dispatches itc-chip-fill with entryId=behavior.id. Only this
  // BehaviorItem's listener matches; other behaviors' items ignore.
  useEffect(() => {
    function onFill(ev: Event) {
      const e = ev as CustomEvent<{
        value: string;
        target?: string;
        entryId?: string;
      }>;
      if (!e.detail?.value) return;
      if (e.detail.target !== "behavior") return;
      if (e.detail.entryId !== behavior.id) return;
      setDraft(e.detail.value);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
    window.addEventListener("itc-chip-fill", onFill as EventListener);
    return () => window.removeEventListener("itc-chip-fill", onFill as EventListener);
  }, [behavior.id]);

  function commit() {
    setError(null);
    if (inflightRef.current) return;
    const text = draft.trim();
    if (text.length < 3) {
      setError("Too short.");
      setDraft(savedRef.current); // revert
      return;
    }
    if (text === savedRef.current.trim()) return; // no change
    const priorSaved = savedRef.current;
    savedRef.current = text; // optimistic — dedupes concurrent commits
    inflightRef.current = true;
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("behavior_id", behavior.id);
    fd.set("text", text);
    startTransition(async () => {
      const res = await updateBehavior(fd);
      inflightRef.current = false;
      if (!res.ok) {
        savedRef.current = priorSaved; // rollback
        setError(res.reason ?? "Could not save.");
        setDraft(priorSaved);
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
        "rounded-md border border-[color:var(--color-border)] bg-black/20 px-3 py-2 " +
        (fresh ? "itc-fresh-row" : "")
      }
    >
      {thread.length > 0 ? (
        <div className="mb-2">
          <EntryThread
            messages={thread}
            chipTarget="behavior"
            entryId={behavior.id}
          />
        </div>
      ) : null}
      <div className="flex items-start gap-3">
        <span className="mt-2 text-sm text-[color:var(--color-text-muted)] shrink-0">
          {index}.
        </span>
        <textarea
          ref={textareaRef}
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
          disabled={pending}
          className={
            "flex-1 resize-none rounded-md px-3 py-2 text-base leading-relaxed transition-colors " +
            (focused
              ? "bg-black/30 border border-[color:var(--color-primary)]/60 outline-none"
              : "bg-transparent border border-[color:var(--color-border)] hover:bg-black/20 hover:border-[color:var(--color-text-muted)] cursor-text")
          }
        />
        <button
          type="button"
          onClick={submitRemove}
          disabled={pending}
          title="Remove behavior"
          className="mt-1 shrink-0 rounded px-2 py-1 text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger)] disabled:opacity-50"
        >
          Remove
        </button>
      </div>
      {pending ? (
        <p className="pl-6 text-xs text-[color:var(--color-text-muted)] mt-1">
          Saving…
        </p>
      ) : focused ? (
        <p className="pl-6 text-xs text-[color:var(--color-text-muted)] mt-1">
          Enter to save · Esc to cancel
        </p>
      ) : null}
      {error ? (
        <p className="pl-6 text-sm text-[color:var(--color-danger)] mt-1">
          {error}
        </p>
      ) : null}
    </li>
  );
}
