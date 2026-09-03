"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type {
  ItcAssumption,
  ItcAssumptionCommitment,
  ItcCommitment,
  ItcMessage,
} from "@/lib/itc/maps";
import { worryPassesDepth } from "@/lib/itc/rules";
import { ASSUMPTION_STEM } from "@/lib/itc/stage";
import {
  removeAssumption,
  saveAssumption,
} from "../actions";
import { AutoTextarea } from "./auto-textarea";
import { CoachFixBox } from "./coach-fix-box";
import { DepthBadge, depthBorderClass } from "./depth-badge";
import { EntryThread } from "./entry-thread";
import { InlineSpinner, SavingIndicator } from "./form-field";
import { useConfirm } from "@/components/ui/use-confirm";

const FRESH_ROW_MS = 15_000;
function isFresh(iso: string, nowMs: number): boolean {
  const then = new Date(iso).getTime();
  return Number.isFinite(then) && nowMs - then < FRESH_ROW_MS;
}

/**
 * Column 5 rows — Big Assumptions. Unlike worries/commitments this is
 * a many-to-many pairing: one assumption can underwrite multiple
 * commitments. Users add new assumptions via the AddAssumptionForm
 * at the bottom and edit existing ones inline. Commitment linkage is
 * a checkbox set per row.
 *
 * Every save re-runs the server rubric, increments attempts, and
 * fires a fresh coach reaction — same excavation-loop shape as C3
 * and C4.
 */
