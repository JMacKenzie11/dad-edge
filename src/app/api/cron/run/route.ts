import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runDailyReminders } from "@/lib/jobs/daily-reminders";
import { runMissionDayNudges } from "@/lib/jobs/mission-nudges";
import { runDisengagementScan } from "@/lib/jobs/disengagement-scan";
import { runWeekLock } from "@/lib/jobs/week-lock";
import { runMarkMissedMissions } from "@/lib/jobs/mark-missed-missions";
import { runWeeklyDigest } from "@/lib/jobs/digest";
import { runExemplarNovelty } from "@/lib/jobs/exemplar-novelty";
import { auditLog } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * On-demand job runner for platform admins. Useful in dev and for manual
 * catch-up runs in prod. Requires the caller to be a signed-in platform admin
 * (session-based, not cron-secret).
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: row } = await supabase
    .from("users")
    .select("is_platform_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!(row as { is_platform_admin: boolean } | null)?.is_platform_admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const job = url.searchParams.get("job") ?? "";
  const now = new Date();

  let result;
  switch (job) {
    case "daily-reminders":
      result = await runDailyReminders(now);
      break;
    case "mission-nudges":
      result = await runMissionDayNudges(now);
      break;
    case "disengagement":
      result = await runDisengagementScan(now);
      break;
    case "week-lock":
      result = await runWeekLock(now);
      break;
    case "mark-missed":
      result = await runMarkMissedMissions(now);
      break;
    case "digest":
      result = await runWeeklyDigest(now);
      break;
    case "exemplar-novelty":
      result = await runExemplarNovelty(now);
      break;
    default:
      return NextResponse.json(
        {
          error: "unknown job",
          available: [
            "daily-reminders",
            "mission-nudges",
            "disengagement",
            "week-lock",
            "mark-missed",
            "digest",
            "exemplar-novelty",
          ],
        },
        { status: 400 },
      );
  }

  await auditLog({
    actor_user_id: user.id,
    action: "job.manual_run",
    metadata: { job, result: result as unknown as Record<string, unknown> },
  });

  return NextResponse.json(result);
}
