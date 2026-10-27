import { describe, expect, it } from "vitest";
import {
  challengeDates,
  challengeFormSchema,
  challengeWeeks,
  daysLetters,
  friendlyChallengeError,
  missionTargetNote,
  targetLine,
  weekTarget,
} from "./rules";

describe("challenge wording", () => {
  it("says what a week asks", () => {
    expect(targetLine({ days: [1, 3, 5, 6], target: 3 })).toBe("3 of M W F S each week");
    expect(targetLine({ days: [1, 3, 5], target: 3 })).toBe("M W F each week");
    expect(targetLine({ days: [1, 2, 3, 4, 5, 6, 7], target: 7 })).toBe("Every day");
    expect(targetLine({ days: [6], target: 1 })).toBe("S each week");
    expect(targetLine({ days: [1, 2, 3, 4, 5, 6, 7], target: 3 })).toBe("Any 3 days each week");
    expect(daysLetters([5, 1, 3])).toBe("M W F");
    expect(challengeDates({ starts_on: "2026-11-03", ends_on: "2026-12-30" })).toBe("Nov 3 to Dec 30");
  });

  it("cuts a part week's target to the days it has", () => {
    // M/W/F, all three, joined Thursday: only Friday is left.
    expect(weekTarget(3, 1)).toBe(1);
    expect(weekTarget(3, 4)).toBe(3);
    expect(missionTargetNote(3, 4)).toBe("Any 3 of these days counts.");
    expect(missionTargetNote(3, 1)).toBeNull();
    expect(missionTargetNote(3, 3)).toBeNull();
  });

  it("lists every week a challenge touches", () => {
    expect(challengeWeeks("2026-11-04", "2026-11-16")).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(challengeWeeks("2026-11-02", "2026-11-08")).toEqual(["2026-11-02"]);
  });
});

describe("challenge form", () => {
  const schema = challengeFormSchema("2026-10-27");
  const ok = {
    name: "30 Days of Movement",
    pillar_code: "V",
    mission_description: "Walk 10 km",
    days: ["5", "1", "3", "3"],
    target: "2",
    starts_on: "2026-11-02",
    ends_on: "2026-11-29",
  };

  it("accepts a valid challenge and tidies the days", () => {
    const r = schema.safeParse(ok);
    expect(r.success && r.data.days).toEqual([1, 3, 5]);
  });

  it.each([
    [{ target: "4" }, "The target can't be more than the days you picked."],
    [{ pillar_code: "M" }, "Pick Bond, Raise, Amplify, Vitality or Enjoyment."],
    [{ ends_on: "2026-11-01" }, "The end date comes before the start date."],
    [{ starts_on: "2026-10-01", ends_on: "2026-10-20" }, "The end date has already passed."],
    [{ days: ["6"], starts_on: "2026-11-02", ends_on: "2026-11-04" }, "None of the picked days fall between those dates."],
    [{ days: [] }, "Pick at least one day."],
  ])("refuses %o", (patch, message) => {
    const r = schema.safeParse({ ...ok, ...patch });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain(message);
  });
});

describe("friendlyChallengeError", () => {
  it("names the locked fields", () => {
    expect(friendlyChallengeError({ details: "challenge_locked" })).toMatch(/already joined/);
    expect(friendlyChallengeError({ details: "challenge_mission_locked" })).toMatch(/keeps the challenge/);
    expect(friendlyChallengeError({ details: "other" })).toBe("That didn't save. Try again.");
  });
});
