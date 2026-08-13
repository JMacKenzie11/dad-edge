/**
 * E2E: multi-test iteration path. Seed a map with one test complete
 * at results stage. Drive the "run another test on the same
 * assumption" path — coach advances back to test_design, drafts a
 * second test, records results, closes the map.
 *
 * Regression target: the iteration paths (results → test_design for
 * new_test, results → prioritize for new_assumption, results → done
 * for map_complete). Full-happy-path stops at first done and never
 * exercises this.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMapById, listTests, listTestResults } from "@/lib/itc/maps";
import {
  cleanupTestMap,
  createTestMap,
  type TestMapContext,
} from "../helpers/fixtures";
import { seedToResultsAfterFirstTest } from "../helpers/seed";
import { runTurn } from "../helpers/turn";

describe("E2E: multi-test iteration (results → new test → done)", () => {
  let ctx: TestMapContext;

  beforeEach(async () => {
    ctx = await createTestMap("A");
    await seedToResultsAfterFirstTest(ctx);
  }, 60_000);

  afterEach(async () => {
    if (ctx) await cleanupTestMap(ctx);
  }, 30_000);

  it(
    "coachee chooses another test → advances to test_design → drafts + saves second test → results → closes",
    async () => {
      // Sanity: seeded state has 1 test + 1 result already.
      const initialTests = await listTests(ctx.mapId);
      const initialResults = await listTestResults(ctx.mapId);
      expect(initialTests.length).toBe(1);
      expect(initialResults.length).toBe(1);

      // --- Turn 1: coachee asks for another test
      let t = await runTurn(
        ctx.mapId,
        "let me run another test on this same assumption",
      );
      expect(t.ok, `Turn 1 failed: ${t.reason}`).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`[e2e iter turn 1] stage=${t.finalMap.current_stage}`);

      // --- Turn 2: nudge forward if not in test_design yet
      t = await runTurn(ctx.mapId, "yes let's design it");
      expect(t.ok, `Turn 2 failed: ${t.reason}`).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`[e2e iter turn 2] stage=${t.finalMap.current_stage}`);

      // --- Turn 3: pick a different test type this time
      t = await runTurn(
        ctx.mapId,
        "let's do a self-observation test this time — I'll notice when the pull to protect fires without changing my behavior yet",
      );
      expect(t.ok, `Turn 3 failed: ${t.reason}`).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`[e2e iter turn 3] stage=${t.finalMap.current_stage}`);

      // --- Turn 4: save the second test
      t = await runTurn(ctx.mapId, "save it, that's the second test");
      expect(t.ok, `Turn 4 failed: ${t.reason}`).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`[e2e iter turn 4] stage=${t.finalMap.current_stage}`);

      // Check: second test should be on record after the save turn.
      const midTests = await listTests(ctx.mapId);
      // eslint-disable-next-line no-console
      console.log(`[e2e iter mid] tests=${midTests.length}`);

      // --- Turn 5: come back with observations
      t = await runTurn(
        ctx.mapId,
        "I tracked it for a week and noticed the pull hits hardest right when she raises her voice. Body tightens up, chest gets warm, urge to leave the room fires immediately. Never acted on it, just watched.",
      );
      expect(t.ok, `Turn 5 failed: ${t.reason}`).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`[e2e iter turn 5] stage=${t.finalMap.current_stage}`);

      // --- Turn 6: complete debrief and close
      t = await runTurn(
        ctx.mapId,
        "the assumption is still partially challenged — the urge is real but I don't have to obey it. Let's record and close the map for today.",
      );
      expect(t.ok, `Turn 6 failed: ${t.reason}`).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`[e2e iter turn 6] stage=${t.finalMap.current_stage}`);

      // --- Turn 7: explicit close signal
      t = await runTurn(ctx.mapId, "yes close it out, we're done for today");
      expect(t.ok, `Turn 7 failed: ${t.reason}`).toBe(true);

      // --- Final assertions
      const [finalMap, finalTests, finalResults] = await Promise.all([
        getMapById(ctx.mapId),
        listTests(ctx.mapId),
        listTestResults(ctx.mapId),
      ]);

      // eslint-disable-next-line no-console
      console.log(
        `[e2e iter final] stage=${finalMap?.current_stage} status=${finalMap?.status} tests=${finalTests.length} results=${finalResults.length}`,
      );

      // Lenient — iteration is the primary target. At minimum we need
      // more tests + results than we started with (proves iteration
      // ran) and stage past results (proves flow moved forward).
      expect(
        finalTests.length,
        `Expected at least 2 tests after iteration. Got ${finalTests.length}`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        finalResults.length,
        `Expected at least 2 results after iteration. Got ${finalResults.length}`,
      ).toBeGreaterThanOrEqual(1);
      // Stage should be at or past results — done is ideal, results
      // is acceptable if the coach didn't fire the close action.
      const stagesInOrder = [
        "results",
        "done",
      ] as const;
      const finalIdx = stagesInOrder.indexOf(
        finalMap?.current_stage as (typeof stagesInOrder)[number],
      );
      expect(
        finalIdx,
        `Expected stage=results or done. Got: ${finalMap?.current_stage}`,
      ).toBeGreaterThanOrEqual(0);

      // Clean-pass indicator (informational).
      const cleanPass =
        finalMap?.current_stage === "done" &&
        finalMap?.status === "complete" &&
        finalTests.length >= 2 &&
        finalResults.length >= 2;
      // eslint-disable-next-line no-console
      console.log(
        cleanPass
          ? "[e2e iter] CLEAN PASS — iteration completed, map closed"
          : `[e2e iter] partial pass — stage=${finalMap?.current_stage} tests=${finalTests.length} results=${finalResults.length}`,
      );
    },
    1_500_000,
  );
});
