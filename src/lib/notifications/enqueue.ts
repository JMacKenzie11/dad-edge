import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * All notification kinds the app can emit. Keep in sync with the
 * bell UI's per-kind icon + label handling.
 */
export type NotificationKind =
  | "daily_reminder"
  | "week_lock"
  | "weekly_digest"
  | "quarter_closing"
  | "goal_midpoint";

type EnqueueInput = {
  userId: string;
  kind: NotificationKind;
  /** Idempotency key. Same (user, kind, dedup_key) triple is inserted once.
   *  See migration comment for the convention per kind. */
  dedupKey: string;
  title: string;
  body?: string;
  deepLink: string;
  targetType?: "goal" | "week" | "digest" | "check_in";
  targetId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Insert one notification row. Safe to call from a re-runnable cron
 * job — a conflict on (user_id, kind, dedup_key) silently no-ops so
 * the same daily reminder never lands twice in the bell.
 *
 * Returns { inserted: true } when the row was actually written,
 * { inserted: false } on dedup conflict. Callers usually don't care
 * (fire-and-forget), but tests + the digest job use it to count.
 */
export async function enqueueNotification(
  input: EnqueueInput,
): Promise<{ inserted: boolean; error?: string }> {
  const svc = createSupabaseServiceClient();
  // upsert with ignoreDuplicates gives us the ON CONFLICT DO NOTHING
  // semantics we want. select() returns [] on conflict, [row] on insert.
  const { data, error } = await svc
    .from("notifications")
    .upsert(
      {
        user_id: input.userId,
        kind: input.kind,
        dedup_key: input.dedupKey,
        title: input.title,
        body: input.body ?? null,
        deep_link: input.deepLink,
        target_type: input.targetType ?? null,
        target_id: input.targetId ?? null,
        metadata: input.metadata ?? {},
      },
      { onConflict: "user_id,kind,dedup_key", ignoreDuplicates: true },
    )
    .select("id");
  if (error) return { inserted: false, error: error.message };
  return { inserted: (data?.length ?? 0) > 0 };
}
