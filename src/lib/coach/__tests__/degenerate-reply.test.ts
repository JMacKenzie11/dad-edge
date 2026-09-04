/**
 * The two real failures this exists to catch are the first two cases.
 * Both shipped to a coachee on 2026-09-03 because nothing looked at
 * the reply text before persisting it.
 */
import { describe, expect, it } from "vitest";
import { checkCoachReply } from "../degenerate-reply";

describe("checkCoachReply", () => {
  it("catches the literal 'placeholder' that shipped", () => {
    const v = checkCoachReply("placeholder");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/scaffolding/);
  });

  it("catches the reply that opened mid-word", () => {
    const v = checkCoachReply(
      "y then answer your question straight.\n\nThat matters, man. You're telling me the thing you actually want isn't sex, it's her hands on you without you asking.",
    );
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/mid-sentence/);
  });

  it("passes the real replies from that same conversation", () => {
    for (const good of [
      "What's 'resistant' look like, actually? Is she saying no outright, changing the subject, going to bed early, or something else?",
      "Hold on, that's actually useful info, not just resistance. She's not dodging, she's negotiating.",
      "That's the real thing then. This was never really about the number of days.",
    ]) {
      expect(checkCoachReply(good), good.slice(0, 40)).toEqual({
        ok: true,
        reason: null,
      });
    }
  });

  it("catches the other shapes a lost model emits", () => {
    for (const bad of ["TODO", "[your response here]", "N/A", "<reply>", "null", ""]) {
      expect(checkCoachReply(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("catches a single word and a fragment", () => {
    expect(checkCoachReply("Okay.").ok).toBe(false);
    expect(checkCoachReply("Understood").ok).toBe(false);
  });

  it("allows a reply that opens with a quote or an ellipsis", () => {
    // Only a bare lowercase letter counts as mid-sentence; the coach
    // quotes the man back to himself often.
    expect(
      checkCoachReply('"I just want to feel wanted." That is the whole thing right there, and it is worth saying to her.').ok,
    ).toBe(true);
    expect(
      checkCoachReply("...and that is the part she never hears from you, which is exactly the problem to solve here.").ok,
    ).toBe(true);
  });

  it("does not fire on a normal short-but-real reply", () => {
    expect(
      checkCoachReply("Have you ever actually said that to her, in those words?").ok,
    ).toBe(true);
  });
});
