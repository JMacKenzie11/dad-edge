import { describe, expect, it } from "vitest";
import { callCoach } from "../helpers/call-coach";
import {
  judgeNoDanglingPromises,
  judgeNoIdentityProjection,
  judgeNoUnearnedPraise,
} from "../helpers/judge";
import { worryRoleIdentityPushback } from "../fixtures/worry-role-identity-pushback";

describe("worries stage", () => {
  it(
    "coachee pushback — coach owns leading question and asks shape-neutral (does not re-push self-labeling)",
    async () => {
      const reply = await callCoach(worryRoleIdentityPushback);

      // Log the actual reply so failures show exactly what the coach said,
      // not just which assertion failed. Cheap and pays off every time.
      // eslint-disable-next-line no-console
      console.log("\n[coach reply]\n" + reply.reply + "\n");
      if (reply.action) {
        // eslint-disable-next-line no-console
        console.log("[coach action]\n" + JSON.stringify(reply.action, null, 2) + "\n");
      }

      // Structural: coach may legitimately fire propose_worry on this
      // turn IF it uses role-identity framing drawn from the coachee's
      // own words (that's actually ideal ITC behavior). What's banned
      // is firing propose_worry with self-labeling wording ("not
      // enough", "unworthy", "weak") that the coachee just disowned.
      if (reply.action?.type === "propose_worry") {
        const worryText = reply.action.text.toLowerCase();
        const usesSelfLabeling =
          /\bnot enough\b|\bunworthy\b|\bweak\b|\bworthless\b/.test(worryText);
        expect(
          usesSelfLabeling,
          `propose_worry fired with self-labeling wording after coachee disowned that frame: "${reply.action.text}"`,
        ).toBe(false);
      }
      // advance_stage is fine either way — a coach that locks worry #1
      // in this turn (via propose_worry with role-identity framing)
      // shouldn't ALSO advance the whole stage; there are more worries
      // pending.
      expect(reply.action?.type).not.toBe("advance_stage");

      // Content: reply must acknowledge the pushback and shift stance.
      // Cheap regex check — "you're right", "fair", "own", "leading"
      // are all reasonable acknowledgment openers.
      const acknowledgesPushback =
        /you're right|fair (question|point|push)|own that|own it|leading question|good (push|catch)|point taken/i.test(
          reply.reply,
        );
      expect(
        acknowledgesPushback,
        `Expected coach to acknowledge the pushback. Actual reply:\n${reply.reply}`,
      ).toBe(true);

      // Semantic: judge that the reply does NOT project self-labeling.
      // This is the specific regression we're guarding against.
      const identity = await judgeNoIdentityProjection(reply.reply);
      expect(
        identity.passes,
        `Judge failed no-identity-projection: ${identity.reason}\n\nReply:\n${reply.reply}`,
      ).toBe(true);

      // Semantic: reply must not praise the pushback (would land as
      // condescending in this moment).
      const praise = await judgeNoUnearnedPraise(reply.reply);
      expect(
        praise.passes,
        `Judge failed no-unearned-praise: ${praise.reason}\n\nReply:\n${reply.reply}`,
      ).toBe(true);

      // Semantic: no dangling promises ("I'll ask better next time" is
      // a common failure mode when the coach is caught in a leading Q).
      const promises = await judgeNoDanglingPromises(reply.reply);
      expect(
        promises.passes,
        `Judge failed no-dangling-promises: ${promises.reason}\n\nReply:\n${reply.reply}`,
      ).toBe(true);
    },
    120_000, // per-test timeout: real API + judge calls
  );
});
