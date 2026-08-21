import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * §6 cost control: monthly message allowance per user.
 *
 * Spec (2026-08-27): never hard-block a man mid-conversation about
 * his marriage. Soft cap at 150 messages; when hit, the coach still
 * responds but the UI shows a clear "over your monthly allowance"
 * notice. A quiet indicator appears earlier at 80% (120 messages)
 * so the man sees it coming.
 *
 * Hard cap at 300 (2× soft cap) is the runaway-spend safety net,
 * kept separately from the user-visible allowance semantics. It
 * only fires in the pathological case of someone hammering the
 * endpoint; normal use never approaches it.
 */
export const SOFT_CAP = 150;
export const NOTICE_THRESHOLD = Math.floor(SOFT_CAP * 0.8); // 120
export const HARD_CAP = 300;

export type AllowanceBucket = "ok" | "notice" | "over" | "block";

export type AllowanceState = {
  used: number;
  softCap: number;
  noticeThreshold: number;
  hardCap: number;
  /** Messages remaining under the soft cap. Floors at 0 past the
   *  soft cap. Purely display — the coach still responds in 'over'. */
  remaining: number;
  bucket: AllowanceBucket;
  since: string; // ISO of month start
};

function monthStartISO(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return d.toISOString();
}

function bucketFor(used: number): AllowanceBucket {
  if (used >= HARD_CAP) return "block";
  if (used >= SOFT_CAP) return "over";
  if (used >= NOTICE_THRESHOLD) return "notice";
  return "ok";
}

/**
 * Count user-role messages in the current UTC month across all conversations
 * for this user. Assistant messages aren't counted — the allowance meters
 * user turns, which is the closest proxy to "coaching sessions initiated."
 */
export async function readAllowance(userId: string): Promise<AllowanceState> {
  const svc = createSupabaseServiceClient();
  const since = monthStartISO();

  const { data: convos } = await svc
    .from("coach_conversations")
    .select("id")
    .eq("user_id", userId);
  const convoIds = (convos ?? []).map((c) => (c as { id: string }).id);
  if (convoIds.length === 0) {
    return {
      used: 0,
      softCap: SOFT_CAP,
      noticeThreshold: NOTICE_THRESHOLD,
      hardCap: HARD_CAP,
      remaining: SOFT_CAP,
      bucket: "ok",
      since,
    };
  }

  const { count } = await svc
    .from("coach_messages")
    .select("id", { count: "exact", head: true })
    .in("conversation_id", convoIds)
    .eq("role", "user")
    .gte("created_at", since);

  const used = count ?? 0;
  const remaining = Math.max(0, SOFT_CAP - used);
  return {
    used,
    softCap: SOFT_CAP,
    noticeThreshold: NOTICE_THRESHOLD,
    hardCap: HARD_CAP,
    remaining,
    bucket: bucketFor(used),
    since,
  };
}
