import { describe, expect, it } from "vitest";
import { resolveMissionWeek, shiftWeek, type MissionWeekInput } from "../week-nav";

const BASE: MissionWeekInput = {
  requested: undefined,
  thisMonday: "2026-09-21",
  lastMonday: "2026-09-14",
  nextMonday: "2026-09-28",
  canGoBack: true,
  firstMonday: "2026-08-31",
};

const resolve = (over: Partial<MissionWeekInput> = {}) =>
  resolveMissionWeek({ ...BASE, ...over });

describe("resolveMissionWeek", () => {
  it("defaults to this week with no param", () => {
    const v = resolve();
    expect(v).toMatchObject({ viewMonday: "2026-09-21", isLastWeek: false, isLocked: false });
  });

  it("offers the back arrow to last week", () => {
    expect(resolve()).toMatchObject({ prevMonday: "2026-09-14" });
  });

  it("opens next week any day, not just on a Sunday", () => {
    // Members asked to set next week's missions midweek (2026-11-03).
    expect(resolve()).toMatchObject({ nextMonday: "2026-09-28" });
    expect(resolve({ requested: "2026-09-28" })).toMatchObject({ viewMonday: "2026-09-28", isNextWeek: true });
  });

  it("steps one week at a time: back from next week is THIS week", () => {
    // The bug this file exists for: next -> back used to jump to last
    // week, skipping the week the man is actually living in.
    expect(resolve({ requested: "2026-09-28" })).toMatchObject({
      viewMonday: "2026-09-28",
      isNextWeek: true,
      prevMonday: "2026-09-21",
      nextMonday: null,
    });
  });

  it("last week is catch-up while the grace period is open", () => {
    expect(resolve({ requested: "2026-09-14" })).toMatchObject({
      viewMonday: "2026-09-14",
      isLastWeek: true,
      isLocked: false,
      prevMonday: "2026-09-07",
      nextMonday: "2026-09-21",
    });
  });

  it("last week is view-only once it has locked", () => {
    expect(resolve({ requested: "2026-09-14", canGoBack: false })).toMatchObject({
      viewMonday: "2026-09-14",
      isLastWeek: false,
      isLocked: true,
    });
  });

  it("goes back through every locked week to his first one, and no further", () => {
    expect(resolve({ requested: "2026-09-07" })).toMatchObject({ isLocked: true, prevMonday: "2026-08-31", nextMonday: "2026-09-14" });
    expect(resolve({ requested: "2026-08-31" })).toMatchObject({ isLocked: true, prevMonday: null });
    expect(resolve({ requested: "2026-08-24" })).toEqual({ redirect: true });
  });

  it("with no missions at all, back reaches last week only while it's open", () => {
    expect(resolve({ firstMonday: null })).toMatchObject({ prevMonday: "2026-09-14" });
    expect(resolve({ firstMonday: null, requested: "2026-09-14" })).toMatchObject({ prevMonday: null });
    expect(resolve({ firstMonday: null, canGoBack: false })).toMatchObject({ prevMonday: null });
    expect(resolve({ firstMonday: null, canGoBack: false, requested: "2026-09-14" })).toEqual({ redirect: true });
  });

  it("redirects rather than rendering an unreachable week", () => {
    // Two weeks out, a Tuesday, a date that doesn't exist, and junk.
    expect(resolve({ requested: "2026-10-05" })).toEqual({ redirect: true });
    expect(resolve({ requested: "2026-09-15" })).toEqual({ redirect: true });
    expect(resolve({ requested: "2026-02-30" })).toEqual({ redirect: true });
    expect(resolve({ requested: "not-a-date" })).toEqual({ redirect: true });
  });

  it("redirects ?week= pointing at this week to the canonical URL", () => {
    expect(resolve({ requested: "2026-09-21" })).toEqual({ redirect: true });
  });
});

describe("shiftWeek", () => {
  it("crosses month and daylight-saving boundaries cleanly", () => {
    expect(shiftWeek("2026-10-26", 1)).toBe("2026-11-02");
    expect(shiftWeek("2026-11-02", -1)).toBe("2026-10-26");
    expect(shiftWeek("2027-01-04", -1)).toBe("2026-12-28");
  });
});
