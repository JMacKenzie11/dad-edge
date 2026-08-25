import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { NotificationKind } from "./enqueue";

export type NotificationRow = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  deep_link: string;
  created_at: string;
  read_at: string | null;
  metadata: Record<string, unknown>;
};

/**
 * How many recent notifications the bell dropdown shows. Beyond this
 * we'd need pagination or a full /notifications page; not building
 * either in v1 — 20 covers ~a month of daily reminders for an active
 * coachee.
 */
const RECENT_LIMIT = 20;

/**
 * Load the current user's recent notifications + unread count in one
 * round-trip. Called from the app layout so the bell renders SSR
 * with real data (no post-hydration flicker).
 *
 * Returns empty state on unauthenticated callers — the layout guard
 * runs before us, but returning safely keeps this pure.
 */
export async function getNotificationsForBell(): Promise<{
  unreadCount: number;
  recent: NotificationRow[];
}> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { unreadCount: 0, recent: [] };

  const [{ data: recentRaw }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, kind, title, body, deep_link, created_at, read_at, metadata")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
  ]);

  return {
    unreadCount: count ?? 0,
    recent: (recentRaw ?? []) as NotificationRow[],
  };
}
