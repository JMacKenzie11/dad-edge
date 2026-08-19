"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type {
  ItcAssumption,
  ItcAssumptionCommitment,
  ItcCommitment,
  ItcMessage,
} from "@/lib/itc/maps";
import { removeAssumption, saveAssumption } from "../actions";
import { EntryThread } from "./entry-thread";

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
        Complete commitments first.
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
          Add commitments first.
        </p>
      ) : (
        <AddAssumptionForm
          mapId={mapId}
          commitments={commitments}
          initiallyExpanded={assumptions.length === 0}
        />
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
      setError("Link at least one commitment this assumption underwrites.");
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
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        disabled={pending}
        placeholder="If I…, then… — the belief underneath."
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (pending) return;
            submit();
          }
        }}
        className="w-full resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-base leading-relaxed"
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
              underwrites #{i + 1}
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

  function submitRemove() {
    if (!confirm(`Remove assumption #${index}: "${assumption.text}"?`)) return;
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("assumption_id", assumption.id);
    startTransition(async () => {
      const res = await removeAssumption(fd);
      if (!res.ok) setError(res.reason ?? "Could not remove.");
    });
  }

  return (
    <li
      className={
        "rounded-md border border-[color:var(--color-border)] bg-black/20 px-4 py-3 " +
        (fresh ? "itc-fresh-row" : "")
      }
    >
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
        <div className="flex-1 space-y-2">
          <textarea
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
            rows={2}
            disabled={pending}
            className={
              "w-full resize-none rounded-md px-3 py-2 text-base leading-relaxed transition-colors " +
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
        <p className="pl-6 text-xs text-[color:var(--color-text-muted)] mt-1">
          Saving…
        </p>
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
