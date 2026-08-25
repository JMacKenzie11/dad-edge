"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Send a text message in a thread. RLS enforces sender_id = auth.uid()
 * and thread membership, but we double-guard here so a broken client
 * hits a clear error path instead of a silent RLS reject.
 *
 * Returns { ok: true, messageId } or { ok: false, error }.
 */
export async function sendMessage(
  threadId: string,
  body: string,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "empty" };
  if (trimmed.length > 4000) {
    return { ok: false, error: "Message too long (max 4000 chars)." };
  }

  // Confirm the caller participates in this thread. RLS would
  // reject too but we want the error surface, not a silent 401.
  const { data: thread } = await supabase
    .from("message_threads")
    .select("participant_a, participant_b")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return { ok: false, error: "Thread not found." };
  const t = thread as { participant_a: string; participant_b: string };
  if (t.participant_a !== user.id && t.participant_b !== user.id) {
    return { ok: false, error: "Not your thread." };
  }

  const { data: inserted, error: insErr } = await supabase
    .from("messages")
    .insert({ thread_id: threadId, sender_id: user.id, body: trimmed })
    .select("id, created_at")
    .single();
  if (insErr || !inserted) {
    return { ok: false, error: insErr?.message ?? "Send failed." };
  }
  const row = inserted as { id: string; created_at: string };

  // Stamp last_message_at on the thread so the inbox sorts right.
  // Service client — the RLS policy on threads UPDATE allows either
  // participant but Postgres treats set-a-timestamp writes with a
  // subquery poorly through the auth client sometimes. Service is
  // safe because we already validated participation above.
  const svc = createSupabaseServiceClient();
  await svc
    .from("message_threads")
    .update({ last_message_at: row.created_at })
    .eq("id", threadId);

  // Layout-scoped revalidate so the inbox + header unread badge on
  // OTHER routes pick up the change on the sender's next navigation.
  // The recipient's client gets it via Realtime, no server help.
  revalidatePath("/messages", "layout");
  return { ok: true, messageId: row.id };
}

/**
 * Mark every unread message from the other participant in a thread
 * as read (by the current user). Called when the recipient opens or
 * scrolls to the bottom of the thread.
 */
export async function markThreadRead(threadId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("thread_id", threadId)
    .neq("sender_id", user.id)
    .is("read_at", null);
  revalidatePath("/messages", "layout");
}

/**
 * Toggle a reaction (one emoji per user per message; toggling sets or
 * clears). Called from the message hover-menu on desktop / long-press
 * on mobile.
 */
export async function toggleReaction(
  messageId: string,
  emoji: string,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: existing } = await supabase
    .from("message_reactions")
    .select("emoji")
    .eq("message_id", messageId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) {
    await supabase
      .from("message_reactions")
      .insert({ message_id: messageId, user_id: user.id, emoji });
    return;
  }
  const currentEmoji = (existing as { emoji: string }).emoji;
  await supabase
    .from("message_reactions")
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", user.id);
  // If tapping a DIFFERENT emoji, insert the new one (the PK is
  // (message_id, user_id) so we can only hold one at a time).
  if (currentEmoji !== emoji) {
    await supabase
      .from("message_reactions")
      .insert({ message_id: messageId, user_id: user.id, emoji });
  }
}
