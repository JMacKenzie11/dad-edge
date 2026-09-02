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
  // Criterion 4 is extract-then-decide: the judge writes the opposite
  // move and the feared result down before it rules. Asked as one
  // inline boolean, the model rationalized confessions of the
  // behavior as fears ("standing behind your belief exposes exactly
  // that identity"). With the two lines on the page first, it doesn't.
  opposite_move: z.string().max(160),
  feared_result_of_opposite: z.string().max(240),
  feared_result_is_the_behavior_restated: z.boolean(),
  // The discriminator. "does the behavior make sense as protection?"
  // was a judgment call, and tuning it strict rejected real fears
  // while tuning it lenient passed outright contradictions. This
  // question has a determinate answer for both.
  which_produces_the_feared_result: z.enum(["the behavior", "the opposite"]),
  reason: z.string().min(1).max(400),
});

export type WorryDepthResult = {
  score: 0 | 1 | 2 | 3;
  is_fear: boolean;
  is_first_person_felt: boolean;
  touches_identity: boolean;
  /** Kegan/Lahey Appendix A, Column 3: the worry "shows why the
   *  Column 2 behaviors make good sense." False when the worry is the
   *  behavior said back as self-criticism, or when the feared result
   *  is what the BEHAVIOR produces rather than its opposite (a
   *  backwards worry: "if I held firm, they'd see me as desperate",
   *  when agreeing to bad terms is what looks desperate). Folded into
   *  touches_identity for the score: an identity that doesn't explain
   *  the behavior isn't the feared identity. */
  explains_behavior: boolean;
  reason: string;
};

