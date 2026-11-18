import { describe, expect, it } from "vitest";
import { missionList, type MissionListRow } from "./missions";

const man = (userId: string, first: string) => ({ userId, first_name: first, last_name: "Hagner", email: `${first}@x.test`, role: "member" as const });
const WEEK = { start: "2026-11-09", end: "2026-11-15" };
const row = (r: Partial<MissionListRow>): MissionListRow => ({
  user_id: "a",
  description: "Write a note in Jess notebook",
  pillar_code: "B",
  status: "completed",
  target_date: "2026-11-09",
  target_dates: ["2026-11-09"],
  done_dates: [],
  challenge_id: null,
  quarterly_goal_id: null,
  ...r,
});

describe("missions list", () => {
  it("gives each mission's words, domain, days and how it went", () => {
    const r = missionList(
      [man("a", "Larry"), man("b", "Tim")],
      [
        row({ description: "Bible study ", pillar_code: "E", target_date: "2026-11-13", target_dates: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"] }),
        row({}),
        row({ description: "Breakfast with Kenneth", pillar_code: "R", status: "missed", target_date: "2026-11-13", target_dates: ["2026-11-13"], quarterly_goal_id: "g" }),
        row({ description: "60 burpees", pillar_code: "V", target_date: "2026-11-15", target_dates: ["2026-11-14", "2026-11-15"], done_dates: ["2026-11-14"], challenge_id: "c" }),
        row({ description: "Next week", target_date: "2026-11-16", target_dates: ["2026-11-16"] }),
      ],
      WEEK,
    );
    expect(r.no_missions).toEqual(["Tim H."]);
    expect(r.men).toHaveLength(1);
    expect(r.men[0].name).toBe("Larry H.");
    expect(r.men[0].missions.map((m) => [m.domain, m.text, m.status, m.days_planned, m.days_done, m.on_goal, m.challenge])).toEqual([
      ["BOND", "Write a note in Jess notebook", "done", 1, 1, false, false],
      ["ENJOYMENT", "Bible study", "done", 5, 5, false, false],
      ["RAISE", "Breakfast with Kenneth", "missed", 1, 0, true, false],
      ["VITALITY", "60 burpees", "done", 2, 1, false, true],
    ]);
    expect(r.men[0].missions[1].days).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
  });
});
