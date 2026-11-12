import { describe, expect, it } from "vitest";
import { missionResults, quarterStart, reportWeek, shortName } from "./mission-results";

const man = (userId: string, first: string, last = "Smith") => ({ userId, first_name: first, last_name: last, email: `${first}@x.test`, role: "member" as const });
const m = (user_id: string, target_date: string, status: string, goal: string | null = null) => ({ user_id, target_date, status, quarterly_goal_id: goal });
const WEEK = { start: "2026-11-02", end: "2026-11-08" };

describe("mission results", () => {
  it("defaults to last week in the community's time zone", () => {
    // Monday 2026-11-09 03:00 UTC is still Sunday Nov 8 in Chicago.
    expect(reportWeek(undefined, "America/Chicago", new Date("2026-11-09T03:00:00Z"))).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(reportWeek(undefined, "America/Chicago", new Date("2026-11-12T15:00:00Z"))).toEqual(WEEK);
    expect(reportWeek("2026-11-05", "America/Chicago")).toEqual(WEEK);
  });

  it("splits goal and BRAVE MAN missions, best man first, counts only", () => {
    const r = missionResults(
      [man("a", "Mike"), man("b", "Dave"), man("c", "Rob")],
      [
        m("a", "2026-11-03", "completed", "g1"), m("a", "2026-11-04", "completed"), // Mike 2/2
        m("b", "2026-11-03", "missed", "g2"), m("b", "2026-11-05", "completed"), m("b", "2026-11-06", "rolled_over"), // Dave 1/3
        m("a", "2026-11-10", "completed"), // this week: not counted
        m("z", "2026-11-03", "completed"), // not a counted man (staff)
      ],
      new Set(["a", "b"]),
      WEEK,
    );
    expect(r.men.map((x) => x.name)).toEqual(["Mike S.", "Dave S."]);
    expect(r.men[1]).toEqual({
      name: "Dave S.",
      all: { done: 1, total: 3, percent: 33 },
      goal_missions: { done: 0, total: 1, percent: 0 },
      brave_man_missions: { done: 1, total: 2, percent: 50 },
    });
    expect(r.totals.all).toEqual({ done: 3, total: 5, percent: 60 });
    expect(r.totals.goal_missions).toEqual({ done: 1, total: 2, percent: 50 });
    expect(r.no_missions).toEqual(["Rob S."]);
    expect(r.no_goals).toEqual(["Rob S."]);
    expect(JSON.stringify(r)).not.toMatch(/description|end_state/);
  });

  it("names men short and finds the quarter", () => {
    expect(shortName({ first_name: "Mike", last_name: "rogers", email: "m@x" })).toBe("Mike R.");
    expect(shortName({ first_name: null, last_name: null, email: "pat@x.test" })).toBe("pat");
    expect(quarterStart("2026-11-02")).toBe("2026-10-01");
  });
});
