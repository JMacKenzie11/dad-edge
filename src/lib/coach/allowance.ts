import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * §6 cost control: monthly message allowance per user. Soft-capped with a
 * friendly ceiling — the coach still responds but nudges the man to be
 * intentional. Hard cap at 2×soft cap prevents runaway spend.
 */
export const SOFT_CAP = 150;
export const HARD_CAP = 300;

export type AllowanceState = {
  used: number;
  softCap: number;
  hardCap: number;
  remaining: number;
  bucket: "ok" | "warn" | "block";
  since: string; // ISO of month start
};

function monthStartISO(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return d.toISOString();
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
  const bucket: AllowanceState["bucket"] =
    used >= HARD_CAP ? "block" : used >= SOFT_CAP ? "warn" : "ok";

  return { used, softCap: SOFT_CAP, hardCap: HARD_CAP, remaining, bucket, since };
}
