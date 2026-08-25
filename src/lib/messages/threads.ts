import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Sort two user ids into canonical order so (a, b) pair is stable
 * regardless of who started the thread. Matches the DB CHECK
 * constraint on message_threads.
 */
export function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Find or create the thread between two users. Enforces the "must
 * share an active community" rule server-side before insert — matches
 * the RLS policy on the messages migration, but running the check
 * here too lets us return a friendly error instead of an opaque RLS
 * violation.
 *
 * Returns { threadId } on success, { error } if the pair aren't
 * allowed to message (no shared community, self-message, etc.).
 */
export async function findOrCreateThread(
  viewerId: string,
  otherUserId: string,
): Promise<{ threadId: string } | { error: string }> {
  if (viewerId === otherUserId) {
    return { error: "You can't message yourself." };
  }
  const svc = createSupabaseServiceClient();

  const [a, b] = canonicalPair(viewerId, otherUserId);

  // Existing thread?
  const { data: existing } = await svc
    .from("message_threads")
    .select("id")
    .eq("participant_a", a)
    .eq("participant_b", b)
    .maybeSingle();
  if (existing) return { threadId: (existing as { id: string }).id };

  // Shared-community precheck (mirrors RLS). Fetch both sides,
  // intersect in JS — cheap since each user is in ~1 community.
  // Running the check here means the RLS violation on a bad pair
  // never fires, and we can return a friendly error string instead.
  const [{ data: aRows }, { data: bRows }] = await Promise.all([
    svc.from("memberships").select("community_id").eq("user_id", a).eq("status", "active"),
    svc.from("memberships").select("community_id").eq("user_id", b).eq("status", "active"),
  ]);
  const aSet = new Set(
    ((aRows ?? []) as Array<{ community_id: string }>).map((r) => r.community_id),
  );
  const sharesCommunity = ((bRows ?? []) as Array<{ community_id: string }>).some(
    (r) => aSet.has(r.community_id),
  );
  if (!sharesCommunity) {
    return { error: "You can only message brothers in your community." };
  }

  // Create.
  const { data: created, error } = await svc
    .from("message_threads")
    .insert({ participant_a: a, participant_b: b })
    .select("id")
    .single();
  if (error || !created) {
    return { error: error?.message ?? "Could not create thread." };
  }
  return { threadId: (created as { id: string }).id };
}

/**
 * Load the viewer's inbox: all threads they participate in, most-
 * recently-active first, with the other participant's basic info +
 * unread count + last message preview.
 */
export async function loadInbox(viewerId: string): Promise<
  Array<{
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
  }>
> {
  const supabase = await createSupabaseServerClient();

  const { data: threadRows } = await supabase
    .from("message_threads")
    .select(
      "id, participant_a, participant_b, last_message_at, " +
        "pa:participant_a(first_name, last_name, email, avatar_url), " +
        "pb:participant_b(first_name, last_name, email, avatar_url)",
    )
    .or(`participant_a.eq.${viewerId},participant_b.eq.${viewerId}`)
    .order("last_message_at", { ascending: false, nullsFirst: false });

  const threads = (threadRows ?? []) as unknown as Array<{
    id: string;
    participant_a: string;
    participant_b: string;
    last_message_at: string | null;
    pa: UserBits | UserBits[] | null;
    pb: UserBits | UserBits[] | null;
  }>;
  if (threads.length === 0) return [];

  const threadIds = threads.map((t) => t.id);

  // Batch the "last message" preview per thread. Only the most
  // recent message per thread — fine to fetch a batch since inbox
  // caps at whatever the user actually has (small).
  const { data: lastMessages } = await supabase
    .from("messages")
    .select("thread_id, sender_id, body, created_at")
    .in("thread_id", threadIds)
    .order("created_at", { ascending: false });
  const lastByThread = new Map<
    string,
    { sender_id: string; body: string; created_at: string }
  >();
  for (const m of (lastMessages ?? []) as Array<{
    thread_id: string;
    sender_id: string;
    body: string;
    created_at: string;
  }>) {
    if (!lastByThread.has(m.thread_id)) {
      lastByThread.set(m.thread_id, {
        sender_id: m.sender_id,
        body: m.body,
        created_at: m.created_at,
      });
    }
  }

  // Unread counts per thread.
  const { data: unreadRows } = await supabase
    .from("messages")
    .select("thread_id")
    .in("thread_id", threadIds)
    .neq("sender_id", viewerId)
    .is("read_at", null);
  const unreadByThread = new Map<string, number>();
  for (const r of (unreadRows ?? []) as Array<{ thread_id: string }>) {
    unreadByThread.set(
      r.thread_id,
      (unreadByThread.get(r.thread_id) ?? 0) + 1,
    );
  }

  return threads.map((t) => {
    const otherIsA = t.participant_b === viewerId;
    const otherRaw = otherIsA ? t.pa : t.pb;
    const other = Array.isArray(otherRaw) ? otherRaw[0] : otherRaw;
    const last = lastByThread.get(t.id) ?? null;
    return {
      threadId: t.id,
      otherUserId: otherIsA ? t.participant_a : t.participant_b,
      otherName:
        [other?.first_name, other?.last_name].filter(Boolean).join(" ") ||
        (other?.email ?? "Brother"),
      otherAvatarUrl: other?.avatar_url ?? null,
      otherFirstName: other?.first_name ?? null,
      otherLastName: other?.last_name ?? null,
      otherEmail: other?.email ?? "",
      lastMessagePreview: last?.body ?? null,
      lastMessageAt: last?.created_at ?? t.last_message_at,
      lastMessageFromMe: last ? last.sender_id === viewerId : false,
      unreadCount: unreadByThread.get(t.id) ?? 0,
    };
  });
}

type UserBits = {
  first_name: string | null;
  last_name: string | null;
  email: string;
  avatar_url: string | null;
};

/**
 * Mark every unread message addressed to the viewer as read. Called
 * when the viewer lands on the /messages inbox — visiting the inbox
 * counts as "consuming the notification" (we don't surface read
 * receipts anywhere, so this only affects the unread badge). Opening
 * a specific thread later still works fine; there just won't be
 * anything left to mark.
 */
export async function markAllMessagesReadForViewer(viewerId: string): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .neq("sender_id", viewerId)
      .is("read_at", null);
  } catch (err) {
    console.warn(
      "[messages] markAllMessagesReadForViewer failed for user=%s: %s",
      viewerId,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Total distinct threads with at least one unread message. Drives
 * the header speech-bubble badge and the nav item badge.
 */
export async function getUnreadThreadCount(viewerId: string): Promise<number> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("messages")
      .select("thread_id")
      .neq("sender_id", viewerId)
      .is("read_at", null);
    const set = new Set<string>();
    for (const r of (data ?? []) as Array<{ thread_id: string }>) {
      set.add(r.thread_id);
    }
    return set.size;
  } catch (err) {
    console.warn(
      "[messages] getUnreadThreadCount failed for user=%s: %s",
      viewerId,
      err instanceof Error ? err.message : String(err),
    );
    return 0;
  }
}
