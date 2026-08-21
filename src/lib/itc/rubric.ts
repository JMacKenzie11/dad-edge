import { generateObject } from "ai";
import { z } from "zod";
import { utilityModel } from "@/lib/model-config";

/**
 * Server-side depth rubric. Prompt language alone drifted in the reviewed
 * session — the coach called practical concerns "deep." This is the
 * mechanical guard: a cheap Haiku call scores every proposed worry against
 * three binary criteria straight from the guides.
 */

const RubricSchema = z.object({
  is_fear: z.boolean(),
  is_first_person_felt: z.boolean(),
  touches_identity: z.boolean(),
  reason: z.string().min(1).max(400),
});

export type WorryDepthResult = {
  score: 0 | 1 | 2 | 3;
  is_fear: boolean;
  is_first_person_felt: boolean;
  touches_identity: boolean;
  reason: string;
};

const SYSTEM = `
You are a strict depth rubric for the worry-box column of an Immunity to Change map. The methodology (Kegan & Lahey) requires each worry to be a first-person felt fear that lands on identity. Practical concerns and forecasts are not enough. But "identity" comes in more than one valid shape — do NOT reject a worry that lands on role/relational identity in favor of one that lands on self-labeling.

You score three BINARY criteria. Be strict. When in doubt, score false.

1. is_fear: The worry is a fear — visceral, present-tense, felt. Not a practical concern, forecast, or cost/benefit calculation. "It'd be a waste of time" and "she might feel pushed" are practical. "I'm afraid I'd fail her" is a fear.

2. is_first_person_felt: The worry names something the man himself dreads, in his own body/experience. Not abstract ("relationships need trust"), not about the other person's reaction ("she'd get upset"), not third-person ("men who don't listen lose their marriages"). If he's talking about the other person's feelings instead of his own, false.

3. touches_identity: The worry lands on identity in one of two ITC-valid shapes:
   (a) Self-labeling identity — a label he'd apply to himself. "I'm not enough," "I'm weak," "I'm a fraud," "I'd be the kind of husband who chose ego over her."
   (b) Role/relational identity — a role he'd have failed in or a relationship whose collapse he can't face. "I've failed my family as a provider," "the guy who let people down," "someone whose work didn't help," "the husband who hurts her."
   Both shapes pass. A worry that has clearly landed on either passes this criterion. Practical outcomes ("it'd take longer," "we'd lose the deal," "the money might not come") do NOT pass. But once the chain reaches "I couldn't provide for my family" or "I would have failed as a father," that IS role/relational identity — pass it. Do not require the further step of "and that means I'm unworthy" — that's imposing a self-labeling frame ITC doesn't require.

Return your judgment as three booleans plus one short reason (under 40 words) explaining what would need to change to score better if any is false.
`.trim();

const CommitmentSchema = z.object({
  is_self_protective: z.boolean(),
  is_first_person: z.boolean(),
  is_not_productivity_platitude: z.boolean(),
  reason: z.string().min(1).max(400),
});

export type CommitmentRubricResult = {
  score: 0 | 1 | 2 | 3;
  is_self_protective: boolean;
  is_first_person: boolean;
  is_not_productivity_platitude: boolean;
  reason: string;
};

const COMMITMENT_SYSTEM = `
You are a strict rubric for column-4 hidden competing commitments in an Immunity to Change map. A commitment must read as SELF-PROTECTION, not as sensible productivity advice. It should sound like the man keeping himself safe from the paired worry, not like a virtuous vow or a business-book platitude.

Score three binary criteria. When in doubt, false.

1. is_self_protective: The commitment names what he's keeping himself safe from — a protective flinch is visible. "I'm committed to never having to find out that my effort didn't matter" is self-protective. "I'm committed to always having a real plan" is not — that's a productivity platitude.

2. is_first_person: Starts with "I'm committed to" (or equivalent) and names something the man himself commits to, not a general principle, not a rule for other people, not framed as advice.

3. is_not_productivity_platitude: The commitment would sound STRANGE on a productivity blog or in a corporate meeting — a stranger reading it would think "that's a weird thing to admit," not "that's good advice." A noble-sounding vow ("I'm committed to being the best husband I can be") fails this; it's socially acceptable and doesn't reveal a hidden flinch.

Also return a one-line reason (<40 words) explaining what would need to change to raise a false criterion to true.
`.trim();

