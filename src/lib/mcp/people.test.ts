import { describe, expect, it } from "vitest";
import type { CommunityMember } from "@/lib/community/people-directory";
import { peopleNumbers } from "./people";

const person = (userId: string, name: string, dailyLivingAvg: number, extra: Partial<CommunityMember> = {}) =>
  ({ userId, name, dailyLivingAvg, streak: 3, missionPct: 80, goalMissionPct: 50, tenureWeeks: 9, goals: [{ text: "secret goal wording" }], email: "x@x", ...extra }) as unknown as CommunityMember;
const man = (userId: string, first: string, last: string) => ({ userId, first_name: first, last_name: last, email: "x@x", role: "member" as const });

describe("people numbers", () => {
  it("most active first, counted men only, numbers only", () => {
    const r = peopleNumbers(
      [person("a", "Erik Brown", 30.04), person("b", "Larry Hagner", 41.66, { missionPct: null, goalMissionPct: null }), person("s", "Staff Person", 49)],
      [man("a", "Erik", "Brown"), man("b", "Larry", "Hagner")],
    );
    expect(r).toEqual([
      { name: "Larry H.", daily_avg: 41.7, streak_days: 3, missions_pct: null, goal_missions_pct: null, weeks_in: 9 },
      { name: "Erik B.", daily_avg: 30, streak_days: 3, missions_pct: 80, goal_missions_pct: 50, weeks_in: 9 },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/secret goal wording|x@x/);
  });
});
