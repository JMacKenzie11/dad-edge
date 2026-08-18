/**
 * Native tool-use path for the ITC coach.
 *
 * Replaces the old marker-parser + extractor pipeline with model-side
 * tool calls. The Anthropic API guarantees each tool call's JSON
 * validates against the schema, so we never have to parse prose for
 * state intent. Content actions become itc_action_proposals cards
 * for the coachee to accept/edit/reject; immediate actions apply
 * server-side through the existing stage guards.
 *
 * The tool executor is bound to a TurnScope so each tool.execute() has
 * the map id, current stage, goal text, and the shared rubric-rejection
 * counter used to cap the multi-step loop at one rubric rejection per
 * turn. Content tools push into scope.pendingProposals during
 * generation; the caller creates the actual itc_action_proposals rows
 * after the multi-step loop finishes and the assistant message has been
 * persisted (so we have a real message id to attach cards to).
 *
 * Rubric-at-proposal-time: for worries and assumptions, the depth
 * rubric runs INSIDE execute(), before anything is queued. A rejected
 * proposal never becomes a card. The tool result returned to the model
 * tells it what criterion failed AND — per DECISIONS — instructs it to
 * ask an excavation question next, not re-propose its own deeper
 * version. The coachee never sees the rejection message; it lives
 * entirely in the model↔tool loop.
 */

import { tool } from "ai";
import { z } from "zod";
import type { CoachAction } from "./coach";
import {
  advanceStage,
  appendMessage,
  clearSelectedAssumption,
  countWorryAttempts,
  listBehaviors,
  listCommitments,
  listWorries,
  logWorryAttempt,
  markMapComplete,
  markRevealDelivered,
  markWalkthroughDelivered,
} from "./maps";
import { scoreAssumptionDepth, scoreWorryDepth } from "./rubric";
import {
  ASSUMPTION_STEM,
  COMMITMENT_STEM,
  ensureStem,
  hasGoalStem,
  WORRY_STEM,
  type ItcStage,
} from "./stage";
import type { TurnEventLog } from "./turn-events";

/**
 * Batched proposal to be persisted after the multi-step loop. Kept as
 * data instead of an inline DB write so we can create rows against the
 * final assistant_message_id (which doesn't exist until after
 * generation completes).
 */
export type PendingProposal = {
  action_type: string;
  payload: CoachAction;
};

/**
 * Shared context every tool executor needs. Mutable fields are wrapped
 * so all closures see the same running state across the multi-step
 * loop.
 */
export type TurnScope = {
  mapId: string;
  currentStage: ItcStage;
  goalText: string | null;
  rejectionsCount: { current: number };
  maxRejections: number;
  pendingProposals: PendingProposal[];
  events: TurnEventLog;
};

/**
 * Standard shape returned by every tool executor. The model treats it
 * as tool-result JSON and reacts on the next step. It NEVER contains
 * information the coachee should see — it's plumbing.
 */
type ToolResult =
  | { status: "accepted"; note?: string }
  | { status: "applied"; note?: string }
  | { status: "rejected"; reason: string; instruction: string }
  | { status: "invalid"; reason: string }
  | { status: "cap_reached"; reason: string; instruction: string };

function capReachedResult(): ToolResult {
  return {
    status: "cap_reached",
    reason:
      "One rubric rejection has already fired this turn. No more proposals allowed.",
    instruction:
      "Your next content block must be prose only, ending in a single excavation question directed at the coachee. Do NOT propose a deeper version of the rejected item; his answer supplies the depth. The coachee never sees this system message.",
  };
}

/**
 * Build a fresh tools object bound to the given TurnScope. Call once
 * per coach turn — the closures capture scope by reference so the
 * rejection counter, proposal accumulator, and current-stage tracker
 * stay coherent across all tool calls in that turn.
 */
