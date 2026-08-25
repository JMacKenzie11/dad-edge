import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { localMonday, weekDates } from "@/lib/scoring/week";
import { sendWeekCloseEmail } from "@/lib/email";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { format, addDays, differenceInCalendarDays } from "date-fns";
import type { JobResult } from "@/lib/jobs/utils";

/**
 * §4: weeks lock N days after they end (default 3, per-community override).
 * This job:
 *   - Ensures a weeks row exists for the current and prior week per community
 *     (idempotent by unique (community_id, start_date))
 *   - Marks prior weeks locked once `now >= week_end + week_lock_days`
 *   - Sends the "week locks in X days" close notice to members with unlogged days
 *     when we're 2 days before lock (§8)
 */
export async function runWeekLock(now: Date = new Date()): Promise<JobResult> {
  const svc = createSupabaseServiceClient();

  const { data: communities } = await svc
    .from("communities")
    .select("id, timezone, week_lock_days")
    .eq("status", "active");

  let processed = 0;
  let sent = 0;
  const errors: string[] = [];

  for (const c of (communities ?? []) as { id: string; timezone: string; week_lock_days: number }[]) {
    const thisMonday = localMonday(now, c.timezone);
    const lastMondayDate = addDays(new Date(`${thisMonday}T00:00:00`), -7);
    const lastMonday = format(lastMondayDate, "yyyy-MM-dd");

    // Ensure weeks rows exist for both.
    for (const monday of [lastMonday, thisMonday]) {
      const { data: existing } = await svc
        .from("weeks")
        .select("id")
        .eq("community_id", c.id)
        .eq("start_date", monday)
        .maybeSingle();
      if (!existing) {
        await svc.from("weeks").insert({ community_id: c.id, start_date: monday });
      }
    }

    // Lock last week if we're past the lock window.
    const lastWeekEnd = addDays(lastMondayDate, 6);
    const daysAfterEnd = differenceInCalendarDays(now, lastWeekEnd);
    if (daysAfterEnd >= c.week_lock_days) {
      const { error } = await svc
        .from("weeks")
        .update({ locked_at: new Date().toISOString() })
        .eq("community_id", c.id)
        .eq("start_date", lastMonday)
        .is("locked_at", null);
      if (error) errors.push(`lock ${c.id}: ${error.message}`);
      processed += 1;
    }

    // Warn members 2 days before lock.
    const warnDayOffset = c.week_lock_days - 2;
    if (daysAfterEnd === warnDayOffset && warnDayOffset >= 0) {
      const locksAtDate = addDays(lastWeekEnd, c.week_lock_days);
      const locksAt = format(locksAtDate, "EEEE MMM d");

      const week = weekDates(lastMonday);
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

      const loggedDaysByUser = new Map<string, Set<string>>();
      const weekTotalByUser = new Map<string, number>();
      for (const r of (rows ?? []) as { user_id: string; date: string; value: number }[]) {
        let s = loggedDaysByUser.get(r.user_id);
        if (!s) {
          s = new Set();
          loggedDaysByUser.set(r.user_id, s);
        }
        s.add(r.date);
        if (r.value === 1) weekTotalByUser.set(r.user_id, (weekTotalByUser.get(r.user_id) ?? 0) + 1);
      }

      for (const m of (members ?? []) as {
        user_id: string;
        users: { email: string; first_name: string | null } | { email: string; first_name: string | null }[] | null;
      }[]) {
        const u = Array.isArray(m.users) ? m.users[0] : m.users;
        if (!u) continue;
        const days = loggedDaysByUser.get(m.user_id) ?? new Set<string>();
        const unlogged = week.filter((d) => !days.has(d)).length;
        const res = await sendWeekCloseEmail({
          to: u.email,
          firstName: u.first_name,
          weekTotal: weekTotalByUser.get(m.user_id) ?? 0,
          daysUnlogged: unlogged,
          locksAt,
        });
        if (res.ok) sent += 1;
        else errors.push(`week-close ${u.email}: ${res.error}`);
        // Bell row. Dedup by the week's Monday — re-running the job
        // inside the 2-day-before window won't double-post.
        await enqueueNotification({
          userId: m.user_id,
          kind: "week_lock",
          dedupKey: lastMonday,
          title: `Week locks ${locksAt}.`,
          body:
            unlogged > 0
              ? `${unlogged} day${unlogged === 1 ? "" : "s"} unlogged.`
              : "All days logged. Finish strong.",
          deepLink: "/today",
          targetType: "week",
        });
      }
    }
  }

  return { job: "week-lock", ok: errors.length === 0, processed, sent, errors };
}
