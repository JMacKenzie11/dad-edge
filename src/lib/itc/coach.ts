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
import { normalizeMapText } from "./maps";
import { buildItcCoachSystemSplit } from "./prompts";
import { scoreAssumptionDepth } from "./rubric";
import { ASSUMPTION_STEM, ensureStem, type ItcStage } from "./stage";

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
    // Reactions never carry a suggestions array — that's what the
    // "Give me ideas" button is for. Strip regardless of what the
    // model produced. Belt-and-suspenders against prompt drift.
    return {
      ...object,
      reply: scrubReply(object.reply),
      refinement: object.refinement ? scrubReply(object.refinement) : undefined,
      suggestions: undefined,
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
        "SCORE 3 (deep): The worry is at genuine depth. ONE SHORT sentence of plain acknowledgment. VARY YOUR OPENER — do NOT default to \"That's the [X]...\" / \"Yeah. That's...\" / \"Right. That's...\". Those are formulaic and coachees see them in sequence across their three worries; repeated openers read as a template, not a response. Reach for alternatives: \"There it is.\" / \"You moved from what you're doing to what you're afraid of.\" / \"Now you're at the layer that runs it.\" / \"You landed the fear underneath.\" / \"Now the worry has teeth.\" / \"That names something you couldn't quite reach a minute ago.\" Use \"That's the [X]...\" openers RARELY — at most once across the map. Then STOP. Do NOT list criteria (banned: chains like 'that's felt, it's yours, and it names X' — reads like a checklist). Do NOT restate the worry back to him. No question. No 'what else', 'what other', 'what more', 'what shows up'. No reference to other columns. No invitation to add or edit anything else.",
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
        "SCORE 3 (deep): The commitment is self-protective, first-person, and would sound strange on a productivity blog — a real hidden vow. ONE SHORT sentence of plain acknowledgment. VARY YOUR OPENER — do NOT default to \"That's the vow\" / \"That's what's running it\" / \"That's the commitment...\". Those are formulaic and coachees see them across all three commitments; repeated openers feel templated. Alternatives: \"There's the piece you weren't supposed to say out loud.\" / \"That's the commitment doing the work.\" / \"You named the game.\" / \"Now the map has what actually runs it.\" / \"You landed the protective flinch.\" / \"That reads as the real vow, not the noble version.\" Use \"That's the [X]...\" openers RARELY — at most once across the map. Then STOP. Do NOT list criteria. Do NOT restate the commitment. No question. No 'what else', no cross-column direction.",
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
        "SCORE 3 (deep): The assumption is a genuine identity-level belief — if-then form, first-person felt, 'then' lands in identity or Big Time Bad. ONE SHORT sentence of plain acknowledgment. VARY YOUR OPENER — do NOT default to \"That's the belief running it\" / \"That's the one\" / \"That's what the whole system is built on\". Those are formulaic and coachees see them across all their assumptions; repeated openers feel templated. Alternatives: \"There's the belief that makes all of it feel necessary.\" / \"You named the water you swim in.\" / \"Now the assumption is on the page instead of running underneath.\" / \"You got to the belief that has to be tested.\" / \"There's the piece that has to be tested for anything to move.\" / \"You just made the invisible thing visible.\" Use \"That's the [X]...\" openers RARELY — at most once across the map. Then STOP. Do NOT list criteria. Do NOT restate the assumption. No question. No 'what else' / 'what other' / cross-column direction.",
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
    if (kind === "goal") {
      // Explicit specificity guard for goals. Repeated failure mode:
      // the model approves role-identity goals ("being a husband",
      // "being a good father") as Case 3 because they're technically
      // on the right pillar. They fail Kegan/Lahey's specificity bar
      // — if the goal is a ROLE, not a PATTERN within that role, it
      // can't generate observable Column 2 behaviors.
      parts.push(
        "GOAL-SPECIFIC HARD RULE (do not skip): if the goal names a ROLE rather than a PATTERN within that role, it is CASE 2, not Case 3. Test in your head: 'if he achieved this goal, what would he be DOING differently?' If the honest answer is 'everything' or 'I don't know', the goal is a role and fails the specificity bar.\n" +
          "  BANNED as Case 3 (must go to Case 2 with a refinement chip):\n" +
          "    - \"being a husband\" / \"being a good husband\" / \"being a better husband\"\n" +
          "    - \"being a father\" / \"being a good father\" / \"being a dad\"\n" +
          "    - \"being a leader\" / \"being a boss\" / \"being a partner\"\n" +
          "    - any \"being a [role]\" or \"being a good [role]\" phrasing\n" +
          "    - \"being present\" (too abstract — present when? during what?)\n" +
          "    - \"being better\" / \"doing better\" (no content)\n" +
          "  PASSES as Case 3 (specific behavioral patterns within a role):\n" +
          "    - \"staying present when my wife is upset with me\"\n" +
          "    - \"listening without planning my response\"\n" +
          "    - \"not going defensive when she brings something up\"\n" +
          "    - \"asking my kids what they need instead of telling them what to do\"\n" +
          "  If the goal is a banned role-identity phrasing, react as CASE 2: name that it's a role not a change (\"'being a husband' is the whole role — what's the specific pattern inside that role you want to work on?\") and put a specific behavioral version in the `refinement` field.",
      );
    }
    if (kind === "behavior") {
      // Explicit specificity + goal-connection guard for behaviors.
      // Same failure family as goal: identity claims, aspirational
      // phrasings, vague verbs, or moves that don't clearly work
      // against the Column 1 goal all get Case-3 approved when they
      // shouldn't. Column 2 is specifically the counterproductive
      // moments that undermine THIS specific goal.
      parts.push(
        "BEHAVIOR-SPECIFIC HARD RULES (do not skip):\n" +
          "  (1) The behavior must CLEARLY work AGAINST the current Column 1 goal. Look at the goal in the map context above. Ask yourself: 'in the moment this behavior happens, is he moving away from that specific goal?' If the connection requires explanation, it's CASE 2 — ask him how this behavior works against his goal, and offer a sharper phrasing (in `refinement`) that makes the connection explicit.\n" +
          "  (2) BANNED as Case 3 (must go to Case 2 or Case 1):\n" +
          "    - Identity claims: \"I'm a bad listener\" / \"I'm not good at communicating\" / \"I'm distant with her\" — self-labels, not moment-in-time actions.\n" +
          "    - Aspirational: \"I need to be more patient\" / \"I should listen better\" / \"I want to stop yelling\" — names what he wishes he did, not what he does. That's a Column 1 goal, not a Column 2 behavior.\n" +
          "    - About other people: \"She doesn't respect me\" / \"He never listens\" — Column 2 is HIS moves only.\n" +
          "    - Vague verbs without specifics: \"I withdraw\" / \"I shut down\" / \"I get defensive\" — on their own these are too abstract. Sharpen to a specific observable action (\"I stop talking and look at my phone\" / \"I leave the room without saying anything\" / \"I start explaining why she's wrong before she's finished\").\n" +
          "  (3) PASSES as Case 3 (specific observable move that undermines the goal):\n" +
          "    - \"I bring up things she did in the past instead of listening\"\n" +
          "    - \"I explain why I'm right for ten minutes\"\n" +
          "    - \"I check my phone during dinner\"\n" +
          "    - \"I go silent for the rest of the day\"\n" +
          "  If the behavior fails any of (1)–(3), react as CASE 2 or CASE 1 accordingly — do NOT bare-acknowledge a shallow behavior as sharp.",
      );
    }
  }

  parts.push(
    "HARD RULES for every case:\n" +
      "- Do NOT mention the next column, the next stage, moving on, being ready for the next step, or anything that suggests forward motion. The coachee decides when to advance by tapping the Continue button. Your job is done when you've reacted to this entry.\n" +
      "- Do NOT ask 'ready to move on?', 'ready for the worry box?', 'want to move to X?', or any variant. He'll advance himself when he sees the button.\n" +
      "- Do NOT claim to have saved, added, or locked anything. He wrote it. He'll write the next one too.\n" +
      "- The rubric, scores, and attempts count are internal — never reference them in prose. Do not tell him 'you're at 2 out of 3' or 'attempt 3'.\n" +
      "- No false praise. 'That's great' / 'perfect' / 'beautifully said' are banned. Acknowledgment is a plain read against the criteria.\n" +
      "- VARY YOUR OPENING PHRASING. You have no memory of prior reactions, but coachees read all three (or five) of yours in sequence on the page. If every reaction opens with \"That's the [X]...\" or \"Yeah. That's...\" or \"Right. That's...\", it reads as a template, not a response. Reach for less-common openers by default. Reserve \"That's the [X]...\" for AT MOST ONE reaction per map — treat it as a scarce resource.\n" +
      "- LEAVE `suggestions` EMPTY. Reactions never carry a multi-item suggestions menu — that's what the 'Give me ideas' button generates in a separate call. If you think he'd benefit from options, that's a signal to end your reaction with a question, not to hand him a menu.\n" +
      "- `refinement` is optional; only include when it's a genuine one-line sharpening of what he wrote (Case 2 / depth-score 2 only).",
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

  // Kind-specific template for what a suggestion chip must look like.
  // Chips are TAPPABLE ENTRY CANDIDATES — the coachee taps one, it
  // fills the input, he saves. So each chip must be a COMPLETE ENTRY
  // ready to drop in as-is. Never a question. Never a meta-prompt.
  const kindShape: Record<SuggestionsInput["kind"], string> = {
    goal:
      `Each suggestion is a COMPLETE improvement goal, starting with "I'm committed to getting better at…". Specific, personal, first-person, one sentence. Example on Bond: "I'm committed to getting better at staying in the room when my wife brings up something hard instead of shutting down."`,
    behavior:
      `Each suggestion is a COMPLETE column-2 doing/not-doing — a specific thing the coachee catches himself doing or failing to do in the moment that works against his goal. First-person present, one sentence. Example: "I explain why I'm right for ten minutes instead of asking what she needs."`,
    worry:
      `Each suggestion is a COMPLETE column-3 worry — first-person felt fear that lands on identity. Example: "That she'll finally see I've been faking it and stop trusting me."`,
    commitment:
      `Each suggestion is a COMPLETE column-4 hidden commitment starting with "I'm committed to never…" — self-protective, not noble. Example: "I'm committed to never letting her see the parts of me I'd have to disown."`,
    assumption:
      `Each suggestion is a COMPLETE column-5 Big Assumption in "If I…, then…" form, with the "then" clause carried through to identity or a Big Time Bad. Example: "If I let her see who I really am, then I will have proved I'm not the man I've been telling her I am."`,
  };

  // Existing entries for this kind — the model must not repeat these
  // and neither should the post-generation dedup allow them through.
  const existing = existingEntriesForKind(input);
  const existingBlock = existing.length
    ? [
        `- DO NOT duplicate or paraphrase any of the entries already on the map for this column:`,
        ...existing.map((t, i) => `    ${i + 1}. "${t}"`),
        `- If your first drafts overlap semantically with the above, rewrite them until they name genuinely different patterns.`,
      ].join("\n")
    : `- No existing entries for this column — options draft fresh.`;

  const prompt = [
    `[system: the coachee tapped "Give me ideas" for the ${input.kind} column. He wants 3-5 tappable options he can drop into the input as-is.]`,
    `Rules for the \`suggestions\` field (STRICT):`,
    `- Every item is a COMPLETE, ready-to-tap ENTRY on the ${pillar.label} pillar (${pillar.domain}). Not a question. Not a meta-prompt. Not "what have you typed" or "tell me more" — those go in \`reply\`, never in \`suggestions\`.`,
    `- ${kindShape[input.kind]}`,
    `- No cross-domain options (no fitness on Bond, no work on Vitality, no marriage on Amplify, etc.).`,
    existingBlock,
    input.contextText
      ? `- Ground the options in the paired context: "${input.contextText}".`
      : null,
    input.extra ? `- ${input.extra}` : null,
    ``,
    `Rules for the \`reply\` field:`,
    `- ONE short intro sentence framing the options. Example: "Here are five directions Bond men often work on. Tap one to start with, edit however you want."`,
    `- Never a question demanding input from him first — he tapped the button precisely because he doesn't know what to write yet.`,
    `- Never longer than one sentence.`,
  ]
    .filter((s): s is string => Boolean(s))
    .join("\n");

  try {
    const { object } = await generateObject({
      model: mainModel(),
      schema: SuggestionsSchema,
      system,
      prompt,
      maxOutputTokens: 1200,
    });
    // Three-step filter:
    //   1. scrub voice/dash cleanup
    //   2. drop any question-shaped chip (meta-prompt leak)
    //   3. drop any chip whose normalized text matches an existing
    //      entry on the map (semantic dedup — prevents the coach from
    //      re-offering what he just typed)
    const existingNormalized = new Set(existing.map(normalizeMapText));
    const cleaned = object.suggestions
      .map(scrubReply)
      .filter((s) => !isQuestionShaped(s))
      .filter((s) => !existingNormalized.has(normalizeMapText(s)));
    return {
      reply: scrubReply(object.reply),
      suggestions: cleaned,
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

/**
 * Pull the existing on-map entry texts for the column the coachee
 * asked for suggestions on. The suggestions prompt uses these
 * verbatim to bias the model away from duplicates, and the
 * post-generation filter strips any that snuck through.
 */
function existingEntriesForKind(input: SuggestionsInput): string[] {
  switch (input.kind) {
    case "behavior":
      return input.behaviors.filter((b) => b.selected).map((b) => b.text);
    case "worry":
      return input.worries.map((w) => w.text);
    case "commitment":
      return input.commitments.map((c) => c.text);
    case "assumption":
      return input.assumptions.map((a) => a.text);
    case "goal":
    default:
      // Goal is a single field; if it's already set, listing it as
      // "existing" biases the model to write near-duplicates. Better
      // to draft fresh alternatives.
      return [];
  }
}

/**
 * True when the string reads as a meta-prompt / question rather than
 * a tappable entry candidate. Guards against the failure mode where
 * the coach fills the suggestions array with "Share your draft with
 * me" instead of actual entry text.
 */
function isQuestionShaped(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.endsWith("?")) return true;
  const openers = [
    /^share\b/i,
    /^tell me\b/i,
    /^show me\b/i,
    /^what\b/i,
    /^how\b/i,
    /^which\b/i,
    /^describe\b/i,
    /^give me\b/i,
  ];
  return openers.some((re) => re.test(trimmed));
}

// -------------------------------------------------------------------------
// draftCommitmentForWorry — coach-drafted Column 4 starting text
// -------------------------------------------------------------------------

const CommitmentDraftSchema = z.object({
  /** "I'm committed to never…" phrasing. Non-noble (would sound
   *  strange on a productivity blog), first-person, self-protective. */
  draft: z.string().min(10).max(400),
});

const DRAFT_COMMITMENT_SYSTEM = `
You draft ONE non-noble hidden competing commitment for a coachee's ITC map. This is Column 4 — the self-protective vow that keeps the paired worry from ever coming true. Your draft is a starting point the coachee will review, accept, edit, or replace.

Non-noble is the whole game. A stranger reading a non-noble commitment thinks "that's a weird thing to admit," not "that's good advice." Noble commitments ("I'm committed to being a good listener", "being the best husband I can be") fail immediately — they sound like wedding vows. Non-noble commitments name the SELF-PROTECTIVE MOVE explicitly ("I'm committed to never having to find out my effort didn't matter", "I'm committed to never letting her see the parts of me I'd have to disown").

## The identity-level bar (mandatory)

There are two rungs on the non-noble ladder, and only the higher one is what Kegan/Lahey actually helps coachees arrive at:

  - EVENT-level (weaker, still self-protective — but the coach will push past this): "I'm committed to never having to admit I made the mistake" — protects against a discrete event / feeling of exposure.
  - IDENTITY-level (canonical): "I'm committed to never having to see I'm the kind of husband who keeps hurting her no matter how hard I try" — protects against a truth about WHO HE IS being confirmed.

Every draft must land at the identity-level rung. What is the commitment keeping him safe from having to SEE ABOUT HIMSELF? Not "having to admit the fact happened" — "having to face what the fact would confirm about the kind of person he is."

If the fear underneath is "I'm the kind of husband who keeps hurting her," the commitment is not "never having to admit I hurt her" (event-level dodge) — it is "never having to see I'm the kind of husband who keeps hurting her" (identity-level protection).

## Softening anti-patterns — do NOT use these frames

These are all event-level dodges the drafter has produced before and the reaction coach then had to push past. Ban them:

  - "never having to admit the mistake" / "never admitting I was wrong" — event, not pattern.
  - "never letting her see me fail" / "never letting her see me make a mistake" — protects the visibility of the event, not the identity underneath.
  - "never having to face the situation" / "never having to have that conversation" — the situation, not the self-truth.
  - "never having to apologize" / "never having to say I'm sorry" — the ceremony, not the identity.

Replace all of these with constructions that name what the moment would CONFIRM about him. "Never having to see I'm the man who…", "never having to find out I'm the kind of person who…", "never letting her prove I'm the husband who…"

## Preserve the coachee's own specificity — copy his nouns

You are naming HIS belief in HIS words. Do NOT editorialize a smoother version.
  - If his worry says "his wife", the commitment says "his wife". Do NOT substitute "his family", "the people he loves", "his loved ones".
  - If his worry says "she'd leave", the commitment says "she'd leave". Do NOT reword to "I'd lose everyone" or "I'd be alone".
  - If his worry names a specific act ("bringing up the past", "lying"), the commitment stays in that act's shape.

## Three criteria (all must hold)

  1. is_self_protective — the protective flinch is visible. Names what he's keeping himself safe from FEELING or FACING.
  2. is_first_person — starts with "I'm committed to never…" (or equivalent). Named as his own vow.
  3. is_not_productivity_platitude — would sound strange on a productivity blog. If it'd fit in a wedding speech, it hasn't landed.

## Silent two-step derivation

  A. Read the paired worry. Identify what it would CONFIRM ABOUT HIM as a person if it came true (not just what event would happen — what identity truth would land).
  B. Draft "I'm committed to never [move that prevents having to see / face that identity truth]." Land at the identity rung — his person, not the event.

Return exactly one draft in the \`draft\` field, starting with "I'm committed to never". No prose, no explanation, no meta. One sentence.
`.trim();

/**
 * Server-side coach-draft generator for Column 4. Called once per
 * worry when the coachee advances into the commitments stage.
 *
 * Same architectural class as the depth-scoring rubric: LLM computes
 * a value, the server writes it, the user sees it as a suggestion in
 * the UI. The draft becomes real commitment.text only when the user
 * explicitly accepts (tap "Use this draft") or types their own —
 * never silently.
 */
export async function draftCommitmentForWorry(input: {
  goalText: string;
  behaviorText: string;
  worryText: string;
}): Promise<string | null> {
  const started = Date.now();
  try {
    const { object } = await generateObject({
      model: mainModel(),
      schema: CommitmentDraftSchema,
      system: DRAFT_COMMITMENT_SYSTEM,
      prompt: [
        `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
        `Behavior (Column 2): ${input.behaviorText}`,
        `Paired worry (Column 3): ${input.worryText}`,
        ``,
        `Draft the non-noble commitment underneath this worry.`,
      ].join("\n"),
      maxOutputTokens: 400,
    });
    return scrubReply(object.draft);
  } catch (err) {
    console.warn(
      "[itc coach] draftCommitmentForWorry failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    console.warn(
      "[itc timing] draft kind=commitment ms=%d",
      Date.now() - started,
    );
  }
}

// -------------------------------------------------------------------------
// draftAssumptionsFromCommitments — coach-drafted Column 5 starting text
// -------------------------------------------------------------------------

/**
 * Cluster-first assumption drafter. Reads all commitments on the map
 * and proposes N Big Assumptions where each proposal names which
 * commitments (by 1-based index into the input list) it underwrites.
 * Many-to-many: one assumption typically covers several commitments.
 *
 * The schema uses INDICES (not ids) so the LLM never has to echo an
 * opaque uuid — the server maps indices → commitment_ids before
 * persisting via saveAssumptionDrafts.
 */
/**
 * Belt-and-suspenders "then" injection for Big Assumption drafts.
 * The drafter prompt requires "I assume that if I …, then …" but LLMs
 * occasionally drop the "then". Without it the consequent reads as a
 * diagnosis (fact) rather than a prediction (testable belief) — a real
 * ITC-purity loss.
 *
 * Two-step (detect-then-inject) instead of one regex with lookahead:
 * negative lookahead + \s* interact badly (the engine picks the
 * shortest \s* that lets the lookahead succeed, so a "then" already
 * present after a space is missed). Separate detection avoids that.
 *
 * Exported for tests. Not a general-purpose helper — assumes the text
 * has already been stem-normalized ("I assume that if I ...").
 */
export function ensureThenAfterIfClause(text: string): string {
  // Already canonical — "then" appears after the antecedent's comma.
  if (/\bif\s+I\b[^,]*,\s*then\b/i.test(text)) return text;
  // Inject "then " right after the antecedent comma. The `\s*` in the
  // match swallows any existing whitespace so we don't end up with
  // ",  then" (double space) after the replacement.
  return text.replace(
    /(\bif\s+I\b[^,]*,)\s*/i,
    "$1 then ",
  );
}

const AssumptionDraftsSchema = z.object({
  drafts: z
    .array(
      z.object({
        /** "I assume that if I …, then …" belief the coachee holds as
         *  truth. The "I assume that" stem makes the epistemic status
         *  explicit (testable belief, not fact about reality) — that's
         *  what unlocks the immunity. The server post-processes each
         *  draft through ensureStem(text, ASSUMPTION_STEM) so a
         *  compliant model can drop the stem and the server still
         *  puts it in canonical form. */
        // Max ~40 words. The prompt targets 15 words (Kegan's average);
        // 200 chars is a safety-net upper bound to catch runaway
        // multi-clause chained drafts. Well-formed drafts sit comfortably
        // under this.
        text: z.string().min(10).max(200),
        /** 1-based indices into the commitments list passed to the
         *  prompt. At least one — a draft covering nothing is useless. */
        commitment_indices: z.array(z.number().int().min(1)).min(1),
      }),
    )
    .min(1)
    .max(6),
});

const DRAFT_ASSUMPTIONS_SYSTEM = `
You cluster a coachee's competing commitments and draft the Big Assumptions underneath them for an ITC map (Column 5). Big Assumptions are beliefs the coachee holds about how the world works that make each hidden commitment in Column 4 feel NECESSARY. To him they don't feel like assumptions — they feel like TRUTH. That's why the immune system runs itself.

## Canonical form (mandatory)

Every draft.text MUST match the shape: "I assume that if I …, then …". Three literal tokens are non-negotiable and must appear in this order in every draft:
  - "I assume that" — the epistemic-status prefix. Names it as belief, not fact.
  - "if I" — the antecedent opener. Frames the behavior he'd do differently.
  - "then" — the consequent opener. Frames what would follow as a PREDICTION, not a diagnosis.

Do NOT drop the "then". "I assume that if I X, Y" reads as a diagnosis (X reveals Y as an already-true fact). "I assume that if I X, then Y" reads as a prediction (X would cause / lead to Y). Only the second is testable. Kegan/Lahey's canonical form.

## The bar every draft must clear

  1. **One catastrophic clause in the consequent.** Land on ONE identity or relational catastrophe — "then I'd be a fraud", "then she'd have no choice but to leave", "then I'd be the husband who hurts his wife". If two different catastrophes come to mind, split them into two drafts. Do NOT chain "…and I'd become X, and she'd Y, and then Z" — a chained draft is untestable because it's unclear which link is the load-bearing belief.

  2. **Consequent must have BOTH parts: observable tell AND identity landing.** Not one or the other. Both. Every draft. This is the hardest bar and the one drafts most often miss.

     - The **OBSERVABLE TELL** is something the coachee could see, hear, or feel — a behavior he'd exhibit ("I'd lose control"), a reaction from another person ("she'd pull away"), or a specific felt state ("I'd feel the shame"). Without this the belief is untestable — you can't run an experiment on "am I a fraud."
     - The **IDENTITY LANDING** is what the tell would CONFIRM about who he is — "the husband who hurts her", "not good enough for her", "the man she can't trust". Without this the draft is just a behavioral prediction and it fails BOTH the coach reaction (which will push "what does that prove about you?") AND the depth rubric (which will score it below identity-level and reject it).

     The template is strict: "then [OBSERVABLE TELL] and [IDENTITY LANDING]". Both slots must be filled. Test each draft yourself before returning it — cover the second half of the consequent with your hand: if what remains is just a behavioral prediction ("I'd lose control", "I'd say something awful", "she'd pull away") with no identity claim following, you have NOT completed the draft. Extend it with the identity landing.

     Anchor the identity landing in the coachee's OWN commitment language when possible. If his commitment says "never becoming that guy", the assumption's landing should invoke "that guy" or "the guy I'm terrified I am." If his commitment says "never letting her see I've failed her", the landing should invoke "the husband who fails her" or similar. His identity language is the raw material for your consequent's back half.

     Draft is rejected server-side (via scoreAssumptionDepth) if the identity landing is missing — you don't get to hand the coachee a draft that will fail the gate.

  3. **Land in identity/relationship/worth — NOT practical outcome.** "It would be awkward" or "we'd fall behind" is a practical concern, not a Big Assumption.

  4. **First-person felt, in HIS voice.**

  5. **Preserve the coachee's own specificity — copy his nouns.** This rule was violated in prior drafts; enforce it strictly.
     - If his worry says "his wife", the assumption says "his wife". Do NOT substitute "his family", "the people he loves", "anyone he cares about", "his loved ones".
     - If his worry says "she'd leave", the assumption says "she'd leave". Do NOT reword to "I'd end up alone" or "I'd lose everyone".
     - If his worry says "I'd lose control", the assumption says "I'd lose control". Do NOT reword to "I'd become someone I don't recognize".
     - If his commitment says "admit she's right", the assumption says "admit she's right". Do NOT add "completely" or any other intensifier he didn't use.
     You are naming HIS belief in HIS words. You are not editorializing a smoother, more literary, or more universal version.

  6. **Ban meta-language self-verdicts in the consequent.** Do NOT write "I'd prove", "I'd confirm", "I'd realize", "I'd finally know", "I'd see that I'm" — these are META descriptions of what would become KNOWN to him as fact, not observable events. They collapse the belief into a self-verdict he can find evidence for internally without ever running a real test. Replace with an observable-in-the-world tell (behavior, reaction, felt state) and let the identity claim ride on top of that tell. Wrong: "then I'd prove I'm the husband who hurts her." Right: "then she'd tell me how many times I've hurt her and I'd have to face I really am that husband." The felt-shame version is fine ("then I'd feel the shame that lands it"), because feeling shame IS an observable event — but "prove", "realize", "confirm" as self-directed verbs are not.

  7. **Ban unfalsifiable global qualifiers.** Do NOT include "no matter what I do", "no matter what", "always", "every time", "in every situation", "for good" in the consequent. These make the belief unfalsifiable by any single interaction — even if the test goes well, the coachee can dismiss it as one exception ("that's just one time, I still X every other time"). The consequent must name something that could turn out NOT to happen in ONE specific real-world interaction. Wrong: "then I'd prove I'm the husband who hurts her no matter what I do." Right: "then she'd tell me I've been hurting her." The right version can be falsified in a single conversation. Note: negation like "never" inside the coachee's OWN nouns (a commitment saying "I'm committed to never letting her see...") is fine — the ban is on universals in the CONSEQUENT that make the outcome unfalsifiable.

  8. **Do NOT re-stem the worry.** The most common drafter failure: taking the paired worry and swapping "worry that" → "assume that" + injecting "then" — producing a draft that IS the worry with a canonical prefix. The worry and the Big Assumption are different objects. The worry is a felt fear ("I worry that if X, Y-catastrophic-chain"). The assumption is the belief UNDERNEATH the worry — the taken-as-truth claim that MAKES the worry feel warranted. Derivation:
      - Isolate the ONE atomic testable belief inside the worry's chained clauses. If the worry is "if I stay in the room, I'd lose it and say something awful, and I'd be the husband who hurts his wife", the atomic belief is either "I can't handle her anger without losing control" (about the behavior) OR "if I show her the worst of me, she couldn't stay" (about her response). Pick ONE.
      - Make the antecedent NAME the specific act (not just repeat the worry's if-clause).
      - Make the consequent ONE observable + ONE identity landing (not the worry's chain).
     Wrong shape: worry = "if I stay in the room, I'd lose it and say something awful, and I'd be the husband who hurts his wife" → assumption = "I assume that if I stay in the room, then I'd lose it and say something awful, and I'd be the husband who hurts his wife" (verbatim worry with prefix swap).
     Right shape: assumption = "I assume that if I stay in the room while she's angry, then I'd lose control and say something I can't take back." One clean atomic testable belief distilled from the worry — not the worry re-stemmed.

  9. **Aim for ~15–20 words WITH both consequent parts included.** Kegan/Lahey's canonical Big Assumptions in *Immunity to Change* average ~15 words. Your target: 15–20 words with BOTH the observable tell AND the identity landing (per rule 2). 20+ is a smell you're carrying extra modifiers or chained clauses. 25+ is nearly always the worry re-stemmed. Precision, not paragraph. When in doubt, tighten the antecedent (drop "actually" / "in the moment" / "really") — but NEVER drop the identity landing to hit a word count.

     Canonical shapes (study these — they are your templates):
     - "I assume that if I stay in the room while she's angry, then I'd lose control and be the husband who hurts her." (19 words: tell "lose control" + landing "husband who hurts her")
     - "I assume that if I show her the worst of me, then she'd pull away and I'd know I'm not enough." (17 words: relational tell + landing)
     - "I assume that if I stop protecting her from my failures, then she'd finally see I'm not the husband she deserves." (18 words: tell "she'd see" + landing "not the husband she deserves")
     - "I assume that if I keep admitting I'm wrong, then she'd stop trusting me and I'd be the man she can't rely on." (19 words: tell "stop trusting" + landing "the man she can't rely on")

     Every canonical shape has: "I assume that if I" + [act] + ", then" + [tell] + [and-connector] + [identity landing]. Match this shape.

## Clustering — shared-root FIRST, split only as fallback

Kegan/Lahey's methodology explicitly favors finding ONE Big Assumption that underwrites MULTIPLE competing commitments when a genuine shared root exists — that's evidence you've found a deep assumption vs. a surface one. Many-to-many is the target when it's real.

BUT: a fake cluster is worse than a split. Coverage is determined by the ANTECEDENT ONLY — not by keywords in your consequent.

**The cluster-coverage test (mandatory before you list a commitment_index):**

  1. Read the antecedent — the "if I ..." clause.
  2. For EACH commitment you're about to link, ask: "Would this coachee actually perform the act named in the antecedent under this commitment's protective vow?"
  3. If yes for all — cluster under one draft.
  4. If yes for only some — split. Do NOT list commitment_indices for the ones that don't fit.

**The consequent-keyword trap — do NOT do this:**

If your consequent contains a phrase like "I'd lose it" or "hurt her" or "not good enough," and one of the commitments' paired worries also mentions "lose it" or "hurt her" or "not good enough" — that is NOT evidence the antecedent covers that commitment. That is just a shared FEAR downstream. The antecedent (the ACT) must fit, independently of what fears the consequent names.

**Worked example of the trap:**

Antecedent: "if I actually listen to her and admit she's right".
Consequent contains: "then I'd lose it and be the husband who hurts her".
Commitment #3's paired worry mentions "losing it" and "hurting his wife."
Wrong move: linking this draft to #3 because the consequent-keyword matches.
Right move: check the antecedent independently — does #3's commitment involve listening and admitting? No, #3 is about walking out. So the antecedent DOESN'T fit #3. Do not link. If #3 needs coverage, draft a second assumption whose antecedent names the walking-out move.

**A cluster with a wrong link is worse than a smaller cluster with no wrong links.** A wrong link produces an assumption the coachee can't actually test — the antecedent doesn't describe an act she'd perform under that commitment, so the "test" is empty.

## Coverage

Every commitment on the input list must be covered by at least one draft. No orphans. Aim for FEWER drafts (2–4 is typical for a whole map); six is a ceiling, not a target.

## Silent two-step derivation

  A. Read goal + commitments together. Ask: is there ONE catastrophic belief that, if provisionally suspended, would loosen ALL these commitments? If yes → one cluster.
  B. For each cluster (or standalone commitment), write one draft in "I assume that if I …, then …" form. Include the "then". One antecedent. One catastrophic consequent WITH a behavioral or relational tell. HIS words, HIS nouns.

Return only drafts. No prose, no meta, no explanation. Every draft.text starts with "I assume that if I" and contains the word "then" between antecedent and consequent.
`.trim();

/**
 * Server-side coach-draft generator for Column 5. Called once per
 * map when the coachee advances into the assumptions stage. Returns
 * the drafts in a schema-safe shape; the caller resolves indices to
 * commitment_ids and persists via saveAssumptionDrafts.
 */
export async function draftAssumptionsFromCommitments(input: {
  goalText: string;
  commitments: Array<{ text: string; worry_text: string }>;
}): Promise<Array<{ text: string; commitment_indices: number[] }>> {
  const started = Date.now();
  try {
    if (input.commitments.length === 0) return [];
    const commitmentBlock = input.commitments
      .map(
        (c, i) =>
          `  ${i + 1}. commitment: ${c.text}\n     paired worry: ${c.worry_text}`,
      )
      .join("\n");
    const { object } = await generateObject({
      model: mainModel(),
      schema: AssumptionDraftsSchema,
      system: DRAFT_ASSUMPTIONS_SYSTEM,
      prompt: [
        `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
        ``,
        `Competing commitments (Column 4) with their paired worries:`,
        commitmentBlock,
        ``,
        `Cluster these commitments and draft the Big Assumptions underneath. Use 1-based indices from the list above in each draft's commitment_indices.`,
      ].join("\n"),
      maxOutputTokens: 1200,
    });
    // Clamp indices to the input range so a hallucinated index can't
    // land a link pointing at nothing. Also pipe each draft through:
    //   - scrubReply: dash/claim/comma-space cleanup
    //   - ensureStem: canonical "I assume that" prefix
    //   - ensureThenAfterIfClause: canonical "then" between antecedent
    //     and consequent (predictive frame, not diagnostic)
    // so a compliant model that drops either token still lands here in
    // canonical Kegan/Lahey form.
    const max = input.commitments.length;
    const normalized = object.drafts.map((d) => ({
      text: ensureThenAfterIfClause(
        ensureStem(scrubReply(d.text), ASSUMPTION_STEM),
      ),
      commitment_indices: d.commitment_indices.filter(
        (n) => n >= 1 && n <= max,
      ),
    }));

    // Belt-and-suspenders rubric filter. Prompt guidance alone has
    // proven insufficient — the drafter periodically produces drafts
    // that pass Form-First checks (stem, then, atomic) but fail the
    // depth rubric (missing identity landing). Those drafts then get
    // offered to the coachee, who taps "Use this draft", promotes to
    // itc_assumptions, and immediately gets bounced by the same
    // rubric via computeAdvanceGate ("N assumptions need more depth").
    // Solving upstream: score every draft here and drop any that
    // fails identity-landing OR overall score < 2. Better to show
    // the coachee fewer drafts than to show him drafts that will
    // trap him at the depth gate.
    //
    // Architecturally Form-First-pure: server-side scoring of
    // server-computed metadata before persisting metadata. Coachee
    // never sees a rejected draft. If ALL drafts are rejected, the
    // return is empty and the UI shows the "Add another Big
    // Assumption" form with no drafts — user writes their own.
    const scored = await Promise.all(
      normalized.map(async (d) => {
        try {
          const score = await scoreAssumptionDepth({
            goalText: input.goalText,
            assumptionText: d.text,
          });
          return { draft: d, score };
        } catch (err) {
          console.warn(
            "[itc coach] draft rubric score failed, keeping draft: %s",
            err instanceof Error ? err.message : String(err),
          );
          // On score failure keep the draft (fail-open) — better a
          // possibly-shallow draft than losing the drafter output
          // entirely to a transient rubric error.
          return { draft: d, score: null };
        }
      }),
    );
    const kept = scored.filter(({ score }) => {
      if (score === null) return true; // fail-open on rubric error
      // Require identity-landing AND score >= 2. A draft with a
      // finished-then + first-person-felt but no identity-landing
      // would score 2 without lands_in_identity — reject those
      // explicitly, since that's exactly the failure mode we're
      // guarding against.
      return score.lands_in_identity_or_big_time_bad && score.score >= 2;
    });
    const dropped = scored.length - kept.length;
    if (dropped > 0) {
      console.warn(
        "[itc coach] rubric filter dropped %d/%d draft(s) for missing identity landing or low depth score",
        dropped,
        scored.length,
      );
    }
    return kept.map(({ draft }) => draft);
  } catch (err) {
    console.warn(
      "[itc coach] draftAssumptionsFromCommitments failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  } finally {
    console.warn(
      "[itc timing] draft kind=assumptions ms=%d",
      Date.now() - started,
    );
  }
}

// -------------------------------------------------------------------------
// generateImmuneSystemWalkthrough — coach-delivered Column 5 walkthrough
// -------------------------------------------------------------------------

/**
 * Kegan/Lahey-voiced three-movement walkthrough of the coachee's own
 * immunity map. Fires once when the coachee advances into the
 * immune_system stage (server-orchestrated via
 * deliverWalkthroughAfterAdvance in actions.ts). The output is
 * persisted as a stage_note message anchored to itc_maps and rendered
 * at the top of the Column 5 section — the coachee sees it as one
 * block of prose that explains his own map back to him.
 *
 * Form-First-pure: the coach never emits markers or writes state.
 * This helper returns prose; the server writes the message + flips
 * walkthrough_delivered.
 */
export async function generateImmuneSystemWalkthrough(input: {
  goalText: string;
  /** Selected Column 2 behaviors, in on-map order. */
  behaviors: string[];
  /** Column 4 commitments, in on-map order, each with paired worry
   *  + behavior for the top-down chain. Index in this array is the
   *  1-based commitment_index that assumptionsWithCoverage references. */
  commitmentsWithChain: Array<{
    text: string;
    worryText: string;
    behaviorText: string;
  }>;
  /** Column 5 assumptions with commitment coverage (1-based indices
   *  into commitmentsWithChain). Each assumption's Movement-1 loop
   *  names all its covered commitments + their behaviors. */
  assumptionsWithCoverage: Array<{
    text: string;
    commitmentIndices: number[];
  }>;
}): Promise<string | null> {
  const started = Date.now();
  try {
    if (input.assumptionsWithCoverage.length === 0) return null;
    if (input.commitmentsWithChain.length === 0) return null;

    const behaviorsBlock = input.behaviors
      .map((t, i) => `  ${i + 1}. ${t}`)
      .join("\n");

    const commitmentsBlock = input.commitmentsWithChain
      .map(
        (c, i) =>
          `  ${i + 1}. commitment: ${c.text}\n     paired worry: ${c.worryText}\n     paired behavior: ${c.behaviorText}`,
      )
      .join("\n");

    const assumptionsBlock = input.assumptionsWithCoverage
      .map(
        (a, i) =>
          `  ${i + 1}. assumption: ${a.text}\n     underwrites commitments: ${a.commitmentIndices.join(", ") || "(none linked)"}`,
      )
      .join("\n");

    const { IMMUNE_SYSTEM_STAGE } = await import(
      "./prompts/stages/immune-system"
    );

    const { text } = await generateText({
      model: mainModel(),
      system: IMMUNE_SYSTEM_STAGE,
      prompt: [
        `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
        ``,
        `Behaviors (Column 2):`,
        behaviorsBlock || "  (none)",
        ``,
        `Competing commitments (Column 4) with paired worry + behavior:`,
        commitmentsBlock,
        ``,
        `Big Assumptions (Column 5) with commitment coverage:`,
        assumptionsBlock,
        ``,
        `Deliver the three-movement walkthrough now. Return only the walkthrough prose — no meta, no headings, no scaffolding.`,
      ].join("\n"),
      maxOutputTokens: 3000,
    });
    // Use the light scrub — the full scrubReply's advance-cut would
    // truncate at the first mention of "big assumptions", "worry box",
    // "competing commitments", etc., which the walkthrough is
    // explicitly ABOUT. That's the bug that caused the walkthrough to
    // appear to "generate nothing" in the UI.
    return scrubReplyLight(text);
  } catch (err) {
    console.warn(
      "[itc coach] generateImmuneSystemWalkthrough failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    console.warn(
      "[itc timing] walkthrough kind=immune_system ms=%d",
      Date.now() - started,
    );
  }
}

// -------------------------------------------------------------------------
// recommendAssumptionToTest — coach picks the first assumption to test
// -------------------------------------------------------------------------

const PrioritizeRecommendationSchema = z.object({
  /** 1-based index into the assumptions list passed to the prompt.
   *  The server pre-selects this assumption for testing via
   *  setAssumptionSelected, and the coachee can override by clicking
   *  a different one in the UI. */
  picked_index: z.number().int().min(1),
  /** Two-paragraph Kegan-voice recommendation the coachee reads on
   *  the prioritize section. Paragraph 1: the pick + why. Paragraph
   *  2: what the coachee stands to learn. Close: one line invitation
   *  to accept or override. */
  prose: z.string().min(30).max(2000),
});

/**
 * Kegan-voice recommendation of which Big Assumption to test first.
 * Applies the Vol 2 p. 268 criteria (powerful / safe / disconfirmable)
 * to the coachee's specific map. Fires once when the coachee advances
 * into the prioritize stage (server-orchestrated via
 * deliverPrioritizeRecommendationAfterAdvance).
 *
 * Form-First-pure: returns METADATA (pick + prose). Server persists
 * the prose as a stage_note and pre-selects the recommended assumption
 * via setAssumptionSelected. Coachee can override by clicking a
 * different assumption in the UI.
 */
export async function recommendAssumptionToTest(input: {
  goalText: string;
  /** All assumptions on the map, in on-map order, with the commitment
   *  texts they underwrite. Coverage count feeds the POWERFUL
   *  criterion (more coverage → more system-loosening if it falls). */
  assumptionsWithCoverage: Array<{
    text: string;
    commitmentTexts: string[];
  }>;
}): Promise<{ pickedIndex: number; prose: string } | null> {
  const started = Date.now();
  try {
    if (input.assumptionsWithCoverage.length === 0) return null;

    const assumptionsBlock = input.assumptionsWithCoverage
      .map((a, i) => {
        const coverage =
          a.commitmentTexts.length > 0
            ? a.commitmentTexts
                .map((c, ci) => `        ${ci + 1}. ${c}`)
                .join("\n")
            : "        (no commitments linked)";
        return `  ${i + 1}. assumption: ${a.text}\n     underwrites commitments:\n${coverage}`;
      })
      .join("\n\n");

    const { PRIORITIZE_STAGE } = await import(
      "./prompts/stages/prioritize"
    );

    const { object } = await generateObject({
      model: mainModel(),
      schema: PrioritizeRecommendationSchema,
      system: PRIORITIZE_STAGE,
      prompt: [
        `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
        ``,
        `Big Assumptions (Column 5) with the commitments each underwrites:`,
        assumptionsBlock,
        ``,
        `Recommend which assumption to test first. Return picked_index (1-based) and the two-paragraph prose recommendation.`,
      ].join("\n"),
      maxOutputTokens: 1500,
    });

    // Clamp index to input range so a hallucinated index can't point
    // at nothing. Also normalize prose through scrubReplyLight (dashes
    // + claim strip + comma-space, preserves paragraph breaks and
    // column-name mentions — the recommendation legitimately names
    // "Column 5" and the assumption text).
    const max = input.assumptionsWithCoverage.length;
    const pickedIndex = Math.max(1, Math.min(max, object.picked_index));
    return {
      pickedIndex,
      prose: scrubReplyLight(object.prose),
    };
  } catch (err) {
    console.warn(
      "[itc coach] recommendAssumptionToTest failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    console.warn(
      "[itc timing] recommend kind=prioritize ms=%d",
      Date.now() - started,
    );
  }
}

// -------------------------------------------------------------------------
// draftTestForAssumption + reviewTestDesign — coach test-design helpers
// -------------------------------------------------------------------------

const TestDraftSchema = z.object({
  test_type: z.enum([
    "data_mining",
    "observation",
    "thought_experiment",
    "behavioral",
  ]),
  /** Verbatim quote from the assumption's text, sharpened with the
   *  specific prediction the assumption makes about what happens if
   *  the counter-move runs. */
  assumption_says: z.string().min(10).max(400),
  /** The behavior change — one specific move in one specific moment.
   *  Modest, actionable within a week, SAFE, and a real move against
   *  what the assumption dictates. */
  behavior_change: z.string().min(10).max(400),
  /** Two kinds: observable data (what would show up on a videotape)
   *  and experiential data (how the coachee felt). Not interpretive
   *  data that requires reading anyone's mind. */
  data_to_collect: z.string().min(10).max(400),
  /** What the coachee hopes to LEARN. Names a specific disconfirmation
   *  condition — what observation would tell them the assumption
   *  doesn't hold. */
  in_order_to_find_out: z.string().min(10).max(400),
  /** ISO YYYY-MM-DD, in the future, within about a week. */
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Pre-draft a Kegan-voiced first-pass test for the assumption the
 * coachee has selected for testing. Fires once on advance to
 * test_design (idempotent — skip if a test already exists for this
 * assumption). Coachee sees the draft in the test-design form,
 * edits any field, and saves — the save action promotes the draft
 * to a persisted itc_tests row.
 *
 * Form-First-pure: coach returns METADATA (four fields + type +
 * target_date); server-orchestrated persistence.
 */
export async function draftTestForAssumption(input: {
  goalText: string;
  assumptionText: string;
  /** Column 4 commitments the selected assumption underwrites, in
   *  on-map order. Feeds Vol 2 p 271 option 2 (act counter to a
   *  commitment). */
  underwrittenCommitments: Array<{ text: string; behaviorText: string }>;
  /** Today's date (ISO). Used to compute the target_date constraint
   *  ("within about a week"). Server passes; helper doesn't
   *  hard-code so tests can override. */
  todayIso: string;
}): Promise<{
  testType: "data_mining" | "observation" | "thought_experiment" | "behavioral";
  assumptionSays: string;
  behaviorChange: string;
  dataToCollect: string;
  inOrderToFindOut: string;
  targetDate: string;
} | null> {
  const started = Date.now();
  try {
    const commitmentsBlock = input.underwrittenCommitments
      .map(
        (c, i) =>
          `  ${i + 1}. commitment: ${c.text}\n     paired behavior: ${c.behaviorText}`,
      )
      .join("\n");
    const { TEST_DESIGN_STAGE } = await import(
      "./prompts/stages/test-design"
    );
    const { object } = await generateObject({
      model: mainModel(),
      schema: TestDraftSchema,
      system: TEST_DESIGN_STAGE,
      prompt: [
        `MODE: draft (pre-draft a first-pass test for the assumption below).`,
        ``,
        `Today's date (ISO): ${input.todayIso}`,
        `Target date must be in the future, on or within about a week from today.`,
        ``,
        `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
        ``,
        `Big Assumption being tested (Column 5): ${input.assumptionText}`,
        ``,
        `Competing commitments this assumption underwrites (Column 4):`,
        commitmentsBlock || "  (none)",
        ``,
        `Draft the four-field test now. Return the structured object.`,
      ].join("\n"),
      maxOutputTokens: 1200,
    });
    return {
      testType: object.test_type,
      assumptionSays: scrubReply(object.assumption_says),
      behaviorChange: scrubReply(object.behavior_change),
      dataToCollect: scrubReply(object.data_to_collect),
      inOrderToFindOut: scrubReply(object.in_order_to_find_out),
      targetDate: object.target_date,
    };
  } catch (err) {
    console.warn(
      "[itc coach] draftTestForAssumption failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    console.warn(
      "[itc timing] draft kind=test ms=%d",
      Date.now() - started,
    );
  }
}

const TestReviewSchema = z.object({
  verdict: z.enum(["ready", "needs_work"]),
  prose: z.string().min(20).max(1200),
});

/**
 * Review a coachee-saved test against the SMART criteria + the
 * "might it re-true?" check. Fires on every save of the test (via
 * saveTest server action). Returns verdict + prose that renders as
 * a coach reaction thread on the test row. Coachee edits and re-saves
 * until verdict === "ready" (which enables the Continue-to-Test-
 * Running gate). Same excavation-loop shape as worries / commitments /
 * assumptions in earlier columns.
 */
export async function reviewTestDesign(input: {
  goalText: string;
  assumptionText: string;
  test: {
    testType: string;
    assumptionSays: string;
    behaviorChange: string;
    dataToCollect: string;
    inOrderToFindOut: string;
    targetDate: string;
  };
}): Promise<{ verdict: "ready" | "needs_work"; prose: string } | null> {
  const started = Date.now();
  try {
    const { TEST_DESIGN_STAGE } = await import(
      "./prompts/stages/test-design"
    );
    const { object } = await generateObject({
      model: mainModel(),
      schema: TestReviewSchema,
      system: TEST_DESIGN_STAGE,
      prompt: [
        `MODE: review (score the saved test below against SMART + might-it-re-true).`,
        ``,
        `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
        ``,
        `Big Assumption being tested (Column 5): ${input.assumptionText}`,
        ``,
        `The coachee's saved test:`,
        `  test_type: ${input.test.testType}`,
        `  My Big Assumption Says: ${input.test.assumptionSays}`,
        `  So I Will (Change my Behavior This Way): ${input.test.behaviorChange}`,
        `  And Collect the Following Data: ${input.test.dataToCollect}`,
        `  In Order to Find Out Whether: ${input.test.inOrderToFindOut}`,
        `  Target date: ${input.test.targetDate}`,
        ``,
        `Return verdict + one-paragraph prose review.`,
      ].join("\n"),
      maxOutputTokens: 1200,
    });
    return {
      verdict: object.verdict,
      prose: scrubReply(object.prose),
    };
  } catch (err) {
    console.warn(
      "[itc coach] reviewTestDesign failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    console.warn(
      "[itc timing] review kind=test ms=%d",
      Date.now() - started,
    );
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
  // Also fix a recurring LLM typo: comma directly followed by a letter
  // ("wife,and", "loves,and") should be "wife, and". Numeric commas
  // (1,000) are preserved because we only match commas followed by an
  // A–Z letter, not a digit.
  cleaned = cleaned
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/,([A-Za-z])/g, ", $1")
    .replace(/([.!?])\s*\1/g, "$1")
    .trim();
  return cleaned;
}

/**
 * Dashes + claim-of-action + whitespace cleanup, WITHOUT the
 * premature-advance cut. Use this for coach output that is
 * legitimately supposed to name multiple columns / the map's
 * structure — e.g., the immune-system walkthrough, which explicitly
 * traces the Column-4-to-Column-1 pathway across every assumption.
 *
 * scrubReply's advance-cut is designed to prevent an ENTRY-level coach
 * reaction from front-running the coachee to the next column. That
 * guard is exactly wrong for a walkthrough: the walkthrough MUST
 * discuss "big assumptions", "competing commitments", "worry box",
 * etc. — those are the map's own labels being read back. Running
 * scrubReply on walkthrough output truncates it at the first mention
 * of any column label, leaving a near-empty stage_note that renders
 * as blank space in the UI (the bug that made the walkthrough appear
 * to "generate nothing").
 */
export function scrubReplyLight(text: string): string {
  const dashless = text
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/[—–]/g, ",")
    .replace(/\s+--\s+/g, ", ");
  const thatsClaimRe =
    /(^|[.!?]\s+|\n)\s*that'?s\s+(?:been\s+|just\s+)?(?:locked|added|saved|noted|written|jotted|adding|saving|locking|got|down|in|there|on\s+(?:your |the )?map)(?:\s+(?:in|down|now|to\s+(?:your |the )?map|on\s+(?:your |the )?map|it|that))?\s*[.!?]?/gi;
  const bareClaimRe =
    /(^|[.!?]\s+|\n)\s*(?:got it,?\s+)?(?:i(?:'|')?ve\s+|i\s+)?(?:just\s+)?(?:locked|added|saved|adding|locking|saving|noted|written|jotted)(?:\s+(?:it|that|those|them|this)(?:\s+(?:in|down|to\s+(?:your |the )?map|on\s+(?:your |the )?map|now))?)?\s*[.!?]?/gi;
  let cleaned = dashless
    .replace(thatsClaimRe, (_m, sep) => sep || "")
    .replace(bareClaimRe, (_m, sep) => sep || "");
  // Normalize whitespace + comma-space (same as scrubReply) but
  // preserve paragraph breaks: only collapse runs of horizontal
  // whitespace, not newlines. The walkthrough uses \n\n between
  // movements and those must survive to render as paragraph breaks
  // in the whitespace-pre-wrap UI.
  cleaned = cleaned
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,!?])/g, "$1")
    .replace(/,([A-Za-z])/g, ", $1")
    .replace(/([.!?])[ \t]*\1/g, "$1")
    .trim();
  return cleaned;
}
