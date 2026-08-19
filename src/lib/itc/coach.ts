/**
 * The coach LLM under Form-First.
 *
 * The coach never writes state. It reads the map + the transcript
 * and responds in prose. Three generation functions:
 *
 *   generateCoachChat(input)     — free-form chat reply, prose only.
 *   generateCoachReaction(input) — reaction to a just-added entry.
 *                                  Returns { reply, refinement?,
 *                                  suggestions? } via generateObject.
 *                                  refinement is a one-line sharper
 *                                  version the coachee can tap to
 *                                  fill the input; suggestions are
 *                                  the same shape for 4-5 options.
 *                                  Chips are cosmetic — a missing
 *                                  chip degrades to plain prose, an
 *                                  entry never fails to land.
 *   generateSuggestions(input)   — "Give me ideas" trigger. 4-5
 *                                  grounded options via generateObject.
 *
 * All three use the same preamble + stage prompt + map-state context
 * as before, minus every rule about firing tools, emitting markers,
 * locking, or claiming to have saved anything.
 */

import { generateObject, generateText } from "ai";
import type { SystemModelMessage } from "@ai-sdk/provider-utils";
import { z } from "zod";
import { mainModel } from "@/lib/model-config";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { buildItcCoachSystemSplit } from "./prompts";
import type { ItcStage } from "./stage";

