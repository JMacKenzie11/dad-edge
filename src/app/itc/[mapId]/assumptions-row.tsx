"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type {
  ItcAssumption,
  ItcAssumptionCommitment,
  ItcAssumptionDraft,
  ItcCommitment,
  ItcMessage,
} from "@/lib/itc/maps";
import { worryPassesDepth } from "@/lib/itc/rules";
import {
  dismissAssumptionDraft,
  redriveAssumptionFromCommitment,
  removeAssumption,
  saveAssumption,
} from "../actions";
import { AutoTextarea } from "./auto-textarea";
import { EntryThread } from "./entry-thread";
import { InlineSpinner, SavingIndicator } from "./form-field";
import { RegenerateDraftsButton } from "./regenerate-drafts-button";
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
  drafts,
  nowMs,
  threads,
  isLocked,
}: {
  mapId: string;
  assumptions: ItcAssumption[];
  commitments: ItcCommitment[];
  links: ItcAssumptionCommitment[];
  /** Coach-drafted Big Assumptions offered as suggestion cards. Empty
   *  when the section is locked, when drafts have all been used or
   *  dismissed, or when the LLM produced nothing. */
  drafts: ItcAssumptionDraft[];
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
  const commitmentIndexById = new Map(commitments.map((c, i) => [c.id, i + 1]));

  return (
    <div className="space-y-3">
      {drafts.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-[color:var(--color-primary)]/80">
            Coach's drafts
          </p>
          {drafts.map((d) => (
            <DraftCard
              key={d.id}
              mapId={mapId}
              draft={d}
              commitmentIndexById={commitmentIndexById}
            />
          ))}
        </div>
      ) : null}
      {assumptions.length === 0 ? (
        <p className="text-sm italic text-[color:var(--color-text-muted)]/70">
          {drafts.length > 0
            ? "Review the drafts above, or write your own below."
            : "None yet."}
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
          <AddAssumptionForm
            mapId={mapId}
            commitments={commitments}
            initiallyExpanded={
              assumptions.length === 0 && drafts.length === 0
            }
          />
          {/*
            Single persistent regenerate affordance for the column.
            Renders in the same place regardless of whether drafts or
            accepted assumptions exist — during honing (after
            behaviors / worries / commitments have shifted) the
            coachee needs to be able to ask for fresh drafts against
            the new map state. Backing action bypasses the "existing
            assumptions" guard, so accepted assumption rows stay
            untouched while a new draft set gets written.
          */}
          <div className="pt-1">
            <RegenerateDraftsButton mapId={mapId} kind="assumptions" />
          </div>
        </>
      )}
    </div>
  );
}

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
  const [text, setText] = useState("");
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function toggleLink(id: string) {
    setLinkedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function submit() {
    setError(null);
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      setError("Type an assumption first.");
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
      if (!res.ok) setError(res.reason ?? "Could not add.");
      else {
        setText("");
        setLinkedIds([]);
        setExpanded(false);
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
        placeholder="I assume that if I…, then…"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (pending) return;
            submit();
          }
        }}
        className="w-full rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-base leading-relaxed"
      />
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
          className="rounded-md bg-[color:var(--color-primary)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {pending ? "…" : "Add"}
        </button>
        {error ? (
          <p className="text-sm text-[color:var(--color-danger)]">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A single coach-drafted Big Assumption. Two buttons: "Use this draft"
 * promotes it to a real itc_assumptions row (with the same commitment
 * links the coach proposed) and dismisses the draft; "Dismiss" just
 * deletes it. The card disappears via revalidation after either.
 */
function DraftCard({
  mapId,
  draft,
  commitmentIndexById,
}: {
  mapId: string;
  draft: ItcAssumptionDraft;
  commitmentIndexById: Map<string, number>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function useDraft() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("map_id", mapId);
      fd.set("text", draft.text);
      for (const cid of draft.commitment_ids) fd.append("commitment_ids", cid);
      const res = await saveAssumption(fd);
      if (!res.ok) {
        setError(res.reason ?? "Could not use draft.");
        return;
      }
      const dfd = new FormData();
      dfd.set("map_id", mapId);
      dfd.set("draft_id", draft.id);
      // Best-effort — even if this fails, the draft will be filtered
      // out on next render once the user reviews the promoted row.
      await dismissAssumptionDraft(dfd);
    });
  }

  function dismiss() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("map_id", mapId);
      fd.set("draft_id", draft.id);
      const res = await dismissAssumptionDraft(fd);
      if (!res.ok) setError(res.reason ?? "Could not dismiss.");
    });
  }

  const coverageLabels = draft.commitment_ids
    .map((cid) => commitmentIndexById.get(cid))
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => a - b);

  return (
    <div className="rounded-md border border-[color:var(--color-primary)]/30 bg-[color:var(--color-primary)]/[0.06] px-4 py-3 space-y-2">
      <div className="text-sm italic text-white/90 leading-relaxed">
        {draft.text}
      </div>
      {coverageLabels.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 text-xs text-[color:var(--color-text-muted)]">
          <span className="uppercase tracking-widest opacity-70">
            holds up competing commitment{coverageLabels.length === 1 ? "" : "s"}
          </span>
          {coverageLabels.map((n) => (
            <span
              key={n}
              className="rounded-full border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/10 px-2 py-0.5 text-white"
            >
              #{n}
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={pending}
          onClick={useDraft}
          aria-busy={pending ? "true" : undefined}
          className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          {pending ? <InlineSpinner className="h-3 w-3" /> : null}
          Use this draft
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={dismiss}
          className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-text-muted)] hover:text-white disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
      {error ? (
        <p className="text-sm text-[color:var(--color-danger)]">{error}</p>
      ) : null}
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
    setError(null);
    if (inflightRef.current) return;
    const text = draft.trim();
    if (text.length < 3) {
      setError("Too short.");
      setDraft(savedRef.current.text);
      return;
    }
    const linksSorted = linkDraft.slice().sort();
    const textChanged = text !== savedRef.current.text.trim();
    const linksChanged = linksSorted.join(",") !== savedRef.current.links.join(",");
    if (!textChanged && !linksChanged) return;
    if (linkDraft.length === 0) {
      setError("Link at least one commitment.");
      return;
    }
    const priorSaved = savedRef.current;
    savedRef.current = { text, links: linksSorted };
    inflightRef.current = true;
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("assumption_id", assumption.id);
    fd.set("text", text);
    for (const id of linkDraft) fd.append("commitment_ids", id);
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

  function toggleLink(id: string) {
    setLinkDraft((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
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

  const assumptionUpdatedMs = new Date(assumption.updated_at).getTime();
  const upstreamMoved = commitments
    .filter((c) => linkedCommitmentIds.includes(c.id))
    .some((c) => new Date(c.updated_at).getTime() > assumptionUpdatedMs + 1_000);

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
          <span
            className="mt-2 rounded-full border border-[color:var(--color-danger)]/60 bg-[color:var(--color-danger)]/[0.10] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[color:var(--color-danger)] shrink-0"
            title="This assumption hasn't reached the depth needed to advance. Sharpen it (or wait for a second attempt to pass) to clear the gate."
          >
            Needs more depth
          </span>
        ) : null}
        <div className="flex-1 min-w-0 space-y-2">
          {upstreamMoved ? (
            <StaleUpstreamBanner
              mapId={mapId}
              assumptionId={assumption.id}
              upstreamLabel="commitment"
            />
          ) : null}
          {assumption.rubric_reason ? (
            // Boxed coach-message treatment mirroring EntryThread —
            // danger tint (red) so "you need to change this" reads
            // unambiguously. Sits inside the flex-1 content column so
            // it wraps cleanly and doesn't push the row layout.
            <div className="min-w-0 rounded-md border border-[color:var(--color-danger)]/30 border-l-[3px] border-l-[color:var(--color-danger)]/70 bg-[color:var(--color-danger)]/[0.08] px-3 py-2 text-sm leading-relaxed">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--color-danger)]/90">
                One thing to sharpen
              </div>
              <div className="whitespace-pre-wrap break-words text-white/90">
                {assumption.rubric_reason}
              </div>
            </div>
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
                  onClick={() => {
                    toggleLink(c.id);
                  }}
                  onBlur={() => commit()}
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

function StaleUpstreamBanner({
  mapId,
  assumptionId,
  upstreamLabel,
}: {
  mapId: string;
  assumptionId: string;
  upstreamLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="rounded-md border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/[0.08] px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[color:var(--color-warning)]">
          A linked {upstreamLabel} changed since you wrote this. Re-derive?
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            const fd = new FormData();
            fd.set("map_id", mapId);
            fd.set("assumption_id", assumptionId);
            startTransition(async () => {
              const res = await redriveAssumptionFromCommitment(fd);
              if (!res.ok) setError(res.reason ?? "Could not re-derive.");
            });
          }}
          className="shrink-0 rounded-md border border-[color:var(--color-warning)]/60 px-2 py-1 text-[10px] font-heading tracking-widest text-[color:var(--color-warning)] hover:bg-[color:var(--color-warning)]/10 disabled:opacity-50"
        >
          {pending ? "…" : "RE-DERIVE"}
        </button>
      </div>
      {error ? (
        <p className="mt-1 text-[color:var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}
