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

type JudgeContext = {
  actionType?: string | null;
};

async function judgeWith(
  system: string,
  replyText: string,
  ctx: JudgeContext = {},
): Promise<JudgeResult> {
  const contextLine = ctx.actionType
    ? `\n[Context: alongside this reply, the coach fired action type "${ctx.actionType}". A present-tense claim like "Locked" or "Done" is legitimate if the corresponding action fired.]\n`
    : "";
  const { object } = await generateObject({
    model: anthropic(JUDGE_MODEL),
    schema: JudgeSchema,
    system,
    prompt: `${contextLine}Reply to judge:\n\n${replyText}`,
    maxOutputTokens: 400,
  });
  return object;
}

/**
 * Passes if the reply does NOT contain unearned praise about the coachee's
 * answer ("brave", "vulnerable", "raw", "hard to say", "thank you for
 * sharing", etc.). Calibrated acknowledgment ("that's the fear") passes.
 */
export function judgeNoUnearnedPraise(
  replyText: string,
  ctx: JudgeContext = {},
): Promise<JudgeResult> {
  return judgeWith(
    `
You are a strict rubric checking whether an ITC coach's reply contains UNEARNED PRAISE — words that flatter the coachee for what they've said. Unearned praise closes the excavation.

Return passes=false ONLY if the reply contains explicit praise words: "deep", "brave", "vulnerable", "raw", "hard to say", "important", "profound", "powerful", "beautiful", "insightful", "impressive", or says "that took courage", "thank you for sharing", "that's incredible", "so good", "well done", or similar direct praise. Look for the actual words.

Return passes=true for:
- Calibrated reflection ("that's the fear", "I heard that", "you said X")
- Pushback or correction ("hold on", "that's not the fear yet", "feeling terrible and being exposed aren't the same thing")
- Acknowledgment without praise ("noted", "okay", "got it")
- Any observation of what the coachee said that doesn't include a praise word

Do NOT infer praise from "the framing" or "the tone" or "the acknowledgment style" — only flag when explicit praise words are present. Return one short reason explaining what you saw.
    `.trim(),
    replyText,
    ctx,
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
  ctx: JudgeContext = {},
): Promise<JudgeResult> {
  return judgeWith(
    `
You are a strict rubric checking whether an ITC coach's reply projects a SELF-LABELING identity frame onto the coachee ("I'm not enough", "I'm weak", "I'm unworthy") when the coachee has not offered that framing. ITC accepts both self-labeling identity AND role/relational identity ("failed my family as a provider") as valid depth. The failure mode is imposing self-labeling when the coachee already landed on or prefers a different valid frame.

Return passes=false if the reply asks questions like "does that mean you're not enough?" or "what does that make you as a man?" in a way that presupposes the answer is a self-judgment label. Return passes=true if the reply asks a shape-neutral open question ("what does that mean?" without presupposing the shape) or acknowledges the coachee's own framing.
    `.trim(),
    replyText,
    ctx,
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
  ctx: JudgeContext = {},
): Promise<JudgeResult> {
  return judgeWith(
    `
You are a strict rubric checking whether an ITC coach's reply contains DANGLING PROMISES or PRESENT-TENSE LIES ABOUT WHAT THE COACH HAS DONE. Two failure modes to catch:

1. Future-tense from the COACH about themselves: "I'll draft one for each", "let me put together...", "next I'll show you...", "I'll come back with..." — WITHOUT actually delivering the drafted content, list, or thing in the same message. If the coach promises to do X and doesn't do X in the same reply, fail.

2. Present-tense claims BY THE COACH about a state change: "Locking these in", "Locked", "Done", "Saved", "Added to the map" — WITHOUT the corresponding concrete content visible in the reply that would justify the claim. If the reply says "Locked" without any actual locked content, fail.

IMPORTANT — DO NOT flag:
- Instructions to the COACHEE ("read each and say 'lock them in' when ready", "tell me if any don't fit"). These are prompts to the coachee, not promises from the coach.
- Meta-instructions that describe the next step the COACHEE will take.
- Content that IS delivered in the same message. If the coach says "here's a draft for each:" and then provides a numbered list of drafts, that's fulfilled — pass.
- Reflection or acknowledgment that references future work without promising to do it now ("we'll come back to that at column 4", "that's for testing later").
- OFFERS conditional on the coachee's choice. "Want me to draft one for you?" or "if you want, I can draft a candidate" is an offer — the coach is asking permission, not promising. Only flag if the coach commits unconditionally ("I'll draft one for each" without doing it) AND fails to deliver in the same message.

Focus only on whether the COACH announced a step and then failed to do it themselves in this same message. Return passes=true if the reply is self-consistent (announcements matched by delivered content). Return passes=false with a short reason naming the specific unfulfilled promise from the coach.
    `.trim(),
    replyText,
    ctx,
  );
}
