import { describe, expect, it } from "vitest";
import {
  computeWeekSlots,
  friendlyMissionError,
  isEarlierUnattached,
  parseMissionRuleError,
  relativeWeek,
  weekStartOf,
  type SlotMission,
} from "@/lib/missions/rules";
import { fitSuggestion, type CoachMissionPlan } from "@/lib/missions/coach-slots";

const CUTOVER = "2026-10-15T12:00:00Z";
const after = "2026-10-16T09:00:00Z";
const before = "2026-10-01T09:00:00Z";
const m = (o: Partial<SlotMission>): SlotMission => ({
  pillar_code: "B",
  quarterly_goal_id: null,
  target_date: "2026-10-20",
  status: "planned",
  created_at: after,
  ...o,
});

describe("weekStartOf", () => {
  it("matches Postgres date_trunc('week'): Monday", () => {
    expect(weekStartOf("2026-10-19")).toBe("2026-10-19"); // Monday
    expect(weekStartOf("2026-10-25")).toBe("2026-10-19"); // Sunday
    expect(weekStartOf("2026-10-26")).toBe("2026-10-26");
  });
});

describe("computeWeekSlots", () => {
  it("counts two per domain and five goal missions, like the trigger", () => {
    const slots = computeWeekSlots(
      [
        m({}),
        m({ target_date: "2026-10-21" }),
        m({ pillar_code: "R" }),
        m({ quarterly_goal_id: "g1", pillar_code: "V" }),
        m({ quarterly_goal_id: "g2", pillar_code: "A" }),
        m({ status: "rolled_over" }),
        m({ status: "abandoned", quarterly_goal_id: "g1" }),
        m({ target_date: "2026-10-27" }), // next week
      ],
      "2026-10-19",
      CUTOVER,
    );
    expect(slots.domainUsed).toEqual({ B: 2, R: 1, A: 0, V: 0, E: 0 });
    expect(slots.domainOpen.B).toBe(0);
    expect(slots.domainOpen.R).toBe(1);
    expect(slots.goalUsed).toBe(2);
    expect(slots.goalOpen).toBe(3);
  });

  it("doesn't count no-goal missions from before the restructure", () => {
    const slots = computeWeekSlots(
      [m({ created_at: before }), m({ created_at: before }), m({ created_at: before }), m({})],
      "2026-10-19",
      CUTOVER,
    );
    expect(slots.domainUsed.B).toBe(1);
    expect(slots.domainOpen.B).toBe(1);
  });

  it("still counts goal missions from before the restructure", () => {
    const rows = Array.from({ length: 7 }, () => m({ quarterly_goal_id: "g", created_at: before }));
    const slots = computeWeekSlots(rows, "2026-10-19", CUTOVER);
    expect(slots.goalUsed).toBe(7);
    expect(slots.goalOpen).toBe(0);
  });

  it("treats every no-goal mission as earlier when the cutover isn't known yet", () => {
    expect(isEarlierUnattached({ quarterly_goal_id: null, created_at: after }, null)).toBe(true);
    expect(isEarlierUnattached({ quarterly_goal_id: "g", created_at: before }, CUTOVER)).toBe(false);
  });
});

describe("trigger refusals", () => {
  const today = "2026-10-14"; // week of Oct 12
  it.each([
    ["mission_cap:domain:B:2026-10-19", "You already have two Bond missions next week."],
    ["mission_cap:domain:V:2026-10-12", "You already have two Vitality missions this week."],
    ["mission_cap:goal::2026-10-19", "You already have five goal missions next week."],
    ["mission_cap:goal::2026-11-02", "You already have five goal missions the week of Nov 2."],
    ["mission_pillar_retired:N", "Network doesn't take missions anymore. Pick Bond, Raise, Amplify, Vitality, or Enjoyment."],
    ["mission_goal_closed", "That goal is closed, so it can't take new missions."],
    ["goal_pillar_retired:M", "Goals go on Bond, Raise, Amplify, Vitality, or Enjoyment."],
  ])("%s", (details, expected) => {
    expect(friendlyMissionError({ details, message: "raw" }, today)).toBe(expected);
  });

  it("never shows a raw database error", () => {
    expect(friendlyMissionError({ details: null, message: 'violates check constraint "x"' }, today)).toBe(
      "That mission didn't save. Try again.",
    );
    expect(parseMissionRuleError(null)).toBeNull();
  });

  it("names weeks relative to his today", () => {
    expect(relativeWeek("2026-10-05", today)).toBe("last week");
    expect(relativeWeek("2026-10-12", "2026-10-18")).toBe("this week"); // Sunday
  });
});

describe("fitSuggestion (coach)", () => {
  const plan: CoachMissionPlan = {
    today: "2026-10-14",
    weeks: [
      computeWeekSlots([m({ target_date: "2026-10-13" }), m({ target_date: "2026-10-14" })], "2026-10-12", CUTOVER),
      computeWeekSlots(
        Array.from({ length: 5 }, () => m({ quarterly_goal_id: "g", target_date: "2026-10-20" })),
        "2026-10-19",
        CUTOVER,
      ),
    ],
    goals: [
      { n: 1, id: "goal-1", pillar: "V", text: "Deadlift 350" },
      { n: 2, id: "goal-2", pillar: "M", text: "Move every day" },
    ],
  };

  it("refuses a third Bond mission this week and says which slot is full", () => {
    const fit = fitSuggestion(plan, { pillar_code: "B", target_date: "2026-10-16", goal_number: null });
    expect(fit.ok).toBe(false);
    if (!fit.ok) expect(fit.note).toBe("You already have two Bond missions this week.");
  });

  it("accepts an open domain", () => {
    expect(fitSuggestion(plan, { pillar_code: "R", target_date: "2026-10-16", goal_number: null })).toMatchObject({
      ok: true,
      quarterly_goal_id: null,
      pillar_code: "R",
    });
  });

  it("maps goal_number to the goal and takes its pillar", () => {
    expect(fitSuggestion(plan, { pillar_code: "B", target_date: "2026-10-16", goal_number: 1 })).toMatchObject({
      ok: true,
      quarterly_goal_id: "goal-1",
      pillar_code: "V",
    });
  });

  it("refuses a sixth goal mission", () => {
    const fit = fitSuggestion(plan, { pillar_code: "V", target_date: "2026-10-22", goal_number: 1 });
    expect(fit.ok).toBe(false);
    if (!fit.ok) expect(fit.note).toBe("You already have five goal missions next week.");
  });

  it("refuses a goal number he doesn't have", () => {
    expect(fitSuggestion(plan, { pillar_code: "V", target_date: "2026-10-16", goal_number: 9 }).ok).toBe(false);
  });

  it("refuses Movement, Action and Network as domains", () => {
    for (const p of ["M", "A2", "N"]) {
      expect(fitSuggestion(plan, { pillar_code: p, target_date: "2026-10-16", goal_number: null }).ok).toBe(false);
    }
  });
});
