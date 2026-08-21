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
import {
  assembleAssumption,
  assembleCommitment,
  ensureThenAfterIfClause,
  scrubReply,
  scrubReplyLight,
  trimAssembledDraft,
  withVoiceRules,
  WORRY_IDENTITY_SHAPES,
  type WorryIdentityShape,
} from "@/lib/itc/coach";
import {
  chipTargetForStage,
  type ChipTarget,
} from "@/lib/itc/chip-target";
import { hasCompetingGoalFraming, worryPassesDepth } from "@/lib/itc/rules";
import {
  checkAssumptionLogicalConsistency,
  checkWorryLogicalConsistency,
} from "@/lib/itc/rubric";
import {
  ASSUMPTION_STEM,
  ensureStem,
  GOAL_STEM,
  hasAssumptionStem,
  hasGoalStem,
  ITC_STAGES,
  STAGE_LABELS,
} from "@/lib/itc/stage";
import {
  isLegacyCannedIntro,
  LEGACY_INTRO_PREFIXES,
  STAGE_INTROS,
} from "@/lib/itc/stage-intros";
import { normalizeWorryPrefix } from "@/lib/itc/maps";
import {
  computeMidpointCheckAt,
  MIDPOINT_MIN_RUNWAY_DAYS,
} from "@/lib/scoring/quarters";

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

  it("fixes comma-directly-followed-by-letter typos (wife,and → wife, and)", () => {
    // Recurring LLM typo we saw in real coach-drafted assumptions:
    // "hurts his wife,and she'd have no choice" — the missing space
    // makes visible output look sloppy. Defensive normalization on
    // every scrubReply pass ensures we never ship this to a coachee.
    expect(scrubReply("hurts his wife,and she'd leave")).toBe(
      "hurts his wife, and she'd leave",
    );
    expect(scrubReply("the people he loves,and that man isn't enough")).toBe(
      "the people he loves, and that man isn't enough",
    );
  });

  it("preserves numeric commas (1,000 unaffected)", () => {
    // The comma-space fix only injects space when the comma is followed
    // by an A-Z letter — digits (numeric commas) are preserved so
    // "1,000" or "2,500 words" don't get mangled.
    expect(scrubReply("It took 1,000 hours.")).toBe("It took 1,000 hours.");
    expect(scrubReply("Over 2,500 words, roughly.")).toBe(
      "Over 2,500 words, roughly.",
    );
  });
});

describe("scrubReplyLight", () => {
  it("does NOT truncate on column-label mentions (walkthrough must survive)", () => {
    // scrubReply's advance-cut truncates entry-reaction coach output
    // at any mention of a column label to prevent front-running. That
    // guard is exactly wrong for the immune-system walkthrough, which
    // legitimately names "big assumptions", "worry box", "competing
    // commitments" as it reads the map back to the coachee. This test
    // locks the distinction: scrubReplyLight preserves those mentions.
    const walkthrough =
      "Every behavior in your Column 2 is doing the same job. Big Assumptions never get tested. Worry box holds the fear. Competing commitments compete with the goal.";
    const light = scrubReplyLight(walkthrough);
    // All four column labels must survive.
    expect(light.toLowerCase()).toContain("column 2");
    expect(light.toLowerCase()).toContain("big assumptions");
    expect(light.toLowerCase()).toContain("worry box");
    expect(light.toLowerCase()).toContain("competing commitments");
    // Sanity check: full scrubReply DOES truncate the same input
    // (this is the guard we're specifically stepping around for
    // walkthroughs — proves the two functions differ on this case).
    const heavy = scrubReply(walkthrough);
    expect(heavy.length).toBeLessThan(light.length);
  });

  it("still strips em dashes to comma-space", () => {
    expect(scrubReplyLight("This is sharp — I like it.")).toBe(
      "This is sharp, I like it.",
    );
  });

  it("still strips claim-of-action phrases (coach never wrote map state)", () => {
    // Even in walkthroughs, the coach must not claim to have added or
    // saved anything — that's the Form-First invariant, orthogonal to
    // the advance-cut.
    const out = scrubReplyLight("Nice thinking. I've saved that to your map.");
    expect(out.toLowerCase()).not.toContain("saved");
    expect(out.toLowerCase()).not.toContain("i've");
  });

  it("preserves paragraph breaks (double newlines) between movements", () => {
    // The walkthrough uses \n\n between Movement 1, 2, 3 so the UI's
    // whitespace-pre-wrap renders each as its own paragraph. scrubReply
    // collapsed all whitespace including newlines; scrubReplyLight
    // must not.
    const walkthrough =
      "Movement one lands here.\n\nMovement two lands here.\n\nMovement three lands here.";
    const light = scrubReplyLight(walkthrough);
    expect(light).toContain("\n\n");
    // Should still have exactly two paragraph breaks between three
    // movements.
    expect(light.match(/\n\n/g)?.length).toBe(2);
  });
});

