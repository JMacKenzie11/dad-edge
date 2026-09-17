import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { format } from "date-fns";
import type { JobResult } from "@/lib/jobs/utils";

/**
 * Every day at UTC midnight, mark yesterday's-and-earlier planned missions as
 * `missed`. The user can still complete them (marked completed_late) via the
 * existing action; this just keeps the UI honest.
 */
export async function runMarkMissedMissions(now: Date = new Date()): Promise<JobResult> {
  const svc = createSupabaseServiceClient();
  const today = format(now, "yyyy-MM-dd");
  const yesterday = format(new Date(now.getTime() - 86400_000), "yyyy-MM-dd");

  // Heal first: a mission whose day hasn't arrived yet is not missed.
  // Rescheduling a missed mission forward now resets it in the action
  // itself, but rows written before that fix — and any row whose date
  // moves by another path — would otherwise stay missed forever,
  // because the marking pass below only ever writes planned -> missed.
  // Strictly the inverse condition, so the two passes can't fight.
  const { data: healed, error: healError } = await svc
    .from("missions")
    .update({ status: "planned" })
    .eq("status", "missed")
    .gte("target_date", today)
    .select("id");
  if (healError) {
    return { job: "mark-missed", ok: false, errors: [healError.message] };
  }

  const { data, error } = await svc
    .from("missions")
    .update({ status: "missed" })
    .eq("status", "planned")
    .lt("target_date", yesterday)
    .select("id");
  if (error) {
    return { job: "mark-missed", ok: false, errors: [error.message] };
  }
  return {
    job: "mark-missed",
    ok: true,
    processed: (data ?? []).length + (healed ?? []).length,
  };
}