const SYSTEM = `
You are a strict depth rubric for the worry-box column of an Immunity to Change map. The methodology (Kegan & Lahey) requires each worry to be a first-person felt fear that lands on identity. Practical concerns and forecasts are not enough. But "identity" comes in more than one valid shape — do NOT reject a worry that lands on role/relational identity in favor of one that lands on self-labeling.

You score four BINARY criteria. Be strict. When in doubt, score false.

1. is_fear: The worry is a fear — visceral, present-tense, felt. Not a practical concern, forecast, or cost/benefit calculation. "It'd be a waste of time" and "she might feel pushed" are practical. "I'm afraid I'd fail her" is a fear.

2. is_first_person_felt: The worry names something the man himself dreads, in his own body/experience. Not abstract ("relationships need trust"), not about the other person's reaction ("she'd get upset"), not third-person ("men who don't listen lose their marriages"). If he's talking about the other person's feelings instead of his own, false. A worry phrased as what someone else would SEE or KNOW about HIM ("she'd see I've been the husband who only cares about winning", "my team would know I've been faking it") is still his own dread about who he is; that passes. It fails only when the content is the other person's feelings or reaction instead of his identity.

3. touches_identity: The worry lands on an EXPLICITLY NAMED identity or role. Two valid shapes, both requiring a named identity noun (not just a failure event or outcome).

   (a) Self-labeling identity — a label he'd apply to himself, spoken as an identity claim. "I'm a fraud." "I'm weak." "I'm not enough." "I'd be the kind of guy who freezes." The identity noun/label must be present in the worry text.

   (b) Role/relational identity — a NAMED role rendered as "the [role] who [predicate]" (or equivalent phrasing that names a role noun). "The father who wasn't there." "The husband who chose ego over her." "The coach who talks a great game but can't deliver." "The provider who let his family down." The ROLE NOUN must appear, and a predicate must describe who he'd be SEEN AS after this behavior.

   STRICTLY REJECT the following patterns — these are FAILURE EVENTS or OUTCOMES, not identity landings:
   - "I'll have failed to [do X]" without naming WHO he'd be after that failure. ("I will have failed to really help them" — failure event, no identity noun. Would need "…and I'd be the coach who talks a great game but can't help people transform" to pass.)
   - "I'll miss / won't be able to / won't deliver [outcome Y]" — future-tense outcome without identity naming. ("I'll miss an opportunity to demonstrate the value I know I can provide" — outcome only, no named identity.)
   - "It won't be good enough / won't work / won't land" — external outcome without any identity claim about him.
   - "I'm not doing enough to [X]" — behavior/effort gap, no identity landing.
   - "I'd not be as capable / valuable as they think" — comparative, gestures at identity but doesn't name the specific identity he'd be seen as.
   - THE BEHAVIOR SAID BACK AS SELF-CRITICISM. The behavior he pairs this worry to is in the prompt. If the identity is just that behavior restated ("I've been the man who brings up her mistakes to dodge mine" when the behavior is "I bring up things she did in the past instead of listening"), score false. That's a confession of the behavior, not the fear of doing the opposite. This map turns the worry straight into "I'm also committed to never being [that identity]", so a behavior-restating worry produces a vow to stop the behavior, a noble commitment, and the immune system disappears from the map (Coach's Guide Vol 1 p 13: "did the danger to the self get lost when moving from the fear box to the 3rd column?"). The fear has to name what the behavior PROTECTS him from: who he'd be, or be seen as, if he did the opposite and it went the way he dreads. ("If I let her past rest and listened, it'd be my mistakes we were talking about, and I'd be the man who's been the problem all along" passes; the behavior makes sense under it.)

   The bar (self-check before scoring true): after reading the worry, could you finish the sentence "The identity he's afraid of being is: ___" using words FROM the worry itself, not synthesized? If you have to invent the identity or infer it, the identity isn't landed — score false. If the worry names it directly with a role noun or self-label, score true.

4. explains_behavior (Coach's Guide Vol 1, Appendix A, Column 3: the worry "shows why Column 2 behaviors make good sense" as SELF-PROTECTION). Work it in order and write each step down:
   - opposite_move: the opposite of the paired behavior (in the prompt), in his words.
   - feared_result_of_opposite: in one line, what the worry says would happen or be exposed if he did the opposite.
   - feared_result_is_the_behavior_restated: true if that feared result is the behavior itself described as a fault. "I've been the guy who never listens to anybody" for the behavior "I don't ask what the prospect needs"; "I've been choosing my reputation over serving them" for the behavior "I hedge my recommendations". A worry that accuses the behavior does not explain it.
   - which_produces_the_feared_result: is the feared result more likely to come about because he DOES the behavior, or because he does THE OPPOSITE? Only "the opposite" is a worry; "the behavior" means the worry is backwards, blaming the behavior for the very thing it protects him from.
     "the opposite": behavior "I don't ask what the client needs", feared "they'd see me as unsure". ASKING is what would look unsure; not asking hides it. A worry.
     "the opposite": behavior "I bring up things she did in the past", feared "I'd prove I'm the man who can never be enough for her". LISTENING is what would expose it; bringing up her past keeps it off the table. A worry. (The mechanism is unstated, and it doesn't need to be; take the worry's if-then at face value.)
     "the behavior": behavior "I agree to terms I know are bad just to close the deal", feared "they'd see me as desperate to keep the deal". AGREEING to bad terms is what looks desperate; holding firm is the opposite of desperate. Backwards.
     "the behavior": behavior "I oversell and pile on promises", feared "they'd think I'm pushy". OVERSELLING is what looks pushy. Backwards.
   Passing example: "if I stood behind my recommendation and it failed, I'd be the expert who got it wrong with nowhere to hide" (hedging protects him from exactly that). "if I let her past rest and listened, it'd be my mistakes we were talking about and I'd be the man who's been the problem" (bringing up her past keeps his off the table).

   Do not require the extra "and that means I'm unworthy" step for role identity — once the role and predicate are named ("the coach who couldn't help her when she needed me"), that IS identity. But bare failure verbs without a role noun ("I'd have failed to help her") don't clear the bar.

Return your judgment as three booleans plus a reason.

REASON: one sentence, spoken TO the coachee ("you", "your"), the way a coach would say it across a kitchen table. It shows in his map under the entry. Plain words, contractions, under 40 words. Name what the entry stops at and what the finished version would say. Never third person ("he", "the coachee"), never scoring words ("criterion", "rubric", "score", "passes", "fails"), never jargon ("visceral", "identity-level", "outcome-focused"), no dashes. Example: "This stops at the conversation running long. If you let her finish and she still walked away, who would that make you?"
`.trim();

