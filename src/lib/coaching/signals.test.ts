import { describe, expect, it } from "vitest";
import { computeSignals, quote, type CoachGoal, type CoachMission, type FitVerdict, type ManInput } from "./signals";

// Wednesday 2026-11-11; the week started Monday 2026-11-09.
const TODAY = "2026-11-11";
const MONDAY = "2026-11-09";

let n = 0;
function mission(over: Partial<CoachMission> = {}): CoachMission {
  n += 1;
  const date = over.target_date ?? "2026-11-04";
  return {
    id: `m${n}`,
    description: `Mission number ${n} written out`,
    pillar_code: "V",
    target_date: date,
    target_dates: [date],
    status: "completed",
    completed_late: false,
    rolled_over_from_mission_id: null,
    quarterly_goal_id: null,
    quality_score: 9,
    ...over,
  };
}

function goal(over: Partial<CoachGoal> = {}): CoachGoal {
  return {
    id: "g1",
    focus_area: "V",
    desired_end_state: "Deadlift 315 by December",
    current_state: "Pulling 245 today",
    source: "user",
    status: "active",
    created_at: "2026-10-01T12:00:00Z",
    midpoint_check_at: null,
    midpoint_check_answer: null,
    retrospective_what_happened: null,
    ...over,
  };
}

/** A man with nothing to flag: active, a goal with a mission this week. */
function healthy(over: Partial<ManInput> = {}): ManInput {
  return {
    goals: [goal()],
    missions: [mission({ target_date: "2026-11-12", target_dates: ["2026-11-12"], status: "planned", quarterly_goal_id: "g1" })],
    fit: new Map<string, FitVerdict>(),
    lastCheckin: "2026-11-10",
    streak: 3,
    today: TODAY,
    weekStart: MONDAY,
    ...over,
  };
}

const kinds = (i: ManInput) => computeSignals(i).flags.map((f) => f.kind);

