"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ItcMessage } from "@/lib/itc/maps";
import { sendCoachMessage } from "../actions";

/**
 * The chat pane under Form-First. Pure conversation with the coach:
 * user turns, assistant turns, chip-fill affordances beneath any
 * assistant reply that carried a `coach-chips` footer. Nothing in
 * this pane writes to the map. The Continue button and per-column
 * add/edit/remove controls live on the map panel.
 *
 * Chip footer format on assistant messages:
 *
 *   <prose>
 *   ```coach-chips
 *   {"refinement":"...","suggestions":["..","..",".."]}
 *   ```
 *
 * The renderer splits the fenced block off the prose. Tapping a chip
 * dispatches a browser CustomEvent (`itc-chip-fill`) that the map
 * panel listens for and uses to fill the current column's input.
 * Chip → input; input → server action; that's the whole gesture.
 */
export function Conversation({
  mapId,
  messages,
}: {
  mapId: string;
  messages: ItcMessage[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLOListElement>(null);

  const displayMessages = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

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
          <li className="text-sm italic text-[color:var(--color-text-muted)]">
            Say hello, or tell me what's on your mind about this pillar.
          </li>
        ) : null}
        {displayMessages.map((m) => (
          <MessageBubble key={m.id} message={m} />
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

      {error ? (
        <p className="mt-2 text-xs text-[color:var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}

/**
 * Assistant messages may include a fenced JSON footer with refinement
 * and suggestion chips. Parse it once here; render the prose body and
 * the chips separately.
 */
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
    const parsed = JSON.parse(match[1]) as ChipPayload;
    return { prose, chips: parsed };
  } catch {
    return { prose, chips: null };
  }
}

function MessageBubble({ message }: { message: ItcMessage }) {
  if (message.role === "user") {
    return (
      <li className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[color:var(--color-primary)]/25 px-3 py-2 text-sm">
        {message.content}
      </li>
    );
  }
  const { prose, chips } = extractChipPayload(message.content);
  return (
    <li className="flex flex-col gap-1">
      <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm whitespace-pre-wrap">
        {prose}
      </div>
      {chips && (chips.refinement || (chips.suggestions?.length ?? 0) > 0) ? (
        <div className="mr-auto max-w-[95%] flex flex-wrap gap-1.5 pl-2">
          {chips.refinement ? (
            <ChipButton label={`Use: "${chips.refinement}"`} value={chips.refinement} kind="refinement" />
          ) : null}
          {chips.suggestions?.map((s, i) => (
            <ChipButton key={i} label={s} value={s} kind="suggestion" />
          ))}
        </div>
      ) : null}
    </li>
  );
}

function ChipButton({
  label,
  value,
  kind,
}: {
  label: string;
  value: string;
  kind: "refinement" | "suggestion";
}) {
  function handleClick() {
    window.dispatchEvent(
      new CustomEvent("itc-chip-fill", { detail: { value, kind } }),
    );
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded-full border border-[color:var(--color-primary)]/60 bg-[color:var(--color-primary)]/10 px-3 py-1 text-[11px] text-white hover:bg-[color:var(--color-primary)]/20"
      title="Use this in the map input"
    >
      {label}
    </button>
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