const CommitmentSchema = z.object({
  is_first_person_never_vow: z.boolean(),
  mirrors_worry_identity: z.boolean(),
  is_specific_not_generic: z.boolean(),
  reason: z.string().min(1).max(400),
});

export type CommitmentRubricResult = {
  score: 0 | 1 | 2 | 3;
  is_first_person_never_vow: boolean;
  mirrors_worry_identity: boolean;
  is_specific_not_generic: boolean;
  reason: string;
};

const COMMITMENT_SYSTEM = `
You are a strict rubric for column-4 hidden competing commitments in an Immunity to Change map. This app uses the INTRODUCTORY FORM (Kegan Vol 1 pp 26-27): the paired worry's identity/outcome content is mirrored directly into an "I'm also committed to never..." vow. You score whether the commitment does that transformation correctly.

Score three binary criteria. When in doubt, false.

1. is_first_person_never_vow: The commitment starts with "I'm also committed to never" and names a first-person vow. The "also" is enforced at save time by ensureCommitmentStem in stage.ts, so you'll always see it — pass on stem shape and focus on whether the rest is a first-person "never" vow. Positive-aspiration form ("I'm committed to being the best husband") fails — that's a Column 1 goal, not a competing commitment.

2. mirrors_worry_identity: The vow names the identity or outcome the paired worry fears. Worry says "I fear being the guy who's defensive" → vow says "being the guy who's defensive" (or a clear paraphrase preserving the same identity). Worry says "I worry I'd look incompetent in front of my team" → vow says "looking incompetent in front of my team". If the commitment jumps to an identity/outcome the worry doesn't name, false.

3. is_specific_not_generic: The vow keeps the coachee's specific nouns and context. "Never being a bad husband" fails (too generic). "Never being the husband who can't let things go" passes (specific role + specific behavior). "Never failing" fails (generic). "Never failing my family as the provider" passes (specific role + specific stakes).

REASON: one sentence, spoken TO the coachee ("you", "your"), the way a coach would say it across a kitchen table. It shows in his map under the entry. Plain words, contractions, under 40 words. Name what the entry stops at and what the finished version would say. Never third person ("he", "the coachee"), never scoring words ("criterion", "rubric", "score", "passes", "fails"), never jargon ("visceral", "identity-level", "outcome-focused"), no dashes. Example: "This stops at the conversation running long. If you let her finish and she still walked away, who would that make you?"

When your reason includes an example rewrite, use the canonical stem "I'm also committed to never...". The "also" is what makes it a COMPETING commitment next to the improvement goal; dropping it turns the entry into a bare commitment that reads as if it stands alone.
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
      (object.is_first_person_never_vow ? 1 : 0) +
      (object.mirrors_worry_identity ? 1 : 0) +
      (object.is_specific_not_generic ? 1 : 0);
    scoreForLog = score;
    return {
      score: score as 0 | 1 | 2 | 3,
      is_first_person_never_vow: object.is_first_person_never_vow,
      mirrors_worry_identity: object.mirrors_worry_identity,
      is_specific_not_generic: object.is_specific_not_generic,
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
  // Same extract-then-decide shape as the worry rubric's criterion 4.
  // A Big Assumption whose "then" is what the CURRENT behavior
  // produces, rather than what the "if" act produces, is backwards.
  antecedent_act: z.string().max(160),
  consequent: z.string().max(240),
  which_produces_the_consequent: z.enum([
    "the act named in the if",
    "the opposite of that act",
  ]),
  reason: z.string().min(1).max(400),
});

export type AssumptionRubricResult = {
  score: 0 | 1 | 2 | 3;
  has_finished_then: boolean;
  is_first_person_felt: boolean;
  lands_in_identity_or_big_time_bad: boolean;
  /** The "then" is produced by the act in the "if", not by its
   *  opposite. False on a backwards assumption ("if I hold firm on
   *  the terms, then they'd see me as desperate" — caving is what
   *  looks desperate, holding firm is not). Folded into
   *  lands_in_identity_or_big_time_bad for the score: an ending the
   *  antecedent could not produce is not this belief's Big Time Bad. */
  consequent_follows: boolean;
  reason: string;
};

const ASSUMPTION_SYSTEM = `
You are a strict rubric for column-4 Big Assumptions in an Immunity to Change map. A real Big Assumption is a first-person belief in if-then form whose "then" lands somewhere genuinely bad — the Big Time Bad conclusion, a contracted world. Not a forecast, not a strategy note.

