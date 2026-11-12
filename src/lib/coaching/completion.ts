import { addDays, format, parseISO } from "date-fns";
import type { CoachGoal, CoachMission } from "./signals";

/**
 * Mission completion for the Coaching list (DECISIONS.md "Coaching list:
 * completion by week"). Two finished weeks: last week and the week
 * before. The current week isn't shown, since it's still open.
 *
 * A mission counts in the week of its target date. Done means status
 * completed (late included). Missed, rolled over or still planned after
 * the week ended count as not done.
 */

export type Pct = { done: number; total: number; pct: number | null };
export type WeekRange = { start: string; end: string };
export type TwoWeeks = [last: Pct, before: Pct];

export type Completion = {
  weeks: [last: WeekRange, before: WeekRange];
  byGoal: Map<string, TwoWeeks>;
  nonGoal: TwoWeeks;
  overall: TwoWeeks;
  /** Both weeks together: what the list is sorted by. */
  combined: Pct;
};

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const day = (s: string) => parseISO(`${s}T00:00:00`);

export function pastWeeks(weekStart: string): [WeekRange, WeekRange] {
  const m = day(weekStart);
  return [
    { start: iso(addDays(m, -7)), end: iso(addDays(m, -1)) },
    { start: iso(addDays(m, -14)), end: iso(addDays(m, -8)) },
  ];
}

function pct(missions: CoachMission[]): Pct {
  const done = missions.filter((m) => m.status === "completed").length;
  return { done, total: missions.length, pct: missions.length ? Math.round((done / missions.length) * 100) : null };
}

const inWeek = (m: CoachMission, w: WeekRange) => m.target_date >= w.start && m.target_date <= w.end;

export function completion(goals: Pick<CoachGoal, "id">[], missions: CoachMission[], weekStart: string): Completion {
  const weeks = pastWeeks(weekStart);
  const two = (pick: (m: CoachMission) => boolean): TwoWeeks =>
    [pct(missions.filter((m) => pick(m) && inWeek(m, weeks[0]))), pct(missions.filter((m) => pick(m) && inWeek(m, weeks[1])))];
  const byGoal = new Map(goals.map((g) => [g.id, two((m) => m.quarterly_goal_id === g.id)] as const));
  return {
    weeks,
    byGoal,
    nonGoal: two((m) => !m.quarterly_goal_id),
    overall: two(() => true),
    combined: pct(missions.filter((m) => inWeek(m, weeks[0]) || inWeek(m, weeks[1]))),
  };
}

/** Highest combined completion first; men with no missions in either week last. */
export function byCompletion<T extends { name: string; completion: Completion }>(men: T[]): T[] {
  return [...men].sort((a, b) => {
    const x = a.completion.combined.pct;
    const y = b.completion.combined.pct;
    if (x === null || y === null) return x === y ? a.name.localeCompare(b.name) : x === null ? 1 : -1;
    return y - x || b.completion.combined.total - a.completion.combined.total || a.name.localeCompare(b.name);
  });
}
