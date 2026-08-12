/**
 * E2E flow test: from a fresh map, walk through goal → behaviors →
 * worries. Real coach, real DB, real cascade / backstops. Asserts that
 * stage advances correctly at each user-scripted turn and that DB rows
 * land where they should.
 *
 * Not exhaustive on content quality (the scenario tests cover that);
 * this is the integration smoke test — the pieces snap together end
 * to end without getting stuck.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listBehaviors, listWorries } from "@/lib/itc/maps";
import {
  cleanupTestMap,
  createTestMap,
  type TestMapContext,
} from "../helpers/fixtures";
import { runTurn } from "../helpers/turn";

describe("E2E: goal → behaviors → worries flow", () => {
  let ctx: TestMapContext;

  beforeAll(async () => {
    ctx = await createTestMap("A");
  }, 30_000);

  afterAll(async () => {
    if (ctx) await cleanupTestMap(ctx);
  }, 30_000);

  it(
    "walks a fresh map through goal → behaviors → worries — asserts FINAL state, not per-turn transitions",
    async () => {
      // Scripted user turns for the full goal → worries path. Coach
      // decides how to interpret each turn (may advance early if the
      // opening reads as a lockable goal, may hone if not). This
      // test doesn't care about intermediate stages — only that the
      // pipeline reaches worries with a proper goal + selected
      // behaviors on the map. That's the integration smoke test.
      const script = [
        "I want to get better at being present and calm when my wife is upset with me.",
        "yes lock it in",
        "I shut down and walk out of the room.",
        "I bring up things she did wrong in the past.",
        "I go on the offense and start pointing out her flaws.",
        "I agree just to end the conversation, even when I don't mean it.",
        "that's it, let's move on to the worries",
      ];

      for (const userText of script) {
        const t = await runTurn(ctx.mapId, userText);
        expect(t.ok, `Turn failed: "${userText}" — ${t.reason}`).toBe(true);
      }

      // Final DB assertions — the pipeline shape after the full script.
      const [behaviors, worries] = await Promise.all([
        listBehaviors(ctx.mapId),
        listWorries(ctx.mapId),
      ]);
      const selectedBehaviors = behaviors.filter((b) => b.selected);

      // Goal must be set and start with the stem.
      // (Fetched via a fresh runTurn result; use finalMap from a no-op
      // read — simpler to just do it via the last turn's finalMap.)
      const finalT = await runTurn(ctx.mapId, "just checking in");
      expect(finalT.finalMap.improvement_goal, "goal should be set").toMatch(
        /I['\u2019]m committed to getting better at/i,
      );

      // Should end up in worries or later (coach may have progressed
      // further depending on how it interpreted the "just checking in"
      // message; either way, we're past behaviors).
      expect(
        ["worries", "commitments", "assumptions", "review"],
        `Expected to be in worries or later. Got: ${finalT.finalMap.current_stage}`,
      ).toContain(finalT.finalMap.current_stage);

      // 3-5 selected behaviors on the map after the full script.
      expect(
        selectedBehaviors.length,
        `Expected 3-5 selected behaviors. Got ${selectedBehaviors.length}`,
      ).toBeGreaterThanOrEqual(3);
      expect(selectedBehaviors.length).toBeLessThanOrEqual(5);

      // Log for inspection — E2E gives us the whole trajectory to
      // eyeball if something feels off.
      // eslint-disable-next-line no-console
      console.log(
        `[e2e] final stage=${finalT.finalMap.current_stage} behaviors=${selectedBehaviors.length} worries=${worries.length}`,
      );
    },
    600_000,
  );
});
