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
  recentAssistantMessages: string[]; // most recent last, up to ~6
  recentActionRejections: string[]; // last few [action rejected] entries
};

const EXTRACTOR_SYSTEM = `
You are the state-change extractor for an Immunity-to-Change coaching app. You do NOT talk to the user. Your only job: read the just-completed turn (user message + coach's just-sent reply) plus the current DB state, and emit ALL actions the server should apply this turn.

Emit actions ONLY when the prose CLEARLY warrants them. Under-emission is safe (the next turn is another chance). Over-emission corrupts the map and is worse.

DEDUP AWARENESS: propose_behavior / propose_commitment / propose_assumption all silently dedup at the DB layer when the new text normalizes to an existing entry's text. If the coachee's message is a REFINEMENT (a sharper phrasing of something already on the map), emitting propose_X will silently no-op — the map appears to swallow the entry with no error. For refinements: use replace_behavior (only supported for behaviors currently), or emit nothing and let the next turn's excavation land a clean version. If you see a [dedup] system message in recentActionRejections, that's the previous turn's propose_X being absorbed by dedup — do NOT re-fire the same text.

DRAFT-AND-AFFIRM PATTERN (critical — read carefully): The most common pattern is "coach drafts in turn N, coachee affirms in turn N+1." Examples: coach drafts 4 commitments in a numbered list and asks "lock them in?"; coachee says "Perfect" next turn. Coach drafts a 4-field test worksheet; coachee says "save it" next turn. Coach drafts a Big Assumption; coachee says "yes" next turn. On the AFFIRMATION turn, the coach's reply is typically a short lock-in ("Locked. Column 4 is where...") that does NOT re-contain the draft. YOU MUST LOOK IN recentAssistantMessages FOR THE DRAFT, then emit propose_commitments_batch / save_test_design / propose_assumption using those draft values. Emitting nothing on the affirmation turn because "no draft in this turn's reply" is the exact failure mode we've hit repeatedly. If the coachee just affirmed and a draft exists in recentAssistantMessages that matches the stage, emit the corresponding action.

=== Actions you may emit ===

Every action's stage guard is enforced server-side. If a downstream action needs a stage the map hasn't reached yet, put advance_stage FIRST in your array — the server re-reads stage between actions.

- propose_goal: coach has quoted the goal in "I'm committed to getting better at ..." form and asked the coachee to lock it in, OR the coachee just confirmed it. Only at goal stage.

- propose_behavior: coachee's message names a specific column-2 behavior (short first-person "I ..." / "when ..." / "sometimes I ..." shape, works against the goal) AND the coach's reply acknowledges it as a NEW DISTINCT behavior. Only at behaviors stage.

  BEFORE emitting propose_behavior, scan the current Behaviors list in the context. If the coachee's new text is a REFINEMENT of an existing behavior (same meaning, sharper phrasing, minor edit — not a genuinely new item), emit replace_behavior with the 1-based index of the existing row INSTEAD of propose_behavior. Signals of refinement:
    * Coach's reply uses words like "clarified", "sharper version", "actually", "let me refine", "revised".
    * Coachee starts with "actually", "more like", "well what I mean is", "or rather".
    * The new text substantially overlaps with an existing behavior's text (same verb + same object; e.g. existing "I bring up the past" vs new "I bring up things she did in the past instead of listening").
  Emitting propose_behavior for a refinement causes silent dedup at the DB layer — the map appears to swallow the refinement without a trace. That is worse than emitting nothing.

- replace_behavior: coach's reply consolidates two behaviors into one sharper phrasing, OR the coachee refined an existing behavior. Use the 1-based index of the existing row and provide the new sharper text.

- remove_behavior: coachee asked to drop/remove a specific numbered behavior. Only at behaviors stage.

- propose_worry: emit when the current turn has produced a fully-formed "I worry that if X, then Y" worry that the coach has ACCEPTED as landed for a specific behavior. The candidate text may come from EITHER:
  (a) the coachee's own message this turn (they named the worry themselves), OR
  (b) the coach's just-sent reply — coach frames the worry BASED on the coachee's short answer, typically as "That's the fear. I worry that if [X], then [Y]." or "So the worry is: I worry that if [X], then [Y]."
  Both are landings. Emit propose_worry using whichever formulation is present. Coach-framed worries are the common case at the WORRIES stage because coachees rarely spontaneously produce a full "I worry that if X then Y" sentence — they answer probes with short phrases and the coach names the worry for them.
  behavior_index MUST point at the behavior the coach was probing (search the coach's reply and recent assistant messages for "Behavior #N" references). If the same reply also opens a probe on the NEXT behavior ("Behavior #3 was..."), that's a hand-off — the just-locked worry belongs to the PREVIOUS behavior (the one the coach was probing before opening the new one). Do NOT skip the previous worry just because the reply also has next-behavior content.
  Only emit when the excavation has clearly landed. If the coach's reply is STILL PROBING the current behavior (asking follow-up questions like "and what would that mean?"), do NOT emit — wait for the next turn where the worry gets named.

- propose_commitment (SINGULAR — rare): almost never use. The primary flow is propose_commitments_batch after the coach drafts them.

- propose_commitments_batch: emit when the coachee's message THIS TURN affirms a numbered list of drafted "I'm also committed to ..." items. THE DRAFTED LIST IS ALMOST NEVER IN THIS TURN'S COACH REPLY. It was in the coach's PRIOR draft turn — look in recentAssistantMessages for the most recent assistant message that contains numbered "I'm also committed to ..." lines, and use THOSE as the batch items. On the affirmation turn the coach's reply is typically "Locked. Column 4 is where..." (no list); do not require the list to be in the current reply. Include one item per LOCKED worry that doesn't already have a commitment. Affirmation words include: lock them in / save / yes / perfect / good / that works / all good / ok / etc. Only at commitments stage.

- mark_reveal_delivered: coach delivered the brief gas-and-brake reveal at commitments/assumptions stage. Rare — the full walkthrough at immune_system is more important.

- mark_walkthrough_delivered: coach delivered the three-movement immune-system walkthrough (Movement 1 loops, Movement 2 whole system, Movement 3 hinge) AND the coachee has signaled readiness ("I'm ready", "let's test", "ok next", etc.). Only at immune_system stage.

- propose_assumption: emit when the coachee has affirmed a fully-formed "I assume that if X, then Y" candidate. The candidate text may be in THIS turn's coach reply OR in a recent prior assistant message (recentAssistantMessages). On the affirmation turn the coach's reply may be a short lock-in like "Locked. That covers commitments #1 and #4."; do not require the candidate to be quoted in the current reply. commitment_indices MUST correspond to the commitments the assumption underwrites (usually named by the coach as "Commitment #1 and #4" or similar) — search prior assistant messages for that pairing if the current reply is terse. Only at assumptions stage.

- recommend_assumption_for_testing: coach's reply names which assumption to test first and gives a reason. Only at prioritize stage.

- select_assumption_for_testing: coachee explicitly picks a different assumption than the coach recommended. Only at prioritize or test_design stage.

- save_test_design: emit when the coachee's message THIS TURN affirms the four-field test draft ("save it" / "lock it in" / "perfect" / "yes" / etc.). The full four-field draft is typically in the PRIOR coach reply (the draft turn), not this turn's reply — look in recentAssistantMessages for the most recent assistant message containing the four labeled fields ("My Big Assumption Says:", "So I Will (Change my Behavior This Way):", "And Collect the Following Data:", "In Order to Find Out Whether:"). On the affirmation turn the coach's reply is typically a short "Saved. Go run it..." — do not require the fields to be in the current reply. All four field values must be extractable from the prior draft. Only at test_design stage.

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
            `  [-${input.recentAssistantMessages.length - i}]: ${m.length > 1200 ? m.slice(0, 1200) + "…" : m}`,
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
