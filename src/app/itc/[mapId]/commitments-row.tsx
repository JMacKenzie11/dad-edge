"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ItcBehavior, ItcCommitment, ItcWorry } from "@/lib/itc/maps";
import { saveCommitment } from "../actions";

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
}: {
  mapId: string;
  behaviors: ItcBehavior[];
  worries: ItcWorry[];
  commitments: ItcCommitment[];
  nowMs: number;
}) {
  const behaviorById = new Map(behaviors.map((b) => [b.id, b]));
  const commitmentByWorryId = new Map(
    commitments.map((c) => [c.worry_id, c]),
  );

  if (worries.length === 0) {
    return (
      <p className="text-xs italic text-[color:var(--color-text-muted)]/70">
        Add worries first.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5 text-sm">
      {worries.map((w, i) => (
        <CommitmentItem
          key={w.id}
          mapId={mapId}
          worry={w}
          behaviorText={behaviorById.get(w.behavior_id)?.text ?? "(behavior)"}
          index={i + 1}
          commitment={commitmentByWorryId.get(w.id) ?? null}
          fresh={isFresh(commitmentByWorryId.get(w.id)?.created_at, nowMs)}
        />
      ))}
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
}: {
  mapId: string;
  worry: ItcWorry;
  behaviorText: string;
  index: number;
  commitment: ItcCommitment | null;
  fresh: boolean;
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
        "rounded-md border border-[color:var(--color-border)] bg-black/20 px-3 py-2 " +
        (fresh ? "itc-fresh-row" : "")
      }
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-2 text-[color:var(--color-text-muted)]/80">
          <span className="text-[11px] shrink-0">{index}.</span>
          <span className="text-[10px] text-[color:var(--color-text-muted)]/60">
            worry:
          </span>
          <span className="text-xs italic">{worry.text}</span>
        </div>
        <div className="flex items-baseline gap-2 text-[10px] text-[color:var(--color-text-muted)]/60 pl-5">
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
