"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { format, isSameDay } from "date-fns";
import { UserAvatar } from "@/components/ui/user-avatar";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  markThreadRead,
  sendMessage,
  toggleReaction,
} from "@/lib/messages/actions";

type Message = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

type Reaction = {
  message_id: string;
  user_id: string;
  emoji: string;
};

type Other = {
  userId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  avatarUrl: string | null;
};

const QUICK_REACTIONS = ["👍", "❤️", "💪", "🔥", "🙏"];

/**
 * Realtime thread view. Owns:
 *   - message list with day dividers
 *   - realtime subscription for new/updated messages + reactions
 *   - optimistic send (bubble shows immediately with dim styling
 *     until the server acks + returns the real id)
 *   - mark-as-read on mount + on new-message arrival
 *   - hover reactions
 *
 * Two-pane on desktop: this component renders in the right pane of
 * /messages. On mobile: it's the whole screen with a Back link at
 * the top since the inbox pane hides.
 */
export function ThreadView({
  threadId,
  viewerId,
  other,
  initialMessages,
  initialReactions,
}: {
  threadId: string;
  viewerId: string;
  other: Other;
  initialMessages: Message[];
  initialReactions: Reaction[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [reactions, setReactions] = useState<Reaction[]>(initialReactions);
  const [draft, setDraft] = useState("");
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Group reactions by message for cheap render.
  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, Map<string, Set<string>>>();
    for (const r of reactions) {
      const emojiMap = map.get(r.message_id) ?? new Map<string, Set<string>>();
      const set = emojiMap.get(r.emoji) ?? new Set<string>();
      set.add(r.user_id);
      emojiMap.set(r.emoji, set);
      map.set(r.message_id, emojiMap);
    }
    return map;
  }, [reactions]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollerRef.current;
    if (!el) return;
    // Defer to next frame so DOM has painted the new bubble first.
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior });
    });
  }, []);

  // Auto-scroll on mount + whenever messages change.
  useEffect(() => {
    scrollToBottom("auto");
  }, [scrollToBottom]);
  useEffect(() => {
    scrollToBottom("smooth");
  }, [messages, scrollToBottom]);

  // Mark thread read on mount and whenever a new inbound message
  // arrives while the tab is focused. Fire-and-forget.
  useEffect(() => {
    startTransition(() => void markThreadRead(threadId));
  }, [threadId, messages.length]);

  // Realtime: subscribe to new + updated messages + reaction changes
  // for this thread only. On disconnect, Supabase retries in the
  // background — for a short-lived hiccup the user sees nothing.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`thread:${threadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const row = payload.new as Message;
          setMessages((prev) =>
            prev.some((m) => m.id === row.id) ? prev : [...prev, row],
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const row = payload.new as Message;
          setMessages((prev) => prev.map((m) => (m.id === row.id ? row : m)));
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions" },
        (payload) => {
          const row = payload.new as Reaction;
          setReactions((prev) =>
            prev.some(
              (r) => r.message_id === row.message_id && r.user_id === row.user_id,
            )
              ? prev
              : [...prev, row],
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions" },
        (payload) => {
          const row = payload.old as Reaction;
          setReactions((prev) =>
            prev.filter(
              (r) => !(r.message_id === row.message_id && r.user_id === row.user_id),
            ),
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [threadId]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    setSendErr(null);

    // Optimistic bubble. Real id lands via realtime — dedupe by
    // body+time (client-only id gets replaced in place).
    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: Message = {
      id: optimisticId,
      sender_id: viewerId,
      body,
      created_at: new Date().toISOString(),
      read_at: null,
    };
    setMessages((prev) => [...prev, optimistic]);

    const res = await sendMessage(threadId, body);
    if (!res.ok) {
      setSendErr(res.error);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      // Restore the draft so the user can fix + retry.
      setDraft(body);
      return;
    }
    // Replace optimistic with the real row so id + created_at are
    // authoritative (Realtime will also fire but the dedupe in the
    // subscription handler makes that a no-op).
    setMessages((prev) =>
      prev.map((m) =>
        m.id === optimisticId
          ? {
              id: res.messageId,
              sender_id: viewerId,
              body,
              created_at: m.created_at,
              read_at: null,
            }
          : m,
      ),
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] md:h-[70vh] border border-[color:var(--color-border)] rounded-[var(--radius-card)] bg-[color:var(--color-surface)] overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[color:var(--color-border)]">
        <Link
          href="/messages"
          className="md:hidden text-[color:var(--color-text-muted)] hover:text-white"
          aria-label="Back to inbox"
        >
          ←
        </Link>
        <UserAvatar
          url={other.avatarUrl}
          firstName={other.firstName}
          lastName={other.lastName}
          email={other.email}
        />
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm truncate">{other.name}</p>
          <p className="text-[10px] text-[color:var(--color-text-muted)] truncate">
            {other.email}
          </p>
        </div>
      </header>

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-2"
      >
        {messages.length === 0 ? (
          <p className="text-center text-sm text-[color:var(--color-text-muted)] italic py-6">
            No messages yet. Say something.
          </p>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const showDayDivider =
              !prev || !isSameDay(new Date(m.created_at), new Date(prev.created_at));
            const isMine = m.sender_id === viewerId;
            const isOptimistic = m.id.startsWith("optimistic-");
            const emojiMap = reactionsByMessage.get(m.id);
            return (
              <div key={m.id}>
                {showDayDivider ? (
                  <div className="text-center py-2">
                    <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] px-2 py-1">
                      {format(new Date(m.created_at), "EEE, MMM d")}
                    </span>
                  </div>
                ) : null}
                <MessageBubble
                  message={m}
                  isMine={isMine}
                  isOptimistic={isOptimistic}
                  viewerId={viewerId}
                  emojiMap={emojiMap}
                />
              </div>
            );
          })
        )}
      </div>

      <form
        onSubmit={handleSend}
        className="border-t border-[color:var(--color-border)] p-3 flex gap-2"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message"
          maxLength={4000}
          autoFocus
          className="flex-1 h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm focus:outline-none focus:border-[color:var(--color-accent)]"
        />
        <button
          type="submit"
          disabled={draft.trim().length === 0}
          className="h-10 px-4 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest disabled:opacity-40 cursor-pointer"
        >
          SEND
        </button>
      </form>
      {sendErr ? (
        <p className="px-3 pb-2 text-xs text-[color:var(--color-danger)]">
          {sendErr}
        </p>
      ) : null}
    </div>
  );
}

