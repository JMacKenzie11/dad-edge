import { describe, expect, it } from "vitest";
import { callCoach } from "../helpers/call-coach";
import { judgeNoUnearnedPraise } from "../helpers/judge";
import { resultsNonBinary } from "../fixtures/results-non-binary";

describe("results stage", () => {
  it(
    "coachee jumps to 'assumption confirmed' — coach probes past the binary, does not fire record_test_results yet",
    async () => {
      const reply = await callCoach(resultsNonBinary);

      // eslint-disable-next-line no-console
      console.log("\n[coach reply]\n" + reply.reply + "\n");
      if (reply.action) {
        // eslint-disable-next-line no-console
        console.log("[coach action]\n" + JSON.stringify(reply.action, null, 2) + "\n");
      }

      // Coach must NOT accept the "confirmed" verdict and fire
      // record_test_results — needs to unpack what actually happened.
      expect(
        reply.action?.type,
        `Coach accepted pass/fail framing and shipped results. Fired: ${reply.action?.type}`,
      ).not.toBe("record_test_results");

      // Reply should probe past pass/fail — ask about the gap between
      // prediction and reality, what surprised him, what was the felt
      // vs predicted intensity.
      const probesPastBinary =
        /(what|and then).*happened|what surprised|predicted.*(vs|and)|felt like|the (gap|difference)|specifically|exactly|the collapse|what did it (feel|look)|how did/i.test(
          reply.reply,
        );
      expect(
        probesPastBinary,
        `Reply should push past pass/fail framing. Actual:\n${reply.reply}`,
      ).toBe(true);

      // Reply should NOT reinforce the binary — no "right/wrong/
      // confirmed/disconfirmed/passed/failed" language on its own
      // side (coachee said "confirmed"; coach shouldn't echo).
      const echoesBinary =
        /^([^]*?\b(confirmed|disconfirmed|proved right|proved wrong|passed|failed the test)[^]*)?$/i.test(
          reply.reply,
        ) &&
        /\b(so it was confirmed|assumption is confirmed|that confirms|that proves)\b/i.test(
          reply.reply,
        );
      expect(
        echoesBinary,
        `Reply reinforces the binary framing. Actual:\n${reply.reply}`,
      ).toBe(false);

      const praise = await judgeNoUnearnedPraise(reply.reply);
      expect(praise.passes, `Judge failed no-praise: ${praise.reason}`).toBe(true);
    },
    120_000,
  );
});
