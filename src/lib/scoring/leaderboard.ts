import { leaderboardComposite } from "./composite";
import type { PillarCode } from "@/lib/pillars";

type CheckinRow = { user_id: string; date: string; pillar_code: PillarCode; value: 0 | 1 };
type MissionRow = {
  user_id: string;
  target_date: string;
  status: "planned" | "completed" | "missed" | "rolled_over";
};

export type LeaderboardEntry = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  daily_total: number;
  mission_completed: number;
  mission_missed: number;
  mission_rate: number;
  composite: number;
  streak_days: number;
  delta_vs_prior: number;
};

/**
 * mission_rate — completed / (completed + missed) for the target window.
 * planned-and-not-yet-past does not penalize.
 */
function missionRate(rows: MissionRow[]): { completed: number; missed: number; rate: number } {
  let c = 0;
  let m = 0;
  for (const r of rows) {
    if (r.status === "completed") c++;
    else if (r.status === "missed") m++;
  }
  const denom = c + m;
  return { completed: c, missed: m, rate: denom === 0 ? 0 : c / denom };
}

/**
 * Assemble per-user weekly totals ranked by composite (DECISION #1).
 * The prior-week entries drive the delta arrow.
 */
export function assembleWeekly({
  users,
  checkins,
  missions,
  weekDates,
  priorWeekComposites,
  engagementStreaks,
}: {
  users: { id: string; first_name: string | null; last_name: string | null }[];
  checkins: CheckinRow[];
  missions: MissionRow[];
  weekDates: string[];
  priorWeekComposites: Record<string, number>;
  engagementStreaks: Record<string, number>;
}): LeaderboardEntry[] {
  const inWindow = new Set(weekDates);
  const perUser = new Map<
    string,
    { checkins: CheckinRow[]; missions: MissionRow[] }
  >();
  for (const u of users) perUser.set(u.id, { checkins: [], missions: [] });

  for (const c of checkins) {
    if (!inWindow.has(c.date)) continue;
    perUser.get(c.user_id)?.checkins.push(c);
  }
  for (const m of missions) {
    if (!inWindow.has(m.target_date)) continue;
    perUser.get(m.user_id)?.missions.push(m);
  }

  const entries: LeaderboardEntry[] = users.map((u) => {
    const p = perUser.get(u.id)!;
    const dailyTotal = p.checkins.reduce((n, r) => n + (r.value === 1 ? 1 : 0), 0);
    const mr = missionRate(p.missions);
    const composite = leaderboardComposite(dailyTotal, mr.rate);
    const priorComposite = priorWeekComposites[u.id] ?? composite;
    return {
      user_id: u.id,
      first_name: u.first_name,
      last_name: u.last_name,
      daily_total: dailyTotal,
      mission_completed: mr.completed,
      mission_missed: mr.missed,
      mission_rate: mr.rate,
      composite,
      streak_days: engagementStreaks[u.id] ?? 0,
      delta_vs_prior: composite - priorComposite,
    };
  });

  entries.sort((a, b) => b.composite - a.composite);
  return entries;
}
