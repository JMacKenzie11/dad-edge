"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ItcMessage } from "@/lib/itc/maps";
import { postThreadReply } from "../actions";

/**
 * Inline coaching thread anchored to a specific map entry. Always
 * visible when there are messages; reply input is always visible
 * under the latest coach message.
 *
 * No auto-collapse: prior versions tried to infer "coach approved"
 * from the absence of chip payload, but Case 1 pushback ALSO has
 * no chips, so the badge misfired on rejections. Under Form-First
 * the user is the decider — thread stays visible so the coach's
 * prose can do its job.
 *
 * One-active-thread rule: focusing this thread's reply broadcasts
 * `itc-thread-focus`; other threads listen and blur their own
 * inputs when a sibling takes focus.
 */
export function EntryThread({
  mapId,
  entryRefTable,
  entryRefId,
  entryText,
  entryKind,
  messages,
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
}) {
  const focusKey = `${entryRefTable}:${entryRefId}`;
  const [pending, startTransition] = useTransition();
  const [replyText, setReplyText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onOtherFocus(ev: Event) {
      const e = ev as CustomEvent<{ key: string }>;
      if (!e.detail?.key) return;
      if (e.detail.key !== focusKey && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
      }
    }
    window.addEventListener("itc-thread-focus", onOtherFocus as EventListener);
    return () => window.removeEventListener("itc-thread-focus", onOtherFocus as EventListener);
  }, [focusKey]);

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
      }
    });
  }

  if (messages.length === 0) return null;

  return (
    <div className="pl-3 pt-1 space-y-1.5">
      {messages.map((m) => (
        <ThreadMessage key={m.id} message={m} />
      ))}
      <div className="space-y-1.5">
        <textarea
          ref={inputRef}
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onFocus={() => {
            window.dispatchEvent(
              new CustomEvent("itc-thread-focus", {
                detail: { key: focusKey },
              }),
            );
          }}
          rows={2}
          disabled={pending}
          placeholder="Reply to the coach…"
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              if (pending) return;
              submitReply();
            }
          }}
          className="w-full resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-2 py-1 text-sm focus:outline-none focus:border-[color:var(--color-primary)]/60"
        />
        {replyText.trim().length > 0 ? (
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
                setReplyText("");
                setError(null);
              }}
              disabled={pending}
              className="text-[11px] text-[color:var(--color-text-muted)] hover:text-white"
            >
              Cancel
            </button>
          </div>
        ) : null}
        {error ? (
          <p className="text-[11px] text-[color:var(--color-danger)]">
            {error}
          </p>
        ) : null}
      </div>
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
