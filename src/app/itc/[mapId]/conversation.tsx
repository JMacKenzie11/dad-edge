"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ItcMessage } from "@/lib/itc/maps";
import type { ItcStage } from "@/lib/itc/stage";
import { advanceMapStage, sendCoachMessage } from "../actions";

type Behavior = {
  id: string;
  text: string;
  source: "user" | "suggested";
  selected: boolean;
};

const MAX_SELECTED = 5;

export function Conversation({
  mapId,
  stage,
  messages,
  behaviors,
}: {
  mapId: string;
  stage: ItcStage;
  messages: ItcMessage[];
  behaviors: Behavior[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLOListElement>(null);

  const displayMessages = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  // Keep the latest turn in view whenever the transcript grows or the
  // typing indicator flips. Scrolls the inner overflow container (not
  // the window) so the map pane on the right stays put.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [displayMessages.length, pending]);

  function handleSend(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await sendCoachMessage(fd);
      if (!res.ok) setError(res.reason ?? "Something went wrong.");
      if (textRef.current) textRef.current.value = "";
    });
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <ol
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-3 pr-1 scroll-smooth"
      >
        {displayMessages.length === 0 ? (
          <li className="text-sm italic text-[color:var(--color-muted)]">
            Say hello, or tell me what's on your mind about this pillar.
          </li>
        ) : null}
        {displayMessages.map((m) => (
          <li
            key={m.id}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[color:var(--color-primary)]/25 px-3 py-2 text-sm"
                : "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm whitespace-pre-wrap"
            }
          >
            {m.content}
          </li>
        ))}
        {pending ? (
          <li className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm">
            <TypingDots />
          </li>
        ) : null}
      </ol>

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

      {stage === "behaviors" ? (
        <BehaviorPanel
          mapId={mapId}
          behaviors={behaviors}
          onError={setError}
        />
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-[color:var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}

function TypingDots() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[color:var(--color-muted)]"
      aria-label="Coach is thinking"
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce" />
    </span>
  );
}

function BehaviorPanel({
  mapId,
  behaviors,
  onError,
}: {
  mapId: string;
  behaviors: Behavior[];
  onError: (msg: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-3 border-t border-[color:var(--color-border)] pt-3">
      <ContinueBar
        mapId={mapId}
        selectedCount={behaviors.filter((b) => b.selected).length}
        pending={pending}
        onError={onError}
        startTransition={startTransition}
      />
    </div>
  );
}

function ContinueBar({
  mapId,
  selectedCount,
  pending,
  onError,
  startTransition,
}: {
  mapId: string;
  selectedCount: number;
  pending: boolean;
  onError: (msg: string | null) => void;
  startTransition: React.TransitionStartFunction;
}) {
  const canContinue = selectedCount >= 1 && selectedCount <= MAX_SELECTED;
  return (
    <form
      action={(fd) => {
        onError(null);
        fd.set("to", "worries");
        startTransition(async () => {
          const res = await advanceMapStage(fd);
          if (!res.ok) onError(res.reason ?? "Not ready to advance yet.");
        });
      }}
    >
      <input type="hidden" name="map_id" value={mapId} />
      <button
        type="submit"
        disabled={pending || !canContinue}
        className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
      >
        I'm done adding behaviors — continue
      </button>
    </form>
  );
}
