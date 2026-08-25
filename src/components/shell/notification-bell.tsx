"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/actions";
import type { NotificationRow } from "@/lib/notifications/read";
import type { NotificationKind } from "@/lib/notifications/enqueue";

/**
 * Bell trigger + dropdown. Server layout fetches unreadCount + recent
 * and passes them in; opening the dropdown just toggles local state,
 * no additional fetch. Row click → server action marks read + router
 * navigates to deep_link.
 */
export function NotificationBell({
  unreadCount,
  recent,
}: {
  unreadCount: number;
  recent: NotificationRow[];
}) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Close on Esc.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function handleRowClick(n: NotificationRow) {
    setOpen(false);
    if (n.read_at === null) {
      // Fire-and-forget — navigation shouldn't wait on the DB write.
      // revalidatePath in the action will refresh the badge on next nav.
      startTransition(() => {
        void markNotificationRead(n.id);
      });
    }
    router.push(n.deep_link);
  }

  function handleMarkAllRead() {
    startTransition(() => {
      void markAllNotificationsRead();
    });
  }

  const badgeLabel = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={open}
        className="relative flex items-center justify-center h-10 w-10 rounded-full bg-[color:var(--color-surface-2)] border border-[color:var(--color-border)] hover:border-[color:var(--color-accent)] transition-colors cursor-pointer"
      >
        <BellIcon />
        {unreadCount > 0 ? (
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[color:var(--color-accent)] text-black text-[10px] font-heading flex items-center justify-center"
            aria-hidden
          >
            {badgeLabel}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-12 w-[22rem] max-w-[calc(100vw-2rem)] rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] shadow-xl z-50 overflow-hidden"
        >
          <header className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--color-border)]">
            <span className="font-heading text-[11px] tracking-widest">
              NOTIFICATIONS
            </span>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-white cursor-pointer"
              >
                MARK ALL READ
              </button>
            ) : null}
          </header>

          {recent.length === 0 ? (
            <p className="px-3 py-6 text-xs text-center text-[color:var(--color-text-muted)] italic">
              Nothing here yet. Notifications show up when your week is
              closing, your quarter is wrapping, or a goal midpoint hits.
            </p>
          ) : (
            <ul className="max-h-[70vh] overflow-y-auto divide-y divide-[color:var(--color-border)]">
              {recent.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleRowClick(n)}
                    className={`w-full text-left px-3 py-2.5 flex items-start gap-3 hover:bg-[color:var(--color-surface-2)] transition-colors cursor-pointer ${
                      n.read_at === null
                        ? "bg-[color:var(--color-accent)]/[0.06]"
                        : ""
                    }`}
                  >
                    <KindIcon kind={n.kind} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">{n.title}</p>
                      {n.body ? (
                        <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5 leading-snug">
                          {n.body}
                        </p>
                      ) : null}
                      <p className="text-[10px] text-[color:var(--color-text-muted)] mt-1">
                        {relativeTime(n.created_at)}
                      </p>
                    </div>
                    {n.read_at === null ? (
                      <span
                        className="mt-1.5 inline-block h-2 w-2 rounded-full bg-[color:var(--color-accent)] shrink-0"
                        aria-hidden
                      />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BellIcon() {
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
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function KindIcon({ kind }: { kind: NotificationKind }) {
  const label = LABEL_BY_KIND[kind] ?? kind[0]?.toUpperCase() ?? "•";
  return (
    <span
      className="mt-0.5 h-6 w-6 shrink-0 rounded-full flex items-center justify-center font-heading text-[10px] bg-[color:var(--color-surface-2)] border border-[color:var(--color-border)] text-[color:var(--color-text-muted)]"
      aria-hidden
    >
      {label}
    </span>
  );
}

const LABEL_BY_KIND: Record<NotificationKind, string> = {
  daily_reminder: "D",
  week_lock: "W",
  weekly_digest: "∑",
  quarter_closing: "Q",
  goal_midpoint: "½",
  help_content_stale: "?",
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86_400);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
