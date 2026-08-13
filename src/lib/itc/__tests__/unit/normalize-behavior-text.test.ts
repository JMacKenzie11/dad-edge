import { describe, expect, it } from "vitest";
import { normalizeBehaviorText } from "../../maps";

describe("normalizeBehaviorText — dedup key for addBehavior", () => {
  it("treats trailing punctuation as noise", () => {
    expect(normalizeBehaviorText("I lie to get out.")).toBe(
      normalizeBehaviorText("I lie to get out"),
    );
    expect(normalizeBehaviorText("I go silent!")).toBe(
      normalizeBehaviorText("I go silent"),
    );
  });

  it("is case-insensitive", () => {
    expect(normalizeBehaviorText("I Shut Down")).toBe(
      normalizeBehaviorText("i shut down"),
    );
  });

  it("collapses whitespace", () => {
    expect(normalizeBehaviorText("I  bring  up things")).toBe(
      normalizeBehaviorText("I bring up things"),
    );
  });

  it("treats smart and straight apostrophes as equal", () => {
    expect(normalizeBehaviorText("I don\u2019t listen")).toBe(
      normalizeBehaviorText("I don't listen"),
    );
  });

  it("preserves internal words (not overly aggressive)", () => {
    expect(normalizeBehaviorText("I shut down")).not.toBe(
      normalizeBehaviorText("I shut down and walk out"),
    );
    expect(normalizeBehaviorText("I bring up her past")).not.toBe(
      normalizeBehaviorText("I bring up her mistakes"),
    );
  });
});
