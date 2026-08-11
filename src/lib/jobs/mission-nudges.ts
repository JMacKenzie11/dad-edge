import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { sendMissionDayNudgeEmail } from "@/lib/email";
import { localDate } from "@/lib/scoring/week";
import { localHour } from "@/lib/jobs/timezones";
import type { JobResult } from "@/lib/jobs/utils";

/**
 * "Date night is tonight. Report back." (§8).
 * Fires once per mission on the target_date. We send when the local hour hits
 * the community's morning (8:00 default) so the man sees it before the day
 * starts. Idempotency is enforced by the daily reminder marker: we skip if we
 * already emailed for this mission today. Since we don't persist a marker,
 * we send only when localHour is 8, giving a single hourly window.
 */
export async function runMissionDayNudges(now: Date = new Date()): Promise<JobResult> {
  const svc = createSupabaseServiceClient();
  const { data: communities } = await svc
    .from("communities")
    .select("id, timezone")
    .eq("status", "active");

  const errors: string[] = [];
  let sent = 0;

  for (const c of (communities ?? []) as { id: string; timezone: string }[]) {
    if (localHour(now, c.timezone) !== 8) continue;
    const today = localDate(now, c.timezone);

    const { data: missions } = await svc
      .from("missions")
      .select("id, description, user_id, users:user_id(email, first_name)")
      .eq("community_id", c.id)
      .eq("status", "planned")
      .eq("target_date", today);

    for (const m of (missions ?? []) as {
      id: string;
      description: string;
      user_id: string;
      users: { email: string; first_name: string | null } | { email: string; first_name: string | null }[] | null;
    }[]) {
      const u = Array.isArray(m.users) ? m.users[0] : m.users;
      if (!u) continue;
      const res = await sendMissionDayNudgeEmail({
        to: u.email,
        firstName: u.first_name,
        missionDescription: m.description,
      });
      if (res.ok) sent += 1;
      else errors.push(`${u.email}/${m.id}: ${res.error}`);
    }
  }

  return { job: "mission-day-nudges", ok: errors.length === 0, sent, errors };
}