export async function scoreCommitmentDepth(input: {
  goalText: string;
  worryText: string;
  commitmentText: string;
}): Promise<CommitmentRubricResult> {
  const started = Date.now();
  let scoreForLog: number | null = null;
  try {
    const { object } = await generateObject({
      model: utilityModel(),
      schema: CommitmentSchema,
      system: COMMITMENT_SYSTEM,
      prompt: [
        `Improvement goal: ${input.goalText || "(not set)"}`,
        `Paired worry: ${input.worryText}`,
        `Proposed commitment: ${input.commitmentText}`,
      ].join("\n"),
      maxOutputTokens: 512,
      // Rubrics are classifiers, not authors. Low temperature makes
      // verdicts reproducible — same input yields same score, no
      // flakiness where the user "removes a period, hits enter, and
      // it passes." Non-zero to preserve tie-breaking on genuine
      // borderline calls.
      temperature: 0.1,
    });
    const score =
      (object.is_self_protective ? 1 : 0) +
      (object.is_first_person ? 1 : 0) +
      (object.is_not_productivity_platitude ? 1 : 0);
    scoreForLog = score;
    return {
      score: score as 0 | 1 | 2 | 3,
      is_self_protective: object.is_self_protective,
      is_first_person: object.is_first_person,
      is_not_productivity_platitude: object.is_not_productivity_platitude,
      reason: object.reason,
    };
  } finally {
    console.warn(
      "[itc timing] rubric kind=commitment ms=%d score=%s",
      Date.now() - started,
      scoreForLog === null ? "error" : `${scoreForLog}/3`,
    );
  }
}

const AssumptionSchema = z.object({
  has_finished_then: z.boolean(),
  is_first_person_felt: z.boolean(),
  lands_in_identity_or_big_time_bad: z.boolean(),
  reason: z.string().min(1).max(400),
});

export type AssumptionRubricResult = {
  score: 0 | 1 | 2 | 3;
  has_finished_then: boolean;
  is_first_person_felt: boolean;
  lands_in_identity_or_big_time_bad: boolean;
  reason: string;
};

const ASSUMPTION_SYSTEM = `
You are a strict rubric for column-4 Big Assumptions in an Immunity to Change map. A real Big Assumption is a first-person belief in if-then form whose "then" lands somewhere genuinely bad — the Big Time Bad conclusion, a contracted world. Not a forecast, not a strategy note.

Score three binary criteria. When in doubt, false.

1. has_finished_then: The assumption states "If X, then Y" and the Y half is followed through to its actual identity-level or existential end. "If I only rely on service energy, the money might not show up" is a forecast — the "then" hasn't finished. "If I only rely on service energy, then I'll fail as a provider and prove I never had it in me" has finished.

2. is_first_person_felt: First-person, present-tense, feels true when he says it. Not third-person, not abstract, not about anyone else.

3. lands_in_identity_or_big_time_bad: The "then" touches identity ("I'm the kind of man who...") or a Big Time Bad conclusion (irrecoverable failure, being seen as the thing he most dreads being). "It'd take longer" or "we'd lose the deal" doesn't land here.

Also return a one-line reason (<40 words) explaining what to extend or reframe if any is false.
`.trim();

