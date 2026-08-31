/**
 * Unit test for the multi-day mission normalizer.
 *
 * Missions can target multiple days (M/W/F etc.) via the target_dates
 * array column added 2026-08-31. `target_date` stays as the deadline
 * (max of the set) so downstream jobs / views that still read the
 * scalar column keep working. This test locks that contract without
 * needing a DB.
 */

import { describe, expect, it } from "vitest";
import { resolveTargetDates, shiftDatesByOneWeek } from "../target-dates";

describe("resolveTargetDates", () => {
  it("returns null when neither target_dates nor target_date is provided", () => {
    expect(resolveTargetDates({})).toBeNull();
  });

  it("returns null when target_dates is an empty array and target_date is missing", () => {
    expect(resolveTargetDates({ target_dates: [] })).toBeNull();
  });

  it("wraps a single target_date into a 1-element sorted array", () => {
    const res = resolveTargetDates({ target_date: "2026-08-31" });
    expect(res).toEqual({ dates: ["2026-08-31"], deadline: "2026-08-31" });
  });

  it("preserves target_dates when both fields are set (target_dates wins)", () => {
    // target_dates is the newer field. When the caller passes both,
    // the array is authoritative — a shim caller passing target_date
    // for back-compat shouldn't override the intended multi-day set.
    const res = resolveTargetDates({
      target_dates: ["2026-09-01", "2026-09-03"],
      target_date: "2026-08-31",
    });
    expect(res).toEqual({
      dates: ["2026-09-01", "2026-09-03"],
      deadline: "2026-09-03",
    });
  });

  it("deduplicates repeated dates", () => {
    const res = resolveTargetDates({
      target_dates: ["2026-09-02", "2026-09-01", "2026-09-02"],
    });
    expect(res).toEqual({
      dates: ["2026-09-01", "2026-09-02"],
      deadline: "2026-09-02",
    });
  });

  it("sorts dates ascending regardless of input order", () => {
    const res = resolveTargetDates({
      target_dates: ["2026-09-05", "2026-09-01", "2026-09-03"],
    });
    expect(res).toEqual({
      dates: ["2026-09-01", "2026-09-03", "2026-09-05"],
      deadline: "2026-09-05",
    });
  });

  it("takes the max of the set as the deadline (target_date must mirror max(target_dates))", () => {
    const res = resolveTargetDates({
      target_dates: ["2026-09-02", "2026-09-07", "2026-09-04"],
    });
    // The deadline drives downstream jobs (mission-nudges, mark-missed,
    // digest) which still read scalar target_date. If this ever
    // regresses to picking min or first, missed-mission jobs will fire
    // a day early and confuse the coachee.
    expect(res?.deadline).toBe("2026-09-07");
  });

  it("handles a single-element target_dates array the same as a single target_date", () => {
    const arr = resolveTargetDates({ target_dates: ["2026-09-02"] });
    const scalar = resolveTargetDates({ target_date: "2026-09-02" });
    expect(arr).toEqual(scalar);
  });
});

describe("shiftDatesByOneWeek", () => {
  // Backs the → NEXT WEEK carry-forward action. A mission targeting
  // M/T/F/S this week has to land on M/T/F/S next week — anything
  // else and a coachee's weekly staple silently drifts a day.

  it("shifts a single date by +7 days", () => {
    expect(shiftDatesByOneWeek(["2026-09-01"])).toEqual(["2026-09-08"]);
  });

  it("preserves the day-of-week pattern across a multi-day set", () => {
    // Mon/Tue/Fri/Sat → same four weekdays next week.
    const source = ["2026-08-31", "2026-09-01", "2026-09-04", "2026-09-05"];
    const shifted = shiftDatesByOneWeek(source);
    expect(shifted).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-11",
      "2026-09-12",
    ]);
    // Sanity: every shifted date is exactly one weekday match on the
    // Gregorian calendar. If the mapping ever regressed to +6 or +8
    // we'd land on a different weekday.
    const dow = (iso: string) =>
      new Date(`${iso}T00:00:00Z`).getUTCDay();
    source.forEach((src, i) => {
      expect(dow(shifted[i])).toBe(dow(src));
    });
  });

  it("crosses a month boundary cleanly", () => {
    expect(shiftDatesByOneWeek(["2026-08-30"])).toEqual(["2026-09-06"]);
  });

  it("crosses a year boundary cleanly", () => {
    expect(shiftDatesByOneWeek(["2026-12-30"])).toEqual(["2027-01-06"]);
  });

  it("survives a DST spring-forward week (US: 2027-03-14) with day-of-week intact", () => {
    // 2027-03-07 (Sun) → 2027-03-14 (Sun). Naive local-Date arithmetic
    // around DST can round-trip via ISO to the wrong calendar day; UTC
    // math has no such risk. If this regresses to picking up local
    // 23:00 or 01:00, the ISO slice would drift by ±1 day and this
    // test would catch it.
    expect(shiftDatesByOneWeek(["2027-03-07"])).toEqual(["2027-03-14"]);
  });

  it("survives a DST fall-back week (US: 2026-11-01) with day-of-week intact", () => {
    expect(shiftDatesByOneWeek(["2026-10-25"])).toEqual(["2026-11-01"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(shiftDatesByOneWeek([])).toEqual([]);
  });
});
