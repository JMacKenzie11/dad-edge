"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type {
  ItcBehavior,
  ItcCommitment,
  ItcMessage,
  ItcWorry,
} from "@/lib/itc/maps";
import { saveCommitment } from "../actions";
import { EntryThread } from "./entry-thread";

const FRESH_ROW_MS = 15_000;
function isFresh(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return false;
  const then = new Date(iso).getTime();
  return Number.isFinite(then) && nowMs - then < FRESH_ROW_MS;
}

/**
 * Column 4 rows — one commitment input per worry (1:1 pairing).
 * Excavation-loop mirror of worries-row: every save re-runs the
 * server rubric, increments attempts, and triggers a fresh coach
 * reaction. The rubric here pushes back on noble-sounding
 * productivity-blog commitments and requires the self-protective
 * form ("I'm committed to never having to find out...").
 */
export function CommitmentsRow({
  mapId,
  behaviors,
  worries,
  commitments,
  nowMs,
  threads,
}: {
  mapId: string;
  behaviors: ItcBehavior[];
  worries: ItcWorry[];
  commitments: ItcCommitment[];
  nowMs: number;
  /** Per-commitment coach reaction threads. Non-empty only on the
   *  commitments stage. Rendered above each commitment's input. */
  threads: Map<string, ItcMessage[]>;
}) {
  const behaviorById = new Map(behaviors.map((b) => [b.id, b]));
  const commitmentByWorryId = new Map(
    commitments.map((c) => [c.worry_id, c]),
  );

  if (worries.length === 0) {
    return (
      <p className="text-sm italic text-[color:var(--color-text-muted)]/70">
        Add worries first.
      </p>
    );
  }

  return (
    <ul className="space-y-3 text-base">
      {worries.map((w, i) => {
        const c = commitmentByWorryId.get(w.id) ?? null;
        return (
          <CommitmentItem
            key={w.id}
            mapId={mapId}
            worry={w}
            behaviorText={behaviorById.get(w.behavior_id)?.text ?? "(behavior)"}
            index={i + 1}
            commitment={c}
            fresh={isFresh(c?.created_at, nowMs)}
            thread={c ? threads.get(c.id) ?? [] : []}
          />
        );
      })}
    </ul>
  );
}

function CommitmentItem({
  mapId,
  worry,
  behaviorText,
  index,
  commitment,
  fresh,
  thread,
}: {
  mapId: string;
  worry: ItcWorry;
  behaviorText: string;
  index: number;
  commitment: ItcCommitment | null;
  fresh: boolean;
  thread: ItcMessage[];
}) {
  const [pending, startTransition] = useTransition();
  const initial = commitment?.text ?? "";
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const savedRef = useRef(initial);
  const inflightRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const next = commitment?.text ?? "";
    if (savedRef.current !== next) {
      savedRef.current = next;
      setDraft(next);
    }
  }, [commitment?.text]);

  useEffect(() => {
    if (!commitment) return;
    const commitmentId = commitment.id;
    function onFill(ev: Event) {
      const e = ev as CustomEvent<{
        value: string;
        target?: string;
        entryId?: string;
      }>;
      if (!e.detail?.value) return;
      if (e.detail.target !== "commitment") return;
      if (e.detail.entryId !== commitmentId) return;
      setDraft(e.detail.value);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    window.addEventListener("itc-chip-fill", onFill as EventListener);
    return () => window.removeEventListener("itc-chip-fill", onFill as EventListener);
  }, [commitment?.id]);

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
    savedRef.current = text;
    inflightRef.current = true;
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("worry_id", worry.id);
    fd.set("text", text);
    startTransition(async () => {
      const res = await saveCommitment(fd);
      inflightRef.current = false;
      if (!res.ok) {
        savedRef.current = priorSaved;
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
      {thread.length > 0 && commitment ? (
        <div className="mb-3">
          <EntryThread
            messages={thread}
            chipTarget="commitment"
            entryId={commitment.id}
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-2 text-[color:var(--color-text-muted)]/80">
          <span className="text-sm shrink-0">{index}.</span>
          <span className="text-xs text-[color:var(--color-text-muted)]/70">
            worry:
          </span>
          <span className="text-sm italic">{worry.text}</span>
        </div>
        <div className="flex items-baseline gap-2 text-xs text-[color:var(--color-text-muted)]/70 pl-6">
          <span>behavior:</span>
          <span className="italic">{behaviorText}</span>
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
          placeholder="I'm committed to never…"
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
