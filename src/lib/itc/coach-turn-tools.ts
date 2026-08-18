/**
 * Native tool-use coach turn.
 *
 * Runs a single coach turn using Anthropic's native tool use through
 * the AI SDK. The coach writes prose to the coachee and, in the same
 * response, fires zero or more tool calls carrying schema-validated
 * action payloads. Content actions queue into scope.pendingProposals
 * for the caller to persist as itc_action_proposals cards; immediate
 * actions apply server-side during the call.
 *
 * Multi-step: `stopWhen: stepCountIs(2)` gives the model one
 * opportunity to react to a rubric rejection in the same turn. The
 * recovery step must end on an excavation question and cannot re-fire
 * a proposal (enforced by capReached() inside every tool executor —
 * see coach-tools.ts).
 */

import { generateText, stepCountIs } from "ai";
import type { SystemModelMessage } from "@ai-sdk/provider-utils";
import { mainModel } from "@/lib/model-config";
import { PILLAR_BY_CODE } from "@/lib/pillars";
import { buildCoachTools, type PendingProposal, type TurnScope } from "./coach-tools";
import { buildItcCoachSystemSplit } from "./prompts";
import type { ItcStage } from "./stage";
import type { TurnEventLog } from "./turn-events";
import type { PillarCode } from "@/lib/pillars";

/**
 * Canned prose acknowledgment used when a forced-tool run returned
 * no visible reply text (model spent everything on the tool call).
 * Reads the queued proposal's content so the card gets a natural
 * framing line above it.
 */
function cannedForcedReply(proposal: PendingProposal): string {
  const p = proposal.payload as { text?: string };
  const text = p.text?.trim() ?? "";
  switch (proposal.action_type) {
    case "propose_behavior":
      return text.length > 0
        ? `Got it. "${text}". What else shows up in that moment?`
        : "Got it. What else shows up in that moment?";
    default:
      return "Got it.";
  }
}

/**
 * When the coachee's last message looks like a candidate entry for
 * the current content stage, we force the coach's tool choice so it
 * cannot return prose-only. Deterministic guarantee that the state
 * change lands as a card the coachee can tap. The prompt has said
 * "fire the tool" from day one and the model has ignored it too
 * often; this is the belt.
 *
 * Detection is intentionally simple and additive: a message is a
 * candidate entry if it (a) doesn't end with a question mark, (b)
 * doesn't contain a suggestion-asking phrase, and (c) starts with a
 * first-person pattern OR describes a self-directed action. Anything
 * else falls through to auto tool choice so the coach can probe or
 * offer suggestions freely.
 *
 * Returns the specific tool name to force, or null to leave the
 * choice to the model.
 */
function forcedToolChoiceFor(
  stage: ItcStage,
  userMessage: string,
): string | null {
  const trimmed = userMessage.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.endsWith("?")) return null;
  if (
    /\b(suggest|suggestion|example|help me|not sure|what should|give me some|give me a few|can you|any ideas|options|what would|what could|any more)\b/i.test(
      trimmed,
    )
  ) {
    return null;
  }
  // Inner-state openers. If the message starts with a self-reported
  // feeling / thought / desire, it's NOT a behavior — the behaviors
  // stage prompt says to convert those into behaviors by asking
  // "when you're X, what do you actually do?" Forcing propose_behavior
  // here made the coach hallucinate (it grabbed the previous
  // behavior's text because it had nothing real to propose).
  const innerStateOpener =
    /^\s*(I|I'm|I've|I'd|I'll)\s+(feel|felt|feeling|think|thought|believe|believed|want|wanted|need|needed|worry|worried|wonder|wondered|hope|hoped|wish|wished|know|knew|understand|understood|remember|remembered|imagine|imagined|hate|hated|love|loved|assume|assumed|am|was|were|get|got|felt like|kind of|sort of)\b/i;
  if (innerStateOpener.test(trimmed)) return null;
  // First-person pattern check. Covers "I ...", "I'm ...", "Yeah I ...",
  // "When I ...", "Well when I ...", etc.
  const firstPerson = /\b(I|I'm|I've|I'll|I'd)\s+\w/i.test(trimmed);
  if (!firstPerson) return null;
  // Minimum length: too short and it's probably a filler affirmation.
  if (trimmed.length < 15) return null;

  switch (stage) {
    case "behaviors":
      return "propose_behavior";
    // Extend to other content stages as we prove the pattern:
    //   worries → propose_worry (needs behavior_index inference)
    //   commitments → propose_commitments_batch
    //   assumptions → propose_assumption (needs commitment_indices)
    // Not forcing on those stages yet — behavior_index / commitment
    // indices need a resolver first, otherwise the forced call fires
    // with wrong indices.
    default:
      return null;
  }
}

