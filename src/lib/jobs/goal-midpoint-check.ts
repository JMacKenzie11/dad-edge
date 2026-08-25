import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import type { JobResult } from "@/lib/jobs/utils";

/**
 * Nightly: for every user-authored active goal whose midpoint_check_at
 * has arrived (and hasn't been answered yet), drop a bell notification.
 *
 * ITC-sourced goals are skipped — per DECISIONS.md, the ITC map has its
 * own stage-driven cadence and a separate midpoint prompt would be
 * noise. midpoint_check_at is only set at create time for source='user'
 * goals with ≥21 days runway, so this filter is defensive.
 *
 * Idempotent: dedup_key is the goal id, so re-runs after the row lands
 * are no-ops. Once the coachee answers, midpoint_check_answer becomes
 * non-null and the WHERE filter excludes the row entirely.
 */
export async function runGoalMidpointCheck(
  now: Date = new Date(),
): Promise<JobResult> {
  const svc = createSupabaseServiceClient();
  const todayIso = now.toISOString().slice(0, 10);

  const { data, error } = await svc
    .from("quarterly_goals")
    .select("id, user_id, desired_end_state")
    .eq("status", "active")
    .eq("source", "user")
    .not("midpoint_check_at", "is", null)
    .lte("midpoint_check_at", todayIso)
    .is("midpoint_check_answer", null);
  if (error) {
    return {
      job: "goal-midpoint-check",
      ok: false,
      errors: [error.message],
    };
  }

  const rows = (data ?? []) as Array<{
    id: string;
    user_id: string;
    desired_end_state: string;
  }>;

  const errors: string[] = [];
  let enqueued = 0;
  for (const g of rows) {
    const res = await enqueueNotification({
      userId: g.user_id,
      kind: "goal_midpoint",
      dedupKey: g.id,
      title: "Midpoint check.",
      body: truncate(g.desired_end_state, 90),
      deepLink: "/goals",
      targetType: "goal",
      targetId: g.id,
    });
    if (res.error) errors.push(`${g.id}: ${res.error}`);
    if (res.inserted) enqueued += 1;
  }

  return {
    job: "goal-midpoint-check",
    ok: errors.length === 0,
    processed: enqueued,
    errors,
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
