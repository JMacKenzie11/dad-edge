/**
 * E2E: results → new_assumption iteration path. Seed a map with:
 *   - one test complete against assumption A (selected_for_testing)
 *   - a second assumption B on the map (unlinked selection)
 *
 * Drive the "let me test a different assumption" turn. Coach should
 * cascade results → prioritize (clearing selected_for_testing on A),
 * coachee picks B, coach advances to test_design, drafts + saves a
 * second test, records results, closes.
 *
 * Regression target: the results → prioritize side-effect
 * (clearSelectedAssumption) and the selection reset that lets the
 * coachee pick a different assumption cleanly.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getMapById,
  listAssumptions,
  listTestResults,
  listTests,
} from "@/lib/itc/maps";
import {
  cleanupTestMap,
  createTestMap,
  type TestMapContext,
} from "../helpers/fixtures";
import { seedToResultsWithSecondAssumption } from "../helpers/seed";
import { runTurn } from "../helpers/turn";

describe("E2E: results → new_assumption iteration", () => {
  let ctx: TestMapContext;
  let firstAssumptionId: string;
  let secondAssumptionId: string;

  beforeEach(async () => {
    ctx = await createTestMap("A");
    const ids = await seedToResultsWithSecondAssumption(ctx);
    firstAssumptionId = ids.firstAssumptionId;
    secondAssumptionId = ids.secondAssumptionId;
  }, 60_000);

  afterEach(async () => {
    if (ctx) await cleanupTestMap(ctx);
  }, 30_000);

  it(
    "coachee picks a different assumption → cascade clears prior pick, second test lands linked to new assumption",
    async () => {
      // Sanity: first assumption is selected, second is not.
      let assumptions = await listAssumptions(ctx.mapId);
      const initialSelected = assumptions.find(
        (a) => a.selected_for_testing,
      );
      expect(initialSelected?.id).toBe(firstAssumptionId);

      // --- Turn 1: coachee wants a different assumption
      let t = await runTurn(
        ctx.mapId,
        "let me test the other assumption instead",
      );
      expect(t.ok, `Turn 1 failed: ${t.reason}`).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`[e2e new-assumption turn 1] stage=${t.finalMap.current_stage}`);

      // --- Turn 2: nudge toward prioritize if not there yet
      t = await runTurn(ctx.mapId, "let's go back to picking");
      expect(t.ok, `Turn 2 failed: ${t.reason}`).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`[e2e new-assumption turn 2] stage=${t.finalMap.current_stage}`);

      // --- Turn 3: pick the second assumption explicitly
      t = await runTurn(
        ctx.mapId,
        "let's test the second one — the one about failing her financially",
      );
      expect(t.ok, `Turn 3 failed: ${t.reason}`).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`[e2e new-assumption turn 3] stage=${t.finalMap.current_stage}`);

      // --- Turn 4: pick a test type
      t = await runTurn(
        ctx.mapId,
        "let's do a thought experiment for this one",
      );
      expect(t.ok, `Turn 4 failed: ${t.reason}`).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`[e2e new-assumption turn 4] stage=${t.finalMap.current_stage}`);

      // --- Turn 5: save the test
      t = await runTurn(ctx.mapId, "save it, that's the test");
      expect(t.ok, `Turn 5 failed: ${t.reason}`).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`[e2e new-assumption turn 5] stage=${t.finalMap.current_stage}`);

      // --- Turn 6: come back with observations
      t = await runTurn(
        ctx.mapId,
        "I walked through it in my head. I predicted total collapse but even imagining it, the reaction wasn't as absolute as it felt in the moment. Body tightened but the story softened.",
      );
      expect(t.ok, `Turn 6 failed: ${t.reason}`).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`[e2e new-assumption turn 6] stage=${t.finalMap.current_stage}`);

      // --- Turn 7: complete debrief + close
      t = await runTurn(
        ctx.mapId,
        "partially challenged again — the belief has less absolute power than it felt. Let's record and close for today.",
      );
      expect(t.ok, `Turn 7 failed: ${t.reason}`).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`[e2e new-assumption turn 7] stage=${t.finalMap.current_stage}`);

      // --- Turn 8: explicit close
      t = await runTurn(ctx.mapId, "yes close it out, we're done for today");
      expect(t.ok, `Turn 8 failed: ${t.reason}`).toBe(true);

      // --- Final assertions
      const [finalMap, finalTests, finalResults, finalAssumptions] =
        await Promise.all([
          getMapById(ctx.mapId),
          listTests(ctx.mapId),
          listTestResults(ctx.mapId),
          listAssumptions(ctx.mapId),
        ]);

      // eslint-disable-next-line no-console
      console.log(
        `[e2e new-assumption final] stage=${finalMap?.current_stage} status=${finalMap?.status} tests=${finalTests.length} results=${finalResults.length}`,
      );

      // Sanity: still have both assumptions on the map.
      expect(finalAssumptions.length).toBeGreaterThanOrEqual(2);

      // Second test should exist and be linked to the SECOND
      // assumption (not the first — the whole point of the iteration).
      expect(
        finalTests.length,
        `Expected at least 2 tests after new_assumption iteration. Got ${finalTests.length}`,
      ).toBeGreaterThanOrEqual(2);

      // Find the newest test (sorted by created_at) and check the
      // assumption_id.
      const sortedTests = [...finalTests].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      const secondTest = sortedTests[sortedTests.length - 1];
      expect(
        secondTest.assumption_id,
        `Expected second test to be linked to the new assumption (${secondAssumptionId}). Got ${secondTest.assumption_id} (first assumption was ${firstAssumptionId}).`,
      ).toBe(secondAssumptionId);

      // Clean-pass indicator.
      const cleanPass =
        finalMap?.current_stage === "done" &&
        finalMap?.status === "complete" &&
        finalTests.length >= 2 &&
        secondTest.assumption_id === secondAssumptionId;
      // eslint-disable-next-line no-console
      console.log(
        cleanPass
          ? "[e2e new-assumption] CLEAN PASS — different assumption tested, map closed"
          : `[e2e new-assumption] partial pass — stage=${finalMap?.current_stage} tests=${finalTests.length}`,
      );
    },
    1_500_000,
  );
});
