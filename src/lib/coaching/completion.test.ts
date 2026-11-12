import { describe, expect, it } from "vitest";
import { byCompletion, completion, pastWeeks } from "./completion";
import type { CoachMission } from "./signals";

const WEEK = "2026-11-09"; // Monday of the current week
let n = 0;
const m = (target_date: string, status: CoachMission["status"], goal: string | null = null): CoachMission => ({
  id: `m${++n}`, description: "x", pillar_code: "V", target_date, target_dates: [target_date], status,
  completed_late: false, rolled_over_from_mission_id: null, quarterly_goal_id: goal, quality_score: null,
});

describe("completion", () => {
  it("uses last week and the week before, not this week", () => {
    expect(pastWeeks(WEEK)).toEqual([{ start: "2026-11-02", end: "2026-11-08" }, { start: "2026-10-26", end: "2026-11-01" }]);
  });

  it("splits goal missions by goal and keeps non-goal missions apart", () => {
    const c = completion([{ id: "g1" }, { id: "g2" }], [
      m("2026-11-03", "completed", "g1"), m("2026-11-05", "missed", "g1"), // last week, g1: 50%
      m("2026-10-28", "completed", "g1"),                                   // week before, g1: 100%
      m("2026-11-04", "completed"), m("2026-11-06", "rolled_over"), m("2026-11-07", "planned"), // last week, non-goal: 1 of 3
      m("2026-11-10", "completed"), // this week: ignored
      m("2026-10-20", "missed"),    // three weeks ago: ignored
    ], WEEK);
    expect(c.byGoal.get("g1")).toEqual([{ done: 1, total: 2, pct: 50 }, { done: 1, total: 1, pct: 100 }]);
    expect(c.byGoal.get("g2")).toEqual([{ done: 0, total: 0, pct: null }, { done: 0, total: 0, pct: null }]);
    expect(c.nonGoal).toEqual([{ done: 1, total: 3, pct: 33 }, { done: 0, total: 0, pct: null }]);
    expect(c.overall).toEqual([{ done: 2, total: 5, pct: 40 }, { done: 1, total: 1, pct: 100 }]);
    expect(c.combined).toEqual({ done: 3, total: 6, pct: 50 });
  });

  it("orders the list by combined completion, highest first, no missions last", () => {
    const man = (name: string, ms: CoachMission[]) => ({ name, completion: completion([], ms, WEEK) });
    const order = byCompletion([
      man("Al", [m("2026-11-03", "completed"), m("2026-11-04", "missed")]),
      man("Bo", []),
      man("Cy", [m("2026-10-27", "completed")]),
      man("Di", [m("2026-11-03", "missed")]),
    ]).map((x) => x.name);
    expect(order).toEqual(["Cy", "Al", "Di", "Bo"]);
  });
});
