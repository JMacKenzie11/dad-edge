import { generateObject } from "ai";
import { z } from "zod";
import { utilityModel } from "@/lib/model-config";
import { CoachActionSchema, type CoachAction } from "./coach";
import type { ItcStage } from "./stage";

/**
 * State-change extractor. Primary path for updating the map (not a
 * backstop). Runs AFTER the coach's prose reply and BEFORE any
 * commit — reads the just-completed turn plus the current DB state,
 * and returns every action the server should apply.
 *
 * Design goal: split the two jobs the coach was previously doing.
 *   1. Have a conversation → coach LLM (Sonnet), prose only.
 *   2. Update state → this module (Haiku), structured only.
 *
 * The old architecture asked one LLM to do both, then leaned on
 * regex backstops + reconciler to recover when the coach forgot to
 * fire the right action. Every new phrasing broke something. This
 * removes that whole class of bug by moving structured output out of
 * the conversational path entirely.
 *
 * Cost/latency: one utility-tier LLM call per turn (Haiku by default,
 * see ANTHROPIC_UTILITY_MODEL env). Capped at 8 actions per turn.
 * Failures return [] and the turn continues — nothing in the coach
 * loop should depend on this returning non-empty.
 */

const ExtractOutputSchema = z.object({
  actions: z.array(CoachActionSchema).max(8).default([]),
  reason: z.string().max(600).optional(),
});

export type ExtractInput = {
  stage: ItcStage;
  goalText: string | null;
  behaviors: { text: string; selected: boolean }[]; // in map order, 1-based indices
  worries: { behavior_index: number; text: string; locked: boolean }[];
  commitments: { worry_index: number; text: string }[];
  assumptions: {
    text: string;
    commitment_indices: number[];
    selected_for_testing: boolean;
    coach_recommended: boolean;
  }[];
  activeTest: {
    test_type: string;
    assumption_says: string | null;
    behavior_change: string | null;
    data_to_collect: string | null;
    in_order_to_find_out: string | null;
    target_date: string | null;
    status: string;
  } | null;
  walkthroughDelivered: boolean;
  userMessage: string;
  coachReply: string;
  recentAssistantMessages: string[]; // most recent last, up to ~4
  recentActionRejections: string[]; // last few [action rejected] entries
};

const EXTRACTOR_SYSTEM = `
You are the state-change extractor for an Immunity-to-Change coaching app. You do NOT talk to the user. Your only job: read the just-completed turn (user message + coach's just-sent reply) plus the current DB state, and emit ALL actions the server should apply this turn.

Emit actions ONLY when the prose CLEARLY warrants them. Under-emission is safe (the next turn is another chance). Over-emission corrupts the map and is worse.

=== Actions you may emit ===

Every action's stage guard is enforced server-side. If a downstream action needs a stage the map hasn't reached yet, put advance_stage FIRST in your array — the server re-reads stage between actions.

- propose_goal: coach has quoted the goal in "I'm committed to getting better at ..." form and asked the coachee to lock it in, OR the coachee just confirmed it. Only at goal stage.

- propose_behavior: coachee's message names a specific column-2 behavior (short first-person "I ..." / "when ..." / "sometimes I ..." shape, works against the goal) AND the coach's reply acknowledges it as a new behavior. Only at behaviors stage.

- replace_behavior: coach's reply consolidates two behaviors into one sharper phrasing. Rare.

- remove_behavior: coachee asked to drop/remove a specific numbered behavior. Only at behaviors stage.

- propose_worry: coachee's message is a fully-formed "I worry that if X, then Y" candidate AND the coach's reply is accepting it (not still probing). behavior_index MUST point at the behavior the coach was probing. Only emit when the excavation has clearly landed — a partial answer or the coach still probing means do NOT emit.

- propose_commitment (SINGULAR — rare): almost never use. The primary flow is propose_commitments_batch after the coach drafts them.

- propose_commitments_batch: coach's reply contains a numbered list of drafted "I'm also committed to ..." items AND the coachee has affirmed the set (lock them in / save / yes / etc.). Include one item per LOCKED worry that doesn't already have a commitment. Emit ONLY on affirmation, not on the coach's initial draft turn. Only at commitments stage.

- mark_reveal_delivered: coach delivered the brief gas-and-brake reveal at commitments/assumptions stage. Rare — the full walkthrough at immune_system is more important.

- mark_walkthrough_delivered: coach delivered the three-movement immune-system walkthrough (Movement 1 loops, Movement 2 whole system, Movement 3 hinge) AND the coachee has signaled readiness ("I'm ready", "let's test", "ok next", etc.). Only at immune_system stage.

- propose_assumption: coach's reply contains a fully-formed "I assume that if X, then Y" candidate (usually quoted) AND either the coachee has affirmed it OR the coach has drafted it explicitly for a cluster of commitments. commitment_indices MUST correspond to the commitments the assumption underwrites (usually named by the coach as "Commitment #1 and #4" or similar). Only at assumptions stage.

- recommend_assumption_for_testing: coach's reply names which assumption to test first and gives a reason. Only at prioritize stage.

- select_assumption_for_testing: coachee explicitly picks a different assumption than the coach recommended. Only at prioritize or test_design stage.

- save_test_design: coachee has affirmed the four-field test draft with "save it" / "lock it in" / etc. All four fields must be present in the coach's reply. Only at test_design stage.

- record_test_results: coachee has affirmed the debrief block (what I did, what I observed, what it tells me) AND picked a next step. Only at test_running or results stage.

- advance_stage: emit when the current turn completes the work of the current stage and the coach's reply is transitioning. Legal transitions: goal→behaviors, behaviors→worries, worries→commitments, commitments→assumptions, assumptions→immune_system (skip review), immune_system→prioritize, prioritize→test_design, test_design→test_running, test_running→results, results→test_design or results→prioritize or results→done. Server-side gates enforce integrity (e.g., every commitment covered before advancing to immune_system).

=== Never emit ===

- suggest_behaviors — the coach's reply is the surface for suggestions; there's no separate action.
- Any action whose text is garbled or partially rendered (doubled stems, missing spaces, control tokens). Skip it; the next turn will re-attempt.

=== Multiple actions per turn ===

Batching is expected. Canonical shapes:

  Goal locked and behaviors stage starting:
    [ { propose_goal }, { advance_stage → behaviors } ]

  Last worry landed and cascading into commitments:
    [ { propose_worry }, { advance_stage → commitments } ]

  Commitments batch affirmed and cascading into assumptions:
    [ { propose_commitments_batch }, { advance_stage → assumptions } ]

  Last assumption locked and cascading into walkthrough:
    [ { propose_assumption }, { advance_stage → immune_system } ]

  Walkthrough done, ready to test:
    [ { mark_walkthrough_delivered }, { advance_stage → prioritize }, { recommend_assumption_for_testing } ]

Cap at 8 actions total.

=== When in doubt ===

Emit []. The next turn will have another chance. A missed action costs one turn; a wrong action costs several turns of coach confusion + the coachee losing trust.
`.trim();

