/**
 * LIVE test: calls the real utility model. Runs with `npm run test:live`;
 * `npm test` excludes it.
 *
 * The Coaching pages' fit check (src/lib/coaching/fit.ts) on clear-cut
 * cases. Jason asked for a first try at judging whether a mission fits
 * its goal (2026-11-10); these are the calls it must get right every
 * time before its harder calls are worth anything.
 */
import { describe, expect, it } from "vitest";
import { judgeFit, type FitInput } from "@/lib/coaching/fit";
import type { FitVerdict } from "@/lib/coaching/signals";

const deadlift = { focus_area: "V", desired_end_state: "Deadlift 315 pounds by the end of December", current_state: "Pulling 245 for a single" } as const;
const dateNight = { focus_area: "B", desired_end_state: "A date night with my wife every week, phones away", current_state: "Maybe once a month" } as const;
const clients = { focus_area: "A", desired_end_state: "Sign three new coaching clients this quarter", current_state: "One client, no pipeline" } as const;

const cases: Array<[string, Omit<FitInput, "missionId" | "goalId" | "description">, string, FitVerdict[]]> = [
  ["a deadlift session under a deadlift goal", deadlift, "Deadlift 5x5 at 255 on Tuesday and Thursday", ["moves_it"]],
  ["booking the date under a date-night goal", dateNight, "Book the sitter and take her to dinner Friday, phone in the car", ["moves_it"]],
  ["prospect calls under a clients goal", clients, "Call 10 prospects from my list on Tuesday", ["moves_it"]],
  ["a dinner date under a deadlift goal", deadlift, "Take my wife to dinner Friday", ["no_link"]],
  ["cleaning the garage under a clients goal", clients, "Clean out the garage Saturday morning", ["no_link"]],
  ["general cardio under a deadlift goal", deadlift, "Walk 10,000 steps every day", ["related", "no_link"]],
];

describe("mission-goal fit check", () => {
  for (const [name, goal, description, allowed] of cases) {
    it(`${name}: ${allowed.join(" or ")}, three times running`, async () => {
      const got: (FitVerdict | null)[] = [];
      for (let i = 0; i < 3; i++) got.push(await judgeFit({ missionId: "m", goalId: "g", description, ...goal }));
      expect(got.every((v) => v !== null && allowed.includes(v)), `got: ${got.join(", ")}`).toBe(true);
    }, 60_000);
  }
});
