import { describe, expect, it } from "vitest";
import { scrubCoachReply } from "@/lib/coach/scrub-reply";

/**
 * Defensive scrubber tests. The prompt bans em-dashes, en-dashes,
 * and double-hyphens as em-dash substitutes; the scrubber is the
 * output-boundary guarantee that these never reach the coachee.
 *
 * Deliberately narrow: only punctuation. Deeper voice violations
 * (manufactured reversals, dramatic openers, fragment stacks) are
 * prompt concerns because a scrubber can't tell an earned pattern
 * from a manufactured one.
 */
describe("scrubCoachReply", () => {
  it("replaces em-dashes with comma-space", () => {
    expect(scrubCoachReply("You're not broken — you're protected.")).toBe(
      "You're not broken, you're protected.",
    );
  });

  it("replaces en-dashes with comma-space", () => {
    expect(scrubCoachReply("Two things at once – both mattering.")).toBe(
      "Two things at once, both mattering.",
    );
  });

  it("replaces double-hyphens (typewriter em-dash substitute) with comma-space", () => {
    expect(scrubCoachReply("The point is -- follow through.")).toBe(
      "The point is, follow through.",
    );
  });

  it("collapses the double-comma-space the substitution can produce", () => {
    // "text, — text" becomes "text, , text" after the first pass;
    // the collapse step reduces it to "text, text".
    expect(scrubCoachReply("Marcus quit, — Jen pulled away.")).toBe(
      "Marcus quit, Jen pulled away.",
    );
  });

  it("preserves single hyphens in words (over-preparing, phone-in-drawer)", () => {
    const s =
      "Over-preparing looks like over-functioning. Phone-in-drawer is the move.";
    expect(scrubCoachReply(s)).toBe(s);
  });

  it("preserves hyphenated numbers and codes", () => {
    expect(scrubCoachReply("Target date is 2026-09-14.")).toBe(
      "Target date is 2026-09-14.",
    );
  });

  it("preserves prose that already has no em-dashes", () => {
    const s =
      "Hand your phone to Kate before dinner. She holds it. You don't touch it until the meal is over.";
    expect(scrubCoachReply(s)).toBe(s);
  });

  it("strips leading whitespace but preserves paragraph breaks", () => {
    expect(scrubCoachReply("   Yeah.\n\nThat lands.")).toBe(
      "Yeah.\n\nThat lands.",
    );
  });

  it("handles multiple em-dashes in the same reply", () => {
    const messy =
      "Here's what I'm seeing — and tell me if I'm off — but you're leaning hard.";
    expect(scrubCoachReply(messy)).toBe(
      "Here's what I'm seeing, and tell me if I'm off, but you're leaning hard.",
    );
  });

  it("is idempotent — running twice is the same as running once", () => {
    const input = "You're not broken — you're protected.";
    const once = scrubCoachReply(input);
    const twice = scrubCoachReply(once);
    expect(twice).toBe(once);
  });
});
