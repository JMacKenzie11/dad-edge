"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ItcMessage } from "@/lib/itc/maps";
import { postThreadReply } from "../actions";

/**
 * Inline coaching thread anchored to a specific map entry. Renders
 * the coach's reaction messages + any back-and-forth about this
 * entry. Includes a compact reply field so the man can keep the
 * conversation on the entry without leaving the section.
 *
 * Chips (refinement / suggestions) parse out of coach messages and
 * dispatch `itc-chip-fill` events so tapping fills the entry's
 * inline edit field or the section's Add input.
 *
 * Collapse discipline (Amendment §2): threads auto-collapse when
 * the entry is resolved. For MVP: threads default expanded when
 * there's at least one unread message, otherwise collapsed to a
 * comment-count badge that reopens on tap.
 *
 * One-active-thread rule: opening this thread's reply field
 * broadcasts a `itc-thread-focus` event that other threads listen
 * for and use to close their own reply fields.
 */
export function EntryThread({
  mapId,
  entryRefTable,
  entryRefId,
  entryText,
  entryKind,
  messages,
  initiallyExpanded = true,
}: {
  mapId: string;
  entryRefTable:
    | "itc_maps"
    | "itc_behaviors"
    | "itc_worries"
    | "itc_commitments"
    | "itc_assumptions"
    | "itc_tests";
  entryRefId: string;
  entryText: string;
  entryKind: "goal" | "behavior" | "worry" | "commitment" | "assumption";
  messages: ItcMessage[];
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(
    initiallyExpanded && messages.length > 0,
  );
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusKey = `${entryRefTable}:${entryRefId}`;

  // Broadcast focus so other threads collapse their reply fields.
  useEffect(() => {
    function onOtherFocus(ev: Event) {
      const e = ev as CustomEvent<{ key: string }>;
      if (!e.detail?.key) return;
      if (e.detail.key !== focusKey) {
        setReplyOpen(false);
        setReplyText("");
      }
    }
    window.addEventListener("itc-thread-focus", onOtherFocus as EventListener);
    return () => window.removeEventListener("itc-thread-focus", onOtherFocus as EventListener);
  }, [focusKey]);

  function openReply() {
    window.dispatchEvent(
      new CustomEvent("itc-thread-focus", { detail: { key: focusKey } }),
    );
    setReplyOpen(true);
    setExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function submitReply() {
    setError(null);
    const text = replyText.trim();
    if (text.length === 0) return;
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("entry_ref_table", entryRefTable);
    fd.set("entry_ref_id", entryRefId);
    fd.set("entry_text", entryText);
    fd.set("entry_kind", entryKind);
    fd.set("text", text);
    startTransition(async () => {
      const res = await postThreadReply(fd);
      if (!res.ok) setError(res.reason ?? "Could not send.");
      else {
        setReplyText("");
        setReplyOpen(false);
      }
    });
  }

  if (messages.length === 0 && !replyOpen) {
    return (
      <div className="pl-5 pt-1">
        <button
          type="button"
          onClick={openReply}
          className="text-[10px] text-[color:var(--color-text-muted)]/70 hover:text-[color:var(--color-text-muted)]"
        >
          Ask the coach about this
        </button>
      </div>
    );
  }

  if (!expanded) {
    return (
      <div className="pl-5 pt-1">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[10px] text-[color:var(--color-text-muted)]/70 hover:text-[color:var(--color-text-muted)]"
        >
          Coach thread ({messages.length})
        </button>
      </div>
    );
  }

  return (
    <div className="pl-5 pt-1 space-y-1.5">
      {messages.map((m) => (
        <ThreadMessage key={m.id} message={m} />
      ))}
      {replyOpen ? (
        <div className="space-y-1.5">
          <textarea
            ref={inputRef}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={2}
            disabled={pending}
            placeholder="Reply to the coach about this…"
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (pending) return;
                submitReply();
              } else if (e.key === "Escape") {
                setReplyOpen(false);
                setReplyText("");
              }
            }}
            className="w-full resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-2 py-1 text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submitReply}
              disabled={pending}
              className="rounded-md bg-[color:var(--color-primary)] px-3 py-1 text-xs font-semibold disabled:opacity-50"
            >
              {pending ? "…" : "Send"}
            </button>
            <button
              type="button"
              onClick={() => {
                setReplyOpen(false);
                setReplyText("");
                setError(null);
              }}
              disabled={pending}
              className="rounded-md border border-[color:var(--color-border)] px-3 py-1 text-xs disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          {error ? (
            <p className="text-[11px] text-[color:var(--color-danger)]">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={openReply}
          className="text-[10px] text-[color:var(--color-text-muted)]/70 hover:text-[color:var(--color-text-muted)]"
        >
          Reply
        </button>
      )}
    </div>
  );
}

type ChipPayload = {
  refinement?: string;
  suggestions?: string[];
};

function extractChipPayload(content: string): {
  prose: string;
  chips: ChipPayload | null;
} {
  const fence = /\n?```coach-chips\s*\n([\s\S]*?)\n```\s*$/;
  const match = content.match(fence);
  if (!match) return { prose: content, chips: null };
  const prose = content.slice(0, match.index).trimEnd();
  try {
    return { prose, chips: JSON.parse(match[1]) as ChipPayload };
  } catch {
    return { prose, chips: null };
  }
}

function ThreadMessage({ message }: { message: ItcMessage }) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[90%] rounded-md bg-[color:var(--color-primary)]/20 px-2.5 py-1.5 text-xs">
        {message.content}
      </div>
    );
  }
  const { prose, chips } = extractChipPayload(message.content);
  return (
    <div className="space-y-1">
      <div className="rounded-md border-l-2 border-[color:var(--color-primary)]/60 bg-[color:var(--color-surface-2)]/60 px-2.5 py-1.5 text-xs whitespace-pre-wrap">
        {prose}
      </div>
      {chips && (chips.refinement || (chips.suggestions?.length ?? 0) > 0) ? (
        <div className="flex flex-wrap gap-1">
          {chips.refinement ? (
            <ChipButton
              label={`Use: "${chips.refinement}"`}
              value={chips.refinement}
            />
          ) : null}
          {chips.suggestions?.map((s, i) => (
            <ChipButton key={i} label={s} value={s} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChipButton({ label, value }: { label: string; value: string }) {
  function handleClick() {
    window.dispatchEvent(
      new CustomEvent("itc-chip-fill", { detail: { value } }),
    );
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded-full border border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary)]/10 px-2.5 py-0.5 text-[10px] text-white hover:bg-[color:var(--color-primary)]/20"
      title="Use this in the input"
    >
      {label}
    </button>
  );
}
