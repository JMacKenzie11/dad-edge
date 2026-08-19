"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ItcBehavior, ItcMessage, ItcWorry } from "@/lib/itc/maps";
import { saveWorry } from "../actions";
import { EntryThread } from "./entry-thread";

const FRESH_ROW_MS = 15_000;
function isFresh(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return false;
  const then = new Date(iso).getTime();
  return Number.isFinite(then) && nowMs - then < FRESH_ROW_MS;
}

/**
 * Column 3 rows — one worry input per selected behavior. Under the
 * excavation loop, the input field IS the conversation: every save
 * re-runs the server rubric, increments attempts, and triggers a
 * fresh coach reaction. When the rubric scores shallow, the coach
 * asks an excavation question and invites the man to rewrite the
 * worry with the answer folded in.
 *
 * Always editable. Backward edits are fine — the reaction sees
 * updated map state next turn.
 */
export function WorriesRow({
  mapId,
  behaviors,
  worries,
  nowMs,
  threads,
}: {
  mapId: string;
  behaviors: ItcBehavior[];
  worries: ItcWorry[];
  nowMs: number;
  /** Per-worry coach reaction threads. Non-empty only on the worries
   *  stage. Rendered above each worry's input. */
  threads: Map<string, ItcMessage[]>;
}) {
  const selected = behaviors.filter((b) => b.selected);
  const worryByBehaviorId = new Map(worries.map((w) => [w.behavior_id, w]));

  if (selected.length === 0) {
    return (
      <p className="text-sm italic text-[color:var(--color-text-muted)]/70">
        Add at least one behavior first.
      </p>
    );
  }

  return (
    <ul className="space-y-3 text-base">
      {selected.map((b, i) => {
        const w = worryByBehaviorId.get(b.id) ?? null;
        return (
          <WorryItem
            key={b.id}
            mapId={mapId}
            behavior={b}
            index={i + 1}
            worry={w}
            fresh={isFresh(w?.created_at, nowMs)}
            thread={w ? threads.get(w.id) ?? [] : []}
          />
        );
      })}
    </ul>
  );
}

function WorryItem({
  mapId,
  behavior,
  index,
  worry,
  fresh,
  thread,
}: {
  mapId: string;
  behavior: ItcBehavior;
  index: number;
  worry: ItcWorry | null;
  fresh: boolean;
  thread: ItcMessage[];
}) {
  const [pending, startTransition] = useTransition();
  const initial = worry?.text ?? "";
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const savedRef = useRef(initial);
  const inflightRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const next = worry?.text ?? "";
    if (savedRef.current !== next) {
      savedRef.current = next;
      setDraft(next);
    }
  }, [worry?.text]);

  // Refinement-chip fill: only the WorryItem whose entryId matches
  // the event's entryId picks up the fill.
  useEffect(() => {
    if (!worry) return;
    const worryId = worry.id;
    function onFill(ev: Event) {
      const e = ev as CustomEvent<{
        value: string;
        target?: string;
        entryId?: string;
      }>;
      if (!e.detail?.value) return;
      if (e.detail.target !== "worry") return;
      if (e.detail.entryId !== worryId) return;
      setDraft(e.detail.value);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    window.addEventListener("itc-chip-fill", onFill as EventListener);
    return () => window.removeEventListener("itc-chip-fill", onFill as EventListener);
  }, [worry?.id]);

  function commit() {
    setError(null);
    if (inflightRef.current) return;
    const text = draft.trim();
    if (text.length < 3) {
      setError("Add a few more words.");
      setDraft(savedRef.current);
      return;
    }
    if (text === savedRef.current.trim()) return;
    const priorSaved = savedRef.current;
    savedRef.current = text; // optimistic — dedupes concurrent commits
    inflightRef.current = true;
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("behavior_id", behavior.id);
    fd.set("text", text);
    startTransition(async () => {
      const res = await saveWorry(fd);
      inflightRef.current = false;
      if (!res.ok) {
        savedRef.current = priorSaved; // rollback
        setError(res.reason ?? "Could not save.");
        setDraft(priorSaved);
      }
    });
  }

  return (
    <li
      className={
        "rounded-md border border-[color:var(--color-border)] bg-black/20 px-4 py-3 " +
        (fresh ? "itc-fresh-row" : "")
      }
    >
      {thread.length > 0 && worry ? (
        <div className="mb-3">
          <EntryThread
            messages={thread}
            chipTarget="worry"
            entryId={worry.id}
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2 text-[color:var(--color-text-muted)]/80">
          <span className="text-sm shrink-0">{index}.</span>
          <span className="text-sm">{behavior.text}</span>
          <span className="text-[color:var(--color-text-muted)]/50">→</span>
        </div>
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
          rows={2}
          disabled={pending}
          placeholder="What are you afraid would happen if you stopped?"
          className={
            "w-full resize-none rounded-md px-3 py-2 text-base leading-relaxed transition-colors " +
            (focused
              ? "bg-black/30 border border-[color:var(--color-primary)]/60 outline-none"
              : "bg-transparent border border-[color:var(--color-border)] hover:bg-black/20 hover:border-[color:var(--color-text-muted)] cursor-text")
          }
        />
      </div>
      {pending ? (
        <p className="text-xs text-[color:var(--color-text-muted)] pl-6 mt-1">
          Saving…
        </p>
      ) : focused ? (
        <p className="text-xs text-[color:var(--color-text-muted)] pl-6 mt-1">
          Enter to save · Esc to cancel
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-[color:var(--color-danger)] pl-6 mt-1">
          {error}
        </p>
      ) : null}
    </li>
  );
}
