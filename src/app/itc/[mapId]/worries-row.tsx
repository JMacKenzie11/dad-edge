"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ItcBehavior, ItcMessage, ItcWorry } from "@/lib/itc/maps";
import { worryPassesDepth } from "@/lib/itc/rules";
import { saveWorry } from "../actions";
import { AutoTextarea } from "./auto-textarea";
import { EntryThread } from "./entry-thread";
import { SavingIndicator } from "./form-field";
import { RegenerateDraftsButton } from "./regenerate-drafts-button";

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
  isLocked,
}: {
  mapId: string;
  behaviors: ItcBehavior[];
  worries: ItcWorry[];
  nowMs: number;
  /** Per-worry coach reaction threads. Non-empty only on the worries
   *  stage. Rendered above each worry's input. */
  threads: Map<string, ItcMessage[]>;
  /** True when the coachee hasn't advanced into worries yet. */
  isLocked: boolean;
}) {
  const selected = behaviors.filter((b) => b.selected);
  const worryByBehaviorId = new Map(worries.map((w) => [w.behavior_id, w]));

  if (isLocked) {
    return (
      <p className="text-sm italic text-[color:var(--color-text-muted)]/70">
        Complete behaviors first.
      </p>
    );
  }

  if (selected.length === 0) {
    return (
      <p className="text-sm italic text-[color:var(--color-text-muted)]/70">
        Add at least one behavior first.
      </p>
    );
  }

  // Show the regenerate-drafts button when there's at least one
  // behavior with a coach draft AND no accepted worry on it yet.
  // Same conditional as commitments/assumptions rows.
  const hasRegeneratableDrafts = selected.some(
    (b) =>
      Boolean(b.coach_worry_draft) && !worryByBehaviorId.has(b.id),
  );

  return (
    <div className="space-y-3">
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
      {hasRegeneratableDrafts ? (
        <div className="pt-1">
          <RegenerateDraftsButton mapId={mapId} kind="worries" />
        </div>
      ) : null}
    </div>
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
    saveText(draft);
  }

  /**
   * Save a specific text value directly, bypassing the draft state.
   * Used by the "Use this draft" button so a click on the coach's
   * draft card auto-saves — clicking is already the user's explicit
   * intent, an extra Enter step is friction with no upside.
   */
  function saveText(nextText: string) {
    setError(null);
    if (inflightRef.current) return;
    const text = nextText.trim();
    if (text.length < 3) {
      setError("Add a few more words.");
      setDraft(savedRef.current);
      return;
    }
    if (text === savedRef.current.trim()) return;
    const priorSaved = savedRef.current;
    savedRef.current = text; // optimistic — dedupes concurrent commits
    setDraft(text);
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

  // Flag rows whose worry doesn't yet clear the advance-gate depth
  // rubric. Same helper computeAdvanceGate uses — mirroring it in
  // the UI lets the coachee see WHICH row is holding up "Continue"
  // instead of just seeing the count in the gate message.
  const needsMoreDepth =
    worry !== null && !worryPassesDepth(worry.depth_score, worry.attempts);

  return (
    <li
      className={
        "rounded-md border bg-black/20 px-4 py-3 " +
        (needsMoreDepth
          ? "border-[color:var(--color-warning)]/50 "
          : "border-[color:var(--color-border)] ") +
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
        <div className="flex flex-wrap items-baseline gap-2 text-[color:var(--color-text-muted)]/80">
          <span className="text-sm shrink-0">{index}.</span>
          <span className="text-sm">{behavior.text}</span>
          <span className="text-[color:var(--color-text-muted)]/50">→</span>
          {needsMoreDepth ? (
            <span
              className="ml-auto rounded-full border border-[color:var(--color-warning)]/60 bg-[color:var(--color-warning)]/[0.10] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[color:var(--color-warning)]"
              title="This worry hasn't reached the depth needed to advance. Sharpen it (or wait for a second attempt to pass) to clear the gate."
            >
              Needs more depth
            </span>
          ) : null}
        </div>
        {needsMoreDepth && worry?.rubric_reason ? (
          // Boxed coach-message treatment mirroring EntryThread —
          // warning tint instead of primary.
          <div className="min-w-0 rounded-md border border-[color:var(--color-warning)]/30 border-l-[3px] border-l-[color:var(--color-warning)]/70 bg-[color:var(--color-warning)]/[0.08] px-3 py-2 text-sm leading-relaxed">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--color-warning)]/90">
              Coach's read
            </div>
            <div className="whitespace-pre-wrap break-words text-white/90">
              {worry.rubric_reason}
            </div>
          </div>
        ) : null}
        {!worry && behavior.coach_worry_draft ? (
          <div className="rounded-md border border-[color:var(--color-primary)]/30 bg-[color:var(--color-primary)]/[0.06] px-3 py-2 space-y-2">
            <div className="text-xs uppercase tracking-widest text-[color:var(--color-primary)]/80">
              Coach's draft
            </div>
            <div className="text-sm italic text-white/90 leading-relaxed">
              {behavior.coach_worry_draft}
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => saveText(behavior.coach_worry_draft ?? "")}
              className="rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              Use this draft
            </button>
          </div>
        ) : null}
        <AutoTextarea
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
          minRows={2}
          disabled={pending}
          placeholder="I worry that if I…"
          className={
            "w-full rounded-md px-3 py-2 text-base leading-relaxed transition-colors " +
            (focused
              ? "bg-black/30 border border-[color:var(--color-primary)]/60 outline-none"
              : "bg-transparent border border-[color:var(--color-border)] hover:bg-black/20 hover:border-[color:var(--color-text-muted)] cursor-text")
          }
        />
      </div>
      {pending ? (
        <div className="pl-6 mt-1">
          <SavingIndicator pending={pending} />
        </div>
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
