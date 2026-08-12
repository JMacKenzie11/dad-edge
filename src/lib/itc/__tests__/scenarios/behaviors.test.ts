import { describe, expect, it } from "vitest";
import { callCoach } from "../helpers/call-coach";
import { judgeNoDanglingPromises, judgeNoUnearnedPraise } from "../helpers/judge";
import { behaviorInnerState } from "../fixtures/behavior-inner-state";
import { behaviorConsolidation } from "../fixtures/behavior-consolidation";

describe("behaviors stage", () => {
  it(
    "inner-state offering — coach converts to a behavior instead of accepting it",
    async () => {
      const reply = await callCoach(behaviorInnerState);

      // eslint-disable-next-line no-console
      console.log("\n[coach reply]\n" + reply.reply + "\n");
      if (reply.action) {
        // eslint-disable-next-line no-console
        console.log("[coach action]\n" + JSON.stringify(reply.action, null, 2) + "\n");
      }

      // Coach must NOT accept an inner state as a behavior. If it fires
      // propose_behavior, the text should not be the pure inner state.
      if (reply.action?.type === "propose_behavior") {
        const t = reply.action.text.toLowerCase();
        const isInnerState =
          /^i (feel|felt) (anxious|nervous|scared|angry|afraid|frustrated)/.test(t) ||
          /^i (feel|felt) [a-z]+$/.test(t);
        expect(
          isInnerState,
          `Coach accepted an inner state as a behavior: "${reply.action.text}"`,
        ).toBe(false);
      }

      // Reply must ask a converting question — should reference the
      // inner state and ask what he DOES / DOESN'T do. Accept several
      // phrasings — the important thing is that the coach asks about
      // observable action, not just about the felt state.
      const asksForBehavior =
        /what do you (actually |actually)?(do|not do)|what happens|what's the (actual|specific)|what does (that|it) (actually )?look like|do you (go silent|leave|check|say|shut|go quiet|stop|start)/i.test(
          reply.reply,
        );
      expect(
        asksForBehavior,
        `Reply should ask a converting question. Actual:\n${reply.reply}`,
      ).toBe(true);

      const praise = await judgeNoUnearnedPraise(reply.reply);
      expect(praise.passes, `Judge failed no-praise: ${praise.reason}`).toBe(true);
    },
    120_000,
  );

  it(
    "consolidation — new candidate overlaps existing; coach names overlap, does not create duplicate",
    async () => {
      const reply = await callCoach(behaviorConsolidation);

      // eslint-disable-next-line no-console
      console.log("\n[coach reply]\n" + reply.reply + "\n");
      if (reply.action) {
        // eslint-disable-next-line no-console
        console.log("[coach action]\n" + JSON.stringify(reply.action, null, 2) + "\n");
      }

      // Coach must NOT propose the candidate as a NEW behavior (would
      // be a duplicate of the shutdown/silent behavior already at #2).
      // Acceptable actions: replace_behavior (if new phrasing sharper),
      // no action (leaves existing), or advance_stage (if the coachee's
      // message read as "I'm done, let's move on").
      if (reply.action?.type === "propose_behavior") {
        throw new Error(
          `Coach created a duplicate behavior instead of consolidating. ` +
            `Proposed: "${reply.action.text}"`,
        );
      }

      // Reply must acknowledge the overlap in some form (mentions the
      // existing behavior number, uses "same/similar/version of").
      const namesOverlap =
        /#?2|same (move|thing|shape)|similar to|another version of|already on the map|overlap|goes silent/i.test(
          reply.reply,
        );
      expect(
        namesOverlap,
        `Reply should name the overlap with #2. Actual:\n${reply.reply}`,
      ).toBe(true);

      const promises = await judgeNoDanglingPromises(reply.reply);
      expect(promises.passes, `Judge failed no-promises: ${promises.reason}`).toBe(true);
    },
    120_000,
  );
});