/**
 * Cut the coach's visible reply at the first premature-advance
 * signal. Premature advance = coach claiming to lock a proposal it
 * just fired (the coachee taps to lock, not the coach) or opening
 * the exposition for a later stage before the coachee has advanced.
 *
 * Called ONLY when a content proposal was queued in the same turn.
 * If no proposal was queued the coach is legitimately talking about
 * the current stage's substance and shouldn't be truncated.
 *
 * Regex-based, deterministic, stage-aware. If nothing matches, the
 * original reply is returned unchanged. If a match hits, everything
 * from the match onward is dropped and any trailing whitespace is
 * trimmed. The last remaining sentence gets a period if it doesn't
 * already end with one.
 */
function stripPrematureAdvance(reply: string, stage: ItcStage): string {
  // Signals that mean "the coach jumped ahead." Ordered so the
  // most-specific patterns fire first.
  //
  // "Locked" / "Locked." at a paragraph or sentence start is the
  // coach claiming acceptance the coachee hasn't given. "Column N"
  // where N > current stage's column is exposition for a later
  // stage. Stage-specific triggers (worry box, hidden commitment,
  // etc.) catch the next-stage exposition even when the coach
  // doesn't say "Column N".
  const currentColumn = stageColumnNumber(stage);
  const patterns: RegExp[] = [
    // "Locked" or "Locked." at start of a sentence or paragraph.
    // Covers "\nLocked." and ". Locked." positions.
    /(^|[.!?]\s+|\n)Locked\b[^.!?\n]*[.!?]?/i,
  ];
  // "Column N" for any N greater than the current stage's column.
  for (let n = currentColumn + 1; n <= 5; n++) {
    patterns.push(
      new RegExp(`(^|\\n|[.!?]\\s+)[^.!?\\n]*\\bColumn\\s+${n}\\b`, "i"),
    );
  }
  // Stage-specific next-stage exposition triggers.
  const nextStageTriggers: Partial<Record<ItcStage, RegExp[]>> = {
    goal: [
      /(^|\n|[.!?]\s+)[^.!?\n]*\b(the behaviors|what you actually do|what you do or fail to do|First one that comes to mind)/i,
    ],
    behaviors: [
      /(^|\n|[.!?]\s+)[^.!?\n]*\b(worry box|the fear underneath|worries stage)/i,
    ],
    worries: [
      /(^|\n|[.!?]\s+)[^.!?\n]*\b(hidden commitment|competing commitment|the commitment column)/i,
    ],
    commitments: [
      /(^|\n|[.!?]\s+)[^.!?\n]*\b(Big Assumption|the assumption column)/i,
    ],
    assumptions: [
      /(^|\n|[.!?]\s+)[^.!?\n]*\b(immune system walkthrough|the walkthrough)/i,
    ],
  };
  for (const p of nextStageTriggers[stage] ?? []) patterns.push(p);

  let cutAt = -1;
  for (const p of patterns) {
    const m = p.exec(reply);
    if (m && (cutAt === -1 || m.index < cutAt)) cutAt = m.index;
  }
  if (cutAt === -1) return reply;

  const kept = reply.slice(0, cutAt).replace(/\s+$/, "");
  if (kept.length === 0) return reply; // don't strip everything
  // Ensure the last kept sentence ends with punctuation so the coachee
  // doesn't read a truncated fragment.
  if (!/[.!?]$/.test(kept)) return kept + ".";
  return kept;
}

function stageColumnNumber(stage: ItcStage): number {
  switch (stage) {
    case "goal":
      return 1;
    case "behaviors":
      return 2;
    case "worries":
      return 3;
    case "commitments":
      return 4;
    case "assumptions":
    case "review":
    case "immune_system":
    case "prioritize":
      return 5;
    default:
      return 6;
  }
}

