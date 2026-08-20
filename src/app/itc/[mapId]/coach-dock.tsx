"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ItcMessage } from "@/lib/itc/maps";
import { sendDockMessage } from "../actions";

/**
 * The coach dock: floating "Ask the coach" button at the bottom-
 * right corner opens a drawer. The drawer shows recent dock-only
 * exchanges (surface="dock" messages), never the full session
 * transcript.
 *
 * Nothing said in the dock writes state — Amendment §4.
 */
export function CoachDock({
  mapId,
  messages,
}: {
  mapId: string;
  messages: ItcMessage[];
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, pending, open]);

  function submit() {
    setError(null);
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("text", trimmed);
    startTransition(async () => {
      const res = await sendDockMessage(fd);
      if (!res.ok) setError(res.reason ?? "Could not send.");
      else setText("");
    });
  }

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-50 rounded-full bg-[color:var(--color-primary)] px-4 py-2.5 text-sm font-semibold shadow-lg hover:opacity-90"
      >
        {open ? "Close" : "Ask the coach"}
      </button>
      {open ? (
        <aside
          className="fixed bottom-20 right-4 z-50 flex flex-col w-[92vw] max-w-lg h-[75vh] rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-2xl"
          role="dialog"
          aria-label="Ask the coach"
        >
          <div className="border-b border-[color:var(--color-border)] px-4 py-3">
            <div className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]">
              Ask the coach
            </div>
            <div className="text-xs text-[color:var(--color-text-muted)]/70 mt-0.5">
              Anything you want. Nothing here changes the map.
            </div>
          </div>
          <ol
            ref={listRef}
            className="flex-1 overflow-y-auto space-y-2 px-4 py-3"
          >
            {messages.length === 0 ? (
              <li className="text-sm italic text-[color:var(--color-text-muted)]/70">
                What's on your mind?
              </li>
            ) : null}
            {messages.map((m) => (
              <li
                key={m.id}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[color:var(--color-primary)]/25 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap"
                    : "mr-auto w-full rounded-2xl rounded-bl-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] px-3 py-3 text-sm leading-relaxed"
                }
              >
                {m.role === "assistant" ? (
                  <ProseParagraphs text={m.content} />
                ) : (
                  m.content
                )}
              </li>
            ))}
            {pending ? (
              <li className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] px-3 py-2 text-sm text-[color:var(--color-text-muted)]">
                Thinking…
              </li>
            ) : null}
          </ol>
          <div className="border-t border-[color:var(--color-border)] p-3">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              disabled={pending}
              placeholder="Ask… (Enter to send, Shift+Enter for newline)"
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  if (pending) return;
                  submit();
                }
              }}
              className="w-full resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-3 py-2 text-sm leading-relaxed"
            />
            {error ? (
              <p className="mt-2 text-sm text-[color:var(--color-danger)]">
                {error}
              </p>
            ) : null}
          </div>
        </aside>
      ) : null}
    </>
  );
}

/**
 * Splits coach prose on paragraph breaks and renders each block as a
 * <p> with visible spacing. Deterministic, server-owned rendering:
 * even if the LLM produces a wall (one giant paragraph), we render
 * exactly one paragraph. If the LLM uses \n\n between paragraphs,
 * we render them as spaced blocks — no reliance on whitespace-pre-
 * wrap to visually separate blocks.
 *
 * Prose over ~3 sentences was rendering as a dense wall in the
 * narrow dock drawer even with pre-wrap. Splitting on \n\n and
 * spacing paragraphs makes long responses skimmable.
 */
function ProseParagraphs({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return (
    <div className="space-y-2.5">
      {paragraphs.map((p, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {p}
        </p>
      ))}
    </div>
  );
}
