import { describe, expect, it } from "vitest";
import {
  coachAcknowledgedNewBehavior,
  extractAssumptionDraft,
  extractAssumptionDrafts,
  extractCoachBehaviorCount,
  extractCommitmentDrafts,
  extractCommitmentIndicesInText,
  extractWorryDraft,
  looksLikeBehaviorCandidate,
} from "../../backstop-extractors";

describe("looksLikeBehaviorCandidate", () => {
  it("matches short first-person behaviors", () => {
    expect(
      looksLikeBehaviorCandidate("I lie to get myself out of the situation"),
    ).toBe(true);
    expect(looksLikeBehaviorCandidate("I shut down and walk out of the room")).toBe(true);
    expect(looksLikeBehaviorCandidate("I don't listen when she talks")).toBe(true);
    expect(
      looksLikeBehaviorCandidate("when she gets upset I go quiet"),
    ).toBe(true);
    expect(
      looksLikeBehaviorCandidate("sometimes I bring up her past mistakes"),
    ).toBe(true);
  });

  it("rejects questions", () => {
    expect(
      looksLikeBehaviorCandidate("what should I do when she's upset?"),
    ).toBe(false);
  });

  it("rejects affirmations", () => {
    expect(looksLikeBehaviorCandidate("I agree")).toBe(false);
    expect(looksLikeBehaviorCandidate("I get it")).toBe(false);
    expect(looksLikeBehaviorCandidate("I understand")).toBe(false);
  });

  it("rejects short noise and long screeds", () => {
    expect(looksLikeBehaviorCandidate("yes")).toBe(false);
    expect(looksLikeBehaviorCandidate("ok")).toBe(false);
    expect(
      looksLikeBehaviorCandidate("I " + "x".repeat(300)),
    ).toBe(false);
  });

  it("rejects messages that don't start with a behavior stem", () => {
    expect(looksLikeBehaviorCandidate("she gets so upset over nothing")).toBe(false);
    expect(looksLikeBehaviorCandidate("yeah lock that in")).toBe(false);
  });

  it("rejects numbered lists (probably a recap, not a single behavior)", () => {
    expect(
      looksLikeBehaviorCandidate("1. I shut down\n2. I walk out"),
    ).toBe(false);
  });
});

describe("coachAcknowledgedNewBehavior", () => {
  it("matches count claims", () => {
    expect(coachAcknowledgedNewBehavior("Two on the map so far.")).toBe(true);
    expect(coachAcknowledgedNewBehavior("Three on the map now:")).toBe(true);
    expect(coachAcknowledgedNewBehavior("Four on the map.")).toBe(true);
  });

  it("matches ordinal 'that's a second/third one' claims", () => {
    expect(
      coachAcknowledgedNewBehavior("That's a second sharp one, lying your way out."),
    ).toBe(true);
    expect(
      coachAcknowledgedNewBehavior("That's a third one, and a different shape than the first two."),
    ).toBe(true);
  });

  it("matches ack phrases like 'that works as one' / 'adds another'", () => {
    expect(coachAcknowledgedNewBehavior("That works as one.")).toBe(true);
    expect(coachAcknowledgedNewBehavior("adds another sharp move")).toBe(true);
    expect(coachAcknowledgedNewBehavior("another real move")).toBe(true);
  });

  it("matches bare-count recap like 'That's three.' (real observed 2026-08-14 miss)", () => {
    // Coach's compressed recap style. Was missing from the extractor
    // and caused the 3rd behavior to disappear silently mid-session.
    expect(coachAcknowledgedNewBehavior("That's one.")).toBe(true);
    expect(coachAcknowledgedNewBehavior("That's two. Anything else?")).toBe(
      true,
    );
    expect(
      coachAcknowledgedNewBehavior(
        "That's three. Anything else you notice, or does that cover the main moves?",
      ),
    ).toBe(true);
    expect(coachAcknowledgedNewBehavior("That's four.")).toBe(true);
    expect(coachAcknowledgedNewBehavior("That\u2019s 4.")).toBe(true);
  });

  it("does NOT match generic acknowledgments without count/ordinal", () => {
    expect(coachAcknowledgedNewBehavior("Interesting — say more?")).toBe(false);
    expect(coachAcknowledgedNewBehavior("What else do you notice?")).toBe(false);
  });
});

describe("extractCoachBehaviorCount", () => {
  it("extracts word-form counts", () => {
    expect(extractCoachBehaviorCount("Two on the map so far.")).toBe(2);
    expect(extractCoachBehaviorCount("Three on the map now:")).toBe(3);
    expect(extractCoachBehaviorCount("Four on the map.")).toBe(4);
  });

  it("extracts numeric-form counts", () => {
    expect(extractCoachBehaviorCount("3 on the map.")).toBe(3);
  });

  it("extracts bare-count recap 'That's N.' (real observed 2026-08-14 miss)", () => {
    expect(extractCoachBehaviorCount("That's one.")).toBe(1);
    expect(
      extractCoachBehaviorCount(
        "That's three. Anything else you notice, or does that cover the main moves?",
      ),
    ).toBe(3);
    expect(extractCoachBehaviorCount("That's 4. One more if there's another?")).toBe(4);
    expect(extractCoachBehaviorCount("That\u2019s five.")).toBe(5);
  });

  it("returns null for missing patterns", () => {
    expect(extractCoachBehaviorCount("no count here")).toBeNull();
    expect(extractCoachBehaviorCount("")).toBeNull();
  });
});

