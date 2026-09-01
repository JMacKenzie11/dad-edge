"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type {
  ItcBehavior,
  ItcCommitment,
  ItcMessage,
  ItcWorry,
} from "@/lib/itc/maps";
import { worryPassesDepth } from "@/lib/itc/rules";
import { saveCommitment } from "../actions";
import { AutoTextarea } from "./auto-textarea";
import { EntryThread } from "./entry-thread";
import { CoachFixBox } from "./coach-fix-box";
import { SavingIndicator } from "./form-field";

const FRESH_ROW_MS = 15_000;
function isFresh(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return false;
  const then = new Date(iso).getTime();
  return Number.isFinite(then) && nowMs - then < FRESH_ROW_MS;
}

/**
 * Column 4 rows — one commitment input per worry (1:1 pairing).
 *
 * Auto-derived: on advance into Column 4 the server drafts the
 * non-noble competing commitment for each worry and writes it
 * straight to commitment.text. Any worry edit thereafter re-derives
 * the paired commitment automatically (see saveWorry in actions.ts).
 * So by the time this component renders, every row already has real
 * text — no draft-and-accept step, no "Use this draft" button.
 *
 * The coachee still edits inline; every save re-runs the depth
 * rubric so the "one thing to sharpen" box reflects current text.
 */
export function CommitmentsRow({
  mapId,
  behaviors,
  worries,
  commitments,
  nowMs,
  threads,
  isLocked,
}: {
  mapId: string;
  behaviors: ItcBehavior[];
  worries: ItcWorry[];
  commitments: ItcCommitment[];
  nowMs: number;
  /** Per-commitment coach reaction threads. Non-empty only on the
   *  commitments stage. Rendered above each commitment's input. */
  threads: Map<string, ItcMessage[]>;
  /** True when the coachee hasn't advanced into commitments yet. */
  isLocked: boolean;
}) {
  const behaviorById = new Map(behaviors.map((b) => [b.id, b]));
  const commitmentByWorryId = new Map(
    commitments.map((c) => [c.worry_id, c]),
  );

  if (isLocked) {
    return (
      <p className="text-sm italic text-[color:var(--color-text-muted)]/70">
        Complete worries first.
      </p>
    );
  }

  if (worries.length === 0) {
    return (
      <p className="text-sm italic text-[color:var(--color-text-muted)]/70">
        Add worries first.
      </p>
    );
  }

  return (
    <div className="space-y-3">
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
    </div>
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
    saveText(draft);
  }

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
    savedRef.current = text;
    setDraft(text);
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

  // Flag rows whose commitment doesn't yet clear the advance-gate
  // depth rubric. computeAdvanceGate uses the same worryPassesDepth
  // helper — mirroring it in the UI lets the coachee see WHICH row
  // is holding up "Continue" without having to guess. The gate
  // message alone ("1 commitment needs more depth") gives the count
  // but never the identity.
  const needsMoreDepth =
    commitment !== null &&
    !worryPassesDepth(commitment.depth_score, commitment.attempts);

  return (
    <li
      className={
        "rounded-md border bg-black/20 px-4 py-3 " +
        (needsMoreDepth
          ? "border-[color:var(--color-danger)]/50 "
          : "border-[color:var(--color-border)] ") +
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
          {needsMoreDepth ? (
            <span
              className="ml-auto rounded-full border border-[color:var(--color-danger)]/60 bg-[color:var(--color-danger)]/[0.10] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[color:var(--color-danger)]"
              title="This commitment hasn't reached the depth needed to advance to Big Assumptions. Sharpen it (or wait for a second attempt to pass) to clear the gate."
            >
              Needs more depth
            </span>
          ) : null}
        </div>
        {commitment?.sharpen_text ? (
          <CoachFixBox
            text={commitment.sharpen_text}
            fix={commitment.suggested_fix}
            pending={pending}
            onUseFix={saveText}
          />
        ) : null}
        <div className="flex items-baseline gap-2 text-xs text-[color:var(--color-text-muted)]/70 pl-6">
          <span>behavior:</span>
          <span className="italic">{behaviorText}</span>
        </div>
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
          placeholder="I'm also committed to…"
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

