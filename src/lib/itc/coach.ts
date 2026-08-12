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
  // Replace the text of an existing behavior in place. index is 1-based
  // into the behavior list the coach sees. Use this for consolidation —
  // when the coachee's new phrasing sharpens an existing behavior, swap
  // the vaguer text for the sharper one rather than creating a duplicate.
  z.object({
    type: z.literal("replace_behavior"),
    index: z.number().int().min(1),
    text: z.string().min(1),
  }),
  // Propose a worry paired to a specific behavior. behavior_index is
  // 1-based into the behaviors list the coach sees. Server runs the depth
  // rubric before locking; a score <2 always rejects, a score of 2
  // requires at least two attempts on this behavior.
  z.object({
    type: z.literal("propose_worry"),
    behavior_index: z.number().int().min(1),
    text: z.string().min(1).max(500),
  }),
  // Propose a hidden competing commitment paired to a specific worry.
  // worry_index is 1-based into the locked-worry list the coach sees.
  // Server runs a self-protection rubric; commitments that sound like
  // productivity advice are rejected. Kept for edge cases; the primary
  // flow for this stage is propose_commitments_batch below.
  z.object({
    type: z.literal("propose_commitment"),
    worry_index: z.number().int().min(1),
    text: z.string().min(1).max(500),
  }),
  // Primary flow for column 3: after the coachee affirms the drafted
  // set, land every commitment in one action. One item per locked worry
  // (server rejects the batch if item count != locked worry count).
  // No per-item rubric — the drafts are derived from worries the
  // coachee already vetted, so we trust the coach here. If a draft is
  // weak, the coachee catches it in the review-and-tweak turn before
  // affirming.
  z.object({
    type: z.literal("propose_commitments_batch"),
    items: z
      .array(
        z.object({
          worry_index: z.number().int().min(1),
          text: z.string().min(1).max(500),
        }),
      )
      .min(1),
  }),
  // The v2 3.3b brief gas-and-brake reveal. Coach emits this after the
  // commitments column is complete; UI records that the beat happened so
  // the deeper immune-system walkthrough later doesn't repeat it.
  z.object({ type: z.literal("mark_reveal_delivered") }),
  // The deeper immune-system walkthrough (three movements) has been
  // delivered AND the coachee has explicitly said he's ready to move to
  // testing. Emit only when both are true — this action unlocks prioritize.
  z.object({ type: z.literal("mark_walkthrough_delivered") }),
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
  // Persist a drafted test after the coachee affirms all four fields.
  // Server auto-advances to test_running on successful save. target_date
  // must be an ISO date string (YYYY-MM-DD). Fires once the coachee has
  // signed off on the full four-field draft — same "affirm the batch"
  // pattern as commitments.
  z.object({
    type: z.literal("save_test_design"),
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
  // Persist test results after the coachee returns and processes his
  // observations. Server auto-advances test_running → results on save.
  // Verdict is deliberately three-way (held / partially_challenged /
  // challenged) per ITC's non-binary framing — never framed as pass/fail.
  z.object({
    type: z.literal("record_test_results"),
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

/**
 * Detects JSON-fragment leakage in the reply string. Observed in the wild:
 * `Here's the full map, locked - showing this]},."action"}) Wait, ignore
 * that formatting].` The model produces a technically-valid structured
 * response but the reply field contains schema-key artifacts, bracket
 * sequences, or a self-disclaimer about formatting. All three are signs
 * that structured output partially collapsed; we should retry rather than
 * ship the garbage to the coachee.
 */
export function looksLikeStructuredOutputLeakage(text: string): boolean {
  const trimmed = text.trim();
  // Schema key quoted mid-reply followed by JSON punctuation.
  if (
    /"(action|actions|items|text|type|worry_index|behavior_index|commitment_indices|assumption_index|reply|options|to|keep_indices|index|reason)"\s*[:,\]}]/.test(
      trimmed,
    )
  ) {
    return true;
  }
  // Model apologizing for JSON leakage in its own reply. Observed
  // variants: "ignore that formatting", "wait, the format leaked",
  // "let me answer properly", "sorry, that was internal", etc. The
  // shared signal is: model self-corrects mid-reply about output shape.
  if (
    /ignore (that|this|the) formatting|ignore this artifact|sorry.*(json|formatting|internal)|that was.*(json|internal)|ambient artifact|wait[,.]?\s*(the\s+)?(format|json|output|reply)\s+(leaked|is\s+off|slipped|got\s+through|bled)|let me (answer|reply|try|start|do that) (properly|again|correctly|over)|let me redo|scratch that.*(let me|here's)/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  // Placeholder / stub replies where the model returned a shape without
  // any content. Observed: "the reply is here", "reply goes here",
  // "response body goes here", "[content]", "TODO", etc. These all have
  // letters (so pass the actions.ts no-letters check) but are meaningless.
  const placeholderRe =
    /^(the |my |your )?(reply|response|answer|content|message|text)( is| goes)?( here| below| here now)?$|^\[?(placeholder|todo|tbd|fill in|content goes here|reply goes here|insert.*here)\]?$/i;
  if (placeholderRe.test(trimmed)) {
    return true;
  }

  // Truncated fragments — the model stopped mid-thought but the JSON
  // was still valid, so the SDK returned it. Observed: "keep going,
  // this one" (4 words, no terminal punctuation). Heuristic: short,
  // single-line replies that don't end with terminal punctuation are
  // very likely mid-sentence. Legitimate short coach replies end with
  // . ! ? " ) or ]. 200 chars is the ceiling — beyond that, the reply
  // is substantial enough that a missing final period is more likely
  // an intentional stylistic choice than truncation.
  if (
    trimmed.length < 200 &&
    !/\n/.test(trimmed) &&
    !/[.!?"')\]}]$/.test(trimmed)
  ) {
    return true;
  }
  // Two or more JSON-structural fragments in the same reply strongly
  // suggest bracket-sequence bleed.
  const structuralBits = [
    /\]\}/, // ]}
    /\}\)/, // })
    /\}"\s*:/, // }":
    /"\s*\}/, // " }
    /\}\s*,\s*"/, // }, "
  ];
  const hits = structuralBits.filter((re) => re.test(trimmed)).length;
  if (hits >= 2) return true;

  return false;
}

type ChatTurn = { role: "user" | "assistant"; content: string };

type RunCoachInput = {
  pillar: PillarCode;
  stage: ItcStage;
  improvementGoal: string | null;
  // Ordered exactly as the coach sees them in the context block. The
  // 1-based position in this array is what replace_behavior.index refers
  // to. `selected` is retained for legacy maps that still have parked
  // rows from the pre-consolidation flow.
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
    walkthroughDelivered: input.walkthroughDelivered,
    tests: input.tests,
    testResults: input.testResults,
    mapStatus: input.mapStatus,
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
      if (looksLikeStructuredOutputLeakage(object.reply)) {
        console.warn(
          "[itc] coach reply contained JSON-fragment leakage, retrying. raw=%o",
          object.reply,
        );
        lastError = new Error("structured-output leakage");
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
