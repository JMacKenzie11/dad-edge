import { NextRequest, NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/jobs/utils";
import { runDisengagementScan } from "@/lib/jobs/disengagement-scan";
import { runWeekLock } from "@/lib/jobs/week-lock";
import { runMarkMissedMissions } from "@/lib/jobs/mark-missed-missions";
import { runMarkGoalsForReview } from "@/lib/jobs/mark-goals-for-review";
import { runWeeklyDigest } from "@/lib/jobs/digest";
import { runExemplarNovelty } from "@/lib/jobs/exemplar-novelty";
import { runGoalMidpointCheck } from "@/lib/jobs/goal-midpoint-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Once-per-day orchestration. Runs after UTC midnight so all timezones have
 * rolled over. The digest is safe to run daily — it self-skips days that
 * aren't Monday because a `digests` row already exists for the current week.
 */
export async function GET(req: NextRequest) {
  const unauth = assertCronAuth(req);
  if (unauth) return unauth;

  const now = new Date();
  const results = await Promise.all([
    runMarkMissedMissions(now),
    runMarkGoalsForReview(now),
    runWeekLock(now),
    runDisengagementScan(now),
    runWeeklyDigest(now),
    runExemplarNovelty(now),
    runGoalMidpointCheck(now),
  ]);
  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, results });
}
