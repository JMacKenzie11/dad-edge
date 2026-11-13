import { describe, expect, it } from "vitest";
import { quarterMissionPcts } from "./people-directory";

describe("quarterMissionPcts", () => {
  it("gives all missions and goal missions their own percentage", () => {
    const m = quarterMissionPcts([
      { user_id: "a", status: "completed", quarterly_goal_id: "g1" },
      { user_id: "a", status: "missed", quarterly_goal_id: "g1" },
      { user_id: "a", status: "completed", quarterly_goal_id: null },
      { user_id: "a", status: "completed", quarterly_goal_id: null },
    ]);
    expect(m.get("a")).toEqual({ all: 75, onGoals: 50 });
  });

  it("leaves rolled-over missions out and says none when there's nothing to count", () => {
    const m = quarterMissionPcts([
      { user_id: "b", status: "rolled_over", quarterly_goal_id: "g1" },
      { user_id: "b", status: "completed", quarterly_goal_id: null },
    ]);
    expect(m.get("b")).toEqual({ all: 100, onGoals: null });
    expect(m.get("nobody")).toBeUndefined();
  });
});
