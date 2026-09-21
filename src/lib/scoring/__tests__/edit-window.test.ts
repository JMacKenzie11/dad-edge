import { describe, expect, it } from "vitest";
import { resolveEditWindow } from "../week";

const TZ = "America/Chicago";

/** Noon UTC on the given day — safely inside the day in any US zone. */
const at = (iso: string) => new Date(`${iso}T17:00:00Z`);

describe("resolveEditWindow", () => {
  it("keeps last week open through the grace period", () => {
    // Last week ran Mon Sep 14 - Sun Sep 20. The week-lock job locks
    // it once `now - weekEnd >= grace`, so 3 days of grace means it
    // stays open Mon the 21st and Tue the 22nd, and shuts on Wed.
    for (const day of ["2026-09-21", "2026-09-22"]) {
      const w = resolveEditWindow(at(day), TZ, 3);
      expect(w.lastWeekOpen, day).toBe(true);
      expect(w.earliest, day).toBe("2026-09-14");
      expect(w.lastWeekLocksOn).toBe("2026-09-23");
    }
  });

  it("closes last week the day the grace period runs out", () => {
    const w = resolveEditWindow(at("2026-09-23"), TZ, 3);
    expect(w.lastWeekOpen).toBe(false);
    expect(w.earliest).toBe("2026-09-21");
  });

  it("closes last week on Monday morning with a one-day grace", () => {
    // This is what a 1-day community does, and what used to be
    // imposed on every community a man belonged to.
    const w = resolveEditWindow(at("2026-09-21"), TZ, 1);
    expect(w.lastWeekOpen).toBe(false);
    expect(w.earliest).toBe("2026-09-21");
  });

  it("never reaches back further than last Monday", () => {
    // Even a grace period longer than a week only ever opens the one
    // prior week — older weeks are gone for good.
    const w = resolveEditWindow(at("2026-09-21"), TZ, 14);
    expect(w.earliest).toBe("2026-09-14");
    expect(w.lastMonday).toBe("2026-09-14");
  });

  it("keeps the floor at this Monday once the week is well underway", () => {
    // Sunday of the current week, 3-day grace: last week closed days
    // ago, so the floor is this week's Monday.
    const w = resolveEditWindow(at("2026-09-27"), TZ, 3);
    expect(w.today).toBe("2026-09-27");
    expect(w.thisMonday).toBe("2026-09-21");
    expect(w.lastWeekOpen).toBe(false);
    expect(w.earliest).toBe("2026-09-21");
  });

  it("zero grace shuts the door the moment the week ends", () => {
    const w = resolveEditWindow(at("2026-09-21"), TZ, 0);
    expect(w.lastWeekOpen).toBe(false);
    // The Sunday the week ended on — no room at all.
    expect(w.lastWeekLocksOn).toBe("2026-09-20");
  });
});
