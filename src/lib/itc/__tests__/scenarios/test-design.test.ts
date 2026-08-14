import { describe, expect, it } from "vitest";
import { callCoach } from "../helpers/call-coach";
import { judgeNoDanglingPromises, judgeNoUnearnedPraise } from "../helpers/judge";
import { testDesignOffersTypes } from "../fixtures/test-design-offers-types";

describe("test_design stage", () => {
  it(
    "on entry — coach offers 2-3 test type options, does NOT default to in-the-moment behavioral with the wife",
    async () => {
      const reply = await callCoach(testDesignOffersTypes);

      // eslint-disable-next-line no-console
      console.log("\n[coach reply]\n" + reply.reply + "\n");
      if (reply.actions.length > 0) {
        // eslint-disable-next-line no-console
        console.log("[coach actions]\n" + JSON.stringify(reply.actions, null, 2) + "\n");
      }

      // Coach must NOT fire save_test_design on entry — the coachee
      // hasn't picked a type yet.
      expect(
        reply.actions[0]?.type,
        `Coach jumped past type-picking. Fired: ${reply.actions[0]?.type}`,
      ).not.toBe("save_test_design");

      // Reply must offer options — mention at least 2 of the 4 test
      // types by name or descriptor.
      const typesMentioned = [
        /data[- ]mining|look back/i,
        /self[- ]observation|notice|track|observe/i,
        /thought experiment|imagine|walk through/i,
        /behavioral|counter[- ]move/i,
      ].filter((re) => re.test(reply.reply)).length;

      expect(
        typesMentioned,
        `Reply should mention at least 2 test types. Only found ${typesMentioned}.\nReply:\n${reply.reply}`,
      ).toBeGreaterThanOrEqual(2);

      // Extra guard: reply MUST NOT propose only a behavioral in-the-
      // moment test with the wife when she's upset as THE first pass.
      // Checking that the reply doesn't push straight to that as the
      // sole option.
      const soleBehavioralPush =
        /^[^]*?next time (she'?s|your wife is) upset[^]*?$/i.test(
          reply.reply,
        ) && typesMentioned < 2;
      expect(
        soleBehavioralPush,
        `Reply defaulted to in-the-moment behavioral with wife as sole option.\n${reply.reply}`,
      ).toBe(false);

      // Reply should ask him to pick.
      const asksToPick =
        /which one|which of these|pick one|feels safe|start with/i.test(
          reply.reply,
        );
      expect(
        asksToPick,
        `Reply should ask coachee to pick a type. Actual:\n${reply.reply}`,
      ).toBe(true);

      const praise = await judgeNoUnearnedPraise(reply.reply);
      expect(praise.passes, `Judge failed no-praise: ${praise.reason}`).toBe(true);

      const promises = await judgeNoDanglingPromises(reply.reply);
      expect(promises.passes, `Judge failed no-promises: ${promises.reason}`).toBe(true);
    },
    180_000,
  );
});
