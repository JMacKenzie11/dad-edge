import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, type LanguageModel } from "ai";
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
  behaviors: { text: string }[];
  history: ChatTurn[];
  userMessage: string;
};

export async function runItcCoachTurn(input: RunCoachInput): Promise<CoachReply> {
  const pillar = PILLAR_BY_CODE[input.pillar];
  const system = buildItcCoachSystem({
    pillarLabel: pillar.label,
    stage: input.stage,
    improvementGoal: input.improvementGoal,
    behaviors: input.behaviors,
  });

  const messages: ChatTurn[] = [
    ...input.history,
    { role: "user", content: input.userMessage },
  ];

  const { object } = await generateObject({
    model: itcCoachModel(),
    schema: CoachReplySchema,
    system,
    messages,
  });

  return object;
}