export async function scoreAssumptionDepth(input: {
  goalText: string;
  assumptionText: string;
}): Promise<AssumptionRubricResult> {
  const started = Date.now();
  let scoreForLog: number | null = null;
  try {
    const { object } = await generateObject({
      model: utilityModel(),
      schema: AssumptionSchema,
      system: ASSUMPTION_SYSTEM,
      prompt: [
        `Improvement goal: ${input.goalText || "(not set)"}`,
        `Proposed Big Assumption: ${input.assumptionText}`,
      ].join("\n"),
      maxOutputTokens: 512,
      // Rubrics are classifiers, not authors. Low temperature makes
      // verdicts reproducible — same input yields same score, no
      // flakiness where the user "removes a period, hits enter, and
      // it passes." Non-zero to preserve tie-breaking on genuine
      // borderline calls.
      temperature: 0.1,
    });
    const score =
      (object.has_finished_then ? 1 : 0) +
      (object.is_first_person_felt ? 1 : 0) +
      (object.lands_in_identity_or_big_time_bad ? 1 : 0);
    scoreForLog = score;
    return {
      score: score as 0 | 1 | 2 | 3,
      has_finished_then: object.has_finished_then,
      is_first_person_felt: object.is_first_person_felt,
      lands_in_identity_or_big_time_bad: object.lands_in_identity_or_big_time_bad,
      reason: object.reason,
    };
  } finally {
    console.warn(
      "[itc timing] rubric kind=assumption ms=%d score=%s",
      Date.now() - started,
      scoreForLog === null ? "error" : `${scoreForLog}/3`,
    );
  }
}

const BehaviorSchema = z.object({
  is_concrete_observable: z.boolean(),
  works_against_goal: z.boolean(),
  is_first_person_action_not_aspiration: z.boolean(),
  reason: z.string().min(1).max(400),
});

export type BehaviorRubricResult = {
  score: 0 | 1 | 2 | 3;
  is_concrete_observable: boolean;
  works_against_goal: boolean;
  is_first_person_action_not_aspiration: boolean;
  reason: string;
};

const BEHAVIOR_SYSTEM = `
You are a strict rubric for column-2 behaviors in an Immunity to Change map. A real Column 2 entry is a concrete, observable move the coachee himself makes (or fails to make) in the moments that pull him away from his Column 1 goal. Not a feeling, not an identity claim, not aspiration, not something someone else does.

Score three binary criteria. When in doubt, false.

1. is_concrete_observable: A friend on his shoulder could point at this in the moment it happens. Specific, not a vague verb. "I stop talking and look at my phone" passes. "I withdraw" / "I shut down" / "I get defensive" fail — vague on their own. "I feel anxious" fails — that's an inner state, not an observable action.

2. works_against_goal: This move CLEARLY pulls him away from his stated Column 1 goal in the moment it happens. The connection is obvious in one sentence. If explaining the link takes a paragraph, false. General "bad things he does" that don't tie to THIS goal fail.

3. is_first_person_action_not_aspiration: It's what HE actually does or fails to do (present tense), not what he wishes he did, not what he plans to do, not an identity label about himself, not something the other person does. "I need to be more patient" / "I should listen better" / "I want to stop yelling" all fail (aspiration). "I'm a bad listener" / "I'm distant with her" fail (identity claims). "She doesn't respect me" fails (other person). "I don't ask what she needs" passes (first-person not-doing).

Also return a one-line reason (<40 words) explaining what would need to change to raise a failing criterion.
`.trim();

export async function scoreBehaviorDepth(input: {
  goalText: string;
  behaviorText: string;
}): Promise<BehaviorRubricResult> {
  const started = Date.now();
  let scoreForLog: number | null = null;
  try {
    const { object } = await generateObject({
      model: utilityModel(),
      schema: BehaviorSchema,
      system: BEHAVIOR_SYSTEM,
      prompt: [
        `Improvement goal: ${input.goalText || "(not set)"}`,
        `Proposed behavior: ${input.behaviorText}`,
      ].join("\n"),
      maxOutputTokens: 512,
      // Rubrics are classifiers, not authors. Low temperature makes
      // verdicts reproducible — same input yields same score, no
      // flakiness where the user "removes a period, hits enter, and
      // it passes." Non-zero to preserve tie-breaking on genuine
      // borderline calls.
      temperature: 0.1,
    });
    const score =
      (object.is_concrete_observable ? 1 : 0) +
      (object.works_against_goal ? 1 : 0) +
      (object.is_first_person_action_not_aspiration ? 1 : 0);
    scoreForLog = score;
    return {
      score: score as 0 | 1 | 2 | 3,
      is_concrete_observable: object.is_concrete_observable,
      works_against_goal: object.works_against_goal,
      is_first_person_action_not_aspiration:
        object.is_first_person_action_not_aspiration,
      reason: object.reason,
    };
  } finally {
    console.warn(
      "[itc timing] rubric kind=behavior ms=%d score=%s",
      Date.now() - started,
      scoreForLog === null ? "error" : `${scoreForLog}/3`,
    );
  }
}