function promptCachingEnabled(): boolean {
  const raw = process.env.ITC_PROMPT_CACHE;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Split the coach system prompt into two SystemModelMessage entries
 * and mark the static half as cacheable when the env flag is on.
 * Cache-read is 10% of input cost, cache-write 125%. Break-even after
 * ~3 turns in the same 5-minute TTL. Same model input either way.
 */
function toCoachSystem(
  staticPart: string,
  dynamic: string,
): string | SystemModelMessage[] {
  if (!promptCachingEnabled()) return `${staticPart}\n\n${dynamic}`;
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

type MapContextInput = {
  pillar: PillarCode;
  stage: ItcStage;
  improvementGoal: string | null;
  behaviors: { id: string; text: string; selected: boolean }[];
  worries: {
    behavior_id: string;
    text: string;
    depth_score: number | null;
  }[];
  commitments: {
    id: string;
    worry_id: string;
    text: string;
    depth_score: number | null;
  }[];
  assumptions: {
    id: string;
    text: string;
    depth_score: number | null;
    selected_for_testing: boolean;
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
};

function buildSystem(input: MapContextInput): string | SystemModelMessage[] {
  const pillar = PILLAR_BY_CODE[input.pillar];
  const built = buildItcCoachSystemSplit({
    pillarLabel: pillar.label,
    pillarDomain: pillar.domain,
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
    recentActionFeedback: [],
  });
  return toCoachSystem(built.static, built.dynamic);
}

// -------------------------------------------------------------------------
// generateCoachChat — plain prose reply to a chat message
// -------------------------------------------------------------------------

export type ChatInput = MapContextInput & {
  history: ChatTurn[];
  userMessage: string;
};

export type ChatOutput = { reply: string; durationMs: number };

export async function generateCoachChat(input: ChatInput): Promise<ChatOutput> {
  const system = buildSystem(input);
  const messages: ChatTurn[] = [
    ...input.history,
    { role: "user", content: input.userMessage },
  ];
  const started = Date.now();
  try {
    const { text } = await generateText({
      model: mainModel(),
      system,
      messages,
      maxOutputTokens: 2048,
    });
    return { reply: scrubReply(text), durationMs: Date.now() - started };
  } catch (err) {
    console.warn(
      "[itc coach chat] failure: %s",
      err instanceof Error ? err.message : String(err),
    );
    return { reply: "", durationMs: Date.now() - started };
  }
}

// -------------------------------------------------------------------------
// generateCoachReaction — async response to a just-added entry
// -------------------------------------------------------------------------

const ReactionSchema = z.object({
  /** Prose the coachee reads. Two or three sentences, coaching voice. */
  reply: z.string().min(1).max(1200),
  /** Optional one-line sharper phrasing of the entry the coachee just
   *  added. Renders as a "Use this wording" chip that fills the input
   *  when tapped. Omit unless the sharper version is genuinely
   *  clearer; do not repeat the coachee's original. */
  refinement: z.string().min(1).max(300).optional(),
  /** Optional list of 3-5 concrete alternative phrasings the coachee
   *  can consider. Chips. Same "tap to fill input" affordance.
   *  Omit unless the entry could use several angles. */
  suggestions: z.array(z.string().min(1).max(300)).min(2).max(5).optional(),
});

export type ReactionOutput = z.infer<typeof ReactionSchema> & {
  durationMs: number;
};

export type ReactionInput = MapContextInput & {
  recentChat: ChatTurn[];
  /** The entry that just landed — the coach reacts to it. */
  justAdded: {
    kind: "behavior" | "worry" | "commitment" | "assumption" | "goal";
    text: string;
    /** For worries: the paired behavior text.
     *  For commitments: the paired worry text.
     *  For assumptions: the paired commitment text.
     *  The prompt labels it correctly based on kind. */
    pairedText?: string;
    /** Rubric score (server-computed) for depth-stage entries. Fed to
     *  the coach as prompt input so it can excavate at the right depth.
     *  The coach must never mention the score itself. */
    depthScore?: number | null;
    /** Number of save/edit attempts on this entry so far. Used
     *  alongside depthScore to shape the excavation prose. */
    attempts?: number;
  };
};

export async function generateCoachReaction(
  input: ReactionInput,
): Promise<ReactionOutput> {
  const system = buildSystem(input);
  const started = Date.now();
  const promptLine = buildReactionPrompt(input);
  try {
    const { object } = await generateObject({
      model: mainModel(),
      schema: ReactionSchema,
      system,
      messages: [
        ...input.recentChat,
        { role: "user" as const, content: promptLine },
      ],
      maxOutputTokens: 1500,
    });
    return {
      ...object,
      reply: scrubReply(object.reply),
      refinement: object.refinement ? scrubReply(object.refinement) : undefined,
      suggestions: object.suggestions?.map(scrubReply),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    console.warn(
      "[itc coach reaction] schema failure, falling back to prose-only: %s",
      err instanceof Error ? err.message : String(err),
    );
    // Fallback: plain prose reaction, no chips. Missing chip is
    // cosmetic degradation, not lost state.
    try {
      const { text } = await generateText({
        model: mainModel(),
        system,
        messages: [
          ...input.recentChat,
          { role: "user" as const, content: promptLine },
        ],
        maxOutputTokens: 800,
      });
      return { reply: scrubReply(text), durationMs: Date.now() - started };
    } catch (err2) {
      console.warn(
        "[itc coach reaction] prose fallback also failed: %s",
        err2 instanceof Error ? err2.message : String(err2),
      );
      return { reply: "", durationMs: Date.now() - started };
    }
  }
}

function buildReactionPrompt(input: ReactionInput): string {
  const { kind, text, pairedText, depthScore, attempts } = input.justAdded;
  const isDepthStage =
    kind === "worry" || kind === "commitment" || kind === "assumption";
  const pairedLabel =
    kind === "worry"
      ? "behavior"
      : kind === "commitment"
        ? "worry"
        : kind === "assumption"
          ? "commitment"
          : null;
  const parts: string[] = [];
  parts.push(
    `[system: the coachee just added a ${kind} to the map: "${text}".` +
      (pairedText && pairedLabel
        ? ` (paired to ${pairedLabel}: "${pairedText}")`
        : "") +
      (isDepthStage && typeof depthScore === "number"
        ? ` rubric depth: ${depthScore}/3 across ${attempts ?? 1} attempt(s). NEVER mention the score itself to the coachee — it's for your prose shaping only.`
        : "") +
      "]",
  );

  if (isDepthStage) {
    // Depth-stage flow: the field IS the conversation. Coach reads the
    // rubric score and shapes prose accordingly. Every reply either
    // asks an excavation question the coachee can answer by rewriting
    // the entry, or offers a sharper phrasing as a refinement chip.
    parts.push(
      "This is a DEPTH stage entry. The input field is the conversation — every save re-runs the server rubric and fires you again with the new score. Your job is to help him go deeper, not to hand him a pass.",
    );
    // Kind-specific excavation angle.
    if (kind === "worry") {
      parts.push(
        "For a WORRY (Column 3): depth means a first-person felt fear that lands on his identity or role. Shallow = practical concern, external outcome, or someone else's reaction. Deep = 'what part of ME is on the line if this happens.' Your excavation question moves from external → felt → identity.",
      );
      parts.push(
        "SCORE 0-1 (shallow): He's stayed at the surface. Name in one sentence what's still missing (\"that's a practical concern, not a fear you feel — what part of *you* is on the line if this happens?\"). Then ask ONE excavation question that goes one layer deeper. End with an explicit invitation to rewrite: \"Rewrite the worry with that in it.\" No refinement chip — you don't have a sharper phrasing until he does the excavation. Suggestions are also off — he needs to answer the question, not pick from a menu.",
      );
      parts.push(
        "SCORE 2 (getting there): The worry is named and personal but still one layer up from identity. One-line acknowledgment of what's landed, then either (a) ONE more excavation question inviting a rewrite, OR (b) offer a specific sharper version in the `refinement` field. If it's clearly one small edit away, use the refinement chip. If it needs another layer of work, ask the question.",
      );
      parts.push(
        "SCORE 3 (deep): The worry is at genuine depth. ONE SHORT sentence of plain acknowledgment. Examples: \"Yeah. That's the fear.\" \"That's the one.\" \"Right. That's underneath it.\" Then STOP. Do NOT list criteria (banned: chains like 'that's felt, it's yours, and it names X' — reads like a checklist). Do NOT restate the worry back to him. No question. No 'what else', 'what other', 'what more', 'what shows up'. No reference to other columns. No invitation to add or edit anything else.",
      );
    } else if (kind === "commitment") {
      parts.push(
        "For a COMMITMENT (Column 4): this is the HIDDEN, self-protective vow he's keeping — the flip side of the paired worry. It must sound like protecting himself from the fear, NOT like a virtuous goal or productivity advice. Deep commitments would sound strange said out loud (\"I'm committed to never having to find out that my effort didn't matter\"). Noble-sounding commitments (\"I'm committed to being a good husband\") are shallow — they're what he'd say in the group, not what's really running the show. Push past nobility to protection.",
      );
      parts.push(
        "SCORE 0-1 (shallow): He wrote something noble, generic, or platitudinous — a productivity-blog vow, a goal, or a rule. Name it plainly (\"that's a productivity commitment, not a self-protective one — what are you keeping YOURSELF safe from when [paired worry]?\"). Ask ONE excavation question that flips it from virtue to protection. Invite rewrite: \"Rewrite the commitment starting with 'I'm committed to never...'.\" No chip. No suggestions.",
      );
      parts.push(
        "SCORE 2 (getting there): Self-protective and first-person but still a bit too socially acceptable — would still pass on a productivity blog. One-line acknowledgment, then either (a) ONE more question that squeezes the last drop of nobility out, OR (b) offer a sharper (weirder-sounding, more protective) version in `refinement`. Use the chip when it's a one-line phrasing tweak.",
      );
      parts.push(
        "SCORE 3 (deep): The commitment is self-protective, first-person, and would sound strange on a productivity blog — a real hidden vow. ONE SHORT sentence of plain acknowledgment. Examples: \"Yeah. That's the vow.\" \"That's what's running it.\" \"Right. That's the commitment keeping him safe.\" Then STOP. Do NOT list criteria. Do NOT restate the commitment. No question. No 'what else', no cross-column direction.",
      );
    } else if (kind === "assumption") {
      parts.push(
        "For a BIG ASSUMPTION (Column 5): this is the if-then belief that lives UNDERNEATH the paired commitment(s) — the belief that makes those commitments feel necessary. It must (a) have a finished 'then' clause (not a forecast, but the identity-level or Big Time Bad conclusion the 'then' actually leads to), (b) be first-person and felt, (c) land in identity or a genuinely irrecoverable place. Shallow = forecast, strategy note, or if-then that stops at a practical outcome. Deep = if-then whose 'then' clause names something the coachee cannot let be true about himself.",
      );
      parts.push(
        "SCORE 0-1 (shallow): The 'then' half hasn't been carried through to identity, or it's a forecast instead of a belief. Name what's still missing in one sentence (\"the 'then' side stopped at an outcome — carry it through: if that outcome happens, what does it MEAN about you?\"). Ask ONE excavation question that extends the if-then to identity. Invite rewrite: \"Rewrite the assumption with the finished 'then' in it.\" No chip. No suggestions.",
      );
      parts.push(
        "SCORE 2 (getting there): The if-then is first-person and felt but the 'then' is still one layer up from identity — a real cost but not yet a Big Time Bad. One-line acknowledgment, then either (a) ONE more question that pushes the 'then' to identity, OR (b) offer a sharper phrasing in `refinement` that carries the 'then' the last step. Use the chip when it's one edit away.",
      );
      parts.push(
        "SCORE 3 (deep): The assumption is a genuine identity-level belief — if-then form, first-person felt, 'then' lands in identity or Big Time Bad. ONE SHORT sentence of plain acknowledgment. Examples: \"Yeah. That's the belief.\" \"That's the one running it.\" \"Right. That's what the whole system is built on.\" Then STOP. Do NOT list criteria. Do NOT restate the assumption. No question. No 'what else' / 'what other' / cross-column direction.",
      );
    } else {
      // Unreachable — isDepthStage only true for worry/commitment/assumption.
      parts.push(
        "SCORE 0-1 (shallow): Name what's missing in one sentence, ask ONE excavation question, invite rewrite. No chip.",
      );
      parts.push(
        "SCORE 2 (getting there): One-line acknowledgment, then a question OR a refinement chip.",
      );
      parts.push(
        "SCORE 3 (deep): ONE SHORT acknowledgment. Then STOP. No question, no chip, no cross-column direction.",
      );
    }
  } else {
    // Non-depth stages (goal, behavior): the classic three-case flow.
    parts.push(
      "Evaluate the entry against the column's full criteria, including whether it belongs on the BRAVEMAN pillar he chose. Three cases:",
    );
    parts.push(
      "CASE 1: Fundamental mismatch (wrong pillar, wrong column, not a valid entry type at all). Push back plainly. Name what's off in one to two sentences (\"jumping jacks is a fitness behavior, not a goal about your marriage. what would you actually want to be better at with your wife?\"). Do NOT offer a refinement chip. Do NOT offer suggestions — ask the question that gets him to the real entry.",
    );
    parts.push(
      "CASE 2: Right shape but needs sharpening (right pillar, right column, but phrasing is vague, or implicates other people, or doesn't meet a specific criterion). Name what's off in one line and offer a specific sharper phrasing in the `refinement` field. He can tap the chip to fill his input.",
    );
    parts.push(
      "CASE 3: Sharp entry that meets the criteria. Acknowledge in one line naming what makes it work (\"that's specific, it's yours to work on, and it names a real reaction — that's a real column-1 goal\"). Stop.",
    );
  }

  parts.push(
    "HARD RULES for every case:\n" +
      "- Do NOT mention the next column, the next stage, moving on, being ready for the next step, or anything that suggests forward motion. The coachee decides when to advance by tapping the Continue button. Your job is done when you've reacted to this entry.\n" +
      "- Do NOT ask 'ready to move on?', 'ready for the worry box?', 'want to move to X?', or any variant. He'll advance himself when he sees the button.\n" +
      "- Do NOT claim to have saved, added, or locked anything. He wrote it. He'll write the next one too.\n" +
      "- The rubric, scores, and attempts count are internal — never reference them in prose. Do not tell him 'you're at 2 out of 3' or 'attempt 3'.\n" +
      "- No false praise. 'That's great' / 'perfect' / 'beautifully said' are banned. Acknowledgment is a plain read against the criteria.\n" +
      "- Suggestions are optional; include 3-5 in the `suggestions` field only when he'd benefit from options he can tap into the input.\n" +
      "- Refinement is optional; only include when it's a genuine one-line sharpening of what he wrote.",
  );
  return parts.join("\n\n");
}

// -------------------------------------------------------------------------
// generateSuggestions — "Give me ideas" button
// -------------------------------------------------------------------------

const SuggestionsSchema = z.object({
  reply: z.string().min(1).max(600),
  suggestions: z.array(z.string().min(1).max(300)).min(3).max(5),
});

export type SuggestionsOutput = z.infer<typeof SuggestionsSchema> & {
  durationMs: number;
};

export type SuggestionsInput = MapContextInput & {
  /** Which column the suggestions are for. Determines phrasing shape. */
  kind: "goal" | "behavior" | "worry" | "commitment" | "assumption";
  /** For worries/commitments: which behavior/worry the suggestion
   *  attaches to. Coach uses this to ground the options in his
   *  specific paired entry. */
  contextText?: string;
  /** Any extra context — e.g. "he asked for more options that don't
   *  overlap with the ones he's already seen." */
  extra?: string;
};

export async function generateSuggestions(
  input: SuggestionsInput,
): Promise<SuggestionsOutput> {
  const system = buildSystem(input);
  const started = Date.now();
  const pillar = PILLAR_BY_CODE[input.pillar];
  const prompt =
    `[system: the coachee asked for suggestions for the ${input.kind} column.` +
    (input.contextText ? ` context entry: "${input.contextText}".` : "") +
    (input.extra ? ` ${input.extra}` : "") +
    ` Draft 3-5 concrete options. EVERY option MUST belong to the ${pillar.label} pillar (${pillar.domain}) — do not offer options from other domains (no fitness suggestions on Bond, no marriage suggestions on Amplify, etc.). Ground each option in his stated goal + prior entries. Each is one sentence, sayable out loud, in his voice.]`;
  try {
    const { object } = await generateObject({
      model: mainModel(),
      schema: SuggestionsSchema,
      system,
      prompt,
      maxOutputTokens: 1200,
    });
    return {
      reply: scrubReply(object.reply),
      suggestions: object.suggestions.map(scrubReply),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    console.warn(
      "[itc coach suggestions] schema failure: %s",
      err instanceof Error ? err.message : String(err),
    );
    return {
      reply: "",
      suggestions: [],
      durationMs: Date.now() - started,
    };
  }
}

// -------------------------------------------------------------------------
// scrubReply — defensive text cleanup on any visible coach output
// -------------------------------------------------------------------------

/**
 * Belt-and-suspenders text cleanup. The preamble and voice doc ban
 * em dashes, claim-of-action language, and premature next-column
 * exposition. The model ignores those bans intermittently. Three
 * passes:
 *
 *   1. Em/en dashes → comma.
 *   2. Claim-of-action strip: "Locked", "That's locked in",
 *      "Added", "Saved", "I've locked", "That's been added",
 *      "I've saved that to your map", "Adding it now" — from any
 *      sentence position (coach cannot do those things under
 *      Form-First and must not claim to).
 *   3. Premature-advance cut: on any reply that contains
 *      "Now column N", "Column N is what/what you actually", or
 *      other next-stage exposition, truncate the reply at that
 *      point. Kept text ends with a period.
 */
export function scrubReply(text: string): string {
  const dashless = text
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/[—–]/g, ",")
    .replace(/\s+--\s+/g, ", ");

  // Pass 1 — claim-of-action strip. Two families:
  //   (a) "That's <verb> [in/down/to your map]" — "That's locked",
  //       "That's saved", "That's been added", "That's noted"
  //   (b) "(Got it,? )?(I(?:'|')?ve? |I |just )?<verb>" — bare
  //       "Locked.", "Adding it now.", "I've saved that"
  const thatsClaimRe =
    /(^|[.!?]\s+|\n)\s*that'?s\s+(?:been\s+|just\s+)?(?:locked|added|saved|noted|written|jotted|adding|saving|locking|got|down|in|there|on\s+(?:your |the )?map)(?:\s+(?:in|down|now|to\s+(?:your |the )?map|on\s+(?:your |the )?map|it|that))?\s*[.!?]?/gi;
  const bareClaimRe =
    /(^|[.!?]\s+|\n)\s*(?:got it,?\s+)?(?:i(?:'|')?ve\s+|i\s+)?(?:just\s+)?(?:locked|added|saved|adding|locking|saving|noted|written|jotted)(?:\s+(?:it|that|those|them|this)(?:\s+(?:in|down|to\s+(?:your |the )?map|on\s+(?:your |the )?map|now))?)?\s*[.!?]?/gi;
  let cleaned = dashless
    .replace(thatsClaimRe, (_m, sep) => sep || "")
    .replace(bareClaimRe, (_m, sep) => sep || "");

  // Pass 2 — next-step / advance cut. If the reply mentions the next
  // column, moving on, or "ready?" — truncate at that point. Coachee
  // decides when to advance by tapping the Continue button. The coach
  // must never front-run him.
  const advanceTells = [
    /(^|[.!?]\s+|\n)\s*now\s+column\s+\d/i,
    /(^|[.!?]\s+|\n)\s*column\s+\d\s+is\b/i,
    /(^|[.!?]\s+|\n)\s*(?:the\s+)?doing\s+and\s+not-doing\b/i,
    /(^|[.!?]\s+|\n)\s*(?:the\s+)?worry\s+box\b/i,
    /(^|[.!?]\s+|\n)\s*(?:the\s+)?competing\s+commitments\b/i,
    /(^|[.!?]\s+|\n)\s*(?:the\s+)?big\s+assumptions?\b/i,
    // "Ready to move to X?" / "Ready for the worry box?" / "want to
    // move on?" / "want to continue?" — any variant that prompts the
    // coachee to advance.
    /(^|[.!?]\s+|\n)\s*(?:ready\s+(?:to|for)|want\s+to|shall\s+we|let'?s)\s+(?:move|continue|go|advance|start|jump|shift)\b/i,
    /(^|[.!?]\s+|\n)\s*(?:when\s+you'?re\s+ready|when\s+you\s+are\s+ready)\b/i,
    // "on to the next column" / "on to the worry box"
    /(^|[.!?]\s+|\n)\s*on\s+to\s+the\s+/i,
    // Bare "ready?" as a closing question
    /(^|[.!?]\s+|\n)\s*ready\s*\?/i,
  ];
  let cutAt = -1;
  for (const re of advanceTells) {
    const m = re.exec(cleaned);
    if (m && (cutAt === -1 || m.index < cutAt)) cutAt = m.index;
  }
  if (cutAt > 0) {
    cleaned = cleaned.slice(0, cutAt).trimEnd();
    if (cleaned && !/[.!?]$/.test(cleaned)) cleaned += ".";
  }

  // Collapse double spaces / stranded punctuation the strips left.
  cleaned = cleaned
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/([.!?])\s*\1/g, "$1")
    .trim();
  return cleaned;
}
