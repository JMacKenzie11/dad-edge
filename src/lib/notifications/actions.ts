"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Mark one notification read. RLS scopes the update to the caller's
 * own rows — no explicit user_id check needed here beyond the auth
 * guard. Called when the user clicks a bell row.
 */
export async function markNotificationRead(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  // Layout re-renders on the next navigation so the badge updates.
  revalidatePath("/", "layout");
}

/**
 * Mark all of the current user's unread notifications read. Used by
 * the dropdown's "Mark all read" affordance.
 */
export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  revalidatePath("/", "layout");
}