describe("coaching signals", () => {
  it("a healthy man has no flags", () => {
    expect(kinds(healthy())).toEqual([]);
  });

  it("flags a week without a check-in, and two weeks as urgent", () => {
    const week = computeSignals(healthy({ lastCheckin: "2026-11-03" })).flags[0];
    expect(week).toMatchObject({ kind: "inactive", severity: 2, line: "No daily check-ins in the last 8 days." });
    expect(computeSignals(healthy({ lastCheckin: "2026-10-20" })).flags[0].severity).toBe(3);
    expect(computeSignals(healthy({ lastCheckin: null })).flags[0].line).toBe("No daily check-ins yet.");
    expect(kinds(healthy({ lastCheckin: "2026-11-05" }))).toEqual([]);
  });

  it("flags no goal this quarter, but not when the only goal is completed", () => {
    expect(kinds(healthy({ goals: [] }))).toContain("no_goal");
    expect(kinds(healthy({ goals: [goal({ status: "abandoned" })] }))).toContain("no_goal");
    expect(kinds(healthy({ goals: [goal({ status: "completed" })] }))).not.toContain("no_goal");
  });

  it("flags a goal with no mission in three weeks, unless it's new", () => {
    const quiet = healthy({ missions: [mission({ target_date: "2026-10-15", quarterly_goal_id: "g1" }), mission({ target_date: "2026-11-12", target_dates: ["2026-11-12"], status: "planned" })] });
    const f = computeSignals(quiet).flags.find((x) => x.kind === "goal_quiet");
    expect(f?.question).toBe('What\'s one thing this week that moves "Deadlift 315 by December" forward?');
    const fresh = { ...quiet, goals: [goal({ created_at: "2026-11-05T00:00:00Z" })] };
    expect(kinds(fresh)).not.toContain("goal_quiet");
  });

  it("flags a goal with no starting point, but not an improvement-map goal", () => {
    expect(kinds(healthy({ goals: [goal({ current_state: "  " })] }))).toContain("goal_no_start");
    expect(kinds(healthy({ goals: [goal({ current_state: null, source: "itc" })] }))).not.toContain("goal_no_start");
  });

  it("flags a waiting midpoint check-in and a waiting look back", () => {
    expect(kinds(healthy({ goals: [goal({ midpoint_check_at: "2026-11-01" })] }))).toContain("midpoint_waiting");
    expect(kinds(healthy({ goals: [goal({ midpoint_check_at: "2026-11-01", midpoint_check_answer: "On track" })] }))).not.toContain("midpoint_waiting");
    expect(kinds(healthy({ goals: [goal({ midpoint_check_at: "2026-11-20" })] }))).not.toContain("midpoint_waiting");
    expect(kinds(healthy({ goals: [goal({ status: "needs_review" })] }))).toContain("review_waiting");
  });

  it("flags low completion over four weeks", () => {
    const ms = [
      ...["2026-10-20", "2026-10-22", "2026-10-27"].map((d) => mission({ target_date: d, status: "missed" })),
      mission({ target_date: "2026-11-03" }),
      mission({ target_date: "2026-11-12", target_dates: ["2026-11-12"], status: "planned", quarterly_goal_id: "g1" }),
    ];
    const f = computeSignals(healthy({ missions: ms })).flags.find((x) => x.kind === "execution_low");
    expect(f?.line).toBe("Done 1 of 4 missions in the last 4 weeks.");
  });

  it("flags a sharp drop, and calls a sharp rise a comeback", () => {
    const prior = ["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"].map((d) => mission({ target_date: d }));
    const dropped = ["2026-10-20", "2026-10-27", "2026-11-03"].map((d, i) => mission({ target_date: d, status: i === 0 ? "completed" : i === 1 ? "completed" : "missed" }));
    const s = computeSignals(healthy({ missions: [...prior, ...dropped, ...healthy().missions] }));
    // 4/4 then 2/3: 33 points down, but 2/3 isn't low.
    expect(s.flags.map((f) => f.kind)).toContain("execution_drop");

    const priorBad = ["2026-09-21", "2026-09-28", "2026-10-05"].map((d) => mission({ target_date: d, status: "missed" }));
    const upNow = ["2026-10-20", "2026-10-27", "2026-11-03"].map((d) => mission({ target_date: d }));
    const up = computeSignals(healthy({ missions: [...priorBad, ...upNow, ...healthy().missions] }));
    expect(up.wins.map((w) => w.kind)).toContain("comeback");
  });

  it("flags a mission rolled over twice, naming the latest copy", () => {
    const a = mission({ id: "a", target_date: "2026-10-28", status: "rolled_over", description: "Fix the garage door" });
    const b = mission({ id: "b", target_date: "2026-11-04", status: "rolled_over", rolled_over_from_mission_id: "a", description: "Fix the garage door" });
    const c = mission({ id: "c", target_date: "2026-11-12", target_dates: ["2026-11-12"], status: "planned", rolled_over_from_mission_id: "b", description: "Fix the garage door" });
    const f = computeSignals(healthy({ missions: [a, b, c] })).flags.find((x) => x.kind === "stuck_mission");
    expect(f).toMatchObject({ missionId: "c", line: '"Fix the garage door" has rolled over 2 times.' });
    // Rolled over once: not stuck yet.
    expect(kinds(healthy({ missions: [{ ...b, rolled_over_from_mission_id: null }, c] }))).not.toContain("stuck_mission");
  });

  it("flags two or more loosely written missions", () => {
    const ms = [mission({ quality_score: 4 }), mission({ quality_score: 5, target_date: "2026-11-12", target_dates: ["2026-11-12"], status: "planned" })];
    expect(kinds(healthy({ missions: ms }))).toContain("vague_missions");
    expect(kinds(healthy({ missions: [mission({ quality_score: 4, target_date: "2026-11-12", target_dates: ["2026-11-12"] })] }))).not.toContain("vague_missions");
  });

  it("flags an empty week, counting any picked day in the week", () => {
    expect(kinds(healthy({ missions: [] }))).toContain("nothing_planned");
    const spans = mission({ target_date: "2026-11-16", target_dates: ["2026-11-14", "2026-11-16"], status: "planned", quarterly_goal_id: "g1" });
    expect(kinds(healthy({ missions: [spans] }))).not.toContain("nothing_planned");
  });

  it("flags missions the fit check says don't move the goal", () => {
    const off = mission({ id: "x", quarterly_goal_id: "g1", description: "Reorganize the pantry" });
    const on = mission({ id: "y", quarterly_goal_id: "g1", target_date: "2026-11-12", target_dates: ["2026-11-12"], status: "planned" });
    const one = computeSignals(healthy({ missions: [off, on], fit: new Map([["x", "no_link"], ["y", "moves_it"]]) })).flags.find((f) => f.kind === "fit_off");
    expect(one).toMatchObject({ severity: 1, missionId: "x", line: '"Reorganize the pantry" doesn\'t look like it moves "Deadlift 315 by December" forward.' });
    const both = computeSignals(healthy({ missions: [off, on], fit: new Map([["x", "no_link"], ["y", "no_link"]]) })).flags.find((f) => f.kind === "fit_off");
    expect(both?.severity).toBe(2);
    expect(both?.line).toBe('2 of his 2 recent missions under "Deadlift 315 by December" don\'t look like they move it forward.');
    expect(kinds(healthy({ missions: [off, on], fit: new Map([["x", "related"]]) }))).not.toContain("fit_off");
  });

  it("names the wins", () => {
    const sweep = ["2026-10-20", "2026-10-27", "2026-11-03", "2026-11-05"].map((d) => mission({ target_date: d }));
    const s = computeSignals(healthy({ missions: [...sweep, ...healthy().missions], streak: 20, goals: [goal(), goal({ id: "g2", status: "completed", desired_end_state: "Read four books" })] }));
    expect(s.wins.map((w) => w.line)).toEqual([
      "Done all 4 missions in the last 4 weeks.",
      'Completed "Read four books".',
      "Checked in 20 days running.",
    ]);
  });

  it("weights and orders flags most serious first", () => {
    const s = computeSignals(healthy({ lastCheckin: null, missions: [], goals: [goal({ current_state: null })] }));
    expect(s.flags[0].kind).toBe("inactive");
    expect(s.weight).toBe(s.flags.reduce((t, f) => t + f.severity, 0));
  });

  it("never writes an em dash", () => {
    const s = computeSignals(healthy({ lastCheckin: null, missions: [], goals: [goal({ current_state: null, status: "needs_review", midpoint_check_at: "2026-10-01" })] }));
    for (const f of s.flags) expect(`${f.line} ${f.question}`).not.toMatch(/[—–]/);
  });

  it("shortens long quotes on a word", () => {
    expect(quote("a".repeat(70))).toHaveLength(60);
    expect(quote("  Run   the river trail  ")).toBe("Run the river trail");
    expect(quote("Lift four times a week by the end of the quarter.")).toBe("Lift four times a week by the end of the quarter");
  });
});