export function buildCoachTools(scope: TurnScope) {
  const capReached = () =>
    scope.rejectionsCount.current >= scope.maxRejections;

  const queueProposal = (action_type: string, payload: CoachAction): void => {
    scope.pendingProposals.push({ action_type, payload });
    scope.events.record(
      "action_apply",
      {
        action_type,
        via: "tool",
        proposal_queued: true,
      },
      { stage: scope.currentStage },
    );
  };

  return {
    // ================================================================
    // Content tools — become UI cards the coachee accepts/edits/rejects
    // ================================================================

    propose_goal: tool({
      description:
        'Propose an improvement goal for the coachee to accept as a card. Only valid at the goal stage. Text must start with "I\'m committed to getting better at" — omit and the server will prepend it.',
      inputSchema: z.object({
        text: z.string().min(1).max(500),
      }),
      execute: async ({ text }): Promise<ToolResult> => {
        if (capReached()) return capReachedResult();
        const withStem = hasGoalStem(text)
          ? text
          : `I'm committed to getting better at ${text.trim()}`;
        queueProposal("propose_goal", { type: "propose_goal", text: withStem });
        return { status: "accepted" };
      },
    }),

    propose_behavior: tool({
      description:
        'Propose a Column 2 doing/not-doing behavior for the coachee to accept as a card. First-person, in-the-moment behavior that works against the improvement goal — not a fix, not an inner state.',
      inputSchema: z.object({
        text: z.string().min(3).max(500),
      }),
      execute: async ({ text }): Promise<ToolResult> => {
        if (capReached()) return capReachedResult();
        queueProposal("propose_behavior", {
          type: "propose_behavior",
          text,
        });
        return { status: "accepted" };
      },
    }),

    propose_behavior_replacement: tool({
      description:
        'Replace an existing behavior in place when a sharper phrasing lands. index is the 1-based row on Column 2.',
      inputSchema: z.object({
        index: z.number().int().min(1),
        text: z.string().min(3).max(500),
      }),
      execute: async ({ index, text }): Promise<ToolResult> => {
        if (capReached()) return capReachedResult();
        const behaviors = await listBehaviors(scope.mapId);
        const target = behaviors[index - 1];
        if (!target) {
          return {
            status: "invalid",
            reason: `index ${index} out of range (${behaviors.length} behaviors).`,
          };
        }
        queueProposal("replace_behavior", {
          type: "replace_behavior",
          index,
          text,
        });
        return { status: "accepted" };
      },
    }),

    remove_behavior: tool({
      description:
        'Drop a duplicate/erroneous behavior from Column 2. index is the 1-based row. Only valid before any worries are paired against it.',
      inputSchema: z.object({
        index: z.number().int().min(1),
      }),
      execute: async ({ index }): Promise<ToolResult> => {
        if (capReached()) return capReachedResult();
        const behaviors = await listBehaviors(scope.mapId);
        const target = behaviors[index - 1];
        if (!target) {
          return {
            status: "invalid",
            reason: `index ${index} out of range (${behaviors.length} behaviors).`,
          };
        }
        queueProposal("remove_behavior", {
          type: "remove_behavior",
          index,
        });
        return { status: "accepted" };
      },
    }),

    propose_worry: tool({
      description:
        'Propose a worry (fear underneath a specific behavior). behavior_index is 1-based into the SELECTED behaviors list. Rubric runs at proposal time — depth < 3 (or < 2 with prior attempts on this behavior) is rejected. On rejection you must ask the coachee an excavation question next, not re-propose your own deeper version. The coachee never sees the rejection.',
      inputSchema: z.object({
        behavior_index: z.number().int().min(1),
        text: z.string().min(3).max(500),
      }),
      execute: async ({ behavior_index, text }): Promise<ToolResult> => {
        if (capReached()) return capReachedResult();
        const behaviors = await listBehaviors(scope.mapId);
        const selected = behaviors.filter((b) => b.selected);
        const behavior = selected[behavior_index - 1];
        if (!behavior) {
          return {
            status: "invalid",
            reason: `behavior_index ${behavior_index} out of range (${selected.length} selected).`,
          };
        }
        const stemmedText = ensureStem(text, WORRY_STEM);
        const rubric = await scoreWorryDepth({
          goalText: scope.goalText ?? "",
          behaviorText: behavior.text,
          worryText: stemmedText,
        });
        const priorAttempts = await countWorryAttempts(behavior.id);
        const passed =
          rubric.score === 3 || (rubric.score === 2 && priorAttempts >= 1);
        await logWorryAttempt({
          mapId: scope.mapId,
          behaviorId: behavior.id,
          text: stemmedText,
          depthScore: rubric.score,
          accepted: passed,
          rejectReason: passed ? null : rubric.reason,
        });
        if (!passed) {
          scope.rejectionsCount.current++;
          scope.events.record(
            "rubric_rejected_proposal",
            {
              action_type: "propose_worry",
              behavior_index,
              behavior_text: behavior.text,
              rejected_text: stemmedText,
              rubric_score: rubric.score,
              is_fear: rubric.is_fear,
              is_first_person_felt: rubric.is_first_person_felt,
              touches_identity: rubric.touches_identity,
              rubric_reason: rubric.reason,
              prior_attempts: priorAttempts,
            },
            { stage: scope.currentStage },
          );
          return {
            status: "rejected",
            reason: `worry depth ${rubric.score}/3: ${rubric.reason}`,
            instruction:
              "This rejection is invisible plumbing. The coachee must NEVER see any reference to rubrics, validation, or rejection. In your next content block, write prose only, ending in exactly one excavation question that helps HIM name what's underneath. Do NOT propose your own deeper worry — his answer supplies the depth. Do NOT re-fire propose_worry this turn.",
          };
        }
        queueProposal("propose_worry", {
          type: "propose_worry",
          behavior_index,
          text: stemmedText,
        });
        scope.events.record(
          "rubric",
          {
            kind: "worry",
            score: rubric.score,
            accepted: true,
            reason: rubric.reason,
          },
          { stage: scope.currentStage },
        );
        return { status: "accepted" };
      },
    }),

    propose_commitments_batch: tool({
      description:
        'After the coachee has affirmed a drafted set of hidden competing commitments, propose the whole batch as one card. One item per locked worry, IN WORRY ORDER. Each item has a worry_index (1-based into the locked-worry list) and the commitment text.',
      inputSchema: z.object({
        items: z
          .array(
            z.object({
              worry_index: z.number().int().min(1),
              text: z.string().min(3).max(500),
            }),
          )
          .min(1),
      }),
      execute: async ({ items }): Promise<ToolResult> => {
        if (capReached()) return capReachedResult();
        queueProposal("propose_commitments_batch", {
          type: "propose_commitments_batch",
          items: items.map((i) => ({
            worry_index: i.worry_index,
            text: ensureStem(i.text, COMMITMENT_STEM),
          })),
        });
        return { status: "accepted" };
      },
    }),

    propose_assumption: tool({
      description:
        'Propose a Big Assumption that underwrites one or more commitments. commitment_indices are 1-based into the ordered commitments list. Rubric runs at proposal time — score < 2 is rejected. On rejection, ask an excavation question rather than re-propose.',
      inputSchema: z.object({
        text: z.string().min(3).max(500),
        commitment_indices: z.array(z.number().int().min(1)).min(1),
      }),
      execute: async ({ text, commitment_indices }): Promise<ToolResult> => {
        if (capReached()) return capReachedResult();
        const stemmedText = ensureStem(text, ASSUMPTION_STEM);
        const rubric = await scoreAssumptionDepth({
          goalText: scope.goalText ?? "",
          assumptionText: stemmedText,
        });
        if (rubric.score < 2) {
          scope.rejectionsCount.current++;
          scope.events.record(
            "rubric_rejected_proposal",
            {
              action_type: "propose_assumption",
              commitment_indices,
              rejected_text: stemmedText,
              rubric_score: rubric.score,
              rubric_reason: rubric.reason,
            },
            { stage: scope.currentStage },
          );
          return {
            status: "rejected",
            reason: `assumption depth ${rubric.score}/3: ${rubric.reason}`,
            instruction:
              "The rejection is invisible to the coachee. Your next content block is prose only, ending in one excavation question that helps HIM extend the 'then...' clause until it hits identity or Big Time Bad. Do NOT re-propose your own deeper version.",
          };
        }
        queueProposal("propose_assumption", {
          type: "propose_assumption",
          text: stemmedText,
          commitment_indices,
        });
        scope.events.record(
          "rubric",
          {
            kind: "assumption",
            score: rubric.score,
            accepted: true,
            reason: rubric.reason,
          },
          { stage: scope.currentStage },
        );
        return { status: "accepted" };
      },
    }),

    recommend_assumption: tool({
      description:
        'Recommend which locked Big Assumption to test first, with a brief reason. index is 1-based into the assumptions list. Renders as a card the coachee accepts or overrides.',
      inputSchema: z.object({
        index: z.number().int().min(1),
        reason: z.string().min(1).max(500),
      }),
      execute: async ({ index, reason }): Promise<ToolResult> => {
        if (capReached()) return capReachedResult();
        queueProposal("recommend_assumption_for_testing", {
          type: "recommend_assumption_for_testing",
          assumption_index: index,
          reason,
        });
        return { status: "accepted" };
      },
    }),

    select_assumption: tool({
      description:
        "Confirm the coachee's explicit pick of an assumption to test. Fire ONLY after he has clearly named the choice in chat. Renders as a small confirm card.",
      inputSchema: z.object({
        index: z.number().int().min(1),
      }),
      execute: async ({ index }): Promise<ToolResult> => {
        if (capReached()) return capReachedResult();
        queueProposal("select_assumption_for_testing", {
          type: "select_assumption_for_testing",
          assumption_index: index,
        });
        return { status: "accepted" };
      },
    }),

    save_test_design: tool({
      description:
        "Persist a drafted test after the coachee has affirmed all four fields. target_date is ISO YYYY-MM-DD and must fall within a week of today.",
      inputSchema: z.object({
        test_type: z.enum([
          "data_mining",
          "observation",
          "thought_experiment",
          "behavioral",
        ]),
        assumption_says: z.string().min(1).max(600),
        behavior_change: z.string().min(1).max(600),
        data_to_collect: z.string().min(1).max(600),
        in_order_to_find_out: z.string().min(1).max(600),
        target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      execute: async (input): Promise<ToolResult> => {
        if (capReached()) return capReachedResult();
        queueProposal("save_test_design", {
          type: "save_test_design",
          ...input,
        });
        return { status: "accepted" };
      },
    }),

    record_test_results: tool({
      description:
        "Record test results after the coachee returns and processes what he observed. Verdict is three-way (held/partially_challenged/challenged) per ITC framing — never pass/fail.",
      inputSchema: z.object({
        ran_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        what_i_did: z.string().min(1).max(1200),
        data_collected: z.string().min(1).max(1200),
        what_it_says_about_assumption: z.string().min(1).max(1200),
        assumption_verdict: z.enum([
          "held",
          "partially_challenged",
          "challenged",
        ]),
        next_step: z.enum(["new_test", "new_assumption", "map_complete"]),
      }),
      execute: async (input): Promise<ToolResult> => {
        if (capReached()) return capReachedResult();
        queueProposal("record_test_results", {
          type: "record_test_results",
          ...input,
        });
        return { status: "accepted" };
      },
    }),

    // ================================================================
    // Immediate tools — apply server-side, no card
    // ================================================================

    advance_stage: tool({
      description:
        'Advance the map to a specific stage. Server checks invariants (behaviors have worries paired, walkthrough delivered, etc.); an invariant failure returns the specific reason so your next turn addresses it.',
      inputSchema: z.object({
        to: z.enum([
          "goal",
          "behaviors",
          "worries",
          "commitments",
          "assumptions",
          "review",
          "immune_system",
          "prioritize",
          "test_design",
          "test_running",
          "results",
          "done",
        ]),
      }),
      execute: async ({ to }): Promise<ToolResult> => {
        const from = scope.currentStage;
        try {
          await advanceStage(scope.mapId, from, to as ItcStage);
          if (to === "done") {
            try {
              await markMapComplete(scope.mapId);
            } catch {
              // non-fatal
            }
          }
          if (from === "results" && to === "prioritize") {
            try {
              await clearSelectedAssumption(scope.mapId);
            } catch {
              // non-fatal
            }
          }
          scope.currentStage = to as ItcStage;
          scope.events.record(
            "action_apply",
            {
              action_type: "advance_stage",
              via: "tool",
              from,
              to,
            },
            { stage: to as ItcStage },
          );
          return {
            status: "applied",
            note: `map advanced ${from} -> ${to}`,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          scope.events.record(
            "action_rejected",
            {
              action_type: "advance_stage",
              via: "tool",
              from,
              to,
              error: message,
            },
            { stage: from },
          );
          // Persist a corrective system note so the coach's NEXT turn
          // (not just the same-turn recovery) sees the specific
          // invariant that blocked and can address it without
          // guessing. recentActionFeedback in the context builder
          // picks up messages starting with [action rejected].
          try {
            await appendMessage(
              scope.mapId,
              "system",
              `[action rejected] advance_stage ${from} → ${to}: ${message}`,
              from,
            );
          } catch {
            // non-fatal
          }
          return {
            status: "rejected",
            reason: message,
            instruction:
              "Address the invariant failure named above (usually a missing entry or unpaired row) before attempting to advance again. Do NOT retry advance_stage this turn.",
          };
        }
      },
    }),

    mark_walkthrough_delivered: tool({
      description:
        'Flag walkthrough_delivered=true after the three-movement immune-system walkthrough is complete AND the coachee has signaled readiness to test.',
      inputSchema: z.object({}),
      execute: async (): Promise<ToolResult> => {
        try {
          await markWalkthroughDelivered(scope.mapId);
          scope.events.record(
            "action_apply",
            { action_type: "mark_walkthrough_delivered", via: "tool" },
            { stage: scope.currentStage },
          );
          return { status: "applied" };
        } catch (err) {
          return {
            status: "rejected",
            reason: err instanceof Error ? err.message : String(err),
            instruction: "Failed to record; try again next turn.",
          };
        }
      },
    }),

    mark_reveal_delivered: tool({
      description:
        'Flag reveal_delivered=true after the brief gas-and-brake reveal beat at the commitments column. Only valid at commitments or assumptions stage and only when every locked worry already has a commitment.',
      inputSchema: z.object({}),
      execute: async (): Promise<ToolResult> => {
        try {
          const [worries, commitments] = await Promise.all([
            listWorries(scope.mapId),
            listCommitments(scope.mapId),
          ]);
          const locked = worries.filter((w) => w.depth_score !== null);
          const covered = new Set(commitments.map((c) => c.worry_id));
          const uncovered = locked.filter((w) => !covered.has(w.id));
          if (uncovered.length > 0) {
            return {
              status: "rejected",
              reason: `reveal blocked: ${uncovered.length} locked worries still have no commitment. Fire propose_commitments_batch first.`,
              instruction: "Land the commitments batch before marking the reveal delivered.",
            };
          }
          await markRevealDelivered(scope.mapId);
          scope.events.record(
            "action_apply",
            { action_type: "mark_reveal_delivered", via: "tool" },
            { stage: scope.currentStage },
          );
          return { status: "applied" };
        } catch (err) {
          return {
            status: "rejected",
            reason: err instanceof Error ? err.message : String(err),
            instruction: "Failed to record; try again next turn.",
          };
        }
      },
    }),
  };
}
