import { z } from "zod";
import { generateObject } from "ai";
import { utilityModel } from "@/lib/model-config";
import type { PillarCode } from "@/lib/pillars";
import { PILLAR_BY_CODE } from "@/lib/pillars";

/**
 * Live quality gate for missions. Called from the client as the man types
 * (debounced). Uses Haiku with a rubric prompt so it's cheap and fast.
 *
 * The five criteria:
 *   Concrete      — you'll know exactly what "done" looks like
 *   Binary        — you either did it or you didn't
 *   High-Leverage — designed to move the needle, not check a box
 *   Aligned       — reinforces the man he's becoming (goal + pillar)
 *   Time-bound    — when you'll do it is clearly defined
 *
 * Each scored 0/1/2. Total 0-10. Ready = total >= 8 AND no criterion is 0.
 */

export const CRITERIA = ["concrete", "binary", "leverage", "aligned", "time_bound"] as const;
export type Criterion = (typeof CRITERIA)[number];

const SchemaZ = z.object({
  scores: z.object({
    concrete: z.number().int().min(0).max(2),
    binary: z.number().int().min(0).max(2),
    leverage: z.number().int().min(0).max(2),
    aligned: z.number().int().min(0).max(2),
    time_bound: z.number().int().min(0).max(2),
  }),
  feedback: z.string().max(280),
  rewrite: z.string().max(200).nullable(),
});

export type MissionScore = {
  scores: Record<Criterion, 0 | 1 | 2>;
  total: number;
  ready: boolean;
  feedback: string;
  rewrite: string | null;
};

const SYSTEM = `You are a mission-quality rubric for a men's coaching app. You judge the SHAPE of a mission — is the wording specific, verifiable, on-topic, and dated? You do NOT judge the man's domain choices (which exercise, which training method, which conversation topic, which business tactic). That's HIS call, not yours.

Score five criteria on a 0-2 scale and return JSON only. Be strict on shape; be silent on strategy.

- concrete    (0=vague, 1=partial, 2=specific behavior anyone could witness)
- binary      (0=fuzzy verb, 1=binary but ambiguous, 2=clearly done-or-not)
- leverage    (0=busywork with no plausible connection to the pillar, 1=plausible connection, 2=obviously in-pillar). Score based on whether the mission is IN-PILLAR at all, not whether it's the optimal path to the goal. "Lift weights 4x" for a Vitality goal is 2 (in-pillar), even if the man's specific goal is a walking goal — the choice of modality is his.
- aligned     (0=off-theme for the pillar, 1=on-theme for the pillar but doesn't obviously serve THIS goal, 2=on-theme AND obviously serves this goal). "Doesn't obviously serve this goal" is fine — 1 is a pass. Do not push the man toward a different mission because you'd program his training differently.
- time_bound  Missions are always done within a specific week and the target_date field captures the day. Score from the target_date input line:
              * target_date is set → time_bound=2
              * target_date is missing → time_bound=0
              Do NOT dock time_bound because the description says "on Wednesday" without a date. Do NOT ask "which Wednesday?" when target_date is set.

Also return:
- feedback: one short sentence. ONLY about SHAPE (concrete / binary / verifiable / dated). Never about whether the mission is the "right" training choice, the "right" conversation to have, the "right" business move. If the shape is fine, say so and stop. If a criterion is low, name what's fuzzy about the WORDING. Blue-collar, direct, no fluff.
- rewrite: only populate if concrete or binary scored 0 or 1. Propose a tightened version of the SAME mission — same activity, sharper wording (add a rep count, a distance, a duration, a specific end-state). Do NOT propose a different activity. Do NOT propose extra missions. If shape is fine, rewrite is null.

Banned in feedback and rewrite:
- Programming advice ("this builds strength, not aerobic base"; "you need Zone 2 work"; "try tempo runs instead").
- Prescriptive substitution ("do X instead"; "swap this for Y").
- Second-guessing the man's plan across missions (you see one mission at a time, not the whole week).

Allowed:
- Sharpening the wording of what he wrote.
- Naming which criterion is soft and why.`;

type ScoreInput = {
  description: string;
  pillar_code: PillarCode;
  target_date: string | null;
  goal_description: string | null;
};

export async function scoreMissionDraft(input: ScoreInput): Promise<MissionScore> {
  const desc = input.description.trim();
  if (desc.length < 3) {
    return emptyScore("Write at least a few words.");
  }

  const pillar = PILLAR_BY_CODE[input.pillar_code];
  const goalLine = input.goal_description
    ? `Goal it serves: ${input.goal_description}`
    : "Goal it serves: (unattached — should reinforce the pillar directly)";
  const dateLine = input.target_date
    ? `Target date: ${input.target_date}`
    : "Target date: (none — auto-fails Time-bound)";

  const userPrompt = `Pillar: ${pillar.label} (${input.pillar_code})
${goalLine}
${dateLine}

Mission draft:
"""
${desc}
"""

Return JSON only.`;

  try {
    const { object } = await generateObject({
      model: utilityModel(),
      schema: SchemaZ,
      system: SYSTEM,
      prompt: userPrompt,
      maxOutputTokens: 600,
    });
    const scores = object.scores as Record<Criterion, 0 | 1 | 2>;
    const total =
      scores.concrete + scores.binary + scores.leverage + scores.aligned + scores.time_bound;
    const ready = total >= 8 && Object.values(scores).every((s) => s > 0);
    return {
      scores,
      total,
      ready,
      feedback: object.feedback.trim(),
      rewrite: object.rewrite ? object.rewrite.trim() : null,
    };
  } catch (err) {
    console.error("mission quality scoring failed", err);
    return emptyScore("Quality check unavailable.");
  }
}

function emptyScore(feedback: string): MissionScore {
  return {
    scores: { concrete: 0, binary: 0, leverage: 0, aligned: 0, time_bound: 0 },
    total: 0,
    ready: false,
    feedback,
    rewrite: null,
  };
}

export const CRITERION_LABEL: Record<Criterion, string> = {
  concrete: "Concrete",
  binary: "Binary",
  leverage: "High-leverage",
  aligned: "Aligned",
  time_bound: "Time-bound",
};
