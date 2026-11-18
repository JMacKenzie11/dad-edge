import type { CommunityMember } from "@/lib/community/people-directory";
import { shortName } from "./mission-results";
import type { CountedMan } from "./members";

/**
 * The MCP people tool (Jason, 2026-11-18): the numbers on each man's
 * Community → People card, in the card's "Most active" order. Numbers
 * only; the card's goal wording stays in the app.
 */
export type PersonNumbers = {
  name: string;
  /** Daily Living per week, out of 49, averaged over the last 6 weeks (or his weeks in, if fewer). */
  daily_avg: number;
  /** Days in a row with a check-in, as of yesterday. */
  streak_days: number;
  /** Missions done this quarter, percent of those due so far. null: none due. */
  missions_pct: number | null;
  /** The same, for missions tied to one of his goals. */
  goal_missions_pct: number | null;
  /** Under 6 weeks in: daily_avg covers only his weeks. */
  weeks_in: number;
};

export function peopleNumbers(people: CommunityMember[], men: CountedMan[]): PersonNumbers[] {
  const byId = new Map(men.map((m) => [m.userId, m]));
  return people
    .filter((p) => byId.has(p.userId))
    .sort((a, b) => b.dailyLivingAvg - a.dailyLivingAvg || a.name.localeCompare(b.name))
    .map((p) => ({
      name: shortName(byId.get(p.userId)!),
      daily_avg: Math.round(p.dailyLivingAvg * 10) / 10,
      streak_days: p.streak,
      missions_pct: p.missionPct === null ? null : Math.round(p.missionPct),
      goal_missions_pct: p.goalMissionPct === null ? null : Math.round(p.goalMissionPct),
      weeks_in: p.tenureWeeks,
    }));
}
