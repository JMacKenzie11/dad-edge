"use client";

import { useState, useRef, useEffect, useTransition, useCallback } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";

type MissionSuggestion = {
  description: string;
  pillar_code: PillarCode;
  target_date: string;
};

export type UITurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  missionSuggestion: MissionSuggestion | null;
  createdAt: string;
};

type SendResponse = {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  reply: string;
  missionSuggestion: MissionSuggestion | null;
  allowance: { used: number; softCap: number; hardCap: number; remaining: number; bucket: "ok" | "warn" | "block" };
  crisis: boolean;
};

export function CoachConversation({
  conversationId,
  mode,
  initialTurns,
  readOnly,
  remaining: initialRemaining,
  firstName,
}: {
  conversationId: string;
  mode: "general" | "mission";
  initialTurns: UITurn[];
  readOnly: boolean;
  remaining: number;
  firstName: string | null;
}) {
  const [turns, setTurns] = useState<UITurn[]>(initialTurns);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [remaining, setRemaining] = useState(initialRemaining);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    // When the most recent turn is an assistant reply, scroll so the TOP of
    // that reply sits near the top of the visible area — never let the coach's
    // response flow off the bottom of the screen unseen.
    const last = turns[turns.length - 1];
    if (last && last.role === "assistant" && !pending) {
      const el = container.querySelector<HTMLElement>(
        `[data-turn-id="${CSS.escape(last.id)}"]`,
      );
      if (el) {
        const target = Math.max(0, el.offsetTop - 8);
        container.scrollTo({ top: target, behavior: "smooth" });
        return;
      }
    }
    // Otherwise (user just sent, typing indicator visible, empty state) — pin to bottom.
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [turns, pending]);

  const send = useCallback(() => {
    const t = text.trim();
    if (!t || pending) return;
    setError(null);
    setText("");
    const optimisticId = `local-${Date.now()}`;
    setTurns((prev) => [
      ...prev,
      {
        id: optimisticId,
        role: "user",
        text: t,
        missionSuggestion: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    startTransition(async () => {
      try {
        const res = await fetch("/api/coach/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversation_id: conversationId, text: t }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Coach errored (${res.status})`);
        }
        const body = (await res.json()) as SendResponse;
        setRemaining(body.allowance.remaining);
        setTurns((prev) => {
          // Replace the optimistic user turn with the real ID, then append assistant.
          const withReal = prev.map((p) =>
            p.id === optimisticId ? { ...p, id: body.userMessageId } : p,
          );
          return [
            ...withReal,
            {
              id: body.assistantMessageId,
              role: "assistant" as const,
              text: body.reply,
              missionSuggestion: body.missionSuggestion,
              createdAt: new Date().toISOString(),
            },
          ];
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Send failed.");
        setTurns((prev) => prev.filter((p) => p.id !== optimisticId));
        setText(t);
      }
    });
  }, [text, pending, conversationId]);

  return (
    <div className="flex flex-col h-[70vh] rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {turns.length === 0 ? (
          <EmptyState mode={mode} />
        ) : (
          turns.map((t) => (
            <div key={t.id} data-turn-id={t.id}>
              <TurnBubble turn={t} />
            </div>
          ))
        )}
        {pending ? <TypingIndicator /> : null}
      </div>

      <div className="border-t border-[color:var(--color-border)] p-3">
        {error ? (
          <p className="text-xs text-[color:var(--color-danger)] mb-2">{error}</p>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            disabled={readOnly || pending || remaining <= 0}
            rows={2}
            maxLength={4000}
            placeholder={
              readOnly
                ? "Read-only account."
                : remaining <= 0
                  ? "Monthly limit reached. Resets on the 1st."
                  : mode === "mission"
                    ? "Behavior + day. What are we committing to?"
                    : firstName
                      ? `What's on your mind, ${firstName}?`
                      : "What's on your mind?"
            }
            className="flex-1 resize-none rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] px-3 py-2 text-sm disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={readOnly || pending || text.trim().length === 0}
            className="h-11 px-4 rounded-md bg-[color:var(--color-coach)] text-white font-heading text-xs tracking-widest disabled:opacity-40"
          >
            {pending ? "…" : "SEND"}
          </button>
        </form>
        <p className="text-[10px] text-[color:var(--color-text-muted)] mt-2">
          ⌘/Ctrl + Enter to send · Coach is not a therapist. In crisis call 911 or 988.
        </p>
      </div>
    </div>
  );
}

function TurnBubble({ turn }: { turn: UITurn }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-[var(--radius-card)] rounded-tr-sm bg-[color:var(--color-primary)] text-white px-3 py-2 text-sm whitespace-pre-wrap">
          {turn.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <div className="shrink-0 h-8 w-8 rounded-full bg-[color:var(--color-coach)]/20 border border-[color:var(--color-coach)]/40 flex items-center justify-center">
        <Image src="/brand/mark-white.png" alt="" width={20} height={20} />
      </div>
      <div className="max-w-[80%] space-y-2">
        <div className="rounded-[var(--radius-card)] rounded-tl-sm bg-[color:var(--color-surface-2)] border border-[color:var(--color-coach)]/30 px-3 py-2 text-sm whitespace-pre-wrap">
          {turn.text}
        </div>
        {turn.missionSuggestion ? (
          <MissionCommitCard suggestion={turn.missionSuggestion} assistantMessageId={turn.id} />
        ) : null}
      </div>
    </div>
  );
}

function MissionCommitCard({
  suggestion,
  assistantMessageId,
}: {
  suggestion: MissionSuggestion;
  assistantMessageId: string;
}) {
  const [status, setStatus] = useState<"idle" | "accepting" | "accepted" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const pillar = PILLAR_BY_CODE[suggestion.pillar_code];

  const accept = async () => {
    setStatus("accepting");
    setError(null);
    try {
      const res = await fetch("/api/coach/accept-mission", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assistant_message_id: assistantMessageId,
          description: suggestion.description,
          pillar_code: suggestion.pillar_code,
          target_date: suggestion.target_date,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Accept failed.");
      }
      setStatus("accepted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Accept failed.");
      setStatus("error");
    }
  };

  return (
    <div className="rounded-[var(--radius-card)] bg-[color:var(--color-bg)] border border-[color:var(--color-coach)] p-3 space-y-2">
      <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-coach)]">
        MISSION · {pillar.label.toUpperCase()}
      </p>
      <p className="text-sm">{suggestion.description}</p>
      <p className="text-xs text-[color:var(--color-text-muted)]">
        {format(new Date(`${suggestion.target_date}T00:00:00`), "EEEE, MMM d")}
      </p>
      {status === "accepted" ? (
        <p className="text-xs font-heading tracking-widest text-[color:var(--color-success)]">
          COMMITTED
        </p>
      ) : (
        <button
          onClick={accept}
          disabled={status === "accepting"}
          className="h-9 px-3 rounded-md bg-[color:var(--color-coach)] text-white font-heading text-xs tracking-widest disabled:opacity-40"
        >
          {status === "accepting" ? "COMMITTING…" : "COMMIT"}
        </button>
      )}
      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-2" aria-live="polite" aria-label="Coach is typing">
      <div className="shrink-0 h-8 w-8 rounded-full bg-[color:var(--color-coach)]/20 border border-[color:var(--color-coach)]/40 flex items-center justify-center">
        <Image src="/brand/mark-white.png" alt="" width={20} height={20} />
      </div>
      <div className="rounded-[var(--radius-card)] rounded-tl-sm bg-[color:var(--color-surface-2)] border border-[color:var(--color-coach)]/30 px-4 py-3 flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-2 w-2 rounded-full bg-[color:var(--color-text-muted)]"
            animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.15,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ mode }: { mode: "general" | "mission" }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12">
      <Image src="/brand/mark-white.png" alt="" width={48} height={48} className="opacity-80" />
      <p className="font-heading text-sm text-[color:var(--color-text-muted)]">
        {mode === "mission" ? "Give me the behavior and the day." : "Start the conversation."}
      </p>
    </div>
  );
}