describe("assembleAssumption (structured slots → canonical sentence)", () => {
  it("assembles the canonical Kegan/Lahey shape from three slots", () => {
    // The whole architectural point: the LLM writes only the semantic
    // content (act, tell, identity); the server writes the stem, "if
    // I", "then", "and", punctuation. This is what makes the sentence
    // shape unrepresentable-if-wrong (no possible LLM output can
    // produce a compound-consequent chained draft).
    expect(
      assembleAssumption({
        antecedent_act: "stay in the room while she's angry",
        consequent_tell: "I'd lose control",
        consequent_identity: "be the husband who hurts her",
      }),
    ).toBe(
      "I assume that if I stay in the room while she's angry, then I'd lose control and be the husband who hurts her.",
    );
  });

  it("strips trailing punctuation the LLM might redundantly write", () => {
    // Common LLM slip: writes "lose control." — with server assembly
    // that would produce "then I'd lose control. and be the husband..."
    // Normalize by stripping any trailing .,!?;: from each slot.
    expect(
      assembleAssumption({
        antecedent_act: "stay in the room.",
        consequent_tell: "I'd lose control.",
        consequent_identity: "be the husband who hurts her.",
      }),
    ).toBe(
      "I assume that if I stay in the room, then I'd lose control and be the husband who hurts her.",
    );
  });

  it("lowercases the first char of each slot (server writes the sentence-initial cap)", () => {
    // If the LLM accidentally sentence-cases a slot ("Stay in the
    // room"), the assembled output would have "if I Stay in the
    // room" which reads wrong. Normalize to lowercase first char.
    expect(
      assembleAssumption({
        antecedent_act: "Stay in the room while she's angry",
        consequent_tell: "I'd lose control",
        consequent_identity: "Be the husband who hurts her",
      }),
    ).toBe(
      "I assume that if I stay in the room while she's angry, then I'd lose control and be the husband who hurts her.",
    );
  });

  it("assembled length is bounded — worst-case slots produce ≤ 40 words", () => {
    // Per-slot schema caps (12/10/10 words) + connectives (7) put
    // the assembled sentence at ~40 words worst case. Real Kegan-
    // canonical drafts land at 15-25.
    const maxOut = assembleAssumption({
      antecedent_act: "one two three four five six seven eight nine ten eleven twelve",
      consequent_tell: "one two three four five six seven eight nine ten",
      consequent_identity: "one two three four five six seven eight nine ten",
    });
    expect(maxOut.split(/\s+/).length).toBeLessThanOrEqual(40);
  });

  it("cannot produce compound-consequent chained drafts (structural guarantee)", () => {
    // The old freeform-text drafter kept producing "then I'd X and I'd
    // Y, and I'd Z, and she'd W" chains. With the structured schema
    // there's exactly ONE tell slot and ONE identity slot — chaining
    // is impossible at the shape level (any "and" between tell +
    // identity is the server-written one). This test is a sanity
    // demonstration, not an assertion of the schema constraint.
    const out = assembleAssumption({
      antecedent_act: "stay",
      consequent_tell: "I'd lose control",
      consequent_identity: "be the husband who hurts her",
    });
    // Exactly ONE " and " in the output (the server-written one).
    expect(out.match(/ and /g)?.length).toBe(1);
  });
});

