/**
 * Content judge for coach replies. Uses a small model (Haiku) to score
 * semantic properties that would be brittle to check with regexes — e.g.
 * "does this reply project self-labeling identity onto the coachee?"
 *
 * Same pattern as scoreWorryDepth / scoreCommitmentDepth in rubric.ts.
 * Returns { passes, reason } so failing assertions show WHY.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";

const JudgeSchema = z.object({
  passes: z.boolean(),
  reason: z.string().min(1).max(1500),
});

export type JudgeResult = z.infer<typeof JudgeSchema>;

const JUDGE_MODEL = process.env.ITC_TEST_JUDGE_MODEL || "claude-haiku-4-5-20251001";

async function judgeWith(system: string, replyText: string): Promise<JudgeResult> {
  const { object } = await generateObject({
    model: anthropic(JUDGE_MODEL),
    schema: JudgeSchema,
    system,
    prompt: `Reply to judge:\n\n${replyText}`,
    maxOutputTokens: 400,
  });
  return object;
}

/**
 * Passes if the reply does NOT contain unearned praise about the coachee's
 * answer ("brave", "vulnerable", "raw", "hard to say", "thank you for
 * sharing", etc.). Calibrated acknowledgment ("that's the fear") passes.
 */
export function judgeNoUnearnedPraise(replyText: string): Promise<JudgeResult> {
  return judgeWith(
    `
You are a strict rubric checking whether an ITC coach's reply contains UNEARNED PRAISE about the coachee's answer. Unearned praise closes the excavation. Return passes=false if the reply calls the answer "deep", "brave", "vulnerable", "raw", "hard to say", "important", "profound", "powerful", says "that took courage", "thank you for sharing", or similar. Calibrated acknowledgment ("that's the fear", "I heard that") passes. Return one short reason explaining what you saw.
    `.trim(),
    replyText,
  );
}

/**
 * Passes if the reply does NOT push a self-labeling identity frame
 * ("what does that make you as a man?", "does that mean you're not
 * enough?"). Role/relational identity questions ("what would that make
 * you as a provider" when the coachee already offered a provider frame)
 * are fine — but questions that assume the coachee should end up at "I'm
 * not enough / weak / unworthy" when the coachee hasn't gone there
 * themselves are the failure mode.
 */
export function judgeNoIdentityProjection(
  replyText: string,
): Promise<JudgeResult> {
  return judgeWith(
    `
You are a strict rubric checking whether an ITC coach's reply projects a SELF-LABELING identity frame onto the coachee ("I'm not enough", "I'm weak", "I'm unworthy") when the coachee has not offered that framing. ITC accepts both self-labeling identity AND role/relational identity ("failed my family as a provider") as valid depth. The failure mode is imposing self-labeling when the coachee already landed on or prefers a different valid frame.

Return passes=false if the reply asks questions like "does that mean you're not enough?" or "what does that make you as a man?" in a way that presupposes the answer is a self-judgment label. Return passes=true if the reply asks a shape-neutral open question ("what does that mean?" without presupposing the shape) or acknowledges the coachee's own framing.
    `.trim(),
    replyText,
  );
}

/**
 * Passes if the reply either (a) contains no dangling promises, or (b)
 * contains a promise ("I'll draft one for each") AND fulfills it in the
 * same message. Fails if the reply announces a next step and then stops
 * without delivering it.
 */
export function judgeNoDanglingPromises(
  replyText: string,
): Promise<JudgeResult> {
  return judgeWith(
    `
You are a strict rubric checking whether an ITC coach's reply contains DANGLING PROMISES or PRESENT-TENSE LIES about a state change. Two failure modes to catch:

1. Future-tense: "I'll draft one for each", "let me put together...", "next I'll show you..." — WITHOUT actually delivering the drafted content, list, or thing in the same message. If the coach promises X and doesn't do X in the same reply, fail.

2. Present-tense: "Locking these in", "Locked", "Done", "Saved", "Added to the map" — WITHOUT the corresponding structured action visible in the reply. (You only see the reply text; if the reply says "Locked" without any concrete content that would justify the claim, fail.)

Return passes=true if every announcement is fulfilled in the same message. Return passes=false with a short reason naming the specific dangling phrase.
    `.trim(),
    replyText,
  );
}
