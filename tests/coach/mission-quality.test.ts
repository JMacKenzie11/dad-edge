/**
 * LIVE test: calls the real utility model. Runs with `npm run test:live`;
 * `npm test` excludes it.
 *
 * Jason's "Walk 10 km 3 times" with Friday, Saturday and Sunday picked
 * scored 6/10 (2026-10-16). The scorer was only told the last day, so
 * "3 times" read as unpinned, and the same wording scored anywhere
 * from 6 to 8 run to run. A mission whose count matches the days picked
 * on the row is fully specific and binary, and it gets the same score
 * every time.
 */
import { describe, expect, it } from "vitest";
import { scoreMissionDraft } from "@/lib/coach/mission-quality";

describe("mission scorer reads the days picked on the row", () => {
  it("scores 'Walk 10 km 3 times' on Fri/Sat/Sun at 9 or more, five times running", async () => {
    const totals: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await scoreMissionDraft({
        description: "Walk 10 km 3 times",
        target_dates: ["2026-10-16", "2026-10-17", "2026-10-18"],
      });
      totals.push(r.total);
    }
    expect(totals.every((t) => t >= 9), `totals: ${totals.join(", ")}`).toBe(true);
    expect(new Set(totals).size, `totals: ${totals.join(", ")}`).toBe(1);
  }, 60_000);

  it("a control: a vague mission on the same days still isn't ready", async () => {
    const r = await scoreMissionDraft({
      description: "Walk more",
      target_dates: ["2026-10-16", "2026-10-17", "2026-10-18"],
    });
    expect(r.ready, `scores: ${JSON.stringify(r.scores)}`).toBe(false);
  }, 30_000);
});