export async function scoreWorryDepth(input: {
  goalText: string;
  behaviorText: string;
  worryText: string;
}): Promise<WorryDepthResult> {
  const started = Date.now();
  let scoreForLog: number | null = null;
  try {
    const { object } = await generateObject({
      model: utilityModel(),
      schema: RubricSchema,
      system: SYSTEM,
      prompt: [
        `Improvement goal: ${input.goalText || "(not set)"}`,
        `Behavior it pairs to: ${input.behaviorText}`,
        `Proposed worry: ${input.worryText}`,
      ].join("\n"),
      maxOutputTokens: 512,
      // Rubrics are classifiers, not authors. Low temperature makes
      // verdicts reproducible — same input yields same score, no
      // flakiness where the user "removes a period, hits enter, and
      // it passes." Non-zero to preserve tie-breaking on genuine
      // borderline calls.
      temperature: 0.1,
    });

    const score =
      (object.is_fear ? 1 : 0) +
      (object.is_first_person_felt ? 1 : 0) +
      (object.touches_identity ? 1 : 0);
    scoreForLog = score;

    return {
      score: score as 0 | 1 | 2 | 3,
      is_fear: object.is_fear,
      is_first_person_felt: object.is_first_person_felt,
      touches_identity: object.touches_identity,
      reason: object.reason,
    };
  } finally {
    console.warn(
      "[itc timing] rubric kind=worry ms=%d score=%s",
      Date.now() - started,
      scoreForLog === null ? "error" : `${scoreForLog}/3`,
    );
  }
}

// -------------------------------------------------------------------------
// Logical-consistency verifiers — the second model in the two-model split
// -------------------------------------------------------------------------
//
// Depth rubrics answer "is this deep enough?" These verifiers answer a
// different question: "does the identity landing make LOGICAL SENSE
// given what the opposite move would reveal?"
//
// Observed failure (worry drafter): behavior = "I walk out of the room",
// drafter produced worry = "if I stayed and heard her out, I'd have to
// see I'm the man who abandons her." That's inverted — staying is not
// abandoning. The identity landing describes the CURRENT behavior's
// identity, not what STAYING would reveal. Depth rubric passes it (it's
// felt, first-person, touches identity) but the logic is broken.
//
// Same shape one column downstream in the assumption drafter:
// "if I stay, then I'm the man who can't even run away when it matters."
// Staying is the opposite of running.
//
// These verifiers explicitly compare (current, opposite, revealed) and
// flag when `revealed` conflates with `current` instead of describing
// what `opposite` would expose. Runs after assemble+trim, before
// persisting. On fail, feeds `reason` into the same drafter-retry loop
// that the depth rubric feeds. Two-model pattern: drafter drafts,
// verifier verifies; both live server-side.

const ConsistencySchema = z.object({
  consistent: z.boolean(),
  reason: z.string().min(1).max(300),
});

export type ConsistencyResult = {
  consistent: boolean;
  reason: string;
};