Score three binary criteria. When in doubt, false.

1. has_finished_then: The assumption states "If X, then Y" and the Y half is followed through to its actual identity-level or existential end. "If I only rely on service energy, the money might not show up" is a forecast — the "then" hasn't finished. "If I only rely on service energy, then I'll fail as a provider and prove I never had it in me" has finished.

2. is_first_person_felt: First-person, present-tense, feels true when he says it. Not third-person, not abstract, not about anyone else.

4. Whether the "then" actually follows from the "if". Work it in order and write each step down:
   - antecedent_act: the act named in the "if", in his words.
   - consequent: what the "then" says would happen or be true.
   - which_produces_the_consequent: read the "then" as one chain — he does the act, it goes the way he dreads, and THEN this. Ask whether that chain is coherent, not whether every word of it is directly caused by the act. Answer "the opposite of that act" ONLY when the consequent is plainly what his OTHER, current behavior produces. When the chain hangs together, answer "the act named in the if".
     "the act named in the if": "if I let the work speak instead of chasing prospects, then the money wouldn't come and I'd be the passive provider". Letting the work speak is what risks the money not coming. Valid.
     "the act named in the if": "if I hold firm on the terms, then they'd walk and I'd be the guy who can't close without giving it away". Holding firm is what risks them walking, and failing that way is what would prove the label. Valid. Do NOT mark this backwards on the reasoning that "giving it away" is the other behavior; the label is what the FAILURE of the act would prove.
     "the opposite of that act": "if I hold firm on the terms, then they'd see me as desperate". CAVING on terms is what looks desperate; holding firm cannot produce that impression. Backwards.
     "the opposite of that act": "if I stopped rewriting the message ten times, then they'd think I fuss over every word". FUSSING is what the rewriting produces, not what stopping produces. Backwards.

3. lands_in_identity_or_big_time_bad: The "then" names an identity ("I'd be the coach who talked a great game and couldn't deliver", "I'm the kind of man who...", "the fraud") or a Big Time Bad conclusion that can't be recovered from ("I can't be trusted when the people who depend on me need me most"). "It'd take longer" or "we'd lose the deal" doesn't land here.

   STRICTLY REJECT these, the same way the worry rubric does. They gesture at identity without naming it:
   - Comparative hedges: "I may not be as capable / valuable as they think", "I'm not as good as they believe", "I might not be enough for them". The hedge ("may", "might", "not as … as") is the immune system softening it. Would need the named identity ("I'd be the fraud who's been talking a great game").
   - Bare failure events: "I have failed at the thing I claim to be great at", "I'll have failed to help them", "it won't have worked". Failure is an event; who he'd be after it is the identity. Would need "…and I'd be the coach who talked a great game but couldn't help them transform".
   - Outcomes about others with no landing on him: "they'll leave", "she'd be upset", "the deal falls through".

   Self-check before scoring true: can you finish "the identity he's afraid of being is: ___" using words FROM the "then" itself? If you have to infer it, score false.