function MessageBubble({
  message,
  isMine,
  isOptimistic,
  viewerId,
  emojiMap,
}: {
  message: Message;
  isMine: boolean;
  isOptimistic: boolean;
  viewerId: string;
  emojiMap: Map<string, Set<string>> | undefined;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function handleReact(emoji: string) {
    setPickerOpen(false);
    void toggleReaction(message.id, emoji);
  }

  return (
    <div
      className={
        "flex " + (isMine ? "justify-end" : "justify-start") + " group relative"
      }
    >
      <div className="max-w-[80%]">
        <div
          className={
            "inline-block px-3 py-2 rounded-2xl text-sm leading-snug " +
            (isMine
              ? "bg-[color:var(--color-primary)] text-white rounded-br-sm"
              : "bg-[color:var(--color-surface-2)] text-[color:var(--color-text)] rounded-bl-sm") +
            (isOptimistic ? " opacity-60" : "")
          }
        >
          {message.body}
        </div>
        <div
          className={
            "flex items-center gap-2 mt-0.5 text-[10px] text-[color:var(--color-text-muted)] " +
            (isMine ? "justify-end" : "justify-start")
          }
        >
          <span>{format(new Date(message.created_at), "h:mm a")}</span>
        </div>
        {emojiMap && emojiMap.size > 0 ? (
          <div
            className={
              "mt-1 flex gap-1 " + (isMine ? "justify-end" : "justify-start")
            }
          >
            {Array.from(emojiMap.entries()).map(([emoji, users]) => {
              const iReacted = users.has(viewerId);
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleReact(emoji)}
                  className={
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] border cursor-pointer " +
                    (iReacted
                      ? "bg-[color:var(--color-primary)]/20 border-[color:var(--color-primary)]/60"
                      : "bg-[color:var(--color-surface-2)] border-[color:var(--color-border)] hover:border-[color:var(--color-primary)]/60")
                  }
                >
                  <span>{emoji}</span>
                  <span className="text-[color:var(--color-text-muted)]">
                    {users.size}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Reaction picker — appears on hover of the bubble on desktop.
          On touch devices, tap the "+" opens it. */}
      <button
        type="button"
        onClick={() => setPickerOpen((o) => !o)}
        className={
          "absolute top-0 h-6 w-6 rounded-full bg-[color:var(--color-surface-2)] border border-[color:var(--color-border)] text-xs text-[color:var(--color-text-muted)] hover:text-white opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer transition-opacity " +
          (isMine ? "-left-8" : "-right-8")
        }
        aria-label="React"
      >
        +
      </button>
      {pickerOpen ? (
        <div
          role="menu"
          className={
            "absolute top-8 z-10 flex gap-1 px-2 py-1 rounded-full bg-[color:var(--color-surface-2)] border border-[color:var(--color-border)] shadow " +
            (isMine ? "right-0" : "left-0")
          }
        >
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleReact(emoji)}
              className="text-lg hover:scale-125 transition-transform cursor-pointer"
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
