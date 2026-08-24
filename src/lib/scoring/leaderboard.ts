import type { PillarCode } from "@/lib/pillars";
import { DAILY_PILLARS_WEEKLY_MAX } from "./week";

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
  daily_total: number; // 0..49
  daily_max: number; // always 49 (weekly max for daily pillars)
  mission_completed: number;
  mission_planned: number; // any status
  mission_rate: number; // completed / (completed + missed); planned-in-future doesn't penalize
  combined_total: number; // daily_total + mission_completed
  combined_max: number; // daily_max + mission_planned
  streak_days: number;
  delta_vs_prior: number; // combined_total delta week over week
};

function missionSummary(rows: MissionRow[]): {
  completed: number;
  missed: number;
  planned: number;
  rate: number;
} {
  let c = 0;
  let m = 0;
  const planned = rows.length;
  for (const r of rows) {
    if (r.status === "completed") c++;
    else if (r.status === "missed") m++;
  }
  const denom = c + m;
  return {
    completed: c,
    missed: m,
    planned,
    rate: denom === 0 ? 0 : c / denom,
  };
}

/**
 * Assemble per-user weekly totals.
 *
 * Scoring model (2026-08-24): daily pillars (7 checkable × 7 days =
 * 49 max) and mission completions (1 point each, capped by weekly
 * mission cap of 15) are scored independently. Ranking is by
 * combined_total (daily + completed missions); tiebreaker is daily
 * so a guy who logged more consistent daily habits edges out a guy
 * who just executed missions.
 *
 * The prior-week combined_totals drive the delta arrow.
 */
export function assembleWeekly({
  users,
  checkins,
  missions,
  weekDates,
  priorWeekCombined,
  engagementStreaks,
}: {
  users: { id: string; first_name: string | null; last_name: string | null }[];
  checkins: CheckinRow[];
  missions: MissionRow[];
  weekDates: string[];
  priorWeekCombined: Record<string, number>;
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
    // Daily pillars only — A2 credit comes from missions, not check-ins.
    if (c.pillar_code === "A2") continue;
    perUser.get(c.user_id)?.checkins.push(c);
  }
  for (const m of missions) {
    if (!inWindow.has(m.target_date)) continue;
    perUser.get(m.user_id)?.missions.push(m);
  }

  const entries: LeaderboardEntry[] = users.map((u) => {
    const p = perUser.get(u.id)!;
    const dailyTotal = p.checkins.reduce((n, r) => n + (r.value === 1 ? 1 : 0), 0);
    const ms = missionSummary(p.missions);
    const combinedTotal = dailyTotal + ms.completed;
    const priorCombined = priorWeekCombined[u.id] ?? combinedTotal;
    return {
      user_id: u.id,
      first_name: u.first_name,
      last_name: u.last_name,
      daily_total: dailyTotal,
      daily_max: DAILY_PILLARS_WEEKLY_MAX,
      mission_completed: ms.completed,
      mission_planned: ms.planned,
      mission_rate: ms.rate,
      combined_total: combinedTotal,
      combined_max: DAILY_PILLARS_WEEKLY_MAX + ms.planned,
      streak_days: engagementStreaks[u.id] ?? 0,
      delta_vs_prior: combinedTotal - priorCombined,
    };
  });

  entries.sort((a, b) => {
    if (b.combined_total !== a.combined_total) {
      return b.combined_total - a.combined_total;
    }
    return b.daily_total - a.daily_total;
  });
  return entries;
}