function promptCachingEnabled(): boolean {
  const raw = process.env.ITC_PROMPT_CACHE;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Static addendum spliced onto the coach's system prompt when running
 * the tool-use path. Explains the tool contract, the rubric-rejection
 * recovery rule, and the "never surface plumbing to the coachee" rule.
 * Kept small — the bulk of coaching guidance still lives in the
 * per-stage prompts.
 */
const TOOLS_ADDENDUM = `
===== YOU HAVE TOOLS (native tool use) =====

You produce two kinds of output in a single response:
  1. Prose content blocks — plain text the coachee reads verbatim.
  2. Tool calls — schema-validated actions that either become cards
     the coachee accepts/edits/rejects, or apply immediately server-side.

The prose is the coaching. The tool call is the state change carrying
the exact same content the prose refers to. When you draft a worry, a
behavior, a commitment, or an assumption in prose, fire the matching
propose_X tool with that exact text in the same response. The card
renders under your message. One tap for the coachee to accept.

Tools available:
  Content (become cards):
    propose_goal, propose_behavior, propose_behavior_replacement,
    remove_behavior, propose_worry, propose_commitments_batch,
    propose_assumption, recommend_assumption, select_assumption,
    save_test_design, record_test_results
  Immediate (apply server-side, no card):
    mark_walkthrough_delivered, mark_reveal_delivered

You do NOT have an advance_stage tool. Stage transitions are the
coachee's action. When the current column's set is done and he
signals readiness, ask him a simple ready-check ("Ready for the
worry box?") and stop. He'll advance the map himself. Do NOT
preemptively open the next column in the same reply that fires a
content proposal or right after the coachee accepts one; wait for
him to advance and let the server-seeded intro carry the transition.

Rules about tool use:
- NEVER reference tools, cards, rubrics, validation, JSON, schemas,
  or any part of this machinery in visible prose. The coachee reads
  ONLY the natural coaching text. If a tool result comes back
  rejected, that message is for your eyes only.
- When you propose content, your prose says the content naturally
  ("Sharper would be: 'I lie or make excuses to get out of admitting
  she's right.' Does that land?"). The tool carries the same text.
- If a rubric rejects a proposal (worries and assumptions have depth
  rubrics), you get one recovery step in the same turn. That step
  must be prose only, ending in exactly one excavation question that
  helps HIM name what's underneath. Do NOT re-propose a deeper
  version — his answer supplies the depth. You may not fire another
  proposal tool in the same turn after any rejection; the cap is one
  rejection per turn.

Speak to the coachee naturally. The machinery is invisible.
`.trim();

function toCoachSystem(
  staticPart: string,
  dynamic: string,
): string | SystemModelMessage[] {
  if (!promptCachingEnabled()) {
    return `${staticPart}\n\n${dynamic}`;
  }
  return [
    {
      role: "system",
      content: staticPart,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    },
    { role: "system", content: dynamic },
  ];
}

type ChatTurn = { role: "user" | "assistant"; content: string };

export type ToolTurnInput = {
  pillar: PillarCode;
  stage: ItcStage;
  improvementGoal: string | null;
  mapId: string;
  behaviors: { id: string; text: string; selected: boolean }[];
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
  walkthroughDelivered: boolean;
  tests: {
    id: string;
    assumption_id: string;
    test_type: string;
    assumption_says: string | null;
    behavior_change: string | null;
    data_to_collect: string | null;
    in_order_to_find_out: string | null;
    target_date: string | null;
    status: string;
  }[];
  testResults: {
    test_id: string;
    ran_on: string | null;
    what_i_did: string | null;
    data_collected: string | null;
    what_it_says_about_assumption: string | null;
    assumption_verdict: string | null;
    next_step: string | null;
  }[];
  mapStatus: string;
  recentActionFeedback: string[];
  history: ChatTurn[];
  userMessage: string;
  events: TurnEventLog;
};

export type ToolTurnResult = {
  reply: string;
  pendingProposals: PendingProposal[];
  stageAfter: ItcStage;
  hadRubricRejection: boolean;
  stepTexts: string[];
  toolCallCount: number;
};

export async function runItcCoachTurnWithTools(
  input: ToolTurnInput,
): Promise<ToolTurnResult> {
  const pillar = PILLAR_BY_CODE[input.pillar];
  const built = buildItcCoachSystemSplit({
    pillarLabel: pillar.label,
    stage: input.stage,
    improvementGoal: input.improvementGoal,
    behaviors: input.behaviors,
    worries: input.worries,
    commitments: input.commitments,
    assumptions: input.assumptions,
    walkthroughDelivered: input.walkthroughDelivered,
    tests: input.tests,
    testResults: input.testResults,
    mapStatus: input.mapStatus,
    recentActionFeedback: input.recentActionFeedback,
  });
  const staticWithTools = `${built.static}\n\n${TOOLS_ADDENDUM}`;
  const system = toCoachSystem(staticWithTools, built.dynamic);

  const messages = [
    ...input.history,
    { role: "user" as const, content: input.userMessage },
  ];

  const scope: TurnScope = {
    mapId: input.mapId,
    currentStage: input.stage,
    goalText: input.improvementGoal,
    rejectionsCount: { current: 0 },
    maxRejections: 1,
    pendingProposals: [],
    events: input.events,
  };

  const tools = buildCoachTools(scope);

  const forcedTool = forcedToolChoiceFor(input.stage, input.userMessage);
  const toolChoice = forcedTool
    ? ({ type: "tool" as const, toolName: forcedTool as keyof typeof tools })
    : undefined;
  // When we force a tool, cap at ONE step. Otherwise the auto-choice
  // second step tends to fire ANOTHER content tool (coach invents
  // extra items). No rubric runs on behaviors, so no recovery step
  // is needed. Auto-choice runs get the standard 2-step budget so
  // rubric rejections on worries/assumptions still recover in-turn.
  const stopCondition = forcedTool ? stepCountIs(1) : stepCountIs(2);

  const attemptStart = Date.now();
  const result = await generateText({
    model: mainModel(),
    system,
    messages,
    tools,
    toolChoice,
    stopWhen: stopCondition,
    maxOutputTokens: 4096,
  });
  const llmMs = Date.now() - attemptStart;

  // Collect prose from each step. Anthropic returns text blocks
  // interleaved with tool_use blocks per step; the SDK exposes each
  // step's `.text` as the concatenated text of that step's text blocks.
  const stepTexts = result.steps.map((s) => s.text.trim()).filter(Boolean);

  const hadRubricRejection = scope.rejectionsCount.current > 0;

  // Visible reply policy:
  // - On rubric rejection: show ONLY the final step's text (the
  //   recovery question). Any prose from the failed first attempt
  //   would confuse the coachee.
  // - No rejection: concatenate step texts. In practice step 2 is
  //   often empty (model already said its piece in step 1); if the
  //   model does add a follow-up, it's usually a short acknowledgment.
  const rawReply = hadRubricRejection
    ? (stepTexts[stepTexts.length - 1] ?? "")
    : stepTexts.join("\n\n");
  // Belt-and-suspenders em-dash strip. Preamble bans them but the model
  // still ships them. Replace " — " with ", " (comma joiner preserves
  // clause flow; earlier attempts with ". " produced sentence
  // fragments starting with a lowercase word). Strip any leftover bare
  // em dashes to a comma.
  const dashStripped = rawReply
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/[—–]/g, ",")
    .replace(/\s+--\s+/g, ", ");

  // Premature-advance guard. When a content proposal is queued in
  // this turn, the coach must not preemptively open the next stage
  // or claim the card is "locked" (nothing is locked until the
  // coachee taps Add to map + Continue). The prompt states this as
  // a hard rule; the model ignores it. Deterministic strip cuts the
  // reply at the first premature-advance signal.
  const stripped =
    scope.pendingProposals.length > 0
      ? stripPrematureAdvance(dashStripped, scope.currentStage)
      : dashStripped;
  // Forced-tool fallback: when we constrained toolChoice to a
  // specific tool, the model tends to fire the tool and skip prose
  // entirely. Coachee would see a card with no framing message.
  // Fill in a plain acknowledgment from the queued proposal's
  // content so the card has a natural intro.
  const reply =
    forcedTool && stripped.trim().length === 0 && scope.pendingProposals.length > 0
      ? cannedForcedReply(scope.pendingProposals[0])
      : stripped;

  input.events.record(
    "llm_attempt",
    {
      kind: "tools",
      steps: result.steps.length,
      tool_calls: result.toolCalls.length,
      queued_proposals: scope.pendingProposals.length,
      had_rubric_rejection: hadRubricRejection,
    },
    { durationMs: llmMs, stage: scope.currentStage },
  );

  return {
    reply,
    pendingProposals: scope.pendingProposals,
    stageAfter: scope.currentStage,
    hadRubricRejection,
    stepTexts,
    toolCallCount: result.toolCalls.length,
  };
}
