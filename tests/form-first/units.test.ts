/**
 * Pure-function invariants for the ITC map. Fast, no LLM, no DB.
 * These lock in the small helpers that repeatedly caused UX bugs
 * when drift went unnoticed:
 *   - scrubReply: coach output cleanup
 *   - hasGoalStem / ensureStem / hasCompetingGoalFraming: goal
 *     input hygiene (regression f in the scenario suite covers the
 *     server action; these cover the underlying helpers)
 *   - chipTargetForStage: chip routing discriminator (paired with
 *     regression g's structural check on dispatchers/listeners)
 *   - worryPassesDepth: the actual gate rule used by
 *     computeAdvanceGate for worries + commitments + assumptions
 *   - STAGE_INTROS: interpolate-live promise upheld for every
 *     entry-taking stage
 *   - isLegacyCannedIntro: legacy-persisted stage notes filter
 */

import { describe, expect, it } from "vitest";
import { scrubReply } from "@/lib/itc/coach";
import {
  chipTargetForStage,
  type ChipTarget,
} from "@/lib/itc/chip-target";
import { hasCompetingGoalFraming, worryPassesDepth } from "@/lib/itc/rules";
import {
  ensureStem,
  GOAL_STEM,
  hasGoalStem,
  ITC_STAGES,
  STAGE_LABELS,
} from "@/lib/itc/stage";
import {
  isLegacyCannedIntro,
  LEGACY_INTRO_PREFIXES,
  STAGE_INTROS,
} from "@/lib/itc/stage-intros";

describe("scrubReply", () => {
  it("strips em dashes to comma-space", () => {
    expect(scrubReply("This is sharp — I like it.")).toBe(
      "This is sharp, I like it.",
    );
  });

  it("strips en dashes similarly", () => {
    expect(scrubReply("This is sharp – I like it.")).toBe(
      "This is sharp, I like it.",
    );
  });

  it("strips claim-of-action phrases starting with That's", () => {
    // The coach cannot save/lock/add anything under Form-First.
    const out = scrubReply("That's locked. Nice work on it.");
    expect(out.toLowerCase()).not.toContain("locked");
  });

  it("strips 'I've added it' claim-of-action", () => {
    const out = scrubReply("Great. I've added it to your map.");
    expect(out.toLowerCase()).not.toContain("added");
    expect(out.toLowerCase()).not.toContain("i've");
  });

  it("truncates at 'Now Column N' premature-advance", () => {
    const out = scrubReply(
      "That's a solid goal. Now Column 2 is what you actually do.",
    );
    expect(out.toLowerCase()).not.toContain("column 2");
    // Should still contain the acknowledgment before the cut.
    expect(out.toLowerCase()).toContain("solid goal");
  });

  it("truncates at 'ready to move' variants", () => {
    const out = scrubReply(
      "That's the fear. Ready to move to the worry box?",
    );
    expect(out.toLowerCase()).not.toContain("ready to move");
    expect(out.toLowerCase()).not.toContain("worry box");
  });

  it("preserves valid plain prose untouched", () => {
    const input = "That's the fear underneath it.";
    expect(scrubReply(input)).toBe(input);
  });

  it("handles empty string without throwing", () => {
    expect(() => scrubReply("")).not.toThrow();
    expect(scrubReply("")).toBe("");
  });
});

describe("hasGoalStem", () => {
  it("accepts the exact stem", () => {
    expect(hasGoalStem(`${GOAL_STEM} being present`)).toBe(true);
  });

  it("accepts a stem with smart-apostrophe I'm", () => {
    // U+2019 right single quote instead of ASCII '
    const smart = "I\u2019m committed to getting better at being present";
    expect(hasGoalStem(smart)).toBe(true);
  });

  it("accepts case-insensitive stem", () => {
    expect(hasGoalStem("I'M COMMITTED TO GETTING BETTER AT being present")).toBe(
      true,
    );
  });

  it("rejects text without the stem", () => {
    expect(hasGoalStem("I want to get better at being present")).toBe(false);
  });

  it("rejects text where stem appears mid-string but not at start", () => {
    expect(hasGoalStem("Actually I'm committed to getting better at things")).toBe(
      false,
    );
  });
});

describe("ensureStem", () => {
  it("passes through when the stem is already present", () => {
    const t = `${GOAL_STEM} being present`;
    expect(ensureStem(t, GOAL_STEM)).toBe(t);
  });

  it("prepends when absent and lowercases the first char", () => {
    // ensureStem prepends and lowercases the leading char so the seam
    // reads "stem being" not "stem Being".
    expect(ensureStem("Being present is important", GOAL_STEM)).toBe(
      `${GOAL_STEM} being present is important`,
    );
  });
});