describe("extractWorryDraft", () => {
  it("pulls a plain worry sentence from prose", () => {
    const t = "That fits. I worry that if she keeps escalating, I'll never get through to her. Behavior 2 was...";
    expect(extractWorryDraft(t)).toBe(
      "I worry that if she keeps escalating, I'll never get through to her",
    );
  });

  it("handles smart apostrophe in I'm inside body", () => {
    const t = "I worry that if I stop scripting the questions, I\u2019m the guy who let people down.";
    const extracted = extractWorryDraft(t);
    expect(extracted).toContain("I worry that");
    expect(extracted).toContain("let people down");
  });

  it("returns null when there is no worry sentence", () => {
    expect(extractWorryDraft("no fear-shaped content here")).toBeNull();
    expect(extractWorryDraft("")).toBeNull();
  });

  it("extracts a worry the coachee wrote themselves (real observed miss)", () => {
    // From the 2026-08-13 session: coach forgot to fire propose_worry
    // for worry #4 because the user wrote it directly and the coach's
    // reply just acknowledged. The backstop now scans the user's
    // message as its first extraction target.
    const userMessage =
      "I worry that if I let myself feel small or wrong in front of her, she'd lose respect for me as a man";
    const extracted = extractWorryDraft(userMessage);
    expect(extracted).toContain("I worry that");
    expect(extracted).toContain("lose respect for me as a man");
  });
});

describe("extractAssumptionDraft", () => {
  it("pulls a quoted assumption from a reveal-style reply", () => {
    const t =
      'Good. Locking that in: "I assume that if I let her fully see my faults, then I\'m not enough to be loved by her." That\'s the assumption.';
    expect(extractAssumptionDraft(t)).toBe(
      "I assume that if I let her fully see my faults, then I'm not enough to be loved by her",
    );
  });

  it("handles curly double-quotes", () => {
    const t =
      "Candidate: \u201CI assume that if I show weakness, I\u2019ll be discarded.\u201D Let me walk it...";
    expect(extractAssumptionDraft(t)).toBe(
      "I assume that if I show weakness, I\u2019ll be discarded",
    );
  });

  it("returns null when the assumption isn't quoted (avoids false-positives on prose)", () => {
    const t = "I assume that if I let go something bad will happen — but I need to walk it first.";
    expect(extractAssumptionDraft(t)).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(extractAssumptionDraft("")).toBeNull();
  });
});

describe("extractAssumptionDrafts (plural, multi-quote-style)", () => {
  it("extracts a single-quoted assumption (real 2026-08-14 miss)", () => {
    // Real coach reply from the session where cluster A landed but
    // cluster B did not — single-quotes were invisible to the old
    // double-quote-only extractor.
    const t =
      "Let's start with Cluster A. Here's the candidate: 'I assume that if I let her see me as flawed, then I'm not a man worth respecting.' Walking it against those two:";
    const drafts = extractAssumptionDrafts(t);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toBe(
      "I assume that if I let her see me as flawed, then I'm not a man worth respecting",
    );
  });

  it("extracts multiple assumptions from a single-message recap", () => {
    const t = `Here's how it hangs together:
1. 'I assume that if I admit I'm wrong, then I'm fundamentally not good enough.'
2. 'I assume that if I let her see me as flawed, then I'm not a man worth respecting.'`;
    const drafts = extractAssumptionDrafts(t);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toContain("not good enough");
    expect(drafts[1]).toContain("not a man worth respecting");
  });

  it("extracts an unquoted assumption sentence", () => {
    const t =
      "Landing this in: I assume that if I stay in the room when she's upset, I'll say something I can't take back. That's the belief.";
    const drafts = extractAssumptionDrafts(t);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toContain("stay in the room when she's upset");
  });

  it("dedupes when the same assumption appears twice in one message", () => {
    const t = `First: 'I assume that if X, then Y.'
Refined: 'I assume that if X, then Y.'`;
    const drafts = extractAssumptionDrafts(t);
    expect(drafts).toHaveLength(1);
  });

  it("returns empty array when no assumption sentences present", () => {
    expect(extractAssumptionDrafts("no assumption here")).toEqual([]);
    expect(extractAssumptionDrafts("")).toEqual([]);
  });
});

describe("extractCommitmentIndicesInText", () => {
  it("extracts explicit Commitment #N references in order", () => {
    const t =
      "Walking it: - Commitment #1 (keeping her mistakes available) - Commitment #4 (controlling how she sees you). Does that hold?";
    expect(extractCommitmentIndicesInText(t)).toEqual([1, 4]);
  });

  it("dedupes repeated references", () => {
    expect(
      extractCommitmentIndicesInText("Commitment #2 and again Commitment #2"),
    ).toEqual([2]);
  });

  it("returns empty when no references present", () => {
    expect(extractCommitmentIndicesInText("no numbers here")).toEqual([]);
    expect(extractCommitmentIndicesInText("")).toEqual([]);
  });

  it("ignores unreasonable numbers", () => {
    expect(extractCommitmentIndicesInText("Commitment #99")).toEqual([]);
  });
});

describe("extractCommitmentDrafts", () => {
  it("pulls numbered commitment drafts", () => {
    const t = `Here they are:
1. I'm also committed to keeping her past mistakes on the table
2. I'm also committed to hiding when I'm wrong
3. I'm also committed to removing myself the moment anger rises

Reword any that don't fit.`;
    const drafts = extractCommitmentDrafts(t);
    expect(drafts).toHaveLength(3);
    expect(drafts[0]).toBe("I'm also committed to keeping her past mistakes on the table");
    expect(drafts[2]).toBe("I'm also committed to removing myself the moment anger rises");
  });

  it("returns an empty array when no drafts are present", () => {
    expect(extractCommitmentDrafts("no drafts here")).toEqual([]);
  });
});
