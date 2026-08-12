import { describe, expect, it } from "vitest";
import { callCoach } from "../helpers/call-coach";
import {
  judgeNoDanglingPromises,
  judgeNoUnearnedPraise,
} from "../helpers/judge";
import { commitmentsLastWorryTransition } from "../fixtures/commitments-last-worry-transition";
import { commitmentsBatchAffirm } from "../fixtures/commitments-batch-affirm";

describe("commitments stage", () => {
  it(
    "last worry — reply ships commitments intro + drafted list of commitments (no dangling promise)",
    async () => {
      const reply = await callCoach(commitmentsLastWorryTransition);

      // eslint-disable-next-line no-console
      console.log("\n[coach reply]\n" + reply.reply + "\n");
      if (reply.action) {
        // eslint-disable-next-line no-console
        console.log("[coach action]\n" + JSON.stringify(reply.action, null, 2) + "\n");
      }

      // Coach must fire propose_worry for behavior #4 (the unlocked one).
      expect(
        reply.action?.type,
        `Expected propose_worry for behavior #4. Got: ${reply.action?.type ?? "null"}`,
      ).toBe("propose_worry");

      // Reply must contain the numbered commitment drafts. Count
      // "I'm also committed to" occurrences — should be 4 (one per
      // locked worry INCLUDING the one being proposed this turn).
      const drafts = reply.reply.match(/I['\u2019]?m also committed to/gi) ?? [];
      expect(
        drafts.length,
        `Expected 4 "I'm also committed to..." drafts in the reply. Got ${drafts.length}.\n\nReply:\n${reply.reply}`,
      ).toBeGreaterThanOrEqual(4);

      // No dangling promises — this is the exact spot where the coach
      // used to say "I'll draft one for each" without drafting.
      const promises = await judgeNoDanglingPromises(reply.reply);
      expect(
        promises.passes,
        `Judge failed no-dangling-promises: ${promises.reason}\n\nReply:\n${reply.reply}`,
      ).toBe(true);
    },
    180_000,
  );

  it(
    "coachee affirms drafts — coach fires propose_commitments_batch with 4 items",
    async () => {
      const reply = await callCoach(commitmentsBatchAffirm);

      // eslint-disable-next-line no-console
      console.log("\n[coach reply]\n" + reply.reply + "\n");
      if (reply.action) {
        // eslint-disable-next-line no-console
        console.log("[coach action]\n" + JSON.stringify(reply.action, null, 2) + "\n");
      }

      expect(
        reply.action?.type,
        `Expected propose_commitments_batch. Got: ${reply.action?.type ?? "null"}`,
      ).toBe("propose_commitments_batch");

      if (reply.action?.type === "propose_commitments_batch") {
        expect(
          reply.action.items.length,
          `Batch should have 4 items (one per locked worry). Got ${reply.action.items.length}.`,
        ).toBe(4);
        // Every item must use "I'm also committed to" stem.
        for (const item of reply.action.items) {
          expect(
            /^I['\u2019]?m also committed to/i.test(item.text),
            `Batch item missing "I'm also committed to" stem: "${item.text}"`,
          ).toBe(true);
        }
      }

      const praise = await judgeNoUnearnedPraise(reply.reply);
      expect(praise.passes, `Judge failed no-praise: ${praise.reason}`).toBe(true);
    },
    180_000,
  );
});
