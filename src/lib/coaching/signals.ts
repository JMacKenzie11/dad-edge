/**
 * Coaching signals for the admin and leader Coaching pages (DECISIONS.md
 * "Coaching view"). Pure: one man's goals, missions, fit calls and
 * activity in, flags and wins out. No database, no model.
 *
 * Every flag carries a fixed sentence saying what the app noticed and a
 * fixed opening question for the leader to ask. Same input, same output:
 * two leaders looking at the same man see the same thing.
 *
 * Domain balance (all his missions in one domain) is deliberately not a
 * signal (Jason, 2026-11-10).
 */

import { addDays, differenceInCalendarDays, parseISO, format } from "date-fns";
import type { PillarCode } from "@/lib/pillars";

export type FitVerdict = "moves_it" | "related" | "no_link";

export type CoachGoal = {
  id: string;
  focus_area: PillarCode;
  desired_end_state: string;
  current_state: string | null;
  source: "user" | "itc";
  status: "active" | "completed" | "abandoned" | "needs_review";
  created_at: string;
  midpoint_check_at: string | null;
  midpoint_check_answer: string | null;
  retrospective_what_happened: string | null;
};

export type CoachMission = {
  id: string;
  description: string;
  pillar_code: PillarCode;
  target_date: string;
  target_dates: string[];
  status: "planned" | "completed" | "missed" | "rolled_over";
  completed_late: boolean;
  rolled_over_from_mission_id: string | null;
  quarterly_goal_id: string | null;
  quality_score: number | null;
};

export type ManInput = {
  goals: CoachGoal[];
  /** Missions from at least 8 weeks back through the end of this week. */
  missions: CoachMission[];
  fit: Map<string, FitVerdict>;
  /** Date of his last check-in, or null if he's never checked in. */
  lastCheckin: string | null;
  /** Consecutive days with a check-in, ending yesterday or today. */
  streak: number;
  /** Today in his community's timezone, YYYY-MM-DD. */
  today: string;
  /** Monday of this week, YYYY-MM-DD. */
  weekStart: string;
};

export type FlagKind =
  | "inactive"
  | "no_goal"
  | "goal_quiet"
  | "goal_no_start"
  | "midpoint_waiting"
  | "review_waiting"
  | "execution_low"
  | "execution_drop"
  | "stuck_mission"
  | "vague_missions"
  | "nothing_planned"
  | "fit_off";

export type Flag = {
  kind: FlagKind;
  /** 3 = reach out first. */
  severity: 1 | 2 | 3;
  line: string;
  question: string;
  goalId?: string;
  missionId?: string;
};

export type WinKind = "clean_sweep" | "goal_done" | "streak" | "comeback";
export type Win = { kind: WinKind; line: string };

export type Execution = { done: number; total: number; rate: number | null };

export type ManSignals = {
  flags: Flag[];
  wins: Win[];
  /** Sum of flag severities; the Reach out list sorts on it. */
  weight: number;
  recent: Execution;
  prior: Execution;
};

// Starting thresholds (DECISIONS.md "Coaching view"). Tune here.
export const INACTIVE_DAYS = 7;
export const INACTIVE_URGENT_DAYS = 14;
export const QUIET_GOAL_DAYS = 21;
export const NEW_GOAL_GRACE_DAYS = 14;
export const LOW_RATE = 0.5;
export const RATE_SHIFT = 0.25;
export const MIN_MISSIONS_FOR_RATE = 4;
export const MIN_MISSIONS_FOR_SHIFT = 3;
export const STUCK_ROLLOVERS = 2;
export const VAGUE_SCORE = 6;
export const VAGUE_COUNT = 2;
export const STREAK_WIN_DAYS = 14;

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const day = (s: string) => parseISO(`${s}T00:00:00`);

