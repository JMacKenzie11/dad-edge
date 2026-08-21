import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getCurrentQuarter } from "@/lib/scoring/quarters";
import type { JobResult } from "@/lib/jobs/utils";

/**
 * Once a quarter has ended, transition any still-active goal from that
 * quarter into `needs_review`. The /today and /goals surfaces render a
 * dismissible prompt when a needs_review goal exists so the coachee can
 * close it out (or leave it and be re-prompted next visit).
 *
 * ITC-sourced goals: also flagged. The ITC map's own close-out flow
 * lives at the ITC `done` stage, but if a coachee lets an ITC map sit
 * past quarter-end without advancing it, we still surface the review
 * prompt on /goals — the answer just links them back into the map.
 * (The prompt UI treats source='itc' goals as read-only and points to
 * the ITC tool for the actual close-out.)
 */
export async function runMarkGoalsForReview(
  now: Date = new Date(),
): Promise<JobResult> {
  const svc = createSupabaseServiceClient();
  const q = getCurrentQuarter(now);
  // Any active goal whose quarter_start is strictly earlier than the
  // current quarter's start is a past-quarter goal that never got
  // closed. Move to needs_review.
  const { data, error } = await svc
    .from("quarterly_goals")
    .update({ status: "needs_review" })
    .eq("status", "active")
    .lt("quarter_start", q.startIso)
    .select("id");
  if (error) {
    return {
      job: "mark-goals-for-review",
      ok: false,
      errors: [error.message],
    };
  }
  return {
    job: "mark-goals-for-review",
    ok: true,
    processed: (data ?? []).length,
  };
}
