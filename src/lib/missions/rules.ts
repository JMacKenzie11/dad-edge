import { addDays, format, parseISO } from "date-fns";
import { DOMAIN_CODES, PILLAR_BY_CODE, type DomainCode, type PillarCode } from "@/lib/pillars";

/**
 * Weekly mission rules (2026-10-15 restructure). The database trigger
 * `enforce_mission_weekly_cap` is the authority; everything here either
 * mirrors its counting (to draw slots and brief the coach) or translates
 * its refusals into plain copy. If the two ever disagree, the trigger wins
 * and the man sees its message, never a silent drop.
 *
 *   - Domain missions (no goal): two per week in each of B, R, A, V, E.
 *   - Goal missions: five per week in total, across every goal.
 *   - Week = Monday to Sunday of the mission's last target day
 *     (`date_trunc('week', target_date)` in the trigger).
 *   - Rolled-over and abandoned missions don't count.
 *   - No-goal missions created before the cutover don't count against
 *     domain slots (the old planner stamped them Bond without asking).
 */

export const DOMAIN_SLOTS_PER_WEEK = 2;
export const GOAL_MISSIONS_PER_WEEK = 5;
export const MISSION_STRUCTURE_MILESTONE = "mission_structure_v2";

/** Monday on or before an ISO date. Same as Postgres date_trunc('week'). */
export function weekStartOf(isoDate: string): string {
  const d = parseISO(isoDate);
  const dow = (d.getDay() + 6) % 7;
  return format(addDays(d, -dow), "yyyy-MM-dd");
}

export type SlotMission = {
  pillar_code: string;
  quarterly_goal_id: string | null;
  target_date: string;
  status: string;
  created_at: string;
};

export type WeekSlots = {
  weekStart: string;
  /** Missions counted against each domain's two slots. */
  domainUsed: Record<DomainCode, number>;
  goalUsed: number;
  domainOpen: Record<DomainCode, number>;
  goalOpen: number;
};

function countsTowardCap(m: SlotMission): boolean {
  return m.status !== "rolled_over" && m.status !== "abandoned";
}

/** True for a no-goal mission made before the restructure: shown in the
 *  "earlier missions" list and never counted against a domain slot. */
export function isEarlierUnattached(m: { quarterly_goal_id: string | null; created_at: string }, cutover: string | null): boolean {
  if (m.quarterly_goal_id) return false;
  if (!cutover) return true;
  return m.created_at < cutover;
}

export function computeWeekSlots(missions: SlotMission[], weekStart: string, cutover: string | null): WeekSlots {
  const domainUsed = Object.fromEntries(DOMAIN_CODES.map((c) => [c, 0])) as Record<DomainCode, number>;
  let goalUsed = 0;
  for (const m of missions) {
    if (!countsTowardCap(m) || weekStartOf(m.target_date) !== weekStart) continue;
    if (m.quarterly_goal_id) {
      goalUsed += 1;
    } else if (!isEarlierUnattached(m, cutover) && (DOMAIN_CODES as readonly string[]).includes(m.pillar_code)) {
      domainUsed[m.pillar_code as DomainCode] += 1;
    }
  }
  const domainOpen = Object.fromEntries(
    DOMAIN_CODES.map((c) => [c, Math.max(0, DOMAIN_SLOTS_PER_WEEK - domainUsed[c])]),
  ) as Record<DomainCode, number>;
  return { weekStart, domainUsed, goalUsed, domainOpen, goalOpen: Math.max(0, GOAL_MISSIONS_PER_WEEK - goalUsed) };
}

// ---------------------------------------------------------------------------
// Trigger refusals → plain copy
// ---------------------------------------------------------------------------

export type MissionRuleBreak =
  | { kind: "domain_full"; pillar: PillarCode; weekStart: string }
  | { kind: "goal_full"; weekStart: string }
  | { kind: "pillar_retired"; pillar: PillarCode }
  | { kind: "goal_closed" }
  | { kind: "goal_pillar_retired"; pillar: PillarCode };

/** Reads the DETAIL code the trigger attaches. Accepts a PostgrestError
 *  or anything with `details` / `message`. */
export function parseMissionRuleError(err: { details?: string | null; message?: string | null } | null | undefined): MissionRuleBreak | null {
  const code = (err?.details ?? "").trim();
  let m = code.match(/^mission_cap:domain:([A-Z0-9]+):(\d{4}-\d{2}-\d{2})$/);
  if (m) return { kind: "domain_full", pillar: m[1] as PillarCode, weekStart: m[2] };
  m = code.match(/^mission_cap:goal::(\d{4}-\d{2}-\d{2})$/);
  if (m) return { kind: "goal_full", weekStart: m[1] };
  m = code.match(/^mission_pillar_retired:([A-Z0-9]+)$/);
  if (m) return { kind: "pillar_retired", pillar: m[1] as PillarCode };
  if (code === "mission_goal_closed") return { kind: "goal_closed" };
  m = code.match(/^goal_pillar_retired:([A-Z0-9]+)$/);
  if (m) return { kind: "goal_pillar_retired", pillar: m[1] as PillarCode };
  return null;
}

/** "this week", "next week", "last week", or "the week of Oct 26". */
export function relativeWeek(weekStart: string, today: string): string {
  const thisWeek = weekStartOf(today);
  const diff = Math.round((parseISO(weekStart).getTime() - parseISO(thisWeek).getTime()) / (7 * 86400_000));
  if (diff === 0) return "this week";
  if (diff === 1) return "next week";
  if (diff === -1) return "last week";
  return `the week of ${format(parseISO(weekStart), "MMM d")}`;
}

export function missionRuleMessage(rule: MissionRuleBreak, today: string): string {
  switch (rule.kind) {
    case "domain_full":
      return `You already have two ${PILLAR_BY_CODE[rule.pillar]?.label ?? rule.pillar} missions ${relativeWeek(rule.weekStart, today)}.`;
    case "goal_full":
      return `You already have five goal missions ${relativeWeek(rule.weekStart, today)}.`;
    case "pillar_retired":
      return `${PILLAR_BY_CODE[rule.pillar]?.label ?? rule.pillar} doesn't take missions anymore. Pick Bond, Raise, Amplify, Vitality, or Enjoyment.`;
    case "goal_closed":
      return "That goal is closed, so it can't take new missions.";
    case "goal_pillar_retired":
      return "Goals go on Bond, Raise, Amplify, Vitality, or Enjoyment.";
  }
}

/** One call for every write path: a rule break becomes its plain message;
 *  anything else falls back to the given text so raw database errors
 *  never reach the screen. */
export function friendlyMissionError(
  err: { details?: string | null; message?: string | null } | null | undefined,
  today: string,
  fallback = "That mission didn't save. Try again.",
): string {
  const rule = parseMissionRuleError(err);
  return rule ? missionRuleMessage(rule, today) : fallback;
}
