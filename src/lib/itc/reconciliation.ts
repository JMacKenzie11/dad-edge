import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { CoachActionSchema, type CoachAction } from "./coach";
import type { ItcStage } from "./stage";

/**
 * Post-turn LLM reconciliation.
 *
 * After the coach turn's actions have been applied and the regex backstops
 * have run, this reads the coach's reply against the current DB state and
 * asks a small LLM: "What state changes did the reply IMPLY that haven't
 * landed?" It returns a list of actions to apply as follow-ups.
 *
 * Why: the coach frequently claims state changes in prose that its
 * structured actions don't cover — "That's three on the map", "Adding it
 * to worries", "Locked in". Historically we caught these with hand-tuned
 * regex backstops, which drift as the coach's phrasing changes. This
 * gives us a phrasing-agnostic recovery layer.
 *
 * Cost/latency: one small-model call per turn (Anthropic Haiku by
 * default; set ITC_RECONCILE_MODEL to override). Bounded to 3 actions.
 * Failures return an empty array — never break the turn.
 */

function reconcileModel(): LanguageModel {
  const id = process.env.ITC_RECONCILE_MODEL || "claude-haiku-4-5";
  return anthropic(id);
}

const ReconcileOutputSchema = z.object({
  actions: z.array(CoachActionSchema).max(3).default([]),
  reason: z.string().max(400).optional(),
});

export type ReconcileInput = {
  stage: ItcStage;
  goalText: string | null;
  behaviors: { text: string; selected: boolean }[]; // in map order
  worries: { behavior_index: number; text: string; locked: boolean }[]; // behavior_index is 1-based into selected behaviors
  commitments: { worry_index: number; text: string }[]; // worry_index is 1-based into locked worries
  assumptions: {
    text: string;
    commitment_indices: number[];
    selected_for_testing: boolean;
  }[]; // commitment_indices are 1-based into commitments
  hasActiveTest: boolean;
  coachReplyText: string;
  actionsAppliedThisTurn: CoachAction[]; // for context — coach may have already fired some
  coacheeMessage: string;
};

const RECONCILER_SYSTEM = `
You are a strict state-reconciler for an Immunity-to-Change coaching app. You do NOT talk to the user. Your ONLY job: read the coach's just-sent reply and the current DB state, and list any actions that the reply CLEARLY implies but that haven't landed in the DB.

Rules:
1. Only emit an action if the reply's text explicitly asserts a state change that isn't reflected in the current DB state. Example triggers:
   - Reply says "That's three on the map" but DB has only 2 selected behaviors → emit propose_behavior with the coachee's message as text.
   - Reply says "Locked. Column 2 is..." but stage is still 'goal' → emit advance_stage to 'behaviors'.
   - Reply says "Saved. Go run it" at test_design but no test row exists → emit save_test_design if the reply contains a full four-field draft.
2. Never speculate. If the reply doesn't clearly assert the state change, emit nothing. "What comes to mind for the next behavior?" is not an assertion; do NOT emit anything.
3. Never re-emit an action the coach already fired this turn (see actionsAppliedThisTurn). Only fill gaps.
4. Respect stage guards. propose_behavior only makes sense in the behaviors stage — if the current stage is wrong, include the required advance_stage FIRST in your actions array.
5. Return { "actions": [] } liberally. Under-emission is safe; over-emission corrupts the map.
6. Never emit propose_goal (server no-op) or suggest_behaviors (reply-text-only).
7. Cap at 3 actions total.
`.trim();

function buildContextBlock(input: ReconcileInput): string {
  const behaviorsLines = input.behaviors.length
    ? input.behaviors
        .map(
          (b, i) =>
            `  ${i + 1}. ${b.selected ? "" : "(parked) "}${b.text}`,
        )
        .join("\n")
    : "  (none)";
  const worriesLines = input.worries.length
    ? input.worries
        .map(
          (w, i) =>
            `  ${i + 1}. ${w.locked ? "" : "(unlocked) "}paired to behavior #${w.behavior_index}: ${w.text}`,
        )
        .join("\n")
    : "  (none)";
  const commitmentsLines = input.commitments.length
    ? input.commitments
        .map(
          (c, i) => `  ${i + 1}. covers worry #${c.worry_index}: ${c.text}`,
        )
        .join("\n")
    : "  (none)";
  const assumptionsLines = input.assumptions.length
    ? input.assumptions
        .map(
          (a, i) =>
            `  ${i + 1}. ${a.selected_for_testing ? "[SELECTED FOR TESTING] " : ""}covers commitments [${a.commitment_indices.join(",")}]: ${a.text}`,
        )
        .join("\n")
    : "  (none)";
  const priorActionsLine = input.actionsAppliedThisTurn.length
    ? input.actionsAppliedThisTurn.map((a) => a.type).join(", ")
    : "(none)";

  return `
Current stage: ${input.stage}
Improvement goal: ${input.goalText ?? "(not set)"}
Active test on record: ${input.hasActiveTest ? "yes" : "no"}

Behaviors (1-based):
${behaviorsLines}

Worries (1-based into behaviors above):
${worriesLines}

Commitments (1-based into locked worries):
${commitmentsLines}

Assumptions (1-based; commitment_indices are 1-based into commitments):
${assumptionsLines}

Actions the coach already fired this turn: ${priorActionsLine}

Coachee's message this turn: ${JSON.stringify(input.coacheeMessage)}

Coach's just-sent reply:
"""
${input.coachReplyText}
"""

Emit only actions that the reply CLEARLY asserts happened but that the DB state above does not reflect. If in doubt, emit nothing.
`.trim();
}

export async function reconcileTurn(
  input: ReconcileInput,
): Promise<CoachAction[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  const started = Date.now();
  try {
    const { object } = await generateObject({
      model: reconcileModel(),
      schema: ReconcileOutputSchema,
      system: RECONCILER_SYSTEM,
      messages: [{ role: "user", content: buildContextBlock(input) }],
      maxOutputTokens: 1024,
      abortSignal: controller.signal,
    });
    const ms = Date.now() - started;
    console.warn(
      "[itc timing] reconcile ms=%d actions=%d reason=%o",
      ms,
      object.actions.length,
      object.reason ?? null,
    );
    return object.actions;
  } catch (err) {
    console.warn(
      "[itc] reconcileTurn failed after %dms: %s",
      Date.now() - started,
      err instanceof Error ? err.message : String(err),
    );
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}
