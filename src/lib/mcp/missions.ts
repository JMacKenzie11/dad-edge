import { selectAll } from "@/lib/supabase/select-all";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { doneDays, plannedDays, shortName, type MissionRow, type WeekRange } from "./mission-results";
import type { CountedMan } from "./members";

/**
 * The MCP missions tool (Jason, 2026-11-18): what each man set for a
 * week, in his words, with its domain and how it went. The first MCP
 * tool that sends mission wording out of the app.
 */
export type MissionItem = {
  domain: string;
  on_goal: boolean;
  text: string;
  /** The days he planned it for, YYYY-MM-DD. */
  days: string[];
  status: "done" | "missed" | "planned" | "rolled over" | "abandoned";
  days_planned: number;
  /** Ticked days for a challenge; for a regular mission, every planned day once it's done. */
  days_done: number;
  challenge: boolean;
};

export type ManMissions = { name: string; missions: MissionItem[] };

export type MissionListRow = MissionRow & { description: string; pillar_code: string };

const STATUS: Record<string, MissionItem["status"]> = {
  completed: "done",
  missed: "missed",
  planned: "planned",
  rolled_over: "rolled over",
  abandoned: "abandoned",
};

export function missionList(men: CountedMan[], rows: MissionListRow[], week: WeekRange): { week: WeekRange; men: ManMissions[]; no_missions: string[] } {
  const inWeek = rows.filter((m) => m.target_date >= week.start && m.target_date <= week.end);
  const out: ManMissions[] = [];
  const none: string[] = [];
  for (const man of men) {
    const his = inWeek
      .filter((m) => m.user_id === man.userId)
      .sort((a, b) => a.target_date.localeCompare(b.target_date) || a.description.localeCompare(b.description));
    if (his.length === 0) {
      none.push(shortName(man));
      continue;
    }
    out.push({
      name: shortName(man),
      missions: his.map((m) => ({
        domain: (PILLAR_BY_CODE[m.pillar_code as PillarCode]?.label ?? m.pillar_code).toUpperCase(),
        on_goal: !!m.quarterly_goal_id,
        text: m.description.trim(),
        days: m.target_dates?.length ? m.target_dates : [m.target_date],
        status: STATUS[m.status] ?? "planned",
        days_planned: plannedDays(m),
        days_done: doneDays(m),
        challenge: !!m.challenge_id,
      })),
    });
  }
  return { week, men: out, no_missions: none };
}

export async function loadMissionList(svc: SupabaseClient, men: CountedMan[], week: WeekRange) {
  const ids = men.map((m) => m.userId);
  if (ids.length === 0) return missionList([], [], week);
  const { data } = await selectAll((lo, hi) =>
    svc
      .from("missions")
      .select("user_id, description, pillar_code, status, target_date, target_dates, done_dates, challenge_id, quarterly_goal_id")
      .in("user_id", ids)
      .gte("target_date", week.start)
      .lte("target_date", week.end)
      .order("id")
      .range(lo, hi),
  );
  return missionList(men, (data ?? []) as MissionListRow[], week);
}
