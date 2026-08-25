import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ThreadView } from "./thread-view";

export const dynamic = "force-dynamic";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { user } = await requireAccess();
  const { threadId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: threadRow } = await supabase
    .from("message_threads")
    .select(
      "id, participant_a, participant_b, " +
        "pa:participant_a(first_name, last_name, email, avatar_url), " +
        "pb:participant_b(first_name, last_name, email, avatar_url)",
    )
    .eq("id", threadId)
    .maybeSingle();
  if (!threadRow) notFound();
  const thread = threadRow as unknown as {
    id: string;
    participant_a: string;
    participant_b: string;
    pa: UserBits | UserBits[] | null;
    pb: UserBits | UserBits[] | null;
  };
  if (thread.participant_a !== user.id && thread.participant_b !== user.id) {
    // RLS would already block a non-participant query — this is a
    // belt-and-suspenders 404 in case something changed under us.
    notFound();
  }

  const otherIsA = thread.participant_b === user.id;
  const otherRaw = otherIsA ? thread.pa : thread.pb;
  const other = Array.isArray(otherRaw) ? otherRaw[0] : otherRaw;
  const otherUserId = otherIsA ? thread.participant_a : thread.participant_b;

  // Initial batch of messages — realtime picks it up from here.
  // Descending fetch + reverse so we get the newest N; UI renders
  // oldest-first as a scrolling conversation.
  const { data: initialRaw } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at, read_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(100);
  const initial = ((initialRaw ?? []) as Array<{
    id: string;
    sender_id: string;
    body: string;
    created_at: string;
    read_at: string | null;
  }>).reverse();

  // Reactions on those messages.
  const messageIds = initial.map((m) => m.id);
  const { data: reactionRows } = messageIds.length
    ? await supabase
        .from("message_reactions")
        .select("message_id, user_id, emoji")
        .in("message_id", messageIds)
    : { data: [] };
  const reactions = (reactionRows ?? []) as Array<{
    message_id: string;
    user_id: string;
    emoji: string;
  }>;

  return (
    <ThreadView
      threadId={threadId}
      viewerId={user.id}
      other={{
        userId: otherUserId,
        name:
          [other?.first_name, other?.last_name].filter(Boolean).join(" ") ||
          (other?.email ?? "Brother"),
        firstName: other?.first_name ?? null,
        lastName: other?.last_name ?? null,
        email: other?.email ?? "",
        avatarUrl: other?.avatar_url ?? null,
      }}
      initialMessages={initial}
      initialReactions={reactions}
    />
  );
}

type UserBits = {
  first_name: string | null;
  last_name: string | null;
  email: string;
  avatar_url: string | null;
};
