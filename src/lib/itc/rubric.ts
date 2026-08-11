import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";

/**
 * Server-side depth rubric. Prompt language alone drifted in the reviewed
 * session — the coach called practical concerns "deep." This is the
 * mechanical guard: a cheap Haiku call scores every proposed worry against
 * three binary criteria straight from the guides.
 */

const RubricSchema = z.object({
  is_fear: z.boolean(),
  is_first_person_felt: z.boolean(),
  touches_self_image: z.boolean(),
  reason: z.string().min(1).max(400),
});

export type WorryDepthResult = {
  score: 0 | 1 | 2 | 3;
  is_fear: boolean;
  is_first_person_felt: boolean;
  touches_self_image: boolean;
  reason: string;
};

const SYSTEM = `
You are a strict depth rubric for the worry-box column of an Immunity to Change map. The methodology (Kegan & Lahey) requires each worry to be a first-person felt fear that implicates how the man sees himself or dreads being seen. Practical concerns and forecasts are not enough.

You score three BINARY criteria. Be strict. When in doubt, score false.

1. is_fear: The worry is a fear — visceral, present-tense, felt. Not a practical concern, forecast, or cost/benefit calculation. "It'd be a waste of time" and "she might feel pushed" are practical. "I'm afraid I'd fail her" is a fear.

2. is_first_person_felt: The worry names something the man himself dreads, in his own body/experience. Not abstract ("relationships need trust"), not about the other person's reaction ("she'd get upset"), not third-person ("men who don't listen lose their marriages"). If he's talking about the other person's feelings instead of his own, false.

3. touches_self_image: The worry touches how he sees himself or dreads being seen — identity-level. "I'd be the kind of husband who chose ego over her" is self-image. "It'd take longer" is not.

Return your judgment as three booleans plus one short reason (under 40 words) explaining what would need to change to score better if any is false.
`.trim();

export async function scoreWorryDepth(input: {
  goalText: string;
  behaviorText: string;
  worryText: string;
}): Promise<WorryDepthResult> {
  const modelId = process.env.ITC_RUBRIC_MODEL || "claude-haiku-4-5-20251001";
  const { object } = await generateObject({
    model: anthropic(modelId),
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
    (object.touches_self_image ? 1 : 0);

  return {
    score: score as 0 | 1 | 2 | 3,
    is_fear: object.is_fear,
    is_first_person_felt: object.is_first_person_felt,
    touches_self_image: object.touches_self_image,
    reason: object.reason,
  };
}
