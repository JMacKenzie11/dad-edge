"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ItcBehavior, ItcWorry } from "@/lib/itc/maps";
import { saveWorry } from "../actions";

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
}: {
  mapId: string;
  behaviors: ItcBehavior[];
  worries: ItcWorry[];
  nowMs: number;
}) {
  const selected = behaviors.filter((b) => b.selected);
  const worryByBehaviorId = new Map(worries.map((w) => [w.behavior_id, w]));

  if (selected.length === 0) {
    return (
      <p className="text-xs italic text-[color:var(--color-text-muted)]/70">
        Add at least one behavior first.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5 text-sm">
      {selected.map((b, i) => (
        <WorryItem
          key={b.id}
          mapId={mapId}
          behavior={b}
          index={i + 1}
          worry={worryByBehaviorId.get(b.id) ?? null}
          fresh={isFresh(worryByBehaviorId.get(b.id)?.created_at, nowMs)}
        />
      ))}
    </ul>
  );
}

function WorryItem({
  mapId,
  behavior,
  index,
  worry,
  fresh,
}: {
  mapId: string;
  behavior: ItcBehavior;
  index: number;
  worry: ItcWorry | null;
  fresh: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const initial = worry?.text ?? "";
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const savedRef = useRef(initial);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const next = worry?.text ?? "";
    if (savedRef.current !== next) {
      savedRef.current = next;
      setDraft(next);
    }
  }, [worry?.text]);

  function commit() {
    setError(null);
    const text = draft.trim();
    if (text.length < 3) {
      setError("Add a few more words.");
      setDraft(savedRef.current);
      return;
    }
    if (text === savedRef.current.trim()) return;
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("behavior_id", behavior.id);
    fd.set("text", text);
    startTransition(async () => {
      const res = await saveWorry(fd);
      if (!res.ok) {
        setError(res.reason ?? "Could not save.");
        setDraft(savedRef.current);
      } else {
        savedRef.current = text;
      }
    });
  }

  return (
    <li
      className={
        "rounded-md border border-[color:var(--color-border)] bg-black/20 px-3 py-2 " +
        (fresh ? "itc-fresh-row" : "")
      }
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2 text-[color:var(--color-text-muted)]/80">
          <span className="text-[11px] shrink-0">{index}.</span>
          <span className="text-xs">{behavior.text}</span>
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
            "w-full resize-none rounded-md px-2 py-1.5 text-sm transition-colors " +
            (focused
              ? "bg-black/30 border border-[color:var(--color-primary)]/60 outline-none"
              : "bg-transparent border border-transparent hover:bg-black/20 hover:border-[color:var(--color-border)] cursor-text")
          }
        />
      </div>
      {pending ? (
        <p className="text-[10px] text-[color:var(--color-text-muted)] pl-5 mt-0.5">
          Saving…
        </p>
      ) : focused ? (
        <p className="text-[10px] text-[color:var(--color-text-muted)] pl-5 mt-0.5">
          Enter to save · Esc to cancel
        </p>
      ) : null}
      {error ? (
        <p className="text-[11px] text-[color:var(--color-danger)] pl-5 mt-0.5">
          {error}
        </p>
      ) : null}
    </li>
  );
}
