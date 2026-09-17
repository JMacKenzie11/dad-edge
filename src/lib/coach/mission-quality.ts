import { z } from "zod";
import { generateObject } from "ai";
import { utilityModel } from "@/lib/model-config";

/**
 * Live quality gate for missions. Called from the client as the man types
 * (debounced). Uses Haiku with a rubric prompt so it's cheap and fast.
 *
 * The three criteria:
 *   Concrete   (0-4) — you'll know exactly what "done" looks like
 *   Binary     (0-4) — you either did it or you didn't
 *   Time-bound (0-2) — the day you'll do it is picked
 *
 * Total 0-10. Ready = total >= 8 AND no criterion is 0.
 *
 * ARCHITECTURAL NOTE (2026-08-31): the LLM used to return free-form
 * `feedback` prose and a `rewrite` suggestion. It kept editorializing
 * about domain choices ("swap sauna for a long walk mission") no
 * matter how many banned phrases we listed. Removed. The LLM now
 * scores only; the client renders a fixed per-criterion sentence for
 * anything under full marks. Same principle as the honing rework —
 * deterministic renderer over LLM prose.
 *
 * ARCHITECTURAL NOTE (2026-09-17): the rubric used to carry two more
 * criteria — "high-leverage" (is this in the pillar's domain?) and
 * "aligned" (does this serve the quarterly goal?). Both scored the
 * man's CHOICE of activity, not the quality of his mission wording,
 * and both leaked out as coach copy telling him a sardine mission was
 * "off-pillar for Bond". That's his call, not the coach's. Dropped
 * outright rather than muzzled: the pillar and the goal are no longer
 * passed to the renderer at all, so there is no code path that can
 * produce a domain judgement. The remaining weights (4/4/2) keep the
 * total on the 0-10 scale the pill, the DB column and the exemplar
 * rule already speak.
 */

export const CRITERIA = ["concrete", "binary", "time_bound"] as const;
export type Criterion = (typeof CRITERIA)[number];

/** Max points per criterion. Sums to 10. */
export const CRITERION_MAX: Record<Criterion, number> = {
  concrete: 4,
  binary: 4,
  time_bound: 2,
};

const SchemaZ = z.object({
  scores: z.object({
    concrete: z.number().int().min(0).max(4),
    binary: z.number().int().min(0).max(4),
    time_bound: z.number().int().min(0).max(2),
  }),
});

export type MissionScore = {
  scores: Record<Criterion, number>;
  total: number;
  ready: boolean;
  /** Rendered client-side from the weakest criterion. Always about
   *  WORDING — never about the activity the man chose. */
  feedback: string;
  /** Kept in the type for callsite compatibility; always null now.
   *  The rewrite feature was an LLM affordance that consistently
   *  proposed substitute activities instead of tightening wording. */
  rewrite: null;
};

const SYSTEM = `You are a mission-quality rubric for a men's coaching app. You judge ONE thing: is the mission written so that anyone could tell, at the end of the week, whether it happened?

You do NOT judge what the man chose to do. Not the activity, not the exercise, not the food, not the training method, not the conversation topic, not the business tactic, and not whether it fits a pillar or serves a goal. That is HIS call. A mission you would never have picked still scores 10/10 if it is written clearly.

Score three criteria and return JSON only. Scores only — no feedback prose, no rewrites, no commentary. The client renders any user-facing text.

- concrete (0-4): how specific the behavior is.
    0 = no behavior a witness could name ("be better with money")
    2 = a real behavior, missing the specifics ("go for a walk")
    4 = behavior plus the specifics that pin it down — a number, a duration, a distance, a person, a place ("walk 10 km on the river trail with Tanja")
- binary (0-4): how cleanly done-or-not it reads.
    0 = fuzzy verb with no end-state ("focus on my marriage")
    2 = you could argue either way ("spend more time praying")
    4 = you either did it or you didn't, no argument ("pray before 6 AM every day this week")
- time_bound (0-2): read this off the target_date input line ONLY.
    target_date is set -> 2
    target_date is missing -> 0
    Do NOT dock time_bound because the description doesn't name a day. The day is picked in the UI, not typed.

Return only the scores object. Nothing else.`;

/**
 * Deliberately narrow: the description and the day, nothing else. The
 * pillar and the quarterly goal used to ride along here and were the
 * only inputs that let the model form an opinion about what the man
 * chose to do. They are gone from the wire, not just from the prompt.
 */
type ScoreInput = {
  description: string;
  target_date: string | null;
};

export async function scoreMissionDraft(input: ScoreInput): Promise<MissionScore> {
  const desc = input.description.trim();
  if (desc.length < 3) {
    return emptyScore("Write at least a few words.");
  }

  const dateLine = input.target_date
    ? `Target date: ${input.target_date}`
    : "Target date: (none — auto-fails Time-bound)";

  const userPrompt = `${dateLine}

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
    const scores = object.scores as Record<Criterion, number>;
    const total = scores.concrete + scores.binary + scores.time_bound;
    const ready = total >= 8 && CRITERIA.every((c) => scores[c] > 0);
    return {
      scores,
      total,
      ready,
      feedback: renderMissionFeedback(scores),
      rewrite: null,
    };
  } catch (err) {
    console.error("mission quality scoring failed", err);
    return emptyScore("Quality check unavailable.");
  }
}

function emptyScore(feedback: string): MissionScore {
  return {
    scores: { concrete: 0, binary: 0, time_bound: 0 },
    total: 0,
    ready: false,
    feedback,
    rewrite: null,
  };
}

/**
 * Deterministic per-criterion feedback. Picks the weakest criterion by
 * share of its available points (ties broken by CRITERIA order) and
 * returns a fixed sentence about the WORDING. It takes no pillar and
 * no goal, so it cannot comment on what the man chose to do.
 */
export function renderMissionFeedback(scores: Record<Criterion, number>): string {
  const total = scores.concrete + scores.binary + scores.time_bound;
  const perfect = CRITERIA.every((c) => scores[c] === CRITERION_MAX[c]);
  if (perfect) return "Sharp mission. Ready to run.";
  if (total >= 8 && CRITERIA.every((c) => scores[c] > 0)) {
    return "Ready to save — it's clear enough to hold you to. Tighten the wording if you feel it, otherwise ship it.";
  }
  const weakest = CRITERIA.slice().sort(
    (a, b) => scores[a] / CRITERION_MAX[a] - scores[b] / CRITERION_MAX[b],
  )[0];
  return (scores[weakest] === 0 ? CRITIQUE_ZERO : CRITIQUE_PARTIAL)[weakest];
}

const CRITIQUE_ZERO: Record<Criterion, string> = {
  concrete:
    "Wording is vague. Add specifics — a number, a distance, a duration, a person, a place.",
  binary:
    "The done-or-not test is fuzzy. Add the observable end-state — reps, time, message sent.",
  time_bound: "Pick a target day on the row.",
};

const CRITIQUE_PARTIAL: Record<Criterion, string> = {
  concrete:
    "Add one more specific — a number, a distance, a name — so anyone reading it knows what done looks like.",
  binary:
    "The done test is close but not binary yet. Name the exact end-state (a count, a threshold, a checkpoint).",
  time_bound: "Timing is close but not locked. Pick a specific day on the row.",
};

export const CRITERION_LABEL: Record<Criterion, string> = {
  concrete: "Concrete",
  binary: "Binary",
  time_bound: "Time-bound",
};
