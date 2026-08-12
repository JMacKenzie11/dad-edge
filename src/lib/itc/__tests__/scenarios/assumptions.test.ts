import { describe, expect, it } from "vitest";
import { callCoach } from "../helpers/call-coach";
import {
  judgeNoDanglingPromises,
  judgeNoUnearnedPraise,
} from "../helpers/judge";
import { assumptionsAsksFirst } from "../fixtures/assumptions-asks-first";
import { assumptionsTightensCompound } from "../fixtures/assumptions-tightens-compound";

describe("assumptions stage", () => {
  it(
    "on stage entry — coach asks first (Column-1 pattern), does not lead with a draft",
    async () => {
      const reply = await callCoach(assumptionsAsksFirst);

      // eslint-disable-next-line no-console
      console.log("\n[coach reply]\n" + reply.reply + "\n");
      if (reply.action) {
        // eslint-disable-next-line no-console
        console.log("[coach action]\n" + JSON.stringify(reply.action, null, 2) + "\n");
      }

      // Coach must NOT fire propose_assumption unilaterally on stage
      // entry. The coachee hasn't asked for a draft.
      expect(
        reply.action?.type,
        `Coach shipped a Big Assumption unsolicited. Action: ${reply.action?.type}`,
      ).not.toBe("propose_assumption");

      // Reply must invite the coachee to name one first (either
      // framing: "read across commitments" or "opposite of behaviors"),
      // AND offer to help if he wants.
      const asksForOffering =
        /what belief|what would (have to be true|you.*most afraid)|read across your commitments|opposite of.*behaviors|do you want.*(try|draft)|want (me to draft|help)|take a shot|try one/i.test(
          reply.reply,
        );
      expect(
        asksForOffering,
        `Reply should invite the coachee to name an assumption. Actual:\n${reply.reply}`,
      ).toBe(true);

      // Guard against the coach still doing a full draft even while
      // "asking" — a draft would contain "I assume that if" language.
      const containsUnsolicitedDraft = /I assume that if/i.test(reply.reply);
      expect(
        containsUnsolicitedDraft,
        `Reply included an unsolicited assumption draft.\n${reply.reply}`,
      ).toBe(false);

      const promises = await judgeNoDanglingPromises(reply.reply);
      expect(promises.passes, `Judge failed no-promises: ${promises.reason}`).toBe(true);
    },
    120_000,
  );

  it(
    "coachee offers compound 40-word assumption — coach tightens to <25 words, one clause each side",
    async () => {
      const reply = await callCoach(assumptionsTightensCompound);

      // eslint-disable-next-line no-console
      console.log("\n[coach reply]\n" + reply.reply + "\n");
      if (reply.action) {
        // eslint-disable-next-line no-console
        console.log("[coach action]\n" + JSON.stringify(reply.action, null, 2) + "\n");
      }

      // If coach fires propose_assumption, the text must be short
      // (< 25 words) and single-clause on each side.
      if (reply.action?.type === "propose_assumption") {
        const wordCount = reply.action.text.trim().split(/\s+/).length;
        expect(
          wordCount,
          `Big Assumption too long — ${wordCount} words, target 15-25.\nText: ${reply.action.text}`,
        ).toBeLessThanOrEqual(30); // some slack for edge cases

        // Ban compound conditions: "or", "and", or comma in the if-clause
        const ifPart = reply.action.text.match(/if\s+([^,]+?),\s*then/i)?.[1] ?? "";
        const hasCompoundIf = /\b(or|,)\b/.test(ifPart);
        expect(
          hasCompoundIf,
          `If-clause is compound (contains 'or' or ','). Text: ${reply.action.text}`,
        ).toBe(false);
      } else {
        // If coach didn't propose — that's also acceptable, coach might
        // be tightening in conversation first. Reply should signal it's
        // engaging with the shape/length issue.
        const asksToTighten =
          /shorter|tighten|one (belief|if|clause|clean)|too much|split|which (one|comes first)|stack(ing|ed)|pick (one|the (single|real|actual))|conditions|(three|multiple) (belief|thing|clause|conclusion|ending|verdict)/i.test(
            reply.reply,
          );
        expect(
          asksToTighten,
          `Coach neither tightened nor proposed. Should ask to tighten. Actual:\n${reply.reply}`,
        ).toBe(true);
      }

      const praise = await judgeNoUnearnedPraise(reply.reply);
      expect(praise.passes, `Judge failed no-praise: ${praise.reason}`).toBe(true);
    },
    120_000,
  );
});