describe("assembleCommitment (single slot → introductory-form sentence)", () => {
  // Kegan Vol 1 pp 26-27 introductory form:
  //   "I'm also committed to never <vow>."
  // The vow slot names the identity/outcome the paired worry fears,
  // mirrored into never-form. Server writes prefix + terminal period.

  it("assembles 'I'm also committed to never <vow>.'", () => {
    expect(
      assembleCommitment({
        vow: "being the guy who is defensive or difficult to work with",
      }),
    ).toBe(
      "I'm also committed to never being the guy who is defensive or difficult to work with.",
    );
  });

  it("mirrors the outcome content of a worry cleanly", () => {
    expect(
      assembleCommitment({
        vow: "looking incompetent in front of my team",
      }),
    ).toBe(
      "I'm also committed to never looking incompetent in front of my team.",
    );
  });

  it("strips a redundant leading 'never' if the LLM wrote it", () => {
    // Server writes "never" as part of the prefix. LLM slot with
    // leading "never" would produce "never never" — normalize.
    expect(
      assembleCommitment({
        vow: "never being the husband who can't let things go",
      }),
    ).toBe(
      "I'm also committed to never being the husband who can't let things go.",
    );
  });

  it("strips trailing punctuation the LLM might redundantly write", () => {
    expect(
      assembleCommitment({
        vow: "failing my family as the provider.",
      }),
    ).toBe(
      "I'm also committed to never failing my family as the provider.",
    );
  });

  it("lowercases the first char of the slot", () => {
    expect(
      assembleCommitment({
        vow: "Being seen as weak in front of my team",
      }),
    ).toBe(
      "I'm also committed to never being seen as weak in front of my team.",
    );
  });
});

describe("normalizeWorryPrefix (DB-boundary worry stem guard)", () => {
  // Every worry stored must start with "I worry that...". Two failure
  // paths let non-conforming worries through historically:
  //   (a) chat LLM violates the WORRIES_STAGE prompt rule and emits
  //       "I fear being X" in a <<propose_worry>> marker
  //   (b) the coachee types freely in the worry form
  // upsertWorryForBehavior runs every text through this normalizer.

  it("passes through worries already in the canonical stem", () => {
    const s = "I worry that if I stayed calm, she'd know I've been faking it.";
    expect(normalizeWorryPrefix(s)).toBe(s);
  });

  it("passes through 'I worry that' case-insensitively", () => {
    const s = "i worry that I'd be the man who couldn't hold it together";
    // Already begins with "I worry" — no rewrite, just passthrough.
    expect(normalizeWorryPrefix(s)).toBe(s);
  });

  it("transforms 'I fear being X' into 'I worry that I'd be X'", () => {
    expect(
      normalizeWorryPrefix("I fear being the guy who is defensive"),
    ).toBe("I worry that I'd be the guy who is defensive");
  });

  it("transforms 'I fear that X' into 'I worry that X'", () => {
    expect(
      normalizeWorryPrefix("I fear that she'd stop trusting me"),
    ).toBe("I worry that she'd stop trusting me");
  });

  it("transforms bare 'I fear X' into 'I worry that X'", () => {
    expect(normalizeWorryPrefix("I fear losing my team's respect")).toBe(
      "I worry that losing my team's respect",
    );
  });

  it("transforms 'I'm afraid that X' into 'I worry that X'", () => {
    expect(
      normalizeWorryPrefix("I'm afraid that they'd never take me seriously again"),
    ).toBe("I worry that they'd never take me seriously again");
  });

  it("transforms 'I'm afraid of being X' into 'I worry that I'd be X'", () => {
    expect(
      normalizeWorryPrefix("I'm afraid of being the leader who folds"),
    ).toBe("I worry that I'd be the leader who folds");
  });

  it("transforms 'My fear is that X' into 'I worry that X'", () => {
    expect(
      normalizeWorryPrefix("My fear is that I'd be seen as incompetent"),
    ).toBe("I worry that I'd be seen as incompetent");
  });

  it("prepends 'I worry that' with lowercased first char for unhandled shapes", () => {
    // Coachee types a sentence with none of the known stems.
    expect(
      normalizeWorryPrefix("She'd see I've never been the man she thought"),
    ).toBe("I worry that she'd see I've never been the man she thought");
  });

  it("preserves capital I when prepending", () => {
    expect(
      normalizeWorryPrefix("I'd have to admit I was wrong the whole time"),
    ).toBe("I worry that I'd have to admit I was wrong the whole time");
  });

  it("is idempotent — running twice is the same as running once", () => {
    const inputs = [
      "I fear being the guy who is defensive",
      "I worry that if I stayed calm, she'd know",
      "She'd stop trusting me",
    ];
    for (const s of inputs) {
      const once = normalizeWorryPrefix(s);
      const twice = normalizeWorryPrefix(once);
      expect(twice).toBe(once);
    }
  });
});