/**
 * Deterministic replacement for the earlier LLM-based worry-consistency
 * verifier. The LLM verifier was fragile — asking Haiku to detect
 * subtle semantic inversion is a judgment call, and the model kept
 * reading bare present-tense identity claims two valid ways
 * ("I'm the husband who weaponizes" could mean current-state or
 * revealed-pattern depending on generous reading).
 *
 * The concrete failure mode is syntactic, not semantic: the drafter
 * produces bare present-tense "I'm the [X-er]" that reads as the
 * opposite_move creating the X-er identity. That's impossible — Y is
 * the opposite of X, Y cannot create X's identity.
 *
 * The fix is a mechanical check for revealer-framing markers. The
 * identity landing must contain at least ONE marker indicating the
 * identity is presented as pre-existing pattern being witnessed /
 * revealed:
 *
 *   - Past-perfect first-person: "I've" (been, never, kept, etc.)
 *   - External witness: "she'd", "he'd", "they'd", "she'll", "she would"
 *   - Truth-frame: "the truth" (would come out / is)
 *   - Denial-of-hiding: "couldn't pretend/hide/deny"
 *
 * Zero LLM cost. Fully deterministic. Same outcome contract as the
 * previous LLM verifier ({ consistent, reason }) so the drafter's
 * existing retry loop consumes it unchanged. If it fails, the reason
 * gives the drafter the specific pattern it violated and the whitelist
 * to try instead.
 */
