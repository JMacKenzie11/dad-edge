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
  // Remove a behavior from the map. index is 1-based into the behavior
  // list the coach sees. Use this when the coachee asks to "drop" or
  // "remove" a behavior (typical trigger: a duplicate the coach
  // noticed after firing propose_behavior on both). Only allowed at
  // the behaviors stage — once worries are being paired against the
  // set, deletion would orphan a locked worry.
  z.object({
    type: z.literal("remove_behavior"),
    index: z.number().int().min(1),
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
  // Special / control tokens leaking from the tokenizer. Observed on
  // 2026-08-13: reply ended with "Want a fifth, or is that the set?
  // <|control11|>{" — the |...| angle-bracket token is a raw model
  // token that never should reach the coachee, and the trailing "{"
  // suggests a JSON object was starting to render. Catch any
  // <|...|> pattern, and any raw <endoftext> / <|endoftext|> variants.
  if (/<\|[^|>\n]{1,40}\|>/i.test(trimmed)) {
    return true;
  }
  if (/<\/?(?:endoftext|eot_id|start_header_id|end_header_id|bos|eos|s)[^>]*>/i.test(trimmed)) {
    return true;
  }
  // Reply ends with a bare "{" (or "{ " ), suggesting the model started
  // emitting an object after the prose. Bounded to trailing position so
  // legitimate uses of "{" mid-reply (rare — coach never quotes JSON)
  // don't trip. Combined with the length check on truncation elsewhere,
  // this catches the "…set? <|control11|>{" style of trailing garbage.
  if (/\{\s*$/.test(trimmed)) {
    return true;
  }
  // Schema key quoted mid-reply followed by JSON punctuation.
  if (
    /"(action|actions|items|text|type|worry_index|behavior_index|commitment_indices|assumption_index|reply|options|to|keep_indices|index|reason)"\s*[:,\]}]/.test(
      trimmed,
    )
  ) {
    return true;
  }
  // Unquoted schema tokens leaking as prose. Observed: reply ended with
  // "nAction: propose_worry with beh_derior_index=2, textting the worry
  // text." The model rendered the action metadata as plain English
  // instead of firing the action. No quotes to catch, so the first
  // check misses. Detect by looking for unquoted schema-shaped tokens:
  // an "Action:" label at the start of a line, an unquoted action-type
  // name mentioned in prose, or an assignment like "X_index=N".
  const unquotedSchemaRe =
    /(^|\n)\s*n?Action\s*[:=]|\b(propose_(?:worry|behavior|commitment|commitments_batch|goal|assumption)|advance_stage|mark_reveal_delivered|mark_walkthrough_delivered|save_test_design|record_test_results|replace_behavior|remove_behavior|suggest_behaviors|recommend_assumption_for_testing|select_assumption_for_testing)\b|\b(?:behavior|worry|assumption|commitment)_index\s*[=:]|\bkeep_indices\s*[=:]|\bcommitment_indices\s*[=:]|\btextting\b|setting the (worry|commitment|assumption) text/i;
  if (unquotedSchemaRe.test(trimmed)) {
    return true;
  }
  // Banned narration that the prompt explicitly forbids. Observed:
  // "That's worry #2." even though the prompt says "Do NOT number it
  // out loud." When the coach violates a banned phrase, treat the reply
  // as broken and retry — cheaper than shipping the violation.
  if (/\bThat['\u2019]?s worry #\d/i.test(trimmed)) {
    return true;
  }
  // Text-level corruption. Observed on the worry-box map: "I worry
  // that i worworry that ifbringing up her past". Doubled stem
  // fragments ("worworry", "comcommitment") and missing-space
  // compounds ("ifbringing", "andstill") are model-glitch signatures.
  // Regex catches: (a) the same 3+ letter run repeated back-to-back
  // ("worwor", "comcom"); (b) known "I worry that" appearing twice
  // in one string (a single worry has it once).
  const doubledStemRe = /\b(\w{3,})\1/i;
  if (doubledStemRe.test(trimmed)) {
    return true;
  }
  // Repeated stems WITHIN A SINGLE LINE. A numbered list with 4
  // "I'm also committed to..." items across separate lines is legit;
  // two of the same stem on the same line is corruption. Split on
  // newlines and check per line.
  for (const line of trimmed.split(/\n+/)) {
    const w = (line.match(/i worry that/gi) ?? []).length;
    const c = (line.match(/i['\u2019]m also committed to/gi) ?? []).length;
    const a = (line.match(/i assume that/gi) ?? []).length;
    if (w >= 2 || c >= 2 || a >= 2) return true;
  }
  // Global sanity — no reply should have 8+ stem occurrences of any
  // one kind; that's corruption, not just a long draft list.
  const worryStemCount = (trimmed.match(/i worry that/gi) ?? []).length;
  const commitStemCount = (trimmed.match(/i['\u2019]m also committed to/gi) ?? []).length;
  const assumptionStemCount = (trimmed.match(/i assume that/gi) ?? []).length;
  if (worryStemCount > 8 || commitStemCount > 8 || assumptionStemCount > 8) {
    return true;
  }

  // Model reasoning-chain leak. Observed: the model wrote its INTERNAL
  // editing narrative as the reply ("Let's writing the actual reply
  // text properly now:", "Now the last worry locked, that would give
  // commitments column intro"). Two markers:
  //  1. Meta-editing phrases where the model announces it's about to
  //     write the "real" reply. If those appear, the current reply
  //     text is the internal chain, not the intended output.
  //  2. The reply ends with a trailing colon and nothing after —
  //     model was about to deliver content and stopped mid-transition.
  const metaEditingRe =
    /let(['\u2019]?s| me) (writ(e|ing)|start|try|do that|answer|reply|say|redo|give) (the |a |it )?(actual|real|proper|properly|new|full|next|out)|writing the actual reply|reply text (properly|correctly|again)|(now|here) (i|let me) write|actually let me|step(ping)? back|final json|produce (the |a )?(final |proper )?(json|reply|response|output)|write (this |the |it )?(out |up )?properly|need to (produce|write|generate|deliver|give)/i;
  if (metaEditingRe.test(trimmed)) {
    return true;
  }
  // Bare mention of the word "JSON" in a coach reply. The coach never
  // has occasion to talk about JSON, output formats, or schemas —
  // that's model-side plumbing. If the word appears, the model leaked
  // its own reasoning about the output shape.
  if (/\bjson\b/i.test(trimmed)) {
    return true;
  }
  // Trailing brace runs like "}}}" or "}}." — JSON structure that
  // spilled out of the object into the visible reply. A single
  // "}" trailing is caught above; two or more in a row is unambiguous.
  if (/\}\s*\}/.test(trimmed)) {
    return true;
  }
  // Trailing colon with no continuation. A legitimate reply that ends
  // in `:` would have a newline + list items following (the caller
  // provides no such continuation, so we see `:` as the last char).
  // Distinct from the earlier truncation guard, which only fires on
  // replies under 200 chars.
  if (/:\s*$/.test(trimmed) && !/\n[-*\d]/.test(trimmed)) {
    return true;
  }
  // Third-person coach self-narrative. Observed: "that would means
  // she'd think less of him and he'd look weak as a man" — coach
  // referred to the coachee as "he/him" in a fear description. Coach
  // addresses the coachee as "you" per prompt. A reply that uses
  // "he'd" or "him" or "his" in a way that reads like the coach
  // narrating ABOUT the coachee (not quoting his wife or a third
  // party) is a chain-leak. Detect via a conservative pattern: the
  // reply references "he'd" or "he would" in a fear/behavior
  // description context. False-positive risk is real, so only trip
  // when combined with the fear/worry framing that would obviously be
  // second-person if the coach were talking TO the coachee.
  const thirdPersonNarrativeRe =
    /\b(he['\u2019]?d|he would|he['\u2019]?s|his) (look|feel|be exposed|be seen|think|worry|fear|end up|become|prove) /i;
  if (thirdPersonNarrativeRe.test(trimmed)) {
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
    /^(the |my |your )?(reply|response|answer|content|message|text)( is| goes)?( here| below| here now)?$|^\[?(placeholder|todo|tbd|fill in|content goes here|reply goes here|insert.*here)\]?$|^\[(content|reply|response|answer|message|text|placeholder|todo|tbd)\]$/i;
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
    // Per-attempt timeout — observed a "coach spins forever after user
    // types 'OK'" case where the request never returned. Cap at 90s so
    // three attempts is bounded at ~4.5 minutes worst case and the
    // fallback path still gets a chance to run.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);
    try {
      const { object } = await generateObject({
        model: itcCoachModel(),
        schema: CoachReplySchema,
        system,
        messages,
        // NOTE: temperature is NOT supported by claude-sonnet-5 — the
        // AI SDK warns and ignores it. Leaving it off explicitly so we
        // don't get a confusing runtime warning. If we switch to a
        // model that supports temperature, add it back.
        // 8192 (doubled from 4096) so the batch+reveal turn and the
        // full immune-system walkthrough have room without truncating.
        maxOutputTokens: 8192,
        abortSignal: controller.signal,
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
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Plain-text fallback so the coachee always receives a real message.
  // Tell the model that structured output failed and to answer in prose;
  // no action is emitted, so nothing state-machine touches the DB.
  console.warn(
    "[itc] coach structured-output failed after retries, falling back to text:",
    lastError instanceof Error ? lastError.message : String(lastError),
  );
  const fallbackController = new AbortController();
  const fallbackTimeoutId = setTimeout(
    () => fallbackController.abort(),
    60_000,
  );
  let text = "";
  try {
    const result = await generateText({
      model: itcCoachModel(),
      system: `${system}\n\nIMPORTANT: Reply in plain prose ONLY. Do NOT emit JSON. No action fields — the previous attempt to produce structured output failed. Keep the reply short and helpful; the coachee should not see the failure.`,
      messages,
      maxOutputTokens: 4096,
      abortSignal: fallbackController.signal,
    });
    text = result.text;
  } catch (err) {
    console.warn(
      "[itc] coach text fallback also failed: %s",
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(fallbackTimeoutId);
  }
  const fallback = text.trim();
  return {
    reply: fallback.length > 0 ? fallback : "Give me one more sec — mind repeating that?",
    action: null,
  };
}
