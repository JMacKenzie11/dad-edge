"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ItcBehavior, ItcMessage } from "@/lib/itc/maps";
import { worryPassesDepth } from "@/lib/itc/rules";
import {
  addBehavior,
  removeBehavior,
  requestSuggestions,
  updateBehavior,
} from "../actions";
import { AutoTextarea } from "./auto-textarea";
import { EntryThread } from "./entry-thread";
import { SavingIndicator } from "./form-field";
import { useConfirm } from "./use-confirm";

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
  behaviorIdsWithWorries,
  nowMs,
  threads,
  isLocked,
}: {
  mapId: string;
  behaviors: ItcBehavior[];
  /** Set of behavior ids that have a worry attached (Column 3).
   *  Passed from the parent so BehaviorItem can disable Remove with
   *  a coaching-voice tooltip before the coachee tries it and hits
   *  a server-side rejection. */
  behaviorIdsWithWorries: Set<string>;
  nowMs: number;
  /** Per-behavior coach reaction threads. Non-empty only when
   *  the behaviors stage is currently active. Rendered above
   *  each item's input so read-then-edit stays adjacent. */
  threads: Map<string, ItcMessage[]>;
  /** True when the coachee hasn't advanced into this column yet.
   *  Locked columns show a placeholder and hide all edit affordances
   *  so the user can't jump ahead. */
  isLocked: boolean;
}) {
  const selected = behaviors.filter((b) => b.selected);
  const capReached = selected.length >= MAX_BEHAVIORS;
  if (isLocked) {
    return (
      <p className="text-sm italic text-[color:var(--color-text-muted)]/70">
        Complete the goal first.
      </p>
    );
  }
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
              hasWorry={behaviorIdsWithWorries.has(b.id)}
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
  // Once suggestions have been requested this session, keep the
  // "Give me ideas" button disabled. Observed failure: coachees click
  // it multiple times and end up with stacked overlapping suggestion
  // cards. Reset on page reload (mount) — an explicit refresh is the
  // signal that they actually want a fresh set.
  const [hasAsked, setHasAsked] = useState(false);
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
    setHasAsked(true);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("kind", "behavior");
    startTransition(async () => {
      const res = await requestSuggestions(fd);
      if (!res.ok) {
        setError(res.reason ?? "Could not fetch suggestions.");
        // Roll back the "asked" latch on failure — if the request
        // didn't produce suggestions, the user should be able to try
        // again without a page refresh.
        setHasAsked(false);
      }
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
      <AutoTextarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        minRows={2}
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
        className="w-full rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-base leading-relaxed"
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
          disabled={pending || hasAsked}
          className="ml-auto rounded-md border border-[color:var(--color-border)] px-4 py-2 text-sm text-[color:var(--color-text-muted)] hover:text-white disabled:opacity-50"
          title={
            hasAsked
              ? "Suggestions already offered — refresh the page for a fresh set."
              : "Ask the coach for options"
          }
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
  hasWorry,
  fresh,
  thread,
}: {
  mapId: string;
  behavior: ItcBehavior;
  index: number;
  /** True if this behavior has a worry attached (Column 3). When
   *  true, Remove is disabled with a tooltip explaining the
   *  constraint — better UX than letting the coachee click and hit
   *  a raw server-side rejection. */
  hasWorry: boolean;
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
  const [confirmDialog, confirm] = useConfirm();

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

  async function submitRemove() {
    const ok = await confirm({
      title: `Remove behavior ${index}?`,
      body: `"${behavior.text}"\n\nAny worry attached to this behavior will need to be cleared first.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("behavior_id", behavior.id);
    startTransition(async () => {
      const res = await removeBehavior(fd);
      if (!res.ok) setError(res.reason ?? "Could not remove.");
    });
  }

  // Flag behaviors that don't yet clear the advance-gate depth
  // rubric. Same helper computeAdvanceGate uses — mirroring it in
  // the UI lets the coachee see WHICH row is holding up "Continue"
  // instead of just seeing the count in the gate message.
  const needsMoreDepth = !worryPassesDepth(
    behavior.depth_score,
    behavior.attempts,
  );

  return (
    <li
      className={
        "rounded-md border bg-black/20 px-3 py-2 " +
        (needsMoreDepth
          ? "border-[color:var(--color-danger)]/50 "
          : "border-[color:var(--color-border)] ") +
        (fresh ? "itc-fresh-row" : "")
      }
    >
      {confirmDialog}
      {thread.length > 0 ? (
        <div className="mb-2">
          <EntryThread
            messages={thread}
            chipTarget="behavior"
            entryId={behavior.id}
          />
        </div>
      ) : null}
      {needsMoreDepth && behavior.rubric_reason ? (
        // Boxed coach-message treatment mirroring worries/commitments/
        // assumptions — danger tint so "you need to change this"
        // reads unambiguously, not the softer warning amber.
        <div className="mb-2 min-w-0 rounded-md border border-[color:var(--color-danger)]/30 border-l-[3px] border-l-[color:var(--color-danger)]/70 bg-[color:var(--color-danger)]/[0.08] px-3 py-2 text-sm leading-relaxed">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--color-danger)]/90">
            One thing to sharpen
          </div>
          <div className="whitespace-pre-wrap break-words text-white/90">
            {behavior.rubric_reason}
          </div>
        </div>
      ) : null}
      <div className="flex items-start gap-3">
        <span className="mt-2 text-sm text-[color:var(--color-text-muted)] shrink-0">
          {index}.
        </span>
        {needsMoreDepth ? (
          <span
            className="mt-2 rounded-full border border-[color:var(--color-danger)]/60 bg-[color:var(--color-danger)]/[0.10] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[color:var(--color-danger)] shrink-0"
            title="This behavior hasn't reached the depth needed to advance. Sharpen it (or wait for a second attempt to pass) to clear the gate."
          >
            Needs more depth
          </span>
        ) : null}
        <AutoTextarea
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
          minRows={1}
          disabled={pending}
          className={
            "flex-1 rounded-md px-3 py-2 text-base leading-relaxed transition-colors " +
            (focused
              ? "bg-black/30 border border-[color:var(--color-primary)]/60 outline-none"
              : "bg-transparent border border-[color:var(--color-border)] hover:bg-black/20 hover:border-[color:var(--color-text-muted)] cursor-text")
          }
        />
        <button
          type="button"
          onClick={submitRemove}
          disabled={pending || hasWorry}
          title={
            hasWorry
              ? "You wrote a worry paired to this behavior. Clear the worry first, then you can remove the behavior."
              : "Remove behavior"
          }
          className="mt-1 shrink-0 rounded px-2 py-1 text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[color:var(--color-text-muted)]"
        >
          Remove
        </button>
      </div>
      {pending ? (
        <div className="pl-6 mt-1">
          <SavingIndicator pending={pending} />
        </div>
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
