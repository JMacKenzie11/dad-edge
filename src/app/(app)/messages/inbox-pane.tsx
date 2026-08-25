"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { UserAvatar } from "@/components/ui/user-avatar";

type InboxRow = {
  threadId: string;
  otherUserId: string;
  otherName: string;
  otherAvatarUrl: string | null;
  otherFirstName: string | null;
  otherLastName: string | null;
  otherEmail: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  lastMessageFromMe: boolean;
  unreadCount: number;
};

export function InboxPane({ inbox }: { inbox: InboxRow[] }) {
  const pathname = usePathname();
  return (
    <aside
      className={
        "border border-[color:var(--color-border)] rounded-[var(--radius-card)] bg-[color:var(--color-surface)] overflow-hidden " +
        // Hide inbox on mobile when a specific thread is open (path
        // deeper than /messages) so the thread gets full width.
        (pathname === "/messages" ? "block" : "hidden md:block")
      }
    >
      <header className="px-4 py-3 border-b border-[color:var(--color-border)] flex items-baseline justify-between">
        <p className="font-heading text-sm tracking-widest">MESSAGES</p>
        <Link
          href="/community?tab=people"
          className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-white"
        >
          + NEW
        </Link>
      </header>

      {inbox.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-[color:var(--color-text-muted)] mb-2">
            Nothing yet.
          </p>
          <p className="text-xs text-[color:var(--color-text-muted)] mb-3">
            Head to Community and reach out to a brother.
          </p>
          <Link
            href="/community?tab=people"
            className="inline-block h-9 px-3 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-[11px] tracking-widest hover:bg-[color:var(--color-primary)]/90 cursor-pointer"
          >
            BROWSE COMMUNITY
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-[color:var(--color-border)] max-h-[70vh] overflow-y-auto">
          {inbox.map((row) => {
            const isActive = pathname === `/messages/${row.threadId}`;
            return (
              <li key={row.threadId}>
                <Link
                  href={`/messages/${row.threadId}`}
                  className={
                    "flex items-start gap-3 px-3 py-3 hover:bg-[color:var(--color-surface-2)] transition-colors cursor-pointer " +
                    (isActive ? "bg-[color:var(--color-surface-2)]" : "")
                  }
                >
                  <UserAvatar
                    url={row.otherAvatarUrl}
                    firstName={row.otherFirstName}
                    lastName={row.otherLastName}
                    email={row.otherEmail}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-heading text-sm truncate">
                        {row.otherName}
                      </p>
                      {row.lastMessageAt ? (
                        <span className="text-[10px] text-[color:var(--color-text-muted)] shrink-0">
                          {formatDistanceToNowStrict(new Date(row.lastMessageAt))
                            .replace(/ (seconds?|minutes?|hours?|days?|weeks?|months?|years?)/, (m, unit: string) => unit[0])
                            .replace(" ", "")}
                        </span>
                      ) : null}
                    </div>
                    <p
                      className={
                        "text-xs truncate mt-0.5 " +
                        (row.unreadCount > 0 && !row.lastMessageFromMe
                          ? "text-white font-heading"
                          : "text-[color:var(--color-text-muted)]")
                      }
                    >
                      {row.lastMessageFromMe && row.lastMessagePreview
                        ? "You: "
                        : ""}
                      {row.lastMessagePreview ?? "No messages yet"}
                    </p>
                  </div>
                  {row.unreadCount > 0 ? (
                    <span
                      aria-label={`${row.unreadCount} unread`}
                      className="mt-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[color:var(--color-accent)] text-black text-[10px] font-heading flex items-center justify-center shrink-0"
                    >
                      {row.unreadCount > 9 ? "9+" : row.unreadCount}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