describe("hasCompetingGoalFraming", () => {
  it.each([
    "I want to get better at being with my wife",
    "I'd like to spend more time with my kids",
    "I would like to work out more",
    "My goal is to call my brother weekly",
    "My commitment is to be present",
    "Help me stop working late",
    "I need to stop yelling",
    "I will call my dad more",
    "I plan to be a better father",
  ])("flags competing framing: %s", (text) => {
    expect(hasCompetingGoalFraming(text)).toBe(true);
  });

  it("does NOT flag a properly-stemmed goal", () => {
    expect(
      hasCompetingGoalFraming(
        `${GOAL_STEM} being present when my wife is upset`,
      ),
    ).toBe(false);
  });

  it("does NOT flag an arbitrary start that isn't a competing frame", () => {
    expect(hasCompetingGoalFraming("Being calm when she's mad")).toBe(false);
  });

  it("does not flag 'I'm committed to getting better at' followed by valid text (that's the stem)", () => {
    expect(hasCompetingGoalFraming(`${GOAL_STEM} listening`)).toBe(false);
  });

  it("DOES flag 'I'm committed to X' when X is not the goal-stem suffix", () => {
    // "I'm committed" without the full "to getting better at" is a
    // competing frame (they're using the wrong stem).
    expect(hasCompetingGoalFraming("I'm committed to being present")).toBe(
      true,
    );
  });
});

describe("chipTargetForStage", () => {
  it.each<[Parameters<typeof chipTargetForStage>[0], ChipTarget | undefined]>([
    ["goal", "goal"],
    ["behaviors", "behavior"],
    ["worries", "worry"],
    ["commitments", "commitment"],
    ["assumptions", "assumption"],
    ["review", undefined],
    ["immune_system", undefined],
    ["prioritize", undefined],
    ["test_design", undefined],
    ["test_running", undefined],
    ["results", undefined],
    ["done", undefined],
  ])("stage %s → %s", (stage, expected) => {
    expect(chipTargetForStage(stage)).toBe(expected);
  });

  it("is exhaustive over ITC_STAGES (no runtime error, defined behavior for every stage)", () => {
    for (const stage of ITC_STAGES) {
      // Should never throw; may return undefined for non-entry stages.
      expect(() => chipTargetForStage(stage)).not.toThrow();
    }
  });
});

describe("worryPassesDepth (the actual depth gate rule)", () => {
  it("fails when depth_score is null (never scored)", () => {
    expect(worryPassesDepth(null, 5)).toBe(false);
  });

  it("fails at 0/3 regardless of attempts", () => {
    expect(worryPassesDepth(0, 0)).toBe(false);
    expect(worryPassesDepth(0, 10)).toBe(false);
  });

  it("fails at 1/3 regardless of attempts", () => {
    expect(worryPassesDepth(1, 0)).toBe(false);
    expect(worryPassesDepth(1, 10)).toBe(false);
  });

  it("fails at 2/3 with < 2 attempts", () => {
    expect(worryPassesDepth(2, 0)).toBe(false);
    expect(worryPassesDepth(2, 1)).toBe(false);
  });

  it("passes at 2/3 with attempts >= 2 (escape hatch)", () => {
    expect(worryPassesDepth(2, 2)).toBe(true);
    expect(worryPassesDepth(2, 5)).toBe(true);
  });

  it("passes at 3/3 with any attempts", () => {
    expect(worryPassesDepth(3, 0)).toBe(true);
    expect(worryPassesDepth(3, 1)).toBe(true);
    expect(worryPassesDepth(3, 99)).toBe(true);
  });
});

