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
          className="fixed bottom-20 right-4 z-50 flex flex-col w-[92vw] max-w-md h-[70vh] rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-2xl"
          role="dialog"
          aria-label="Ask the coach"
        >
          <div className="border-b border-[color:var(--color-border)] px-4 py-2.5">
            <div className="text-[11px] uppercase tracking-wide text-[color:var(--color-text-muted)]">
              Ask the coach
            </div>
            <div className="text-[10px] text-[color:var(--color-text-muted)]/70">
              Anything you want. Nothing here changes the map.
            </div>
          </div>
          <ol
            ref={listRef}
            className="flex-1 overflow-y-auto space-y-2 px-3 py-2"
          >
            {messages.length === 0 ? (
              <li className="text-xs italic text-[color:var(--color-text-muted)]/70">
                What's on your mind?
              </li>
            ) : null}
            {messages.map((m) => (
              <li
                key={m.id}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[color:var(--color-primary)]/25 px-3 py-1.5 text-sm"
                    : "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] px-3 py-1.5 text-sm whitespace-pre-wrap"
                }
              >
                {m.content}
              </li>
            ))}
            {pending ? (
              <li className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] px-3 py-1.5 text-xs text-[color:var(--color-text-muted)]">
                Thinking…
              </li>
            ) : null}
          </ol>
          <div className="border-t border-[color:var(--color-border)] p-2">
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
              className="w-full resize-none rounded-md bg-black/30 border border-[color:var(--color-border)] px-2 py-1.5 text-sm"
            />
            {error ? (
              <p className="mt-1 text-[11px] text-[color:var(--color-danger)]">
                {error}
              </p>
            ) : null}
          </div>
        </aside>
      ) : null}
    </>
  );
}
