import { z } from "zod";
import { generateObject } from "ai";
import { haikuModel } from "@/lib/coach/client";
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

const SYSTEM = `You are a mission-quality rubric for a men's coaching app. Score a proposed mission on the five criteria below and return JSON only. Be strict — false-positive "ready" missions are worse than false-negative.

Rubric (each 0, 1, or 2):
- concrete    (0=vague, 1=partial, 2=specific behavior anyone could witness)
- binary      (0=fuzzy verb, 1=binary but ambiguous, 2=clearly done-or-not)
- leverage    (0=busywork, 1=useful, 2=moves the needle in the pillar)
- aligned     (0=off-theme, 1=fine, 2=directly serves the man's goal + pillar)
- time_bound  (0=no day, 1=fuzzy timing, 2=specific day / time / count is baked in)

Also return:
- feedback: one short sentence of coaching (blue-collar, direct, no fluff)
- rewrite: if the mission is under 8/10 or any criterion is 0, propose a tightened version (verb + observable behavior + day); otherwise null.`;

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
      model: haikuModel(),
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
