import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { buildItcCoachSystem } from "./prompts";
import type { ItcStage } from "./stage";

/**
 * Anthropic model for the ITC coach. Configurable via env so the user can
 * swap without redeploy. Defaults to claude-sonnet-5.
 */
function itcCoachModel(): LanguageModel {
  const id = process.env.ITC_COACH_MODEL || "claude-sonnet-5";
  return anthropic(id);
}

const CoachActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("propose_goal"), text: z.string().min(1) }),
  z.object({ type: z.literal("propose_behavior"), text: z.string().min(1) }),
  z.object({
    type: z.literal("suggest_behaviors"),
    options: z.array(z.string().min(1)).min(2).max(6),
  }),
  // Prune the current behavior set. keep_indices are 1-based positions into
  // the ordered list the coach sees in its context block. Every behavior
  // outside keep_indices becomes parked; every one inside becomes selected.
  z.object({
    type: z.literal("prune_behaviors"),
    keep_indices: z.array(z.number().int().min(1)).min(1).max(5),
  }),
  // Propose a worry paired to a specific selected behavior. behavior_index
  // is 1-based into the SELECTED behaviors list the coach sees (parked
  // rows are excluded from this numbering). Server runs the depth rubric
  // before locking; a score <2 always rejects, a score of 2 requires at
  // least two attempts on this behavior.
  z.object({
    type: z.literal("propose_worry"),
    behavior_index: z.number().int().min(1),
    text: z.string().min(1).max(500),
  }),
  // Propose a hidden competing commitment paired to a specific worry.
  // worry_index is 1-based into the locked-worry list the coach sees.
  // Server runs a self-protection rubric; commitments that sound like
  // productivity advice are rejected.
  z.object({
    type: z.literal("propose_commitment"),
    worry_index: z.number().int().min(1),
    text: z.string().min(1).max(500),
  }),
  // The v2 3.3b brief gas-and-brake reveal. Coach emits this after the
  // commitments column is complete; UI records that the beat happened so
  // the deeper immune-system walkthrough later doesn't repeat it.
  z.object({ type: z.literal("mark_reveal_delivered") }),
  // Propose a Big Assumption and the commitments it underwrites.
  // commitment_indices are 1-based into the ordered commitments list the
  // coach sees. Server runs the finished-then rubric before locking.
  z.object({
    type: z.literal("propose_assumption"),
    text: z.string().min(1).max(500),
    commitment_indices: z.array(z.number().int().min(1)).min(1),
  }),
  // Coach's prioritization recommendation. assumption_index 1-based into
  // the locked assumptions. Coach must still ask the coachee to pick;
  // this action only surfaces the recommendation to the UI.
  z.object({
    type: z.literal("recommend_assumption_for_testing"),
    assumption_index: z.number().int().min(1),
    reason: z.string().min(1).max(500),
  }),
  // Coachee's final choice for testing. Sets selected_for_testing on the
  // chosen assumption.
  z.object({
    type: z.literal("select_assumption_for_testing"),
    assumption_index: z.number().int().min(1),
  }),
  z.object({
    type: z.literal("advance_stage"),
    to: z.enum([
      "goal",
      "behaviors",
      "worries",
      "commitments",
      "assumptions",
      "review",
      "prioritize",
      "test_design",
      "test_running",
      "results",
      "done",
    ]),
  }),
]);

export type CoachAction = z.infer<typeof CoachActionSchema>;

const CoachReplySchema = z.object({
  reply: z.string().min(1),
  action: CoachActionSchema.nullable(),
});

export type CoachReply = z.infer<typeof CoachReplySchema>;

type ChatTurn = { role: "user" | "assistant"; content: string };

type RunCoachInput = {
  pillar: PillarCode;
  stage: ItcStage;
  improvementGoal: string | null;
  // Ordered exactly as the coach sees them in the context block. The
  // 1-based position in this array is what prune_behaviors.keep_indices
  // refers to.
  behaviors: { id: string; text: string; selected: boolean }[];
  // Worries keyed by behavior_id. Populated during the worries stage so
  // the coach knows what's already locked and doesn't re-propose.
  worries: { behavior_id: string; text: string; depth_score: number | null }[];
  commitments: { id: string; worry_id: string; text: string }[];
  assumptions: {
    id: string;
    text: string;
    depth_score: number | null;
    selected_for_testing: boolean;
    coach_recommended: boolean;
    linked_commitment_ids: string[];
  }[];
  revealDelivered: boolean;
  history: ChatTurn[];
  userMessage: string;
  // Most recent rejected coach actions (e.g., worry_not_deep_enough). Fed
  // into the context block so the coach can respond to the rubric instead
  // of re-proposing the same rejected text.
  recentActionFeedback: string[];
};

/**
 * One coach turn. Wraps the structured-output call with two retries and a
 * plain-text fallback so a schema-parse failure never bubbles a "No object
 * generated" error to the coachee. The fallback returns action:null so the
 * server-side stage machine stays untouched — a text-only reply is safe.
 */
export async function runItcCoachTurn(input: RunCoachInput): Promise<CoachReply> {
  const pillar = PILLAR_BY_CODE[input.pillar];
  const system = buildItcCoachSystem({
    pillarLabel: pillar.label,
    stage: input.stage,
    improvementGoal: input.improvementGoal,
    behaviors: input.behaviors,
    worries: input.worries,
    commitments: input.commitments,
    assumptions: input.assumptions,
    revealDelivered: input.revealDelivered,
    recentActionFeedback: input.recentActionFeedback,
  });

  const messages: ChatTurn[] = [
    ...input.history,
    { role: "user", content: input.userMessage },
  ];

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { object } = await generateObject({
        model: itcCoachModel(),
        schema: CoachReplySchema,
        system,
        messages,
        maxOutputTokens: 4096,
      });
      if (object.reply.trim().length === 0) {
        // Treat empty output the same as a schema miss: retry.
        lastError = new Error("empty reply");
        continue;
      }
      return object;
    } catch (err) {
      lastError = err;
    }
  }

  // Plain-text fallback so the coachee always receives a real message.
  // Tell the model that structured output failed and to answer in prose;
  // no action is emitted, so nothing state-machine touches the DB.
  console.warn(
    "[itc] coach structured-output failed after retries, falling back to text:",
    lastError instanceof Error ? lastError.message : String(lastError),
  );
  const { text } = await generateText({
    model: itcCoachModel(),
    system: `${system}\n\nIMPORTANT: Reply in plain prose ONLY. Do NOT emit JSON. No action fields — the previous attempt to produce structured output failed. Keep the reply short and helpful; the coachee should not see the failure.`,
    messages,
    maxOutputTokens: 2048,
  });
  const fallback = text.trim();
  return {
    reply: fallback.length > 0 ? fallback : "Give me one more sec — mind repeating that?",
    action: null,
  };
}