/** Short enough to quote inside a sentence. */
export function quote(text: string, max = 60): string {
  // Trailing punctuation would double up inside a sentence: "quarter."?
  const t = text.trim().replace(/\s+/g, " ").replace(/[.!?,;:]+$/, "");
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Completed out of the missions whose day has passed in [from, to]. */
export function execution(missions: CoachMission[], from: string, to: string): Execution {
  const closed = missions.filter(
    (m) => m.target_date >= from && m.target_date <= to && m.status !== "planned",
  );
  const done = closed.filter((m) => m.status === "completed").length;
  return { done, total: closed.length, rate: closed.length ? done / closed.length : null };
}

/** How many times this mission has been rolled over to get here. */
function rolloverDepth(m: CoachMission, byId: Map<string, CoachMission>): number {
  let depth = 0;
  let cur: CoachMission | undefined = m;
  const seen = new Set<string>();
  while (cur?.rolled_over_from_mission_id && !seen.has(cur.id)) {
    seen.add(cur.id);
    depth += 1;
    cur = byId.get(cur.rolled_over_from_mission_id);
  }
  return depth;
}

export function computeSignals(input: ManInput): ManSignals {
  const { goals, missions, fit, today, weekStart } = input;
  const weekEnd = iso(addDays(day(weekStart), 6));
  const yesterday = iso(addDays(day(today), -1));
  const recentFrom = iso(addDays(day(today), -28));
  const priorFrom = iso(addDays(day(today), -56));
  const priorTo = iso(addDays(day(today), -29));
  const flags: Flag[] = [];
  const wins: Win[] = [];

  // --- Activity ------------------------------------------------------------
  if (!input.lastCheckin) {
    flags.push({
      kind: "inactive",
      severity: 3,
      line: "Hasn't checked in yet.",
      question: "What's getting in the way of starting?",
    });
  } else {
    const days = differenceInCalendarDays(day(today), day(input.lastCheckin));
    if (days >= INACTIVE_DAYS) {
      flags.push({
        kind: "inactive",
        severity: days >= INACTIVE_URGENT_DAYS ? 3 : 2,
        line: `No check-in for ${days} days.`,
        question: "How are things at home and at work right now?",
      });
    }
  }

  // --- Goals ---------------------------------------------------------------
  const live = goals.filter((g) => g.status === "active" || g.status === "needs_review");
  if (!goals.some((g) => g.status !== "abandoned")) {
    flags.push({
      kind: "no_goal",
      severity: 2,
      line: "No goal set for this quarter.",
      question: "What's the one thing you want to be different by the end of the quarter?",
    });
  }

  const linked = (goalId: string) => missions.filter((m) => m.quarterly_goal_id === goalId);

  for (const g of live) {
    const name = quote(g.desired_end_state);
    const ageDays = differenceInCalendarDays(day(today), day(g.created_at.slice(0, 10)));
    const quietFrom = iso(addDays(day(today), -(QUIET_GOAL_DAYS - 1)));
    const touching = linked(g.id).filter((m) => m.target_dates.some((d) => d >= quietFrom && d <= weekEnd));
    if (g.status === "active" && ageDays >= NEW_GOAL_GRACE_DAYS && touching.length === 0) {
      flags.push({
        kind: "goal_quiet",
        severity: 2,
        line: `"${name}" hasn't had a mission in ${QUIET_GOAL_DAYS / 7} weeks.`,
        question: `What's one thing this week that moves "${name}" forward?`,
        goalId: g.id,
      });
    }

    if (g.source === "user" && !g.current_state?.trim()) {
      flags.push({
        kind: "goal_no_start",
        severity: 1,
        line: `"${name}" has no starting point written down.`,
        question: `Where are you today on "${name}"?`,
        goalId: g.id,
      });
    }

    if (g.status === "active" && g.midpoint_check_at && g.midpoint_check_at.slice(0, 10) <= today && !g.midpoint_check_answer?.trim()) {
      flags.push({
        kind: "midpoint_waiting",
        severity: 1,
        line: `His midpoint check-in on "${name}" is waiting.`,
        question: `How's "${name}" actually going?`,
        goalId: g.id,
      });
    }

    if (g.status === "needs_review" && !g.retrospective_what_happened?.trim()) {
      flags.push({
        kind: "review_waiting",
        severity: 1,
        line: `His end-of-quarter look back on "${name}" is waiting.`,
        question: `What happened with "${name}" this quarter, and what did you learn?`,
        goalId: g.id,
      });
    }

    // Fit: goal-linked missions from the last four weeks through this week.
    const judged = linked(g.id)
      .filter((m) => m.target_date >= recentFrom && m.target_date <= weekEnd && fit.has(m.id))
      .sort((a, b) => b.target_date.localeCompare(a.target_date));
    const off = judged.filter((m) => fit.get(m.id) === "no_link");
    if (off.length > 0) {
      const all = off.length === judged.length;
      flags.push({
        kind: "fit_off",
        severity: off.length >= 2 || (all && judged.length >= 2) ? 2 : 1,
        line:
          off.length === 1
            ? `"${quote(off[0].description, 50)}" doesn't look like it moves "${name}" forward.`
            : `${off.length} of his ${judged.length} recent missions under "${name}" don't look like they move it forward.`,
        question: `How does "${quote(off[0].description, 50)}" get you closer to "${name}"?`,
        goalId: g.id,
        missionId: off[0].id,
      });
    }
  }

  // --- Execution -----------------------------------------------------------
  const recent = execution(missions, recentFrom, yesterday);
  const prior = execution(missions, priorFrom, priorTo);
  const shift =
    recent.rate !== null && prior.rate !== null && recent.total >= MIN_MISSIONS_FOR_SHIFT && prior.total >= MIN_MISSIONS_FOR_SHIFT
      ? recent.rate - prior.rate
      : null;

  if (recent.total >= MIN_MISSIONS_FOR_RATE && recent.rate !== null && recent.rate < LOW_RATE) {
    flags.push({
      kind: "execution_low",
      severity: 2,
      line: `Done ${recent.done} of ${recent.total} missions in the last 4 weeks.`,
      question: "What got in the way the last few weeks?",
    });
  } else if (shift !== null && shift <= -RATE_SHIFT) {
    flags.push({
      kind: "execution_drop",
      severity: 2,
      line: `Down to ${recent.done} of ${recent.total} missions done, from ${prior.done} of ${prior.total} the 4 weeks before.`,
      question: "What changed in the last couple of weeks?",
    });
  }

  const byId = new Map(missions.map((m) => [m.id, m]));
  const rolledInto = new Set(missions.map((m) => m.rolled_over_from_mission_id).filter(Boolean));
  const stuck = missions
    .filter((m) => !rolledInto.has(m.id) && m.target_date >= recentFrom)
    .map((m) => ({ m, depth: rolloverDepth(m, byId) }))
    .filter((x) => x.depth >= STUCK_ROLLOVERS)
    .sort((a, b) => b.depth - a.depth)[0];
  if (stuck) {
    const what = quote(stuck.m.description, 50);
    flags.push({
      kind: "stuck_mission",
      severity: 2,
      line: `"${what}" has rolled over ${stuck.depth} times.`,
      question: `What's making "${what}" hard to get done?`,
      missionId: stuck.m.id,
    });
  }

  const vague = missions.filter(
    (m) => m.target_date >= recentFrom && m.target_date <= weekEnd && m.quality_score !== null && m.quality_score < VAGUE_SCORE,
  );
  if (vague.length >= VAGUE_COUNT) {
    flags.push({
      kind: "vague_missions",
      severity: 1,
      line: `${vague.length} recent missions are loosely written, so done or not is hard to call.`,
      question: `How will you know "${quote(vague[0].description, 50)}" is done?`,
      missionId: vague[0].id,
    });
  }

  const thisWeek = missions.filter((m) => m.target_dates.some((d) => d >= weekStart && d <= weekEnd));
  if (thisWeek.length === 0) {
    flags.push({
      kind: "nothing_planned",
      severity: 2,
      line: "No missions planned this week.",
      question: "What are you committing to this week?",
    });
  }

  // --- Wins ----------------------------------------------------------------
  if (recent.total >= MIN_MISSIONS_FOR_RATE && recent.done === recent.total) {
    wins.push({ kind: "clean_sweep", line: `Done all ${recent.total} missions in the last 4 weeks.` });
  } else if (shift !== null && shift >= RATE_SHIFT) {
    wins.push({
      kind: "comeback",
      line: `Up to ${recent.done} of ${recent.total} missions done, from ${prior.done} of ${prior.total} the 4 weeks before.`,
    });
  }
  for (const g of goals.filter((x) => x.status === "completed")) {
    wins.push({ kind: "goal_done", line: `Completed "${quote(g.desired_end_state)}".` });
  }
  if (input.streak >= STREAK_WIN_DAYS) {
    wins.push({ kind: "streak", line: `Checked in ${input.streak} days running.` });
  }

  flags.sort((a, b) => b.severity - a.severity);
  return { flags, wins, weight: flags.reduce((n, f) => n + f.severity, 0), recent, prior };
}
