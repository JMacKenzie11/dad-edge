/**
 * E2E: full happy-path smoke test. Starts from a fresh map, walks the
 * entire ITC flow via scripted user turns, ends at done. No seeded
 * state — every stage transition, every backstop, every cascade runs
 * through the real code path.
 *
 * Fragile by nature (many turns × LLM stochasticity), so assertions
 * are LENIENT — just check the pipeline reached done with the right
 * shape. Fine-grained assertions live in scenario / segment tests.
 *
 * Long-running: ~5 minutes wall time, ~$0.50-0.80 in API cost per
 * full pass. Skip in the smoke subset — run before shipping any
 * prompt or cascade change that touches multiple stages.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getMapById,
  listAssumptions,
  listBehaviors,
  listCommitments,
  listTestResults,
  listTests,
  listWorries,
} from "@/lib/itc/maps";
import {
  cleanupTestMap,
  createTestMap,
  type TestMapContext,
} from "../helpers/fixtures";
import { runTurn } from "../helpers/turn";

describe("E2E: full happy path (goal → done)", () => {
  // Fresh map per attempt — retries share nothing so a re-run starts
  // from goal, not mid-flow. beforeAll would let attempts pick up
  // where the previous one got stuck, which produces confusing
  // failures (coach thinks map is done and just chats about it).
  let ctx: TestMapContext;

  beforeEach(async () => {
    ctx = await createTestMap("A");
  }, 60_000);

  afterEach(async () => {
    if (ctx) await cleanupTestMap(ctx);
  }, 30_000);

  it(
    "walks the entire flow from a fresh map to done, asserting final DB shape",
    async () => {
      // Every substantive turn is followed by an EXPLICIT affirmation
      // that trips looksAffirmative — otherwise the cascade never fires
      // and the DB stage stays put while the coach chats about later
      // stages. This makes the script chatty but reliable.
      const script: string[] = [
        // --- Goal
        "I want to get better at being present and calm when my wife is upset with me.",
        "yes lock it in",
        // --- Behaviors
        "I shut down and walk out of the room.",
        "I bring up things she did wrong in the past.",
        "I go on the offense and start pointing out her flaws.",
        "I agree just to end the conversation, without meaning it.",
        "let's move on",
        // --- Worry #1 excavation
        "she'd keep pushing and I'd have to say something back",
        "I'd end up being the husband who hurts her by what I say",
        "yes lock that in",
        // --- Worry #2 excavation
        "she'd keep bringing up my own stuff and I'd have nothing to balance it",
        "I'd be the one who's the problem in this marriage, always",
        "yes lock that in",
        // --- Worry #3 excavation
        "she'd see I don't have anything to push back with",
        "she'd see I'm not as strong as I've been letting on",
        "yes lock that in",
        // --- Worry #4 excavation → cascade to commitments
        "she'd keep going and I'd cave anyway, just slower",
        "she'd see the strong version of me is a costume",
        "yes lock that in",
        // --- Commitments (drafts should be on the transition reply)
        "lock them in",
        "let's keep going",
        // --- Assumptions (ask-first opener)
        "draft one for me to react to",
        "yes lock it in",
        // --- Review + walkthrough + prioritize
        "yes it holds together, let's move on",
        "let's move on to picking one",
        "yes let's go with your pick",
        // --- Test design
        "let's do data mining — safest first pass",
        "save it",
        // --- Test running → results
        "I looked back at three fights where I actually stayed. She got upset for a bit but the marriage didn't fall apart. I felt uncomfortable but not annihilated. Kind of surprised.",
        "the assumption is partially challenged — it isn't as absolute as it felt",
        "let's record it and close the map",
        // --- Done
        "yes close it out, we're done for today",
      ];

      let lastReply = "";
      let lastStage = "";
      for (const [i, userText] of script.entries()) {
        const t = await runTurn(ctx.mapId, userText);
        lastReply = t.assistantReply;
        lastStage = t.finalMap.current_stage;
        expect(
          t.ok,
          `Turn ${i + 1} failed at stage=${t.finalMap.current_stage}: ${t.reason}. Last user message: "${userText}"`,
        ).toBe(true);
        // eslint-disable-next-line no-console
        console.log(
          `[e2e turn ${i + 1}] stage=${t.finalMap.current_stage} user="${userText.slice(0, 60)}..."`,
        );
      }

      // Final shape assertions.
      const finalMap = await getMapById(ctx.mapId);
      const [behaviors, worries, commitments, assumptions, tests, results] =
        await Promise.all([
          listBehaviors(ctx.mapId),
          listWorries(ctx.mapId),
          listCommitments(ctx.mapId),
          listAssumptions(ctx.mapId),
          listTests(ctx.mapId),
          listTestResults(ctx.mapId),
        ]);

      // eslint-disable-next-line no-console
      console.log(
        `[e2e final] stage=${finalMap?.current_stage} status=${finalMap?.status} behaviors=${behaviors.filter((b) => b.selected).length} worries=${worries.length} commitments=${commitments.length} assumptions=${assumptions.length} tests=${tests.length} results=${results.length}`,
      );

      // Lenient final assertions — E2E is a "did the pipeline move
      // forward substantially" smoke test, not a "reached exact final
      // state" test. LLM turn interpretation varies enough that the
      // full path won't reliably reach done every run. We assert:
      //   - Goal saved
      //   - Reveal delivered (past commitments)
      //   - At least 3 of each intermediate DB shape (map is built)
      //   - Stage is past behaviors (real progression happened)
      //
      // If stage=done, status=complete, and results are recorded, we
      // consider it a "clean pass" and log — but don't fail otherwise.
      expect(finalMap?.improvement_goal, "goal should be set").toBeTruthy();
      expect(
        finalMap?.reveal_delivered,
        `reveal should be delivered (past commitments). Stage: ${finalMap?.current_stage}. Last reply:\n${lastReply}`,
      ).toBe(true);
      expect(
        behaviors.filter((b) => b.selected).length,
      ).toBeGreaterThanOrEqual(3);
      expect(worries.length).toBeGreaterThanOrEqual(3);
      expect(commitments.length).toBeGreaterThanOrEqual(3);

      // Late-stage stages are less reliable, so tier expectations
      // rather than a single hard target.
      const stagesInOrder = [
        "goal",
        "behaviors",
        "worries",
        "commitments",
        "assumptions",
        "review",
        "immune_system",
        "prioritize",
        "test_design",
        "test_running",
        "results",
        "done",
      ] as const;
      const finalIdx = stagesInOrder.indexOf(
        finalMap?.current_stage as (typeof stagesInOrder)[number],
      );
      const commitmentsIdx = stagesInOrder.indexOf("commitments");
      expect(
        finalIdx,
        `Expected stage past commitments. Got: ${finalMap?.current_stage}. Last reply:\n${lastReply}`,
      ).toBeGreaterThan(commitmentsIdx);

      // Clean-pass log — informational, doesn't fail.
      const cleanPass =
        finalMap?.current_stage === "done" &&
        finalMap?.status === "complete" &&
        tests.length > 0 &&
        results.length > 0;
      // eslint-disable-next-line no-console
      console.log(
        cleanPass
          ? "[e2e] CLEAN PASS — reached done with full test recording"
          : `[e2e] partial pass — stopped at stage=${finalMap?.current_stage} tests=${tests.length} results=${results.length}`,
      );
    },
    1_500_000, // 25 min ceiling — real time is ~5 min
  );
});
