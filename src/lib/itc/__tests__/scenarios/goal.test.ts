import { describe, expect, it } from "vitest";
import { callCoach } from "../helpers/call-coach";
import {
  judgeNoDanglingPromises,
  judgeNoUnearnedPraise,
} from "../helpers/judge";
import { goalAffirmLock } from "../fixtures/goal-affirm-lock";

describe("goal stage", () => {
  it(
    "on coachee affirmation, advances to behaviors AND the reply opens Column 2",
    async () => {
      const reply = await callCoach(goalAffirmLock);

      // eslint-disable-next-line no-console
      console.log("\n[coach reply]\n" + reply.reply + "\n");
      if (reply.action) {
        // eslint-disable-next-line no-console
        console.log("[coach action]\n" + JSON.stringify(reply.action, null, 2) + "\n");
      }

      // The core regression: coach must fire advance_stage → behaviors
      // on the lock turn. Not doing so leaves the coachee stuck on goal
      // even though the goal is affirmed.
      expect(
        reply.action?.type,
        `Expected advance_stage on lock turn. Got: ${reply.action?.type ?? "null"}`,
      ).toBe("advance_stage");
      if (reply.action?.type === "advance_stage") {
        expect(reply.action.to).toBe("behaviors");
      }

      // Reply must open Column 2 — mention behaviors / doing / not-doing
      // and ask for the first one. If it just says "Locked." with nothing
      // else, coachee lands on the behaviors stage staring at a bare
      // acknowledgment.
      const opensColumn2 =
        /(column 2|doing|behavior|not[- ]doing)/i.test(reply.reply);
      expect(
        opensColumn2,
        `Reply should introduce Column 2. Actual:\n${reply.reply}`,
      ).toBe(true);

      // No unearned praise ("brave," "vulnerable," etc.).
      const ctx = { actionType: reply.action?.type ?? null };
      const praise = await judgeNoUnearnedPraise(reply.reply, ctx);
      expect(
        praise.passes,
        `Judge failed no-unearned-praise: ${praise.reason}\n\nReply:\n${reply.reply}`,
      ).toBe(true);

      // No dangling promises — "let me now walk you through" without
      // walking through, etc.
      const promises = await judgeNoDanglingPromises(reply.reply, ctx);
      expect(
        promises.passes,
        `Judge failed no-dangling-promises: ${promises.reason}\n\nReply:\n${reply.reply}`,
      ).toBe(true);
    },
    180_000,
  );
});
