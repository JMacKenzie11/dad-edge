import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { judgeMissingFits } from "@/lib/coaching/fit";
import { coachableIds, coachingWindow } from "@/lib/coaching/load";
import type { JobResult } from "@/lib/jobs/utils";

/** Most fit checks one nightly run makes; the rest wait for the next night or a page open. */
export const FIT_JOB_LIMIT = 150;

/**
 * Nightly: run the Coaching pages' fit check on goal-linked missions from
 * the last eight weeks that have no verdict, or whose wording or goal
 * changed. Opening a man's Coaching page checks his on the spot, so this
 * just keeps the community view and the Monday email current.
 */
export async function runMissionGoalFit(now: Date = new Date()): Promise<JobResult> {
  const svc = createSupabaseServiceClient();
  const { data: communities } = await svc
    .from("communities")
    .select("id, name, timezone")
    .eq("status", "active")
    .not("name", "ilike", "[IT-TEST]%");
  let judged = 0;
  let failed = 0;
  let pending = 0;
  let budget = FIT_JOB_LIMIT;
  for (const c of (communities ?? []) as { id: string; name: string; timezone: string }[]) {
    if (budget <= 0) break;
    const ids = (await coachableIds(svc, c.id, null)).map((m) => m.userId);
    const r = await judgeMissingFits(svc, { userIds: ids, from: coachingWindow(c, now).from, limit: budget });
    judged += r.judged;
    failed += r.failed;
    pending += r.pending;
    budget -= r.judged + r.failed;
  }
  return { job: "mission-goal-fit", ok: failed === 0, processed: judged, detail: { failed, pending } };
}
