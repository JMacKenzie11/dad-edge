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
