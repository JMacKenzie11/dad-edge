import { NextRequest, NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/jobs/utils";
import { runDailyReminders } from "@/lib/jobs/daily-reminders";
import { runMissionDayNudges } from "@/lib/jobs/mission-nudges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs every hour. Handles time-of-day jobs that must fire when the local
 * community timezone matches a target hour.
 */
export async function GET(req: NextRequest) {
  const unauth = assertCronAuth(req);
  if (unauth) return unauth;

  const now = new Date();
  const results = await Promise.all([
    runDailyReminders(now),
    runMissionDayNudges(now),
  ]);
  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, results });
}
