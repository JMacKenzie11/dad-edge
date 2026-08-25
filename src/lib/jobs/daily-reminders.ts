import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { sendDailyReminderEmail } from "@/lib/email";
import { localDate, localMonday, weekDates } from "@/lib/scoring/week";
import { isWithinReminderWindow } from "@/lib/jobs/timezones";
import { engagementStreaksByUser } from "@/lib/scoring/streaks";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import type { JobResult } from "@/lib/jobs/utils";

/**
 * Send today's log-your-check-in reminder to members whose community reminder
 * hour has just passed (in the *community* timezone; per-user preferences can
 * come later — §8 lists per-user time as a phase 1 nice-to-have).
 */
export async function runDailyReminders(
  now: Date = new Date(),
  options?: { force?: boolean },
): Promise<JobResult> {
  const svc = createSupabaseServiceClient();
  const { data: communities } = await svc
    .from("communities")
    .select("id, timezone, nudge:nudge_settings(daily_reminder_time)")
    .eq("status", "active");

  const errors: string[] = [];
  let sent = 0;
  // Users in multiple communities would otherwise get one email per
  // community they're in — the outer loop is per-community and the
  // check-in table itself isn't community-scoped, so the "did they
  // log today?" filter fires per-community independently. Track the
  // set of users we've already reminded this run and skip repeats.
  // Force mode surfaced this most sharply since it processes every
  // community regardless of reminder-hour alignment.
  const sentUserIds = new Set<string>();

  for (const c of (communities ?? []) as {
    id: string;
    timezone: string;
    nudge: { daily_reminder_time: string } | { daily_reminder_time: string }[] | null;
  }[]) {
    const nudge = Array.isArray(c.nudge) ? c.nudge[0] : c.nudge;
    const reminderTime = nudge?.daily_reminder_time ?? "18:00";
    // Force bypass: skip the time-of-day gate so a platform admin
    // can trigger a full pass from /admin/jobs regardless of the
    // clock. Emails + bell rows still respect per-user dedup + the
    // "already logged today?" filter, so force can't produce dupes.
    if (
      !options?.force &&
      !isWithinReminderWindow(now, c.timezone, reminderTime.slice(0, 5))
    ) {
      continue;
    }

    const today = localDate(now, c.timezone);
    const monday = localMonday(now, c.timezone);
    const week = weekDates(monday);

    const { data: members } = await svc
      .from("memberships")
      .select("user_id, users:user_id(email, first_name)")
      .eq("community_id", c.id)
      .eq("status", "active");
    const memberIds = (members ?? []).map((m) => (m as { user_id: string }).user_id);
    if (memberIds.length === 0) continue;

    const { data: rows } = await svc
      .from("daily_checkins")
      .select("user_id, date, value")
      .in("user_id", memberIds)
      .in("date", week);

    const loggedToday = new Set<string>();
    const weekTotal = new Map<string, number>();
    for (const r of (rows ?? []) as { user_id: string; date: string; value: number }[]) {
      if (r.date === today) loggedToday.add(r.user_id);
      if (r.value === 1) weekTotal.set(r.user_id, (weekTotal.get(r.user_id) ?? 0) + 1);
    }

    const streaks = engagementStreaksByUser(
      ((rows ?? []) as { user_id: string; date: string; pillar_code: string; value: number }[]).filter(
        (r) => r.date < today,
      ),
      new Date(new Date(`${today}T00:00:00`).getTime() - 86400_000).toISOString().slice(0, 10),
    );

    for (const m of (members ?? []) as {
      user_id: string;
      users: { email: string; first_name: string | null } | { email: string; first_name: string | null }[] | null;
    }[]) {
      if (loggedToday.has(m.user_id)) continue;
      if (sentUserIds.has(m.user_id)) continue;
      const u = Array.isArray(m.users) ? m.users[0] : m.users;
      if (!u) continue;
      sentUserIds.add(m.user_id);
      const res = await sendDailyReminderEmail({
        to: u.email,
        firstName: u.first_name,
        weekTotal: weekTotal.get(m.user_id) ?? 0,
        streak: streaks[m.user_id] ?? 0,
      });
      if (res.ok) sent += 1;
      else errors.push(`${u.email}: ${res.error}`);
      // In-app bell row alongside the email. Dedup on today so a
      // reminder that fires once per day never doubles up if the
      // job re-runs within the window.
      await enqueueNotification({
        userId: m.user_id,
        kind: "daily_reminder",
        dedupKey: today,
        title: "Log today.",
        body: `${weekTotal.get(m.user_id) ?? 0}/49 this week.`,
        deepLink: "/today",
      });
    }
  }

  return { job: "daily-reminders", ok: errors.length === 0, sent, errors };
}
