/**
 * The Big Assumption must not be the worry wearing a different stem.
 *
 * The live case (2026-09-02) is the first test below: the two
 * sentences share every content word and differ only in their
 * opening. See checkAssumptionRestatesWorry for why the design
 * produced it and where the real fix is (the "if" anchors on the
 * commitment being broken, not the behavior being reversed).
 */
import { describe, expect, it } from "vitest";
import { checkAssumptionRestatesWorry } from "../assumptions";

const WORRY =
  "I worry that if I said the price and waited, they'd see I'm not worth what I'm charging.";

describe("checkAssumptionRestatesWorry", () => {
  it("catches the assumption the coach actually offered", () => {
    const v = checkAssumptionRestatesWorry({
      assumptionText:
        "I assume that if I say the price and wait, then they'd see I'm not worth it and I'd be the consultant who's been charging more than he's worth.",
      worryText: WORRY,
    });
    expect(v.restates).toBe(true);
    expect(v.coverage).toBeGreaterThanOrEqual(0.8);
    // The feedback has to say where to put the "if", not just "no".
    expect(v.reason).toMatch(/COMMITMENT BEING BROKEN/);
  });

  it("passes an assumption anchored on the commitment instead", () => {
    // The shape the guides use: the "if" is the vow being let go of.
    const v = checkAssumptionRestatesWorry({
      assumptionText:
        "I assume that if I let a client think of me as expensive, the work dries up and I end up unable to provide.",
      worryText: WORRY,
    });
    expect(v.restates).toBe(false);
  });

  it("allows sharing the map's nouns, which every entry does", () => {
    // Both entries are about the same part of his life, so overlap on
    // "price" and "charging" is normal. Only near-total reproduction
    // counts.
    const v = checkAssumptionRestatesWorry({
      assumptionText:
        "I assume that charging a premium price means I owe every client a perfect outcome.",
      worryText: WORRY,
    });
    expect(v.restates).toBe(false);
  });

  it("sees through tense and inflection, which is how it hid", () => {
    // "said"/"say", "waited"/"wait", "charging"/"charge". Compared as
    // raw strings these look different; they are the same sentence.
    const v = checkAssumptionRestatesWorry({
      assumptionText:
        "I assume that if I say the price and wait, they will see I am not worth what I charge.",
      worryText: WORRY,
    });
    expect(v.restates).toBe(true);
  });

  it("skips a worry too short to compare", () => {
    expect(
      checkAssumptionRestatesWorry({
        assumptionText: "I assume that if I speak up, I lose them.",
        worryText: "I worry that they'd leave.",
      }).restates,
    ).toBe(false);
  });

  it("uses the guides' own pair as a passing case", () => {
    // Jackson: the worry is about being seen as a bragger; the
    // assumption anchors on the vow (not becoming Kurt).
    const v = checkAssumptionRestatesWorry({
      assumptionText:
        "I assume that if I am bragging, I am just like Kurt, selfish and arrogant.",
      worryText:
        "I worry that if I publicized my successes, they'd see I am a jerk, selfish and opportunistic.",
    });
    expect(v.restates).toBe(false);
  });
});
