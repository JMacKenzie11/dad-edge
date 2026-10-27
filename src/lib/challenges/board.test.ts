import { describe, expect, it } from "vitest";
import { buildBoard } from "./board";

// Mon 2026-11-02 .. Sun 2026-11-29: four weeks.
const challenge = { starts_on: "2026-11-02", ends_on: "2026-11-29" };
const m = (user_id: string, target_date: string, status = "planned") => ({ user_id, target_date, status });

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
    expect(board.rows[0]).toMatchObject({ weeks: ["done", "missed", "open", "upcoming"], done: 1, missed: 1, perfect: false, thisWeek: "open" });
  });

  it("shows this week's ticked days against the target", () => {
    const board = buildBoard({
      challenge: { ...challenge, target: 5 },
      today: "2026-11-18",
      participants: [{ user_id: "a", status: "in", name: "A" }, { user_id: "b", status: "in", name: "B" }],
      missions: [
        { ...m("a", "2026-11-22"), target_dates: ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"], done_dates: ["2026-11-16", "2026-11-17"] },
        // Joined Saturday-ish: two days left, so the week's target is two.
        { ...m("b", "2026-11-22"), target_dates: ["2026-11-21", "2026-11-22"], done_dates: [] },
      ],
    });
    const byName = Object.fromEntries(board.rows.map((r) => [r.name, r.thisWeekDays]));
    expect(byName).toEqual({ A: { done: 2, target: 5 }, B: { done: 0, target: 2 } });
  });

  it("counts a planned mission as missed once its week is over, even before the nightly job runs", () => {
    const board = buildBoard({ challenge, today: "2026-11-09", participants: [{ user_id: "a", status: "in", name: "A" }], missions: [m("a", "2026-11-06")] });
    expect(board.rows[0].weeks[0]).toBe("missed");
  });

  it("keeps a man who missed a week on the board, below the ones still perfect", () => {
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
    expect(board.rows.map((r) => r.name)).toEqual(["Mike", "Dan", "Steve"]);
    expect(board.rows[1].weeks.slice(0, 2)).toEqual(["none", "done"]);
    expect(board.rows[1].perfect).toBe(true);
    expect(board.rows[2]).toMatchObject({ perfect: false, missed: 1 });
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
