import { addDays, format, parseISO, startOfWeek } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localMonday } from "@/lib/scoring/week";
import type { CountedMan } from "./members";

/**
 * Mission results for the MCP tool mission_results (DECISIONS.md "MCP
 * mission results"). Counts only, never the wording of a goal or mission.
 *
 *   goal missions       missions linked to one of his quarterly goals
 *   BRAVE MAN missions  his other missions, in the BRAVE MAN domains
 *
 * The same counting as the Coaching page (src/lib/coaching/completion.ts):
 * a mission counts in the week of its target date; done means completed,
 * late included; missed, rolled over or never ticked count as not done.
 */

export type Score = { done: number; total: number; percent: number | null };
export type WeekRange = { start: string; end: string };

export type ManResult = { name: string; all: Score; goal_missions: Score; brave_man_missions: Score };

export type CommunityResult = {
  week: WeekRange;
  totals: { all: Score; goal_missions: Score; brave_man_missions: Score };
  /** Men with at least one mission that week, best first. */
  men: ManResult[];
  no_missions: string[];
  no_goals: string[];
};

export type MissionRow = { user_id: string; status: string; target_date: string; quarterly_goal_id: string | null };

const iso = (d: Date) => format(d, "yyyy-MM-dd");

function score(ms: MissionRow[]): Score {
  const done = ms.filter((m) => m.status === "completed").length;
  return { done, total: ms.length, percent: ms.length ? Math.round((done / ms.length) * 100) : null };
}

/** The week to report: the Monday-to-Sunday holding `asked`, or last week in the community's time zone. */
export function reportWeek(asked: string | undefined, timezone: string, now: Date = new Date()): WeekRange {
  const monday = asked
    ? startOfWeek(parseISO(`${asked}T00:00:00`), { weekStartsOn: 1 })
    : addDays(parseISO(`${localMonday(now, timezone)}T00:00:00`), -7);
  return { start: iso(monday), end: iso(addDays(monday, 6)) };
}

/** "Mike R." so two Mikes stay apart; no full surnames leave the app. */
export function shortName(m: Pick<CountedMan, "first_name" | "last_name" | "email">): string {
  const first = m.first_name?.trim() || m.email.split("@")[0];
  const initial = m.last_name?.trim()?.[0];
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

export function missionResults(men: CountedMan[], missions: MissionRow[], withGoals: Set<string>, week: WeekRange): CommunityResult {
  const inWeek = missions.filter((m) => m.target_date >= week.start && m.target_date <= week.end);
  const ids = new Set(men.map((m) => m.userId));
  const counted = inWeek.filter((m) => ids.has(m.user_id));
  const rows: ManResult[] = [];
  const none: string[] = [];
  for (const man of men) {
    const his = counted.filter((m) => m.user_id === man.userId);
    if (his.length === 0) {
      none.push(shortName(man));
      continue;
    }
    rows.push({
      name: shortName(man),
      all: score(his),
      goal_missions: score(his.filter((m) => m.quarterly_goal_id)),
      brave_man_missions: score(his.filter((m) => !m.quarterly_goal_id)),
    });
  }
  rows.sort((a, b) => (b.all.percent ?? 0) - (a.all.percent ?? 0) || b.all.total - a.all.total || a.name.localeCompare(b.name));
  return {
    week,
    totals: {
      all: score(counted),
      goal_missions: score(counted.filter((m) => m.quarterly_goal_id)),
      brave_man_missions: score(counted.filter((m) => !m.quarterly_goal_id)),
    },
    men: rows,
    no_missions: none,
    no_goals: men.filter((m) => !withGoals.has(m.userId)).map(shortName),
  };
}

/** The quarter (first day) a date falls in. */
export function quarterStart(date: string): string {
  const d = parseISO(`${date}T00:00:00`);
  return iso(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1));
}

/** Read what missionResults needs for one community's men and week (service client). */
export async function loadMissionResults(svc: SupabaseClient, men: CountedMan[], week: WeekRange): Promise<CommunityResult> {
  const ids = men.map((m) => m.userId);
  if (ids.length === 0) return missionResults([], [], new Set(), week);
  const [missions, goals] = await Promise.all([
    svc.from("missions").select("user_id, status, target_date, quarterly_goal_id").in("user_id", ids).gte("target_date", week.start).lte("target_date", week.end),
    svc.from("quarterly_goals").select("user_id").in("user_id", ids).eq("quarter_start", quarterStart(week.start)).neq("status", "abandoned"),
  ]);
  const withGoals = new Set(((goals.data ?? []) as { user_id: string }[]).map((g) => g.user_id));
  return missionResults(men, (missions.data ?? []) as MissionRow[], withGoals, week);
}