function buildExtractorPrompt(input: ExtractInput): string {
  const behaviorsBlock = input.behaviors.length
    ? input.behaviors
        .map(
          (b, i) => `  ${i + 1}. ${b.selected ? "" : "(parked) "}${b.text}`,
        )
        .join("\n")
    : "  (none)";
  const worriesBlock = input.worries.length
    ? input.worries
        .map(
          (w, i) =>
            `  ${i + 1}. ${w.locked ? "" : "(unlocked) "}paired to behavior #${w.behavior_index}: ${w.text}`,
        )
        .join("\n")
    : "  (none)";
  const commitmentsBlock = input.commitments.length
    ? input.commitments
        .map(
          (c, i) => `  ${i + 1}. covers worry #${c.worry_index}: ${c.text}`,
        )
        .join("\n")
    : "  (none)";
  const assumptionsBlock = input.assumptions.length
    ? input.assumptions
        .map((a, i) => {
          const flags: string[] = [];
          if (a.selected_for_testing) flags.push("SELECTED_FOR_TESTING");
          if (a.coach_recommended) flags.push("COACH_RECOMMENDED");
          const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
          return `  ${i + 1}.${flagStr} covers commitments [${a.commitment_indices.join(",")}]: ${a.text}`;
        })
        .join("\n")
    : "  (none)";
  const activeTest = input.activeTest
    ? `type=${input.activeTest.test_type} status=${input.activeTest.status} target=${input.activeTest.target_date ?? "(none)"}`
    : "(none)";
  const recentAssistant = input.recentAssistantMessages.length
    ? input.recentAssistantMessages
        .map(
          (m, i) =>
            `  [-${input.recentAssistantMessages.length - i}]: ${m.length > 400 ? m.slice(0, 400) + "…" : m}`,
        )
        .join("\n")
    : "  (none)";
  const recentRejections = input.recentActionRejections.length
    ? input.recentActionRejections.map((r) => `  - ${r}`).join("\n")
    : "  (none)";

  return `
Current stage: ${input.stage}
Walkthrough delivered flag: ${input.walkthroughDelivered ? "true" : "false"}

Improvement goal: ${input.goalText ?? "(not set)"}

Behaviors (1-based, "parked" = legacy off-map row):
${behaviorsBlock}

Worries (1-based; behavior_index is 1-based into SELECTED behaviors only):
${worriesBlock}

Commitments (1-based; worry_index is 1-based into LOCKED worries only):
${commitmentsBlock}

Assumptions (1-based; commitment_indices are 1-based into commitments):
${assumptionsBlock}

Active test on record: ${activeTest}

Recent coach messages (prior turns, for context — the just-sent one is BELOW):
${recentAssistant}

Recent [action rejected] messages (last few, so you don't re-emit rejected actions with the same text):
${recentRejections}

=== THIS TURN ===

Coachee's message:
${JSON.stringify(input.userMessage)}

Coach's just-sent reply:
"""
${input.coachReply}
"""

Emit the actions this turn implies. If nothing state-changing happened, emit [].
`.trim();
}

export async function extractActions(
  input: ExtractInput,
): Promise<{ actions: CoachAction[]; reason?: string; durationMs: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);
  try {
    const { object } = await generateObject({
      model: utilityModel(),
      schema: ExtractOutputSchema,
      system: EXTRACTOR_SYSTEM,
      messages: [{ role: "user", content: buildExtractorPrompt(input) }],
      maxOutputTokens: 2048,
      abortSignal: controller.signal,
    });
    return {
      actions: object.actions,
      reason: object.reason,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    console.warn(
      "[itc] extractActions failed after %dms: %s",
      Date.now() - started,
      err instanceof Error ? err.message : String(err),
    );
    return { actions: [], durationMs: Date.now() - started };
  } finally {
    clearTimeout(timeoutId);
  }
}
