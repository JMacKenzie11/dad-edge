import { describe, expect, it } from "vitest";
import { dailyLiving } from "./daily-living";

const week = { start: "2026-11-02", end: "2026-11-08" };
const man = (userId: string, first: string, last: string) => ({ userId, first_name: first, last_name: last, email: `${first}@x.test`, role: "member" as const });

describe("dailyLiving", () => {
  it("scores each man out of 49, best first, the way the leaderboard does", () => {
    const r = dailyLiving(
      [man("a", "Larry", "Hagner"), man("b", "Erik", "Brown"), man("c", "Al", "West")],
      [
        { user_id: "a", date: "2026-11-02", pillar_code: "B", value: 1 },
        { user_id: "a", date: "2026-11-02", pillar_code: "B", value: 1 }, // same pillar, same day: one point
        { user_id: "a", date: "2026-11-02", pillar_code: "A2", value: 1 }, // missions, not check-ins
        { user_id: "a", date: "2026-11-02", pillar_code: "R", value: 0 },
        { user_id: "b", date: "2026-11-03", pillar_code: "V", value: 1 },
        { user_id: "b", date: "2026-11-04", pillar_code: "V", value: 1 },
        { user_id: "b", date: "2026-11-09", pillar_code: "V", value: 1 }, // next week
      ],
      week,
    );
    expect(r.men).toEqual([
      { name: "Erik B.", score: 2, max: 49, percent: 4, days_checked_in: 2 },
      { name: "Larry H.", score: 1, max: 49, percent: 2, days_checked_in: 1 },
    ]);
    expect(r.no_checkins).toEqual(["Al W."]);
    expect(r.average).toEqual({ score: 1, max: 49, percent: 2 });
    expect(JSON.stringify(r)).not.toMatch(/pillar|date"|@x/);
  });

  it("says nothing about an empty community", () => {
    expect(dailyLiving([], [], week)).toEqual({ week, average: null, men: [], no_checkins: [] });
  });
});