const WORRY_REVEALER_MARKERS: RegExp[] = [
  // Past-perfect construction with any subject (contracted or full form).
  // Catches "I've been", "who's been", "he's been", "she's been",
  // "there's been", "we've been", "you've been".
  /['\u2019](s|ve)\s+been\b/i,
  /\b(has|have|had)\s+been\b/i,
  // Past-perfect negations
  /['\u2019](s|ve)\s+never\b/i,
  /\b(has|have|had)\s+never\b/i,
  // Simple past that names an event-level reveal ("I knew the truth and lied")
  /\bi\s+(knew|lied|chose|failed|hid|walked|left|ignored)\b/i,
  // External witness contractions + full form: she/he/they + would/will
  /\bshe['\u2019]d\b/i,
  /\bhe['\u2019]d\b/i,
  /\bthey['\u2019]d\b/i,
  /\bshe['\u2019]ll\b/i,
  /\bshe\s+would\b/i,
  /\bthey\s+would\b/i,
  /\bmy\s+(wife|kids|family)\s+would\b/i,
  // Truth-frame
  /\bthe\s+truth\b/i,
  // Denial-of-hiding (the current behavior no longer works to hide)
  /\bcouldn['\u2019]t\s+(pretend|hide|deny)\b/i,
];

/**
 * Interior-witness scaffolding patterns that must NOT appear in
 * identity_landing regardless of whether a revealer marker is present.
 * Observed failure: drafter reaches for "I'd have to admit I've been
 * running" — the past-perfect passes the whitelist but "I'd have to
 * admit" is exactly the interior-witness verb the voice rules ban.
 * Stripping "I'd have to admit" leaves "I've been running" which is
 * perfect. So the blacklist is a strip-this-scaffolding directive to
 * the drafter, not a reveal-check.
 */
const WORRY_INTERIOR_SCAFFOLDING_BANS: Array<{
  pattern: RegExp;
  label: string;
}> = [
  {
    pattern: /\bi['\u2019]d\s+have\s+to\s+(see|face|feel|know|admit|be|become)\b/i,
    label:
      "interior-witness scaffolding 'I'd have to see/face/feel/know/admit/be/become'",
  },
  {
    pattern: /\badmit\s+to\s+myself\b/i,
    label: "'admit to myself' (banned in voice rules)",
  },
];

/**
 * Kegan-canonical identity-landing markers. Drawn verbatim from the
 * Coach's Guide Vol 1 pp 13-14 and p 27, which enumerate valid
 * Column-3 identity landing shapes:
 *
 *   - Role/relational noun claim ("the husband who X", "someone who
 *     let people down") — Vol 1 p 14.
 *   - Self-label ("I'd be a fraud", "not enough", "the kind of
 *     husband who chose ego over her") — Vol 1 p 14.
 *   - "Seen as" / "looking like" / "appeared like" — Vol 1 p 13,
 *     p 27. These are Kegan's own operative vocabulary for the
 *     external-witness frame.
 *   - Role failure named by a role-implicating relational verb
 *     ("failed her", "let her down", "chose myself over her",
 *     "abandoned her", "hurt her", "brought dishonor to my family").
 *     Vol 1 p 14 and p 27.
 *
 * If none of these markers is present, the landing is likely a
 * STRATEGY description ("using her mistakes to avoid hearing mine"),
 * not an identity landing. Strategy descriptions preserve some yuck
 * but fail Kegan's identity-rung bar (p 13: "keeping the yuk in it
 * from the fear box"; p 27: "avoid being/looking like someone").
 * Retry with feedback pointing at the four valid categories.
 */
const WORRY_IDENTITY_MARKERS: RegExp[] = [
  // Role/relational noun — Vol 1 p 14 shape
  /\b(the|a)\s+(husband|wife|father|dad|mother|mom|man|woman|guy|gal|person|kind|type|one|someone|somebody|parent|partner|spouse|son|daughter|brother|sister)\b/i,
  // Self-label — Vol 1 p 14 shape
  /\b(a|the)\s+(fraud|fake|phony|coward|failure|liar|loser|monster|villain|cheat|hypocrite|fool|weakling)\b/i,
  /\bnot\s+(enough|good\s+enough|worthy|the\s+\w+|a\s+real|a\s+true)\b/i,
  // "Seen as" / "looking like" / "appeared like" — Vol 1 p 13, p 27
  /\bseen\s+as\b/i,
  /\bbe\s+seen\b/i,
  /\bappeared?\s+(as|like)\b/i,
  /\blooking\s+like\b/i,
  /\blook\s+like\b/i,
  // Role failure — Vol 1 p 14, p 27
  /\bfailed\s+(as|her|him|them|my|the|at)\b/i,
  /\blet\s+(her|him|them|down|my)\b/i,
  /\bbrought\s+dishonor\b/i,
  // Self-over-other pattern (any verb tense: chose/choosing/chosen,
  // put/putting, picked/picking) — matches the semantic "putting
  // myself ahead of her" that Kegan p 14 names as canonical role
  // failure ("chose ego over her"). Decoupled from verb so tense
  // doesn't matter.
  /\b(myself|me)\s+(over|before|ahead\s+of)\s+(her|him|them|my)\b/i,
  /\babandon(ed|ing)?\s+(her|him|them|my)\b/i,
  /\bbetray(ed|ing)?\s+(her|him|them|my)\b/i,
  /\bhurt(ing)?\s+(her|him|them|my)\b/i,
  /\bdisappoint(ed|ing)?\s+(her|him|them|my)\b/i,
  /\bneglect(ed|ing)?\s+(her|him|them|my)\b/i,
  /\bignor(ed|ing)\s+(her|him|them|my)\b/i,
  // Relational-role verbs directed at a person (any tense + "from/on
  // her/him/them")
  /\b(running|walking\s+out|hiding|checking\s+out|shutting\s+down|shutting\s+her\s+out)\s+(from|on)\s+(her|him|them|my)\b/i,
];

export function checkWorryLogicalConsistency(input: {
  behaviorText: string;
  oppositeMove: string;
  identityLanding: string;
}): ConsistencyResult {
  // Layer 1: interior scaffolding blacklist. "I'd have to admit
  // I've been running" has the "I've been" marker but the "I'd have
  // to admit" scaffolding is exactly what the voice rules ban.
  for (const ban of WORRY_INTERIOR_SCAFFOLDING_BANS) {
    if (ban.pattern.test(input.identityLanding)) {
      return {
        consistent: false,
        reason: `Identity landing contains ${ban.label}. Strip the interior verb and let the reveal stand alone (e.g., "she'd see I've been X" or "I've been the man who X" — no "I'd have to admit/see/face/feel").`,
      };
    }
  }

  // Layer 2: past-tense revealer whitelist. Catches bare
  // present-tense "I'm the [X-er]" / "I'm a [X]" inversions.
  const hasRevealerMarker = WORRY_REVEALER_MARKERS.some((re) =>
    re.test(input.identityLanding),
  );
  if (!hasRevealerMarker) {
    return {
      consistent: false,
      reason:
        "Identity landing lacks a past-tense revealer marker. Rewrite so it presents the identity as a pre-existing pattern being witnessed or revealed. Use one of: \"I've been [X]\", \"she'd see I've been [X]\", \"she'd realize [X]\", \"the truth would come out that [X]\", \"couldn't pretend anymore that [X]\". NOT bare present-tense \"I'm the [X-er]\" / \"I'm a [X]\".",
    };
  }

  // Layer 3: identity-rung whitelist. Catches strategy-level
  // landings ("using her mistakes to avoid hearing mine") that
  // preserve some yuck but don't reach role/self-label/seen-as
  // identity per Kegan Vol 1 pp 13-14, p 27.
  const hasIdentityMarker = WORRY_IDENTITY_MARKERS.some((re) =>
    re.test(input.identityLanding),
  );
  if (!hasIdentityMarker) {
    return {
      consistent: false,
      reason:
        "Identity landing describes a strategy or maneuver, not an identity. Per Kegan/Lahey Vol 1 pp 13-14 and p 27, Column-3 landings must reach one of four canonical shapes: (a) a role/relational noun claim (\"she'd see I've been the husband who never let a word she said land\"), (b) a self-label (\"she'd know I'm a fraud\", \"the truth would come out that I've never been enough\"), (c) a \"seen as\" / \"looking like\" framing (\"she'd have seen me as the man who chose ego over her\"), or (d) an explicit role-failure verb toward her/him/them (\"she'd see I've been choosing myself over her\", \"I've been the man who let her down all along\"). Rewrite so the landing names WHO he'd be judged as, not the tactical maneuver he's been running.",
    };
  }

  return {
    consistent: true,
    reason:
      "past-tense revealer + identity-rung markers detected (Kegan-canonical shape)",
  };
}

/**
 * Deterministic consistency check for Big Assumption drafts. Same
 * shape as the worry check — requires past-tense / witnessed /
 * truth-frame framing on the consequent_identity slot so bare
 * present-tense "the man who X" inversions are caught mechanically.
 *
 * The BEHAVIORAL invariant (antecedent_act cannot create the identity
 * of its own opposite) is enforced by requiring the revealer marker.
 * If consequent_identity uses "I've been" / "she'd see" / "the truth
 * would come out", it's presenting a pre-existing pattern that
 * antecedent_act would expose — not a state antecedent_act creates.
 */
const ASSUMPTION_REVEALER_MARKERS: RegExp[] = [
  // Past-perfect (any subject)
  /['\u2019](s|ve)\s+been\b/i,
  /\b(has|have|had)\s+been\b/i,
  // Past-perfect negations
  /['\u2019](s|ve)\s+never\b/i,
  /\b(has|have|had)\s+never\b/i,
  // Past-perfect action verbs on his identity ("who's spent years", "who's chosen")
  /\bwho['\u2019]s\s+\w+/i,
  // External witness
  /\bshe['\u2019]d\b/i,
  /\bhe['\u2019]d\b/i,
  /\bthey['\u2019]d\b/i,
  /\bshe['\u2019]ll\b/i,
  /\bshe\s+would\b/i,
  /\bmy\s+(wife|kids|family)\s+would\b/i,
  // Truth-frame
  /\bthe\s+truth\b/i,
];

export function checkAssumptionLogicalConsistency(input: {
  antecedentAct: string;
  consequentTell: string;
  consequentIdentity: string;
}): ConsistencyResult {
  const hasMarker = ASSUMPTION_REVEALER_MARKERS.some((re) =>
    re.test(input.consequentIdentity),
  );
  if (hasMarker) {
    return {
      consistent: true,
      reason: "past-tense revealer framing detected on consequent_identity",
    };
  }
  return {
    consistent: false,
    reason:
      "consequent_identity lacks past-tense revealer framing. Rewrite so it presents the identity as a pre-existing pattern the antecedent_act would REVEAL. Use one of: \"the man who's been [X]\", \"she'd see I've been [X]\", \"the truth would come out that [X]\". NOT bare present-tense \"the man who [X-verb]s\" — the antecedent is the opposite of the current behavior, so it cannot create the current behavior's identity.",
  };
}

/**
 * Deterministic consistency check for competing commitment drafts.
 * Different failure mode than worries/assumptions — commitments don't
 * have a "reveal" slot per se. What DOES fail here is:
 *
 *   1. Interior-witness verbs in protective_purpose ("so I never have
 *      to face X", "so I never have to see Y"). The commitment names
 *      what he's protecting himself from having to encounter — must
 *      be an OBSERVABLE consequence, not an internal reckoning.
 *   2. Noble-avoidance in protective_purpose ("so I never have to be
 *      the man who X"). This is the drafter's own banned frame in
 *      disguise — same identity-aversion structure, just moved from
 *      active_move to protective_purpose.
 *   3. Abstract mechanism metaphors in active_move ("keeping X loaded",
 *      "keeping one foot out the door", "before she can land it").
 *      Banned by the voice rules; must be a specific physical or
 *      verbal act.
 *
 * Blacklist check (any hit = fail) rather than whitelist because
 * "good" purposes vary widely ("so she can't call me out", "so mine
 * doesn't come up", "so she stops expecting me") — no small set of
 * required markers.
 */
const COMMITMENT_ACTIVE_MOVE_BANS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bkeeping\s+.*\b(loaded|available|ready)\b/i, label: "abstract mechanism metaphor ('keeping X loaded/available/ready')" },
  { pattern: /\bkeeping\s+one\s+foot\b/i, label: "abstract 'keeping one foot out the door' metaphor" },
  { pattern: /\bbefore\s+.*\bcan\s+land\b/i, label: "metaphorical 'before she can land it'" },
  { pattern: /\bon\s+the\s+table\b/i, label: "banned metaphor 'on the table'" },
  { pattern: /\boff\s+the\s+table\b/i, label: "banned metaphor 'off the table'" },
];

const COMMITMENT_PROTECTIVE_PURPOSE_BANS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bhave\s+to\s+face\b/i, label: "interior-witness verb 'have to face'" },
  { pattern: /\bhave\s+to\s+see\b/i, label: "interior-witness verb 'have to see' (about a self-truth)" },
  { pattern: /\bhave\s+to\s+know\b/i, label: "interior-witness verb 'have to know' (about a self-truth)" },
  { pattern: /\bhave\s+to\s+feel\b/i, label: "interior-witness verb 'have to feel' (about a self-truth)" },
  { pattern: /\bhave\s+to\s+admit\b/i, label: "interior-witness verb 'have to admit'" },
  { pattern: /\bnever\s+have\s+to\s+be\s+the\b/i, label: "noble-avoidance frame 'never have to be the [X]'" },
  { pattern: /\bnever\s+have\s+to\s+become\b/i, label: "noble-avoidance frame 'never have to become [X]'" },
  { pattern: /\bland\s+(it|the)\b/i, label: "metaphorical 'land it' / 'land the [X]'" },
];

export function checkCommitmentLogicalConsistency(input: {
  activeMove: string;
  protectivePurpose: string;
}): ConsistencyResult {
  for (const ban of COMMITMENT_ACTIVE_MOVE_BANS) {
    if (ban.pattern.test(input.activeMove)) {
      return {
        consistent: false,
        reason: `active_move contains ${ban.label}. Rewrite as a concrete physical or verbal act a bystander could witness (throwing, walking out, adding, sneaking, saying).`,
      };
    }
  }
  for (const ban of COMMITMENT_PROTECTIVE_PURPOSE_BANS) {
    if (ban.pattern.test(input.protectivePurpose)) {
      return {
        consistent: false,
        reason: `protective_purpose contains ${ban.label}. Rewrite so the purpose names an OBSERVABLE consequence (she can't call me out, mine doesn't come up, she stops expecting me) — not an interior reckoning or noble-avoidance frame.`,
      };
    }
  }
  return {
    consistent: true,
    reason: "no banned patterns detected in active_move or protective_purpose",
  };
}
