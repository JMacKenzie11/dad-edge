"use client";

import { useState, useTransition } from "react";
import type { ItcBehavior } from "@/lib/itc/maps";
import type { ItcStage } from "@/lib/itc/stage";
import {
  addBehavior,
  advanceMapStage,
  refineBehavior,
  removeBehavior,
} from "../actions";

const MAX_BEHAVIORS = 5;
const FRESH_ROW_MS = 15_000;

function isFresh(iso: string, nowMs: number): boolean {
  const then = new Date(iso).getTime();
  return Number.isFinite(then) && nowMs - then < FRESH_ROW_MS;
}

/**
 * Column 2 — Doing / Not-Doing behaviors.
 *
 * Coach-as-advisor variant: the coach helps the coachee arrive at
 * sharp behaviors in prose ("that's a real column-2 behavior — add
 * it"). All state changes happen HERE via Add / Refine / Remove
 * controls per row plus the "Next column" advance button.
 *
 * Cap at 5 selected behaviors — beyond that the worry-box pairing
 * goes shallow. When the count hits 5, the add input hides and the
 * coach's job in prose is to help him consolidate.
 */
export function BehaviorsColumn({
  mapId,
  currentStage,
  behaviors,
}: {
  mapId: string;
  currentStage: ItcStage;
  behaviors: ItcBehavior[];
}) {
  const nowMs = Date.now();
  const selected = behaviors.filter((b) => b.selected);
  const onBehaviorsStage = currentStage === "behaviors";
  const capReached = selected.length >= MAX_BEHAVIORS;

  // Read-only rendering for downstream stages (worries onward). Same
  // shape as the pre-refactor map panel had.
  if (!onBehaviorsStage) {
    if (selected.length === 0) {
      return (
        <p className="text-xs italic text-[color:var(--color-muted)]/70">
          None yet.
        </p>
      );
    }
    return (
      <ul className="space-y-1.5 text-sm">
        {selected.map((b) => (
          <li
            key={b.id}
            className={
              "rounded-md border border-[color:var(--color-border)] bg-black/20 px-2 py-1.5" +
              (isFresh(b.created_at, nowMs) ? " itc-fresh-row" : "")
            }
          >
            {b.text}
          </li>
        ))}
      </ul>
    );
  }

  // On the behaviors stage: interactive controls.
  return (
    <div className="space-y-2">
      {selected.length === 0 ? (
        <p className="text-xs italic text-[color:var(--color-muted)]/70">
          None yet.
        </p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {selected.map((b, i) => (
            <BehaviorRow
              key={b.id}
              mapId={mapId}
              behavior={b}
              index={i + 1}
              fresh={isFresh(b.created_at, nowMs)}
            />
          ))}
        </ul>
      )}

      {capReached ? (
        <p className="text-[11px] italic text-[color:var(--color-muted)]/80 pt-1">
          Cap reached (5). Refine or remove one to add another.
        </p>
      ) : (
        <AddBehaviorForm mapId={mapId} />
      )}

      <AdvanceRow mapId={mapId} disabled={selected.length === 0} />
    </div>
  );
}

function BehaviorRow({
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
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(behavior.text);

  function submitRefine() {
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
      if (!res.ok) setError(res.reason ?? "Could not refine.");
      else setEditing(false);
    });
  }

  function submitRemove() {
    setError(null);
    if (!confirm(`Remove behavior #${index}?`)) return;
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
        "rounded-md border border-[color:var(--color-border)] bg-black/20 px-2 py-1.5" +
        (fresh ? " itc-fresh-row" : "")
      }
    >
      {editing ? (
        <div className="space-y-1.5">
          <div className="flex items-start gap-2">
            <span className="mt-1 text-[11px] text-[color:var(--color-muted)]">
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
          <div className="flex flex-wrap items-center gap-1.5 pl-4">
            <button
              type="button"
              onClick={submitRefine}
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
          <span className="mt-0.5 text-[11px] text-[color:var(--color-muted)]">
            {index}.
          </span>
          <span className="flex-1">{behavior.text}</span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={pending}
              className="rounded px-1.5 py-0.5 text-[10px] text-[color:var(--color-muted)] hover:text-white disabled:opacity-50"
            >
              Refine
            </button>
            <button
              type="button"
              onClick={submitRemove}
              disabled={pending}
              className="rounded px-1.5 py-0.5 text-[10px] text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)] disabled:opacity-50"
            >
              Remove
            </button>
          </span>
        </div>
      )}
      {error ? (
        <p className="mt-1 pl-4 text-[11px] text-[color:var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function AddBehaviorForm({ mapId }: { mapId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");

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

  return (
    <div className="space-y-1.5">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        disabled={pending}
        placeholder="Add a behavior…"
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing
          ) {
            e.preventDefault();
            if (pending) return;
            submit();
          }
        }}
        className="w-full resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-2 py-1 text-sm"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="w-full rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
      >
        {pending ? "…" : "Add"}
      </button>
      {error ? (
        <p className="text-[11px] text-[color:var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}

function AdvanceRow({ mapId, disabled }: { mapId: string; disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("to", "worries");
    startTransition(async () => {
      const res = await advanceMapStage(fd);
      if (!res.ok) setError(res.reason ?? "Could not advance.");
    });
  }

  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={submit}
        disabled={pending || disabled}
        title={
          disabled ? "Add at least one behavior first." : "Advance to worries"
        }
        className="rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-xs font-semibold disabled:opacity-30"
      >
        {pending ? "…" : "Next column →"}
      </button>
      {error ? (
        <p className="mt-1 text-[11px] text-[color:var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
