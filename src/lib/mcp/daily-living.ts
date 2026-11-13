import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAll } from "@/lib/supabase/select-all";
import { DAILY_PILLARS_WEEKLY_MAX } from "@/lib/scoring/week";
import type { CountedMan } from "./members";
import { shortName, type WeekRange } from "./mission-results";

/**
 * Daily Living for the MCP tool daily_living (DECISIONS.md "MCP Daily
 * Living"). One number per man per week, never his daily answers.
 *
 * Counted the same way as the leaderboard (src/lib/scoring/leaderboard.ts):
 * one point per daily pillar he checked off (A2 left out; it comes from
 * missions), out of 49 (7 pillars × 7 days). Plus the number of days he
 * checked anything off, 0 to 7.
 */

export type CheckinRow = { user_id: string; date: string; pillar_code: string; value: number };

export type ManDaily = { name: string; score: number; max: number; percent: number; days_checked_in: number };

export type CommunityDaily = {
  week: WeekRange;
  /** Average score across every counted man, no-check-in men included. */
  average: { score: number; max: number; percent: number } | null;
  /** Men with at least one check-in that week, best first. */
  men: ManDaily[];
  no_checkins: string[];
};

const MAX = DAILY_PILLARS_WEEKLY_MAX;
const pct = (n: number) => Math.round((n / MAX) * 100);

export function dailyLiving(men: CountedMan[], checkins: CheckinRow[], week: WeekRange): CommunityDaily {
  const points = new Map<string, Set<string>>();
  const days = new Map<string, Set<string>>();
  for (const c of checkins) {
    if (c.value !== 1 || c.pillar_code === "A2" || c.date < week.start || c.date > week.end) continue;
    // One point per pillar per day, however many rows.
    (points.get(c.user_id) ?? points.set(c.user_id, new Set()).get(c.user_id)!).add(`${c.date}|${c.pillar_code}`);
    (days.get(c.user_id) ?? days.set(c.user_id, new Set()).get(c.user_id)!).add(c.date);
  }
  const rows: ManDaily[] = [];
  const none: string[] = [];
  let sum = 0;
  for (const man of men) {
    const score = Math.min(MAX, points.get(man.userId)?.size ?? 0);
    sum += score;
    if (score === 0) {
      none.push(shortName(man));
      continue;
    }
    rows.push({ name: shortName(man), score, max: MAX, percent: pct(score), days_checked_in: days.get(man.userId)?.size ?? 0 });
  }
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const avg = men.length ? Math.round((sum / men.length) * 10) / 10 : null;
  return {
    week,
    average: avg === null ? null : { score: avg, max: MAX, percent: pct(avg) },
    men: rows,
    no_checkins: none,
  };
}

/** Read what dailyLiving needs for one community's men and week (service client). */
export async function loadDailyLiving(svc: SupabaseClient, men: CountedMan[], week: WeekRange): Promise<CommunityDaily> {
  const ids = men.map((m) => m.userId);
  if (ids.length === 0) return dailyLiving([], [], week);
  const { data } = await selectAll((lo, hi) =>
    svc.from("daily_checkins").select("user_id, date, pillar_code, value").in("user_id", ids).gte("date", week.start).lte("date", week.end).eq("value", 1).order("id").range(lo, hi),
  );
  return dailyLiving(men, (data ?? []) as CheckinRow[], week);
}
