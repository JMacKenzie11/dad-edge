"use client";

import { useState, useTransition } from "react";
import type { ItcBehavior } from "@/lib/itc/maps";
import { refineBehavior, removeBehavior } from "../actions";

const FRESH_ROW_MS = 15_000;
function isFresh(iso: string, nowMs: number): boolean {
  const then = new Date(iso).getTime();
  return Number.isFinite(then) && nowMs - then < FRESH_ROW_MS;
}

/**
 * Column 2 row — read-only list with per-row edit + remove icons for
 * quick fixes. New behaviors, refinements, and removals normally come
 * through coach-fired proposal cards; these icons let the coachee
 * correct a typo or drop a duplicate without going through the coach.
 */
export function BehaviorsRow({
  mapId,
  behaviors,
  nowMs,
}: {
  mapId: string;
  behaviors: ItcBehavior[];
  nowMs: number;
}) {
  const selected = behaviors.filter((b) => b.selected);
  if (selected.length === 0) {
    return (
      <p className="text-xs italic text-[color:var(--color-text-muted)]/70">
        None yet.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {selected.map((b, i) => (
        <BehaviorItem
          key={b.id}
          mapId={mapId}
          behavior={b}
          index={i + 1}
          fresh={isFresh(b.created_at, nowMs)}
        />
      ))}
    </ul>
  );
}

function BehaviorItem({
  mapId,
  behavior,
  index,
  fresh,
}: {
  mapId: string;
  behavior: ItcBehavior;
  index: number;
  fresh: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(behavior.text);
  const [error, setError] = useState<string | null>(null);

  function submitEdit() {
    setError(null);
    const text = draft.trim();
    if (text.length < 3) {
      setError("Too short.");
      return;
    }
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("behavior_id", behavior.id);
    fd.set("text", text);
    startTransition(async () => {
      const res = await refineBehavior(fd);
      if (!res.ok) setError(res.reason ?? "Could not save.");
      else setEditing(false);
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
      {editing ? (
        <div className="space-y-1.5">
          <div className="flex items-start gap-2">
            <span className="mt-1 text-[11px] text-[color:var(--color-text-muted)] shrink-0">
              {index}.
            </span>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              disabled={pending}
              className="flex-1 resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-2 py-1 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pl-5">
            <button
              type="button"
              onClick={submitEdit}
              disabled={pending}
              className="rounded-md bg-[color:var(--color-primary)] px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
            >
              {pending ? "…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(behavior.text);
                setError(null);
              }}
              disabled={pending}
              className="rounded-md border border-[color:var(--color-border)] px-2.5 py-1 text-[11px] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-[11px] text-[color:var(--color-text-muted)] shrink-0">
            {index}.
          </span>
          <span className="flex-1">{behavior.text}</span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={pending}
              title="Edit behavior"
              className="rounded px-1.5 py-0.5 text-[10px] text-[color:var(--color-text-muted)] hover:text-white disabled:opacity-50"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={submitRemove}
              disabled={pending}
              title="Remove behavior"
              className="rounded px-1.5 py-0.5 text-[10px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger)] disabled:opacity-50"
            >
              Remove
            </button>
          </span>
        </div>
      )}
      {error ? (
        <p className="mt-1 pl-5 text-[11px] text-[color:var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </li>
  );
}
