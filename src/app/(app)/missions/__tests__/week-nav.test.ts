import { describe, expect, it } from "vitest";
import { resolveMissionWeek, type MissionWeekInput } from "../week-nav";

const BASE: MissionWeekInput = {
  requested: undefined,
  thisMonday: "2026-09-21",
  lastMonday: "2026-09-14",
  nextMonday: "2026-09-28",
  canGoBack: true,
  canGoForward: false,
};

const resolve = (over: Partial<MissionWeekInput> = {}) =>
  resolveMissionWeek({ ...BASE, ...over });

describe("resolveMissionWeek", () => {
  it("defaults to this week with no param", () => {
    const v = resolve();
    expect(v).toMatchObject({ viewMonday: "2026-09-21", isLastWeek: false });
  });

  it("offers the back arrow while the grace period is open", () => {
    expect(resolve()).toMatchObject({ prevMonday: "2026-09-14", nextMonday: null });
  });

  it("disables the back arrow once last week has locked", () => {
    expect(resolve({ canGoBack: false })).toMatchObject({ prevMonday: null });
  });

  it("opens next week on a Sunday", () => {
    expect(resolve({ canGoForward: true })).toMatchObject({
      nextMonday: "2026-09-28",
    });
  });

  it("steps one week at a time — back from next week is THIS week", () => {
    // The bug this file exists for: next -> back used to jump to last
    // week, skipping the week the man is actually living in.
    const v = resolve({ requested: "2026-09-28", canGoForward: true });
    expect(v).toMatchObject({
      viewMonday: "2026-09-28",
      isNextWeek: true,
      prevMonday: "2026-09-21",
      nextMonday: null,
    });
  });

  it("from last week, forward returns to this week and back is closed", () => {
    const v = resolve({ requested: "2026-09-14" });
    expect(v).toMatchObject({
      viewMonday: "2026-09-14",
      isLastWeek: true,
      prevMonday: null,
      nextMonday: "2026-09-21",
    });
  });

  it("redirects rather than rendering an unreachable week", () => {
    // Locked, too far back, next week on a non-Sunday, and junk.
    expect(resolve({ requested: "2026-09-14", canGoBack: false })).toEqual({ redirect: true });
    expect(resolve({ requested: "2026-09-07" })).toEqual({ redirect: true });
    expect(resolve({ requested: "2026-09-28" })).toEqual({ redirect: true });
    expect(resolve({ requested: "not-a-date" })).toEqual({ redirect: true });
  });

  it("redirects ?week= pointing at this week to the canonical URL", () => {
    expect(resolve({ requested: "2026-09-21" })).toEqual({ redirect: true });
  });
});
