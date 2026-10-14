import { addDays, format, parseISO } from "date-fns";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { DOMAIN_CODES, PILLAR_BY_CODE, isDomainCode, type PillarCode } from "@/lib/pillars";
import { localDate } from "@/lib/scoring/week";
import { missionRuleMessage, relativeWeek, weekStartOf, type WeekSlots } from "./rules";
import { loadWeekSlots } from "./slots";

/**
 * What the coach needs to suggest a mission that will actually save:
 * his open slots this week and next, and his open goals, numbered. The
 * coach names a goal by its number (never an id); the server maps it.
 * The same numbering is used to brief the model (missionSlotsProvider) and
 * to check what it suggests (fitSuggestion), so they can't drift.
 */

export type CoachGoalOption = { n: number; id: string; pillar: PillarCode; text: string };

export type CoachMissionPlan = {
  today: string;
  weeks: WeekSlots[];
  goals: CoachGoalOption[];
};

export async function loadCoachMissionPlan(userId: string, timezone: string, extraWeeks: string[] = []): Promise<CoachMissionPlan> {
  const svc = createSupabaseServiceClient();
  const today = localDate(new Date(), timezone);
  const thisWeek = weekStartOf(today);
  const nextWeek = format(addDays(parseISO(thisWeek), 7), "yyyy-MM-dd");
  const weekList = Array.from(new Set([thisWeek, nextWeek, ...extraWeeks]));
  const [weeks, { data: goalData }] = await Promise.all([
    loadWeekSlots(svc, userId, weekList),
    svc
      .from("quarterly_goals")
      .select("id, focus_area, desired_end_state, created_at")
      .eq("user_id", userId)
      .in("status", ["active", "needs_review"])
      .order("created_at", { ascending: true }),
  ]);
  const goals = ((goalData ?? []) as { id: string; focus_area: PillarCode; desired_end_state: string }[]).map((g, i) => ({
    n: i + 1,
    id: g.id,
    pillar: g.focus_area,
    text: g.desired_end_state.replace(/\s+/g, " ").trim(),
  }));
  return { today, weeks, goals };
}

export function renderCoachMissionPlan(plan: CoachMissionPlan): string {
  const lines: string[] = [];
  lines.push("The app enforces these limits. Never suggest a mission into a slot with 0 open.");
  for (const w of plan.weeks.slice(0, 2)) {
    const label = relativeWeek(w.weekStart, plan.today);
    const domains = DOMAIN_CODES.map((c) => `${PILLAR_BY_CODE[c].label} ${w.domainOpen[c]} of 2 open`).join(", ");
    lines.push(`${label[0].toUpperCase()}${label.slice(1)} (starts ${w.weekStart}): ${domains}. Goal missions ${w.goalOpen} of 5 open.`);
  }
  lines.push("Movement, Action and Network don't take missions. Check-ins still cover them.");
  if (plan.goals.length === 0) {
    lines.push("No open goals, so every mission is a domain mission (goal_number null).");
  } else {
    lines.push("Open goals (use goal_number to put a mission under one; it takes the goal's pillar):");
    for (const g of plan.goals) lines.push(`  ${g.n}. ${PILLAR_BY_CODE[g.pillar]?.label ?? g.pillar}: ${g.text.slice(0, 140)}`);
  }
  return lines.join("\n");
}

export type SuggestionInput = { pillar_code: string; target_date: string; goal_number: number | null };

export type FitResult =
  | { ok: true; quarterly_goal_id: string | null; pillar_code: PillarCode; goal_label: string | null }
  | {
      ok: false;
      /** Fed back to the model on the retry. */
      reason: string;
      /** One plain sentence for him if the retry still doesn't fit. */
      note: string;
    };

/** Checks a suggestion against the slots the trigger will enforce. Pure:
 *  `plan` must include the suggestion's week. */
export function fitSuggestion(plan: CoachMissionPlan, s: SuggestionInput): FitResult {
  const weekStart = weekStartOf(s.target_date);
  const week = plan.weeks.find((w) => w.weekStart === weekStart);
  if (s.goal_number != null) {
    const goal = plan.goals.find((g) => g.n === s.goal_number);
    if (!goal) {
      return {
        ok: false,
        reason: `goal_number ${s.goal_number} isn't one of his open goals. Use a number from the "Open goals" list, or null for a domain mission.`,
        note: "That goal isn't open anymore, so there's nothing to add under it.",
      };
    }
    if (week && week.goalOpen <= 0) {
      const note = missionRuleMessage({ kind: "goal_full", weekStart }, plan.today);
      return {
        ok: false,
        reason: `${note} His goal-mission slots for that week are full. Don't suggest a goal mission there.`,
        note,
      };
    }
    return { ok: true, quarterly_goal_id: goal.id, pillar_code: goal.pillar, goal_label: goal.text };
  }
  if (!isDomainCode(s.pillar_code)) {
    const note = missionRuleMessage({ kind: "pillar_retired", pillar: s.pillar_code as PillarCode }, plan.today);
    return { ok: false, reason: `${note} Use B, R, A, V or E.`, note };
  }
  if (week && week.domainOpen[s.pillar_code] <= 0) {
    const note = missionRuleMessage({ kind: "domain_full", pillar: s.pillar_code, weekStart }, plan.today);
    return {
      ok: false,
      reason: `${note} Both ${PILLAR_BY_CODE[s.pillar_code].label} slots for that week are taken. Don't suggest a ${PILLAR_BY_CODE[s.pillar_code].label} mission there.`,
      note,
    };
  }
  return { ok: true, quarterly_goal_id: null, pillar_code: s.pillar_code, goal_label: null };
}