describe("trimAssembledDraft (the shared drafter overshoot handler)", () => {
  const CAP = 20;

  it("returns the assembled sentence as-is when already under cap", () => {
    const s = "I worry that if I stayed calm, I'd have to see I've been hiding.";
    expect(trimAssembledDraft(s, CAP)).toBe(s);
  });

  it("strips filler modifiers to fit under cap", () => {
    // >20 words with "actually" + "fully" — banned filler that
    // the drafter prompts explicitly call out. Trim only fires when
    // the assembled sentence exceeds cap, so fixture must be OVER 20.
    const over =
      "I worry that if I actually listened to her fully without defending myself in that moment, she'd really see I've been hiding.";
    expect(over.split(/\s+/).length).toBeGreaterThan(CAP);
    const trimmed = trimAssembledDraft(over, CAP);
    expect(trimmed.toLowerCase()).not.toContain("actually");
    expect(trimmed.toLowerCase()).not.toContain("fully");
    expect(trimmed.split(/\s+/).length).toBeLessThanOrEqual(CAP);
  });

  it("strips a trailing 'instead of ...' clause to fit under cap", () => {
    // >20 words; trailing "instead of ..." is the redundant tic both
    // worry and commitment prompts explicitly ban.
    const over =
      "I worry that if I asked her plainly what she needs from me right now, she'd realize I've been performing instead of really loving her.";
    expect(over.split(/\s+/).length).toBeGreaterThan(CAP);
    const trimmed = trimAssembledDraft(over, CAP);
    expect(trimmed.toLowerCase()).not.toContain("instead of");
    expect(trimmed.split(/\s+/).length).toBeLessThanOrEqual(CAP);
  });

  it("strips a trailing parenthetical qualifier", () => {
    // >20 words with a trailing parenthetical the trim should strip
    // as context noise.
    const over =
      "I'm also committed to keeping one foot out the door at all times so I never have to be the man who is needed (when it counts).";
    expect(over.split(/\s+/).length).toBeGreaterThan(CAP);
    const trimmed = trimAssembledDraft(over, CAP);
    expect(trimmed).not.toContain("(");
    expect(trimmed).not.toContain(")");
  });

  it("NEVER returns null — over-cap-and-unrescuable draft still comes back", () => {
    // 25 unique words, no filler, no "instead of", no parens.
    // Beyond mechanical rescue but must still return a string so
    // the coachee sees SOMETHING instead of an empty draft card.
    // Prior implementations (silent-drop + null-return) caused the
    // "only one behavior got a draft" bug the user hit twice.
    const unrescuable =
      "I worry that if I stopped bringing up her past mistakes she would recognize the pattern of my defensive maneuvers running throughout our marriage.";
    const out = trimAssembledDraft(unrescuable, CAP);
    expect(out).toBeTypeOf("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("returns a string type (not null) on any input, guarding the drafter contract", () => {
    // Structural: worry/commitment/assumption drafters all rely on
    // this returning a string so their "show whatever comes back"
    // guarantee holds. If someone reverts to nullable return, this
    // test fails at the type level too.
    const out = trimAssembledDraft("short sentence.", CAP);
    // biome-ignore lint: intentional narrow-to-string
    const _typed: string = out;
    expect(_typed).toBeTypeOf("string");
  });
});

describe("withVoiceRules (drafter → voice-doc single source of truth)", () => {
  // Prior architectural gap: drafters had their own SYSTEM strings that
  // didn't inherit docs/coach-voice-and-tone.md. Voice drift landed
  // in drafter output while reaction-coach paths stayed clean.
  // withVoiceRules is now the single wrapping point ensuring every
  // drafter + stage-specific system prompt carries the voice doc.
  // If this silently regresses, voice enforcement disappears from
  // every drafter + walkthrough + test-design + prioritize + results
  // + done stage in one shot.

  it("prepends VOICE_RULES with an explicit end-of-rules delimiter", () => {
    const wrapped = withVoiceRules("DRAFTER_BODY_HERE");
    expect(wrapped).toContain("===== END VOICE RULES =====");
    // Voice rules must appear BEFORE the delimiter.
    const delimIdx = wrapped.indexOf("===== END VOICE RULES =====");
    expect(delimIdx).toBeGreaterThan(0);
    // Body must appear AFTER the delimiter.
    const bodyIdx = wrapped.indexOf("DRAFTER_BODY_HERE");
    expect(bodyIdx).toBeGreaterThan(delimIdx);
  });

  it("loads a substantial voice-rules block (not empty, not truncated)", () => {
    const wrapped = withVoiceRules("body");
    // Voice doc is ~250 lines; wrapped output should carry the bulk
    // of it. Guards against a future refactor that accidentally
    // stubs VOICE_RULES to an empty string.
    expect(wrapped.length).toBeGreaterThan(1000);
  });

  it("preserves the drafter body verbatim (no truncation)", () => {
    const uniqueBody =
      "UNIQUE_DRAFTER_BODY_MARKER_that_must_appear_verbatim_in_output";
    const wrapped = withVoiceRules(uniqueBody);
    expect(wrapped).toContain(uniqueBody);
  });
});

describe("WORRY_IDENTITY_SHAPES (server-owned rotation across Kegan-canonical shapes)", () => {
  // Server rotates one shape per behavior via index modulo, same
  // architectural pattern as ANOTHER_ROTATION / SAFER_LADDER in
  // test-design. Any reorder or truncation of this array silently
  // shifts every worry drafter's shape assignment across the map.

  it("contains exactly four Kegan-canonical shapes", () => {
    expect(WORRY_IDENTITY_SHAPES.length).toBe(4);
  });

  it("contains the four shape names in canonical order", () => {
    // Order matters: behaviors are indexed by sort_order and mapped
    // to shape via index modulo. Reordering this array changes
    // which behavior gets which shape.
    expect(WORRY_IDENTITY_SHAPES).toEqual([
      "role_noun",
      "role_failure_verb",
      "seen_as",
      "self_label",
    ]);
  });

  it("rotates deterministically via index modulo", () => {
    // Simulates draftMissingWorriesAfterAdvance's rotation logic.
    // Ensures behavior 5 loops back to role_noun, behavior 6 to
    // role_failure_verb, etc.
    const shapeFor = (index: number): WorryIdentityShape =>
      WORRY_IDENTITY_SHAPES[index % WORRY_IDENTITY_SHAPES.length];
    expect(shapeFor(0)).toBe("role_noun");
    expect(shapeFor(1)).toBe("role_failure_verb");
    expect(shapeFor(2)).toBe("seen_as");
    expect(shapeFor(3)).toBe("self_label");
    expect(shapeFor(4)).toBe("role_noun");
    expect(shapeFor(5)).toBe("role_failure_verb");
  });
});

describe("checkWorryLogicalConsistency (three-layer deterministic worry check)", () => {
  // Layer 1: interior-scaffolding blacklist ("I'd have to see/face/feel/
  //          know/admit/be/become", "admit to myself")
  // Layer 2: past-tense revealer whitelist ("I've been", "'s been",
  //          "she'd", "the truth", etc.)
  // Layer 3: Kegan-canonical identity-rung whitelist (role-noun,
  //          self-label, seen-as/see-me-as, role-failure toward
  //          her/him/them, self-over-other)
  //
  // A draft must pass ALL THREE. Feeds into the drafter retry loop
  // via the "reason" string.

  const baseInput = {
    behaviorText: "I bring up things she did in the past instead of listening",
    oppositeMove: "listen to her without bringing up her past",
  };

  it("layer 1 fails on interior scaffolding 'I'd have to admit'", () => {
    const out = checkWorryLogicalConsistency({
      ...baseInput,
      identityLanding: "I'd have to admit I've been running from her",
    });
    expect(out.consistent).toBe(false);
    expect(out.reason).toMatch(/interior-witness scaffolding/i);
  });

  it("layer 1 fails on 'I'd have to be' state-of-being interior verb", () => {
    const out = checkWorryLogicalConsistency({
      ...baseInput,
      identityLanding: "I'd have to be the husband who caused this distance",
    });
    expect(out.consistent).toBe(false);
    expect(out.reason).toMatch(/interior-witness scaffolding/i);
  });

  it("layer 2 fails on bare present-tense 'I'm the [X-er]' inversion", () => {
    // Behavior = bringing up her past; opposite = listening. Bare
    // "I'm the man who ignores her" reads as if listening creates
    // the ignorer identity (impossible — listening is the opposite).
    const out = checkWorryLogicalConsistency({
      ...baseInput,
      identityLanding: "I'm the man who ignores her",
    });
    expect(out.consistent).toBe(false);
    expect(out.reason).toMatch(/revealer marker/i);
  });

  it("layer 3 fails on strategy-level landing without identity marker", () => {
    // "Using her mistakes to avoid hearing mine" is a strategy
    // description, not an identity landing. Passes layer 1 (no
    // scaffolding) and layer 2 ("I've been"), but layer 3 catches
    // the missing role-noun / self-label / seen-as / role-failure.
    const out = checkWorryLogicalConsistency({
      ...baseInput,
      identityLanding: "I've been using her mistakes to avoid hearing mine",
    });
    expect(out.consistent).toBe(false);
    expect(out.reason).toMatch(/strategy|identity/i);
  });

  it("passes Kegan-canonical role-noun landing (she'd see I've been the husband who X)", () => {
    const out = checkWorryLogicalConsistency({
      ...baseInput,
      identityLanding:
        "she'd see I've been the husband who never let a word she said land",
    });
    expect(out.consistent).toBe(true);
  });

  it("passes Kegan-canonical role-failure landing (chose myself over her)", () => {
    const out = checkWorryLogicalConsistency({
      ...baseInput,
      identityLanding: "she'd see I've been choosing myself over her all along",
    });
    expect(out.consistent).toBe(true);
  });

  it("passes Kegan-canonical seen-as variant (she'd see me as [X])", () => {
    // Vol 1 p 13 canonical framing.
    const out = checkWorryLogicalConsistency({
      ...baseInput,
      identityLanding: "she'd see me as the man I always feared I was",
    });
    expect(out.consistent).toBe(true);
  });
});

// The old checkCommitmentLogicalConsistency test block was removed
// with the switch to the introductory commitment form (Kegan Vol 1
// pp 26-27). The mechanism form's active_move / protective_purpose
// slots no longer exist. The introductory form is a text
// transformation of the paired worry — depth rubric alone verifies
// correctness. If a text-level regression pattern appears (e.g.,
// positive-aspiration leakage), add a targeted deterministic check
// with the new vow-slot shape.

describe("checkAssumptionLogicalConsistency (deterministic whitelist on consequent_identity)", () => {
  // Replaces an earlier LLM verifier that made judgment calls on
  // subtle semantic inversion. Deterministic whitelist catches the
  // concrete failure mode: bare present-tense "the man who X" in
  // consequent_identity without a past-tense/witnessed marker.

  const baseInput = {
    antecedentAct: "stay in the room and hear her out",
    consequentTell: "she'd tell me the truth",
  };

  it("fails on bare present-tense noun 'the man who X' with no revealer marker", () => {
    const out = checkAssumptionLogicalConsistency({
      ...baseInput,
      consequentIdentity: "the man who ignores her",
    });
    expect(out.consistent).toBe(false);
    expect(out.reason).toMatch(/revealer/i);
  });

  it("passes on past-perfect 'the man who's been X' with revealer marker", () => {
    const out = checkAssumptionLogicalConsistency({
      ...baseInput,
      consequentIdentity: "the man who's been running her whole marriage",
    });
    expect(out.consistent).toBe(true);
  });

  it("passes on witnessed-by-other landing (she'd see...)", () => {
    const out = checkAssumptionLogicalConsistency({
      ...baseInput,
      consequentIdentity: "she'd see I've been the husband who never listened",
    });
    expect(out.consistent).toBe(true);
  });

  it("passes on truth-frame landing", () => {
    const out = checkAssumptionLogicalConsistency({
      ...baseInput,
      consequentIdentity: "the truth would come out that I've never been enough",
    });
    expect(out.consistent).toBe(true);
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

describe("hasAssumptionStem", () => {
  it("accepts the exact stem", () => {
    expect(hasAssumptionStem(`${ASSUMPTION_STEM} if I fail`)).toBe(true);
  });

  it("rejects text that lacks the stem", () => {
    // "If I …, then …" alone is NOT canonical ITC form — the whole
    // point of the stem is to name the epistemic status (belief, not
    // fact) which is what makes the assumption testable.
    expect(hasAssumptionStem("If I stay, then I'd lose control")).toBe(false);
    expect(hasAssumptionStem("She'd leave me")).toBe(false);
  });

  it("tolerates smart apostrophes and quotes (parses same as ASCII)", () => {
    // Coach output sometimes carries U+2019 smart apostrophes; the
    // stem check normalizes both sides so real drafts pass.
    const smart = "I assume that if I\u2019m too honest, then she\u2019d leave";
    expect(hasAssumptionStem(smart)).toBe(true);
  });

  it("ensureStem auto-prepends when the user types raw 'If I …'", () => {
    // saveAssumption pipes user input through ensureStem so a user
    // typing "If I stop lying" lands as "I assume that if I stop lying"
    // without them having to know the ceremony.
    expect(ensureStem("If I stop lying", ASSUMPTION_STEM)).toBe(
      `${ASSUMPTION_STEM} if I stop lying`,
    );
  });

  it("ensureStem no-ops when the user already typed the stem", () => {
    const t = `${ASSUMPTION_STEM} if I stop lying`;
    expect(ensureStem(t, ASSUMPTION_STEM)).toBe(t);
  });
});

describe("ensureThenAfterIfClause", () => {
  it("injects 'then' after the antecedent comma when missing", () => {
    // ITC canonical form is "if I …, then …" — the "then" makes the
    // consequent a testable prediction, not a diagnosis. Auto-inject
    // is belt-and-suspenders in case the LLM drops it.
    expect(
      ensureThenAfterIfClause(
        "I assume that if I stay in the room, I'll lose it and be that husband.",
      ),
    ).toBe(
      "I assume that if I stay in the room, then I'll lose it and be that husband.",
    );
  });

  it("is a no-op when 'then' is already present", () => {
    const t =
      "I assume that if I stay in the room, then I'll lose it and be that husband.";
    expect(ensureThenAfterIfClause(t)).toBe(t);
  });

  it("preserves case of the existing 'then' (case-insensitive detection)", () => {
    // The negative lookahead is case-insensitive so we don't
    // double-insert if the model wrote "Then" — but we preserve their
    // capitalization rather than lowercasing.
    const t =
      "I assume that if I stay in the room, Then I'll lose it.";
    expect(ensureThenAfterIfClause(t)).toBe(t);
  });

  it("handles smart-apostrophe drafts (still finds the 'if I' opener)", () => {
    // Coach output sometimes carries U+2019 for "I'm"; the "if I"
    // detection is on the ASCII form which is what ensureStem
    // normalizes to, so this should still work.
    expect(
      ensureThenAfterIfClause(
        "I assume that if I stop lying, she'll finally see I'm not enough.",
      ),
    ).toBe(
      "I assume that if I stop lying, then she'll finally see I'm not enough.",
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
  it("passes when depth_score is null (rubric unavailable — fail-open)", () => {
    // Null means the rubric never wrote a score (LLM outage, migration
    // backfill, pre-scoring row state). The rubric is a guard against
    // shallow entries; when the guard can't run, trust the coachee
    // rather than stranding him on a Haiku hiccup. This behavior is
    // load-bearing for regression 5+7 (coach-service-down completes
    // the map end to end) AND for the behaviors depth branch which
    // was added after worries/commitments/assumptions.
    expect(worryPassesDepth(null, 0)).toBe(true);
    expect(worryPassesDepth(null, 5)).toBe(true);
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

  it("assumptions intro names the ITC 'I assume that if…then…' shape and the many-to-many linking", () => {
    const rendered = STAGE_INTROS["assumptions"]!({ goal: null });
    // Big Assumptions in ITC are "I assume that if I…, then …" beliefs
    // — the "I assume that" stem makes the epistemic status explicit
    // (testable belief, not fact) which is what unlocks the immunity.
    // The intro must model that canonical form for the coachee.
    expect(rendered.toLowerCase()).toContain("i assume");
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

describe("computeMidpointCheckAt (goal-relative midpoint math)", () => {
  // Q3 2026 ends 2026-09-30. Anchor every test on that boundary so the
  // "join week N" scenarios read cleanly against a real calendar quarter.
  const QUARTER_END = "2026-09-30";

  it("returns halfway date for a goal created at quarter start (week 1)", () => {
    // Q3 starts July 1. Full 92-day quarter ahead. Midpoint should
    // land near Aug 15-16 (halfway between Jul 1 and Sep 30).
    const created = new Date("2026-07-01T00:00:00Z");
    const midpoint = computeMidpointCheckAt(QUARTER_END, created);
    expect(midpoint).not.toBeNull();
    // Between Jul 20 and Aug 25 is close enough for a halfway check.
    expect(midpoint! >= "2026-07-20" && midpoint! <= "2026-08-25").toBe(true);
  });

  it("returns proportional midpoint for a mid-quarter joiner (week 6)", () => {
    // Joins ~week 6 of Q3. Roughly 47 days remain. Midpoint ~24 days out.
    const created = new Date("2026-08-15T00:00:00Z");
    const midpoint = computeMidpointCheckAt(QUARTER_END, created);
    expect(midpoint).not.toBeNull();
    // Should be roughly early September.
    expect(midpoint! >= "2026-08-30" && midpoint! <= "2026-09-15").toBe(true);
  });

  it("returns null when joining <21 days from quarter end (week 10+)", () => {
    // Joins Sep 15. 15 days to quarter end — under the 21-day floor.
    const created = new Date("2026-09-15T00:00:00Z");
    const midpoint = computeMidpointCheckAt(QUARTER_END, created);
    expect(midpoint).toBeNull();
  });

  it("returns null when joining in the final week (week 12)", () => {
    // Joins Sep 24, only 6 days left. Definitely skip midpoint.
    const created = new Date("2026-09-24T00:00:00Z");
    const midpoint = computeMidpointCheckAt(QUARTER_END, created);
    expect(midpoint).toBeNull();
  });

  it("boundary: exactly MIDPOINT_MIN_RUNWAY_DAYS remaining passes", () => {
    // Ensure the floor rule is `< 21`, not `<= 21`. At exactly 21 days
    // we should still schedule a midpoint (10-11 days out).
    const quarterEndMs = new Date(`${QUARTER_END}T00:00:00Z`).getTime();
    const created = new Date(
      quarterEndMs - MIDPOINT_MIN_RUNWAY_DAYS * 24 * 60 * 60 * 1000,
    );
    const midpoint = computeMidpointCheckAt(QUARTER_END, created);
    expect(midpoint).not.toBeNull();
  });

  it("boundary: one day under the floor returns null", () => {
    const quarterEndMs = new Date(`${QUARTER_END}T00:00:00Z`).getTime();
    const created = new Date(
      quarterEndMs - (MIDPOINT_MIN_RUNWAY_DAYS - 1) * 24 * 60 * 60 * 1000,
    );
    const midpoint = computeMidpointCheckAt(QUARTER_END, created);
    expect(midpoint).toBeNull();
  });

  it("returns ISO YYYY-MM-DD format when non-null", () => {
    const created = new Date("2026-07-01T00:00:00Z");
    const midpoint = computeMidpointCheckAt(QUARTER_END, created);
    expect(midpoint).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
