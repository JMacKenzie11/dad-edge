"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ItcActionProposal, ItcMessage } from "@/lib/itc/maps";
import { advanceMapStage, sendCoachMessage, type AdvanceGate } from "../actions";
import { ProposalCard } from "./proposal-cards";

export function Conversation({
  mapId,
  messages,
  proposals,
  advanceGate,
}: {
  mapId: string;
  messages: ItcMessage[];
  proposals: ItcActionProposal[];
  advanceGate: AdvanceGate;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLOListElement>(null);

  const displayMessages = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  // Group proposals by the assistant message they were created against
  // so each card renders inline below the message that produced it.
  const proposalsByMessage = useMemo(() => {
    const map = new Map<string, ItcActionProposal[]>();
    for (const p of proposals) {
      const arr = map.get(p.assistant_message_id) ?? [];
      arr.push(p);
      map.set(p.assistant_message_id, arr);
    }
    return map;
  }, [proposals]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [displayMessages.length, proposals.length, pending]);

  function handleSend(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await sendCoachMessage(fd);
      if (!res.ok) setError(res.reason ?? "Something went wrong.");
      if (textRef.current) textRef.current.value = "";
    });
  }

  function handleAdvance() {
    if (!advanceGate.to) return;
    setError(null);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("to", advanceGate.to);
    startTransition(async () => {
      const res = await advanceMapStage(fd);
      if (!res.ok) setError(res.reason ?? "Could not advance.");
    });
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <ol
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-3 pr-1 scroll-smooth"
      >
        {displayMessages.length === 0 ? (
          <li className="text-sm italic text-[color:var(--color-text-muted)]">
            Say hello, or tell me what's on your mind about this pillar.
          </li>
        ) : null}
        {displayMessages.map((m) => {
          const cards =
            m.role === "assistant" ? proposalsByMessage.get(m.id) ?? [] : [];
          return (
            <li key={m.id} className="flex flex-col">
              <div
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[color:var(--color-primary)]/25 px-3 py-2 text-sm"
                    : "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm whitespace-pre-wrap"
                }
              >
                {m.content}
              </div>
              {cards.length > 0 ? (
                <div className="mr-auto w-full max-w-[95%] space-y-1">
                  {cards.map((p) => (
                    <ProposalCard key={p.id} proposal={p} />
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
        {pending ? (
          <li className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm">
            <TypingDots />
          </li>
        ) : null}
      </ol>

      {advanceGate.to ? (
        <div className="mt-3 border-t border-[color:var(--color-border)] pt-3">
          <button
            type="button"
            onClick={handleAdvance}
            disabled={pending || !advanceGate.enabled}
            title={
              advanceGate.enabled
                ? undefined
                : advanceGate.reason ?? "Not ready to advance."
            }
            className="w-full rounded-md bg-[color:var(--color-primary)] px-4 py-2 text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {pending ? "…" : advanceGate.label}
          </button>
          {!advanceGate.enabled && advanceGate.reason ? (
            <p className="mt-1 text-[11px] text-[color:var(--color-text-muted)]/80 text-center">
              {advanceGate.reason}
            </p>
          ) : null}
        </div>
      ) : null}

      <form
        action={handleSend}
        className="mt-3 flex items-end gap-2 border-t border-[color:var(--color-border)] pt-3"
      >
        <input type="hidden" name="map_id" value={mapId} />
        <textarea
          ref={textRef}
          name="text"
          required
          rows={2}
          maxLength={4000}
          placeholder="Type… (Enter to send, Shift+Enter for newline)"
          className="flex-1 resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm"
          disabled={pending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (pending) return;
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[color:var(--color-primary)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {pending ? "…" : "Send"}
        </button>
      </form>

      {error ? (
        <p className="mt-2 text-xs text-[color:var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}

function TypingDots() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[color:var(--color-text-muted)]"
      aria-label="Coach is thinking"
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce" />
    </span>
  );
}