REASON: one sentence, spoken TO the coachee ("you", "your"), the way a coach would say it across a kitchen table. It shows in his map under the entry. Plain words, contractions, under 40 words. Name what the entry stops at and what the finished version would say. Never third person ("he", "the coachee"), never scoring words ("criterion", "rubric", "score", "passes", "fails"), never jargon ("visceral", "identity-level", "outcome-focused"), no dashes. Example: "This stops at the conversation running long. If you let her finish and she still walked away, who would that make you?"
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
    const consequentFollows =
      object.which_produces_the_consequent === "the act named in the if";
    const score =
      (object.has_finished_then ? 1 : 0) +
      (object.is_first_person_felt ? 1 : 0) +
      // An ending the antecedent could not produce is not this
      // belief's Big Time Bad. Score stays 0-3 so every gate keeps
      // its meaning.
      (object.lands_in_identity_or_big_time_bad && consequentFollows ? 1 : 0);
    scoreForLog = score;
    return {
      score: score as 0 | 1 | 2 | 3,
      has_finished_then: object.has_finished_then,
      is_first_person_felt: object.is_first_person_felt,
      lands_in_identity_or_big_time_bad:
        object.lands_in_identity_or_big_time_bad && consequentFollows,
      consequent_follows: consequentFollows,
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

REASON: one sentence, spoken TO the coachee ("you", "your"), the way a coach would say it across a kitchen table. It shows in his map under the entry. Plain words, contractions, under 40 words. Name what the entry stops at and what the finished version would say. Never third person ("he", "the coachee"), never scoring words ("criterion", "rubric", "score", "passes", "fails"), never jargon ("visceral", "identity-level", "outcome-focused"), no dashes. Example: "This stops at the conversation running long. If you let her finish and she still walked away, who would that make you?"
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

    const explainsBehavior =
      object.which_produces_the_feared_result === "the opposite" &&
      !object.feared_result_is_the_behavior_restated;
    const score =
      (object.is_fear ? 1 : 0) +
      (object.is_first_person_felt ? 1 : 0) +
      // An identity that doesn't explain the behavior isn't the feared
      // identity (Appendix A, Column 3). The score stays 0–3 so every
      // gate and threshold in the app keeps its meaning.
      (object.touches_identity && explainsBehavior ? 1 : 0);
    scoreForLog = score;

    return {
      score: score as 0 | 1 | 2 | 3,
      is_fear: object.is_fear,
      is_first_person_felt: object.is_first_person_felt,
      touches_identity: object.touches_identity && explainsBehavior,
      explains_behavior: explainsBehavior,
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
 * verifier. Two layers: interior scaffolding (banned verbs) and framing
 * (exposure or consequence, never bare present tense). The LLM verifier was fragile — asking Haiku to detect
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
  // CONSEQUENCE framing (Kegan Vol 1 p 13, "seen as incompetent"):
  // who he'd be, or be seen as, if the opposite went the way he
  // dreads. "I'd be the expert who got it wrong", "I'd end up the guy
  // selling what nobody asked for", "I'd have proven I can't deliver".
  // Added 2026-09-01: requiring only revealer framing forced every
  // draft into "I've been the guy who…", which on a work map
  // degenerates into the behavior said back. The behavior-said-back
  // inversion is now caught semantically by scoreWorryDepth.
  /\bi['\u2019]d\s+(?:be|become|end\s+up|turn\s+out|come\s+off|look)\b/i,
  /\bi['\u2019]d\s+have\s+(?:proven|proved|shown|become)\b/i,
  /\bi\s+would\s+(?:be|become|have\s+proven)\b/i,
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
 * The identity-rung whitelist that used to sit here as "layer 3"
 * (role nouns, self-labels, seen-as, role-failure verbs) was removed
 * 2026-09-01. It was a hand-rolled approximation of the rubric's own
 * touches_identity criterion, and it refused landings the rubric
 * scores 3/3 ("they'd have seen me as someone who doesn't belong in
 * this room"). One judge for "is this an identity": scoreWorryDepth.
 */

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
        "Identity landing is bare present tense. Frame it as what the counter-move would EXPOSE (\"I've been [X]\", \"they'd see I've been [X]\", \"the truth would come out that [X]\") or as its CONSEQUENCE (\"I'd be the [role] who [X]\", \"I'd be seen as [X]\", \"I'd have proven [X]\"). NOT bare present-tense \"I'm the [X-er]\" / \"I'm a [X]\".",
    };
  }

  // Whether the landing reaches the identity rung is the rubric's
  // call (scoreWorryDepth.touches_identity), not a regex's.
  return {
    consistent: true,
    reason: "exposure or consequence framing detected (Kegan-canonical shape)",
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

// `checkCommitmentLogicalConsistency` and its blacklist/through-line
// machinery were removed with the switch to the introductory
// commitment form (Kegan Vol 1 pp 26-27). The introductory form is a
// text transformation of the paired worry — there's no adjacent-
// mechanism drift to guard against and no "protective_purpose" slot
// where interior-witness verbs could leak. Depth rubric alone is the
// verifier now. If drift patterns re-emerge, add back with shape
// matching the new single-slot vow (not the old two-slot mechanism).