export function AssumptionsRow({
  mapId,
  assumptions,
  commitments,
  links,
  nowMs,
  threads,
  isLocked,
}: {
  mapId: string;
  assumptions: ItcAssumption[];
  commitments: ItcCommitment[];
  links: ItcAssumptionCommitment[];
  nowMs: number;
  /** Per-assumption coach reaction threads. Non-empty only on the
   *  assumptions stage. Rendered above each assumption's input. */
  threads: Map<string, ItcMessage[]>;
  /** True when the coachee hasn't advanced into assumptions yet. */
  isLocked: boolean;
}) {
  const linksByAssumption = new Map<string, string[]>();
  for (const l of links) {
    const arr = linksByAssumption.get(l.assumption_id) ?? [];
    arr.push(l.commitment_id);
    linksByAssumption.set(l.assumption_id, arr);
  }
  if (isLocked) {
    return (
      <p className="text-sm italic text-[color:var(--color-text-muted)]/70">
        Complete competing commitments first.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {assumptions.length === 0 ? (
        <p className="text-sm italic text-[color:var(--color-text-muted)]/70">
          None yet.
        </p>
      ) : (
        <ul className="space-y-3 text-base">
          {assumptions.map((a, i) => (
            <AssumptionItem
              key={a.id}
              mapId={mapId}
              assumption={a}
              index={i + 1}
              commitments={commitments}
              linkedCommitmentIds={linksByAssumption.get(a.id) ?? []}
              fresh={isFresh(a.created_at, nowMs)}
              thread={threads.get(a.id) ?? []}
            />
          ))}
        </ul>
      )}
      {commitments.length === 0 ? (
        <p className="text-sm italic text-[color:var(--color-text-muted)]/70 pt-1">
          Add competing commitments first.
        </p>
      ) : (
        <>
          {/*
            No prefilled opening here, deliberately. The guides' own
            Big Assumptions take several shapes and many are not
            if-then at all ("I assume that saying anything about my
            accomplishments is bragging", "My self-worth is based on
            how others view me"), and Vol 1 p 4 only asks that AT
            LEAST ONE be in if-then form. A prefix picks one shape for
            him and, when it is built from his own commitment, mostly
            hands back what he already wrote. The commitments are on
            screen above; the question under the box is the coach's
            job here, and the sentence is his.
          */}
          <AddAssumptionForm
            mapId={mapId}
            commitments={commitments}
            initiallyExpanded={assumptions.length === 0}
          />

        </>
      )}
    </div>
  );
}

/** What the empty box starts as. Trailing space so he types straight
 *  into the sentence. */
const SEED = `${ASSUMPTION_STEM} `;

function AddAssumptionForm({
  mapId,
  commitments,
  initiallyExpanded,
}: {
  mapId: string;
  commitments: ItcCommitment[];
  initiallyExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [pending, startTransition] = useTransition();
  // Seeded with the bare stem so he can see the sentence he is
  // writing. saveAssumption already prepends it (ensureStem), so
  // before this the stem appeared only after saving and a man who
  // typed "charging high prices makes me a fraud" had no idea what
  // it would become.
  //
  // This is a STEM, not the opening we removed. That one carried
  // content built from his own commitment ("I assume that if I
  // <act>, ") and men finished it by restating the worry one column
  // up. This carries none: it fixes the epistemic frame, which is
  // the whole point of Column 5 (a belief he holds, not a fact about
  // the world), and leaves every word of the belief to him.
  const [text, setText] = useState(SEED);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // When the form renders already open (the empty-column state), the
  // box can come up focused with the caret at 0, which would put
  // whatever he types in FRONT of the stem. Move it to the end, but
  // only if the box already has focus: calling focus() here would
  // steal it and scroll the column into view unasked.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (document.activeElement !== el) return;
    if (el.selectionStart === 0 && el.selectionEnd === 0) {
      el.setSelectionRange(el.value.length, el.value.length);
    }
    // Mount only. Later re-runs would fight the caret while he types.
  }, []);

  function toggleLink(id: string) {
    setLinkedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function submit() {
    setError(null);
    const trimmed = text.trim();
    // The stem on its own is not an assumption. Compare against the
    // stem rather than a bare length so "I assume that" alone can't
    // slip through on character count.
    const beyondStem = trimmed
      .toLowerCase()
      .startsWith(ASSUMPTION_STEM.toLowerCase())
      ? trimmed.slice(ASSUMPTION_STEM.length).trim()
      : trimmed;
    if (beyondStem.length < 3) {
      setError("Finish the sentence: what do you assume?");
      return;
    }
    if (linkedIds.length === 0) {
      setError("Link at least one competing commitment this assumption holds up.");
      return;
    }
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("text", trimmed);
    for (const id of linkedIds) fd.append("commitment_ids", id);
    startTransition(async () => {
      const res = await saveAssumption(fd);
      if (!res.ok) {
        setError(res.reason ?? "Could not add.");
        return;
      }
      setText(SEED);
      setLinkedIds([]);
      setExpanded(false);
    });
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => {
          setExpanded(true);
          setTimeout(() => {
            const el = inputRef.current;
            if (!el) return;
            el.focus();
            // Caret after the stem, not before it.
            el.setSelectionRange(el.value.length, el.value.length);
          }, 50);
        }}
        className="w-full rounded-md border border-dashed border-[color:var(--color-border)] px-4 py-3 text-sm text-[color:var(--color-text-muted)] hover:text-white hover:border-[color:var(--color-text-muted)] transition-colors text-left"
      >
        + Add another Big Assumption
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed border-[color:var(--color-border)] bg-black/10 p-3">
      <AutoTextarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        minRows={2}
        disabled={pending}
        placeholder={`${ASSUMPTION_STEM} …`}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (pending) return;
            submit();
          }
        }}
        className="w-full rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-base leading-relaxed"
      />
      {/*
        The guide's own question for this move (Vol 1 p 17): the Big
        Assumption is what has to be true for the vow to feel
        necessary. Stated under the box because the opening starts
        from the vow failing, and the half he writes is the cost.
      */}
      <p className="text-[11px] italic text-[color:var(--color-text-muted)]/70">
        For one of those vows to feel that necessary, what has to be true? That
        belief is what holds the whole thing in place.
      </p>
      <div className="flex flex-wrap gap-2">
        {commitments.map((c, i) => {
          const on = linkedIds.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggleLink(c.id)}
              disabled={pending}
              title={c.text}
              className={
                "rounded-full border px-3 py-1 text-xs " +
                (on
                  ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/20 text-white"
                  : "border-[color:var(--color-border)] bg-black/20 text-[color:var(--color-text-muted)] hover:text-white")
              }
            >
              holds up competing commitment #{i + 1}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          aria-busy={pending ? "true" : undefined}
          className="inline-flex items-center gap-2 rounded-md bg-[color:var(--color-primary)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {/* Saving an assumption runs the depth rubric and then the
              coach text, so this button waits on two model calls. A
              "…" gave no sign anything was happening; same spinner
              the CoachFixBox "Use this" button uses. The label stays
              put rather than swapping to "Adding…" so the button
              doesn't change width under the cursor. */}
          {pending ? <InlineSpinner className="h-3 w-3" /> : null}
          Add
        </button>
        {error ? (
          <p className="text-sm text-[color:var(--color-danger)]">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

function AssumptionItem({
  mapId,
  assumption,
  index,
  commitments,
  linkedCommitmentIds,
  fresh,
  thread,
}: {
  mapId: string;
  assumption: ItcAssumption;
  index: number;
  commitments: ItcCommitment[];
  linkedCommitmentIds: string[];
  fresh: boolean;
  thread: ItcMessage[];
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(assumption.text);
  const [linkDraft, setLinkDraft] = useState<string[]>(linkedCommitmentIds);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const savedRef = useRef({
    text: assumption.text,
    links: linkedCommitmentIds.slice().sort(),
  });
  const inflightRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const nextText = assumption.text;
    const nextLinks = linkedCommitmentIds.slice().sort();
    if (
      savedRef.current.text !== nextText ||
      savedRef.current.links.join(",") !== nextLinks.join(",")
    ) {
      savedRef.current = { text: nextText, links: nextLinks };
      setDraft(nextText);
      setLinkDraft(linkedCommitmentIds);
    }
  }, [assumption.text, linkedCommitmentIds]);

  useEffect(() => {
    const assumptionId = assumption.id;
    function onFill(ev: Event) {
      const e = ev as CustomEvent<{
        value: string;
        target?: string;
        entryId?: string;
      }>;
      if (!e.detail?.value) return;
      if (e.detail.target !== "assumption") return;
      if (e.detail.entryId !== assumptionId) return;
      setDraft(e.detail.value);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
    window.addEventListener("itc-chip-fill", onFill as EventListener);
    return () => window.removeEventListener("itc-chip-fill", onFill as EventListener);
  }, [assumption.id]);

  function commit() {
    save(draft, linkDraft);
  }

  /**
   * Save a specific text value with the current links. Used by the
   * coach box's "Use this" button (a tap on the rewrite is already
   * the user's intent; no extra Enter).
   */
  function saveText(nextText: string) {
    save(nextText, linkDraft);
  }

  /**
   * One save path for text and links. Links are passed explicitly
   * (not read from state) so a chip toggle can save the set it just
   * produced without waiting for a re-render or a blur.
   */
  function save(nextText: string, nextLinks: string[]) {
    setError(null);
    if (inflightRef.current) return;
    const text = nextText.trim();
    if (text.length < 3) {
      setError("Too short.");
      setDraft(savedRef.current.text);
      return;
    }
    const linksSorted = nextLinks.slice().sort();
    const textChanged = text !== savedRef.current.text.trim();
    const linksChanged = linksSorted.join(",") !== savedRef.current.links.join(",");
    if (!textChanged && !linksChanged) return;
    if (nextLinks.length === 0) {
      setError("Link at least one commitment.");
      setLinkDraft(savedRef.current.links);
      return;
    }
    const priorSaved = savedRef.current;
    savedRef.current = { text, links: linksSorted };
    setDraft(text);
    inflightRef.current = true;
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("assumption_id", assumption.id);
    fd.set("text", text);
    for (const id of nextLinks) fd.append("commitment_ids", id);
    startTransition(async () => {
      const res = await saveAssumption(fd);
      inflightRef.current = false;
      if (!res.ok) {
        savedRef.current = priorSaved;
        setError(res.reason ?? "Could not save.");
        setDraft(priorSaved.text);
        setLinkDraft(priorSaved.links);
      }
    });
  }

  /**
   * A chip tap IS the edit. Save on the tap, not on blur: on macOS
   * Safari/Firefox a button doesn't take focus on click, so a
   * blur-triggered save never fired and the toggle never persisted
   * (the "Drop #3 from it" fix in the coach box was impossible to
   * carry out).
   */
  function toggleLink(id: string) {
    const next = linkDraft.includes(id)
      ? linkDraft.filter((x) => x !== id)
      : [...linkDraft, id];
    setLinkDraft(next);
    save(draft, next);
  }

  async function submitRemove() {
    const ok = await confirm({
      title: `Remove assumption ${index}?`,
      body: `"${assumption.text}"`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("assumption_id", assumption.id);
    startTransition(async () => {
      const res = await removeAssumption(fd);
      if (!res.ok) setError(res.reason ?? "Could not remove.");
    });
  }

  // Flag assumptions that don't yet clear the advance-gate depth
  // rubric. Same helper computeAdvanceGate uses — mirroring it in
  // the UI lets the coachee see WHICH row is holding up "Continue"
  // instead of just seeing the count in the gate message.
  const needsMoreDepth = !worryPassesDepth(
    assumption.depth_score,
    assumption.attempts,
  );

  return (
    <li
      className={
        "rounded-md border bg-black/20 px-4 py-3 " +
        (needsMoreDepth
          ? depthBorderClass(assumption.depth_score)
          : "border-[color:var(--color-border)] ") +
        (fresh ? "itc-fresh-row" : "")
      }
    >
      {confirmDialog}
      {thread.length > 0 ? (
        <div className="mb-3">
          <EntryThread
            messages={thread}
            chipTarget="assumption"
            entryId={assumption.id}
          />
        </div>
      ) : null}
      <div className="flex items-start gap-3">
        <span className="mt-2 text-sm text-[color:var(--color-text-muted)] shrink-0">
          {index}.
        </span>
        {needsMoreDepth ? (
          <DepthBadge
            score={assumption.depth_score}
            column="assumption"
            className="mt-2"
          />
        ) : null}
        <div className="flex-1 min-w-0 space-y-2">
          {assumption.sharpen_text ? (
            <CoachFixBox
              text={assumption.sharpen_text}
              fix={assumption.suggested_fix}
              pending={pending}
              onUseFix={saveText}
            />
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
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                setDraft(savedRef.current.text);
                setLinkDraft(savedRef.current.links);
                e.currentTarget.blur();
              }
            }}
            minRows={2}
            disabled={pending}
            className={
              "w-full rounded-md px-3 py-2 text-base leading-relaxed transition-colors " +
              (focused
                ? "bg-black/30 border border-[color:var(--color-primary)]/60 outline-none"
                : "bg-transparent border border-[color:var(--color-border)] hover:bg-black/20 hover:border-[color:var(--color-text-muted)] cursor-text")
            }
          />
          <div className="flex flex-wrap gap-2">
            {commitments.map((c, i) => {
              const on = linkDraft.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleLink(c.id)}
                  disabled={pending}
                  title={c.text}
                  className={
                    "rounded-full border px-3 py-1 text-xs " +
                    (on
                      ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/20 text-white"
                      : "border-[color:var(--color-border)] bg-black/20 text-[color:var(--color-text-muted)] hover:text-white")
                  }
                >
                  #{i + 1}
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={submitRemove}
          disabled={pending}
          title="Remove assumption"
          className="mt-1 shrink-0 rounded px-2 py-1 text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger)] disabled:opacity-50"
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

