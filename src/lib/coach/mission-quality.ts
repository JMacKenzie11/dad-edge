import { z } from "zod";
import { generateObject } from "ai";
import { utilityModel } from "@/lib/model-config";
import type { PillarCode } from "@/lib/pillars";
import { PILLAR_BY_CODE } from "@/lib/pillars";

/**
 * Live quality gate for missions. Called from the client as the man types
 * (debounced). Uses Haiku with a rubric prompt so it's cheap and fast.
 *
 * The five criteria (each 0/1/2):
 *   Concrete      — you'll know exactly what "done" looks like
 *   Binary        — you either did it or you didn't
 *   High-Leverage — designed to move the needle, not check a box
 *   Aligned       — reinforces the man he's becoming (goal + pillar)
 *   Time-bound    — when you'll do it is clearly defined
 *
 * Total 0-10. Ready = total >= 8 AND no criterion is 0.
 *
 * ARCHITECTURAL NOTE (2026-08-31): the LLM used to return free-form
 * `feedback` prose and a `rewrite` suggestion. It kept editorializing
 * about domain choices ("swap sauna for a long walk mission") no
 * matter how many banned phrases we listed. Removed. The LLM now
 * scores only; the client renders a fixed per-criterion sentence for
 * anything under 2. Same principle as the honing rework — deterministic
 * renderer over LLM prose.
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
});

export type MissionScore = {
  scores: Record<Criterion, 0 | 1 | 2>;
  total: number;
  ready: boolean;
  /** Rendered client-side from the lowest-scoring criterion. Always
   *  about WORDING SHAPE — never about the activity the man chose. */
  feedback: string;
  /** Kept in the type for callsite compatibility; always null now.
   *  The rewrite feature was an LLM affordance that consistently
   *  proposed substitute activities instead of tightening wording. */
  rewrite: null;
};

const SYSTEM = `You are a mission-quality rubric for a men's coaching app. You judge the SHAPE of a mission — is the wording specific, verifiable, on-topic, and dated? You do NOT judge the man's domain choices (which exercise, which training method, which conversation topic, which business tactic). That's HIS call, not yours.

Score five criteria on a 0-2 scale and return JSON only. Scores only — no feedback prose, no rewrites, no commentary. The client renders any user-facing text.

- concrete    (0=vague, 1=partial, 2=specific behavior anyone could witness)
- binary      (0=fuzzy verb, 1=binary but ambiguous, 2=clearly done-or-not)
- leverage    (0=busywork with no plausible connection to the pillar, 1=plausible connection, 2=obviously in-pillar). Score based on whether the mission is IN-PILLAR at all, not whether it's the optimal path to the goal. "Lift weights 4x" for a Vitality goal is 2 (in-pillar), even if the man's specific goal is a walking goal — the choice of modality is his.
- aligned     (0=off-theme for the pillar, 1=on-theme for the pillar but doesn't obviously serve THIS goal, 2=on-theme AND obviously serves this goal). "Doesn't obviously serve this goal" is fine — 1 is a pass. Do not push the man toward a different mission because you'd program his training differently.
- time_bound  Missions are always done within a specific week and the target_date field captures the day. Score from the target_date input line:
              * target_date is set → time_bound=2
              * target_date is missing → time_bound=0
              Do NOT dock time_bound because the description says "on Wednesday" without a date.

Return only the scores object. Nothing else.`;

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
      maxOutputTokens: 200,
    });
    const scores = object.scores as Record<Criterion, 0 | 1 | 2>;
    const total =
      scores.concrete + scores.binary + scores.leverage + scores.aligned + scores.time_bound;
    const ready = total >= 8 && Object.values(scores).every((s) => s > 0);
    return {
      scores,
      total,
      ready,
      feedback: renderMissionFeedback(scores, pillar.label),
      rewrite: null,
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

/**
 * Deterministic per-criterion feedback. Picks the lowest-scoring
 * criterion (ties broken by CRITERIA order) and returns a fixed
 * shape-only sentence. Never talks about activity choice, training
 * modality, conversation topic, or business tactic — impossible by
 * construction because the sentences are hardcoded.
 */
export function renderMissionFeedback(
  scores: Record<Criterion, 0 | 1 | 2>,
  pillarLabel: string,
): string {
  const total = scores.concrete + scores.binary + scores.leverage + scores.aligned + scores.time_bound;
  const perfect = Object.values(scores).every((s) => s === 2);
  if (perfect) return "Sharp mission. Ready to run.";
  if (total >= 8 && Object.values(scores).every((s) => s > 0)) {
    return "Ready to save — every criterion clears. Tighten the wording if you feel it, otherwise ship it.";
  }
  const weakest = CRITERIA.slice().sort((a, b) => scores[a] - scores[b])[0];
  if (scores[weakest] === 0) return CRITIQUE_ZERO[weakest](pillarLabel);
  return CRITIQUE_ONE[weakest](pillarLabel);
}

const CRITIQUE_ZERO: Record<Criterion, (pillar: string) => string> = {
  concrete: () =>
    "Wording is vague. Add specifics — a number, a distance, a duration, a person, a place.",
  binary: () =>
    "The done-or-not test is fuzzy. Add the observable end-state — reps, time, message sent, etc.",
  leverage: (pillar) =>
    `This reads as off-pillar for ${pillar}. Point the mission at something inside the pillar's domain.`,
  aligned: () =>
    "This doesn't connect to your goal. Restate so the link is obvious.",
  time_bound: () =>
    "Pick a target day on the row.",
};

const CRITIQUE_ONE: Record<Criterion, (pillar: string) => string> = {
  concrete: () =>
    "Add one more specific — a number, a distance, a name — so anyone reading it knows what done looks like.",
  binary: () =>
    "The done test is close but not binary yet. Name the exact end-state (a count, a threshold, a checkpoint).",
  leverage: () =>
    "In-pillar but light. If you want more weight on this mission, tighten the connection to the goal.",
  aligned: () =>
    "On-theme for the pillar, connection to THIS goal is loose. Fine to save; tighten the tie if you want the coach to promote it.",
  time_bound: () =>
    "Timing is close but not locked. Pick a specific day on the row.",
};

export const CRITERION_LABEL: Record<Criterion, string> = {
  concrete: "Concrete",
  binary: "Binary",
  leverage: "High-leverage",
  aligned: "Aligned",
  time_bound: "Time-bound",
};
