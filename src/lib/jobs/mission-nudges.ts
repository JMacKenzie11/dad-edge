import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { sendMissionDayNudgeEmail } from "@/lib/email";
import { localDate } from "@/lib/scoring/week";
import { localHour } from "@/lib/jobs/timezones";
import type { JobResult } from "@/lib/jobs/utils";

/**
 * "Date night is tonight. Report back." (§8).
 * Fires once per mission on EACH scheduled day. Multi-day missions
 * (target_dates = [Mon, Wed, Fri]) nudge on each of those days. We
 * send when the local hour hits the community's morning (8:00 default)
 * so the man sees it before the day starts. Idempotency by hourly
 * window: we send only when localHour is 8.
 */
export async function runMissionDayNudges(
  now: Date = new Date(),
  options?: { force?: boolean },
): Promise<JobResult> {
  const svc = createSupabaseServiceClient();
  const { data: communities } = await svc
    .from("communities")
    .select("id, timezone")
    .eq("status", "active");

  const errors: string[] = [];
  let sent = 0;

  for (const c of (communities ?? []) as { id: string; timezone: string }[]) {
    // Force bypass mirrors runDailyReminders — the target_date filter
    // still limits the send to missions dated today in the community's
    // local calendar, so force can't blast future missions.
    if (!options?.force && localHour(now, c.timezone) !== 8) continue;
    const today = localDate(now, c.timezone);

    // Match missions where today is any of the scheduled days —
    // multi-day missions nudge on each of their scheduled days.
    const { data: missions } = await svc
      .from("missions")
      .select("id, description, user_id, users:user_id(email, first_name)")
      .eq("community_id", c.id)
      .eq("status", "planned")
      .contains("target_dates", [today]);

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