describe("STAGE_INTROS", () => {
  const requiredStages = [
    "behaviors",
    "worries",
    "commitments",
    "assumptions",
  ] as const;

  it.each(requiredStages)("has an intro for stage %s", (stage) => {
    const factory = STAGE_INTROS[stage];
    expect(factory, `STAGE_INTROS[${stage}] must be defined`).toBeDefined();
    if (factory) {
      const rendered = factory({ goal: "I'm committed to getting better at X" });
      expect(rendered.length).toBeGreaterThan(20);
    }
  });

  it("has NO intro for the goal stage (Column 1 has its own inline stem-primed input)", () => {
    expect(STAGE_INTROS["goal"]).toBeUndefined();
  });

  it("behaviors intro interpolates the goal text", () => {
    const factory = STAGE_INTROS["behaviors"]!;
    const withGoal = factory({ goal: "SENTINEL_GOAL_TEXT" });
    expect(withGoal).toContain("SENTINEL_GOAL_TEXT");
    const withoutGoal = factory({ goal: null });
    expect(withoutGoal).not.toContain("SENTINEL_GOAL_TEXT");
    expect(withoutGoal).toContain("your goal");
  });

  it("behaviors intro states the ITC 3-to-5 target", () => {
    const rendered = STAGE_INTROS["behaviors"]!({ goal: "any goal" });
    // Accept either "3 to 5" or "3-5" phrasing; both are ITC-aligned.
    expect(/3\s*(?:to|-)\s*5/.test(rendered)).toBe(true);
  });

  it("worries intro names identity as the depth bar", () => {
    const rendered = STAGE_INTROS["worries"]!({ goal: null });
    // The Kegan/Lahey depth bar for a Column 3 worry is a first-
    // person felt fear that lands on identity (self-labeling OR
    // role/relational). The intro must signal that bar so the coachee
    // doesn't stop at practical concerns.
    expect(rendered.toLowerCase()).toContain("identity");
    expect(/felt fear|felt.*about you|fear about you/i.test(rendered)).toBe(true);
    // Practical-concern anti-pattern should be called out.
    expect(/practical|"she'd get upset"|"we'd fall behind"/i.test(rendered)).toBe(true);
  });

  it("assumptions intro names the ITC 'If…then…' shape and the many-to-many linking", () => {
    const rendered = STAGE_INTROS["assumptions"]!({ goal: null });
    // Big Assumptions in ITC are If/then beliefs that make the hidden
    // commitments feel necessary — the intro must signal that shape so
    // the coachee doesn't stop at a flat single-clause statement.
    expect(/if.*then/i.test(rendered)).toBe(true);
    // Many-to-many is the whole reason assumptions has an add form
    // separate from the 1:1 worries/commitments — call it out.
    expect(/underwrite|link|holds up|hold up/i.test(rendered)).toBe(true);
    // Must connect back to the immune system framing (why they run
    // the system on autopilot).
    expect(/immunity|immune|autopilot|feels?\s+like\s+truth/i.test(rendered))
      .toBe(true);
  });

  it("no intro accidentally hard-codes an entry-shaped quote (no stale-quote reintroduction)", () => {
    // If a future edit puts a specific behavior/worry/commitment text
    // into a stage intro, this test still passes (we don't hard-code
    // examples). But it catches the specific past regression: no
    // intro should reference a jumping-jacks-shaped placeholder that
    // pretends to be map state.
    for (const stage of Object.keys(STAGE_INTROS)) {
      const factory = STAGE_INTROS[stage as keyof typeof STAGE_INTROS];
      if (!factory) continue;
      const out = factory({ goal: null });
      expect(out).not.toContain("jumping jacks");
    }
  });
});

describe("STAGE_LABELS", () => {
  it("labels Column 4 as 'Competing Commitments' (ITC terminology)", () => {
    // Kegan/Lahey's ITC framework specifically calls Column 4 the
    // "hidden competing commitments" — distinct from the Column 1
    // improvement goal, which is also a "commitment" ("I'm committed
    // to getting better at…"). Using the plain word "Commitments"
    // for Column 4 conflates the two and blurs the whole point of
    // the immunity map: that a hidden vow COMPETES with the stated
    // goal. This test locks the disambiguation into the label used
    // by the Continue button and the progress bar.
    expect(STAGE_LABELS.commitments).toBe("Competing Commitments");
  });
});

describe("isLegacyCannedIntro", () => {
  it.each(LEGACY_INTRO_PREFIXES)(
    "matches a stored message starting with legacy prefix: %s",
    (prefix) => {
      const content = `${prefix} — some tail from the old server-baked intro.`;
      expect(isLegacyCannedIntro(content)).toBe(true);
    },
  );

  it("does NOT match arbitrary LLM prose", () => {
    expect(
      isLegacyCannedIntro(
        "That's the fear underneath it. Ready to write a commitment?",
      ),
    ).toBe(false);
  });

  it("does NOT match a shorter prefix than the marker string", () => {
    expect(isLegacyCannedIntro("Column 2 is")).toBe(false); // no comma/space match
    // Actually startsWith("Column 2 is") should match "Column 2 is what
    // you actually do" — so let's assert the exact rule: prefix match.
    expect(isLegacyCannedIntro("Column 2 is what you actually do…")).toBe(true);
  });

  it("is prefix-anchored (mid-string legacy phrasing does not match)", () => {
    expect(
      isLegacyCannedIntro(
        "Look at your map. Column 2 is what you actually do would tell us more.",
      ),
    ).toBe(false);
  });
});
