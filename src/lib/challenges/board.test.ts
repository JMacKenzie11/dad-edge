import { describe, expect, it } from "vitest";
import { buildBoard } from "./board";

// Mon 2026-11-02 .. Sun 2026-11-29: four weeks.
const challenge = { starts_on: "2026-11-02", ends_on: "2026-11-29" };
const m = (user_id: string, target_date: string, status = "planned") => ({ user_id, target_date, status });

/** An every-day challenge mission for the week starting `monday`, with the first `done` days ticked. */
function week(user_id: string, monday: string, done: number, status = done === 7 ? "completed" : "planned") {
  const target_dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${monday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  return { user_id, target_date: target_dates[6], target_dates, done_dates: target_dates.slice(0, done), status };
}

describe("buildBoard", () => {
  it("marks each week done, missed, open or upcoming from that week's mission", () => {
    const board = buildBoard({
      challenge,
      today: "2026-11-18", // week 3, Wednesday
      participants: [{ user_id: "a", status: "in", name: "Mike" }],
      missions: [
        m("a", "2026-11-06", "completed"),
        m("a", "2026-11-13", "missed"),
        m("a", "2026-11-20"),
        m("a", "2026-11-27"),
      ],
    });
    expect(board.phase).toBe("running");
    expect(board.currentWeek).toBe(3);
    expect(board.rows[0]).toMatchObject({ weeks: ["done", "missed", "open", "upcoming"], done: 1, missed: 1, thisWeek: "open" });
  });

  it("tallies the days he ticked across the challenge, against the days so far", () => {
    const board = buildBoard({
      challenge,
      today: "2026-11-18", // Wednesday of week 3
      participants: [{ user_id: "a", status: "in", name: "A" }],
      missions: [week("a", "2026-11-02", 7), week("a", "2026-11-09", 6), week("a", "2026-11-16", 2), week("a", "2026-11-23", 0)],
    });
    // Weeks 1 and 2 are 14 days, plus Mon and Tue of week 3. Today
    // (Wednesday) isn't ticked yet, so it doesn't count against him.
    expect(board.rows[0]).toMatchObject({ daysDone: 15, daysSoFar: 16, daysTotal: 28, weekTicks: [7, 6, 2, 0] });
  });

  it("ranks by days, so one missed day costs him a day, not a week", () => {
    const board = buildBoard({
      challenge,
      today: "2026-11-16",
      participants: [
        { user_id: "dan", status: "in", name: "Dan" },
        { user_id: "steve", status: "in", name: "Steve" },
        { user_id: "mike", status: "in", name: "Mike" },
      ],
      missions: [
        week("dan", "2026-11-02", 4), week("dan", "2026-11-09", 7),
        week("steve", "2026-11-02", 6), week("steve", "2026-11-09", 7),
        week("mike", "2026-11-02", 7), week("mike", "2026-11-09", 7),
      ],
    });
    expect(board.rows.map((r) => [r.name, r.daysDone])).toEqual([["Mike", 14], ["Steve", 13], ["Dan", 11]]);
  });

  it("ends with the days he did out of the days he had", () => {
    const missions = [week("a", "2026-11-02", 7), week("a", "2026-11-09", 5), week("a", "2026-11-16", 7), week("a", "2026-11-23", 7)];
    const board = buildBoard({ challenge, today: "2026-11-30", participants: [{ user_id: "a", status: "in", name: "A" }], missions });
    expect(board.rows[0]).toMatchObject({ daysDone: 26, daysSoFar: 28, daysTotal: 28, finisher: false });
  });

  it("counts a planned mission as missed once its week is over, even before the nightly job runs", () => {
    const board = buildBoard({ challenge, today: "2026-11-09", participants: [{ user_id: "a", status: "in", name: "A" }], missions: [m("a", "2026-11-06")] });
    expect(board.rows[0].weeks[0]).toBe("missed");
  });

  it("keeps a man who missed a week on the board", () => {
    const board = buildBoard({
      challenge,
      today: "2026-11-18",
      participants: [
        { user_id: "slip", status: "in", name: "Steve" },
        { user_id: "late", status: "in", name: "Dan" },
        { user_id: "ace", status: "in", name: "Mike" },
      ],
      missions: [
        m("slip", "2026-11-06", "completed"), m("slip", "2026-11-13"),
        // Joined in week 2: week 1 is blank and doesn't count against him.
        m("late", "2026-11-13", "completed"),
        m("ace", "2026-11-06", "completed"), m("ace", "2026-11-13", "completed"),
      ],
    });
    const byName = Object.fromEntries(board.rows.map((r) => [r.name, r]));
    expect(Object.keys(byName).sort()).toEqual(["Dan", "Mike", "Steve"]);
    expect(byName.Dan.weeks.slice(0, 2)).toEqual(["none", "done"]);
    expect(byName.Steve).toMatchObject({ missed: 1, weeks: ["done", "missed", "none", "none"] });
  });

  it("leaves out men who left or said not for me", () => {
    const board = buildBoard({
      challenge,
      today: "2026-11-18",
      participants: [
        { user_id: "a", status: "left", name: "A" },
        { user_id: "b", status: "declined", name: "B" },
        { user_id: "c", status: "in", name: "C" },
      ],
      missions: [],
    });
    expect(board.rows.map((r) => r.userId)).toEqual(["c"]);
  });

  it("gives the finisher mark only after the end, for every week hit", () => {
    const missions = ["2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27"].map((d) => m("a", d, "completed"));
    const running = buildBoard({ challenge, today: "2026-11-28", participants: [{ user_id: "a", status: "in", name: "A" }], missions });
    expect(running.rows[0].finisher).toBe(false);
    const ended = buildBoard({ challenge, today: "2026-11-30", participants: [{ user_id: "a", status: "in", name: "A" }], missions });
    expect(ended.phase).toBe("ended");
    expect(ended.currentWeek).toBeNull();
    expect(ended.rows[0].finisher).toBe(true);
  });

  it("covers the part weeks when a challenge starts and ends midweek", () => {
    const board = buildBoard({ challenge: { starts_on: "2026-11-05", ends_on: "2026-11-17" }, today: "2026-11-01", participants: [], missions: [] });
    expect(board.phase).toBe("upcoming");
    expect(board.weeks).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
  });
});
