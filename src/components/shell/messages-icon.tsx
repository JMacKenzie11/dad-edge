"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Speech-bubble icon in the header, left of the notification bell.
 * Shows the count of threads with unread messages. Realtime subscribes
 * to the messages table so the badge ticks up without a page refresh
 * when a new message arrives (RLS ensures only messages this user
 * can see fire the callback).
 *
 * Click = navigate to /messages. No hover dropdown — kept intentional
 * per the "messages live on the messages page" product call.
 */
export function MessagesIcon({
  viewerId,
  initialUnreadThreads,
}: {
  viewerId: string;
  initialUnreadThreads: number;
}) {
  const [unread, setUnread] = useState(initialUnreadThreads);

  // The app layout is a persistent parent across route changes, so
  // this component doesn't unmount when the user navigates. Without
  // this sync, `useState(initialUnreadThreads)` freezes on the value
  // seen at first mount and later server-rendered counts (e.g. after
  // /messages marks everything read) never reach the badge.
  useEffect(() => {
    setUnread(initialUnreadThreads);
  }, [initialUnreadThreads]);

  // Realtime: any new message where sender != me is a potentially
  // unread ping. We can't easily know "is this from a new thread I
  // haven't yet counted?" client-side without re-querying, so we
  // just refetch the exact count via the server. Cheap: one COUNT.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    async function refetch(): Promise<void> {
      // Rely on RLS: this query only sees rows where the user
      // participates in the thread + sender != me.
      const { data } = await supabase
        .from("messages")
        .select("thread_id")
        .neq("sender_id", viewerId)
        .is("read_at", null);
      const set = new Set<string>();
      for (const r of (data ?? []) as Array<{ thread_id: string }>) {
        set.add(r.thread_id);
      }
      setUnread(set.size);
    }

    const channel = supabase
      .channel("header-unread-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as { sender_id: string };
          if (row.sender_id !== viewerId) void refetch();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        () => {
          // A read_at flip means the count went down.
          void refetch();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [viewerId]);

  const badgeLabel = unread > 9 ? "9+" : String(unread);

  return (
    <Link
      href="/messages"
      aria-label={
        unread > 0
          ? `Messages, ${unread} unread thread${unread === 1 ? "" : "s"}`
          : "Messages"
      }
      className="relative flex items-center justify-center h-10 w-10 rounded-full bg-[color:var(--color-surface-2)] border border-[color:var(--color-border)] hover:border-[color:var(--color-accent)] transition-colors cursor-pointer"
    >
      <SpeechBubbleIcon />
      {unread > 0 ? (
        <span
          className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[color:var(--color-accent)] text-black text-[10px] font-heading flex items-center justify-center"
          aria-hidden
        >
          {badgeLabel}
        </span>
      ) : null}
    </Link>
  );
}

function SpeechBubbleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-white"
      aria-hidden
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
