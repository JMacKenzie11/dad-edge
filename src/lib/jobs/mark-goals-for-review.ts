import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { daysUntilQuarterEnd, getCurrentQuarter } from "@/lib/scoring/quarters";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import type { JobResult } from "@/lib/jobs/utils";

/** Days before quarter-end at which the retrospective prompt starts
 *  firing. 7 gives the coachee a full final week with the quarter
 *  still live to reflect while the memory's fresh — waiting until
 *  quarter-end proper meant he'd already moved on by the time the
 *  prompt appeared. */
export const REVIEW_LEAD_DAYS = 7;

/**
 * Transition any still-active goal into `needs_review` once its
 * quarter is within REVIEW_LEAD_DAYS of ending. The /today and
 * /goals surfaces render a dismissible retrospective prompt when a
 * needs_review goal exists so the coachee can close it out.
 *
 * Two cases handled:
 *   1. Prior-quarter goals (safety net for missed cron runs) —
 *      always transitioned regardless of lead window.
 *   2. Current-quarter goals — transitioned only when we're within
 *      REVIEW_LEAD_DAYS of quarter-end.
 *
 * ITC-sourced goals: also flagged. The ITC map's own close-out flow
 * lives at the ITC `done` stage, but if a coachee lets an ITC map
 * sit past quarter-end without advancing it, we still surface the
 * review prompt — the answer just links them back into the map.
 */
export async function runMarkGoalsForReview(
  now: Date = new Date(),
): Promise<JobResult> {
  const svc = createSupabaseServiceClient();
  const q = getCurrentQuarter(now);
  const daysLeft = daysUntilQuarterEnd(now);

  // Case 1: prior-quarter goals. Safety net for a cron run that
  // missed the boundary window on the prior quarter.
  const { data: stale, error: staleErr } = await svc
    .from("quarterly_goals")
    .update({ status: "needs_review" })
    .eq("status", "active")
    .lt("quarter_start", q.startIso)
    .select("id, user_id, quarter_start, desired_end_state");
  if (staleErr) {
    return {
      job: "mark-goals-for-review",
      ok: false,
      errors: [staleErr.message],
    };
  }

  // Case 2: current-quarter goals within the lead window.
  type FlippedGoal = {
    id: string;
    user_id: string;
    quarter_start: string;
    desired_end_state: string;
  };
  let currentRows: FlippedGoal[] = [];
  if (daysLeft <= REVIEW_LEAD_DAYS) {
    const { data: current, error: currentErr } = await svc
      .from("quarterly_goals")
      .update({ status: "needs_review" })
      .eq("status", "active")
      .eq("quarter_start", q.startIso)
      .select("id, user_id, quarter_start, desired_end_state");
    if (currentErr) {
      return {
        job: "mark-goals-for-review",
        ok: false,
        errors: [currentErr.message],
      };
    }
    currentRows = (current ?? []) as FlippedGoal[];
  }

  // One bell row per goal that just flipped. Dedup by
  // (quarter_start, goal_id) so re-runs post-flip (goal is no longer
  // 'active', so the UPDATE returns nothing) can't double-notify.
  const flipped = ([...((stale ?? []) as FlippedGoal[]), ...currentRows]);
  for (const g of flipped) {
    await enqueueNotification({
      userId: g.user_id,
      kind: "quarter_closing",
      dedupKey: `${g.quarter_start}:${g.id}`,
      title: "Wrap this goal.",
      body: truncate(g.desired_end_state, 90),
      deepLink: "/goals",
      targetType: "goal",
      targetId: g.id,
    });
  }

  return {
    job: "mark-goals-for-review",
    ok: true,
    processed: (stale ?? []).length + currentRows.length,
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
