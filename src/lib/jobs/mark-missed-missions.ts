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
  const yesterday = format(new Date(now.getTime() - 86400_000), "yyyy-MM-dd");
  const { data, error } = await svc
    .from("missions")
    .update({ status: "missed" })
    .eq("status", "planned")
    .lt("target_date", yesterday)
    .select("id");
  if (error) {
    return { job: "mark-missed", ok: false, errors: [error.message] };
  }
  return { job: "mark-missed", ok: true, processed: (data ?? []).length };
}
