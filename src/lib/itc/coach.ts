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
import { VOICE_RULES } from "./prompts/preamble";

/**
 * Wrap a drafter-specific system prompt with the coach voice/tone
 * rulebook. All drafter output surfaces on the same map the reaction
 * coach reads, so both must obey the same language rules — otherwise
 * the reaction coach corrects abstractions the drafter itself
 * produced ("keeping her mistakes loaded so I don't have to stay and
 * face myself"). Single source of truth: `docs/coach-voice-and-tone.md`.
 */
export function withVoiceRules(drafterSystem: string): string {
  return `${VOICE_RULES}\n\n===== END VOICE RULES =====\n\n${drafterSystem}`;
}
import {
  checkAssumptionLogicalConsistency,
  checkCommitmentLogicalConsistency,
  checkWorryLogicalConsistency,
  scoreCommitmentDepth,
  scoreWorryDepth,
} from "./rubric";
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
    return {
      reply: ensureParagraphs(scrubReply(text)),
      durationMs: Date.now() - started,
    };
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
  /** When the coach detects a cross-pillar goal leak (the goal
   *  clearly belongs on a different BRAVEMAN pillar than the one
   *  the coachee picked), populate this with the correct pillar
   *  code. The client renders a "Switch this map to [Pillar]"
   *  action button. Omit for anything else — this is NOT a place
   *  to suggest exploring a different pillar generally; only when
   *  the specific goal reads as unambiguously belonging on a
   *  different domain. Excludes A2 (derived pillar, not
   *  user-choose-able). */
  suggested_pillar: z.enum(["B", "R", "A", "V", "E", "M", "N"]).optional(),
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
      return {
        reply: ensureParagraphs(scrubReply(text)),
        durationMs: Date.now() - started,
      };
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
  const pillar = PILLAR_BY_CODE[input.pillar];
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
      // Explicit pillar-fit guard. The generic Case-1 rule about
      // "wrong pillar" is too easy for the model to skip when the
      // goal is otherwise well-formed. This makes the check
      // mandatory and gives concrete cross-pillar leak examples.
      parts.push(
        `GOAL-SPECIFIC PILLAR CHECK (do not skip): the goal MUST be about the domain of the pillar the coachee picked (${pillar.label} = ${pillar.domain}). If the goal is about someone or something outside that domain, it is CASE 1 — push back plainly and ask him to either switch the pillar or reword the goal.\n` +
          `  Common cross-pillar leaks to catch:\n` +
          `    - Raise pillar (kids) + goal about wife/spouse → wrong pillar (that's Bond).\n` +
          `    - Bond pillar (marriage/partner) + goal about kids → wrong pillar (that's Raise).\n` +
          `    - Amplify pillar (business/wealth) + goal about family → wrong pillar (that's Bond or Raise).\n` +
          `    - Vitality/Movement pillar + goal about relationships → wrong pillar.\n` +
          `  Test: after this goal is achieved, would his day-to-day change WITHIN the ${pillar.label} domain (${pillar.domain})? If not, it's the wrong pillar for this goal.\n` +
          `  When you catch a cross-pillar leak: name it plainly ("that reads as a [correct-pillar-name] goal, but you picked ${pillar.label}. Do you want to switch the map to [correct-pillar-name], or reword the goal to focus on ${pillar.domain}?"). Do NOT approve as Case 3. Do NOT offer a refinement chip that just tweaks wording — the fix is either a different pillar or a different goal.\n` +
          `  ALSO populate the "suggested_pillar" field with the pillar code the goal actually belongs on (B/R/A/V/E/M/N — never A2). The client renders a "Switch this map to [Pillar]" action button from that field. Only set suggested_pillar when the leak is unambiguous; leave it unset for anything else. Pillar codes: B=Bond (marriage/partner), R=Raise (kids), A=Amplify (business/wealth), V=Vitality (mind/body fuel), E=Enjoyment (fun), M=Movement (body), N=Network (relationships with the Boardroom group and others).`,
      );
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
      "- No false praise. 'That's great' / 'perfect' / 'beautifully said' are banned. Acknowledgment is a plain check against the criteria.\n" +
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
      `Each suggestion is a COMPLETE column-2 doing/not-doing — a specific thing the coachee catches himself doing or failing to do in the moment that works against his goal. First-person present, one sentence. Every set MUST mix doing AND not-doing: at least one option starting with "I don't…" / "I fail to…" / "I never…" (the omission itself is the behavior), alongside "I [verb]…" options for active moves. All-doing sets miss half the immune system — the failures-to-act are as load-bearing as the active moves. Doing example: "I explain why I'm right for ten minutes instead of asking what she needs." Not-doing example: "I don't look up from my phone when she starts telling me about her day."`,
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
// draftWorryForBehavior — coach-drafted Column 3 starting text
// -------------------------------------------------------------------------

/**
 * Structured-slots schema for the worry drafter. Two slots: the
 * counter-move the coachee would take if he did the opposite of his
 * Column 2 behavior, and the identity-level felt fear that lands when
 * he pictures doing it. Server assembles the canonical Kegan/Lahey
 * "I worry that if I ..., ..." sentence via assembleWorry.
 *
 * Why the counter-move framing (not the current behavior): the
 * methodology is explicit (Vol 1 p. 13-14; encoded in
 * prompts/stages/worries.ts): "picture yourself doing the OPPOSITE of
 * the behavior — what's the worst part of that for you?" Framing the
 * antecedent as the counter-move surfaces the fear the current
 * behavior is quietly protecting against.
 */
const WorryDraftSchema = z.object({
  /** The counter-move — what he'd be doing if he did the opposite of
   *  the Column 2 behavior. Bare verb phrase, first-person present.
   *  Server prefixes "if I " so write WITHOUT the "if I" prefix.
   *  3-14 words.
   *
   *  For a "doing" behavior (I interrupt her): counter-move is
   *  "let her finish and not defend myself".
   *  For a "not-doing" behavior (I don't ask what she needs): counter-
   *  move is the affirmative form — "asked her what she needs and
   *  actually listened to the answer".
   *  Never "stopped [not-doing]" ("if I stopped not-asking her" is
   *  unreadable). Always affirmative. */
  opposite_move: z.string().min(5).max(80),
  /** The felt fear that lands when he pictures doing opposite_move.
   *  10-140 chars. Identity-level (self-labeling OR role/relational —
   *  both are ITC-valid; don't force one shape). NOT a practical
   *  concern.
   *
   *  Server appends after "I worry that if I <opposite_move>, ".
   *  Write it as the sentence continuation — no leading comma, no
   *  leading "then". Starts with "I'd..." / "she'd..." / whichever
   *  subject the fear names. Ends without a period (server adds one). */
  identity_landing: z.string().min(10).max(180),
});

/**
 * Deterministic shortener for over-cap assembled draft sentences.
 * Shared by worry, commitment, and assumption drafters — all three
 * hit the same LLM-overshoots-word-cap failure mode.
 *
 * Prior fixes were both bandaids: `917dc54` added an LLM-retry with
 * "you overshot, cut it" (LLM retried and overshot again, silent
 * drop); `f805bf7` mechanically stripped known filler tics but
 * returned null when the sentence had none to strip (also silent
 * drop). Same user-visible outcome: coachee saw fewer drafts than
 * behaviors.
 *
 * Current design: always return a string. Best-effort trim strips
 * filler ("actually", "fully", "really", "just"), trailing "instead
 * of ..." clauses, and parenthetical qualifiers when they exist.
 * If the sentence is still over cap after best-effort, return it
 * anyway — a slightly-long draft the coachee can edit down beats
 * an empty state where he doesn't even know a draft was attempted.
 * The cap is now a quality target the drafter aims for, not a
 * hard block that silently discards output.
 */
export function trimAssembledDraft(assembled: string, cap: number): string {
  const wc = (s: string) => s.trim().split(/\s+/).length;
  let s = assembled.trim();
  if (wc(s) <= cap) return s;

  // 1. Strip filler modifiers. Every drafter prompt names these as
  //    banned symptoms of over-writing.
  s = s
    .replace(
      /\b(actually|fully|really|literally|honestly|truly|genuinely|just|even|only|clearly)\b\s*/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
  if (wc(s) <= cap) return s;

  // 2. Strip a trailing "instead of ..." clause. Both worry and
  //    commitment prompts explicitly name this as a redundant tic
  //    (the counter-move already implies what it's counter to).
  const insteadIdx = s.toLowerCase().lastIndexOf(" instead of ");
  if (insteadIdx > 0) {
    let t = s.slice(0, insteadIdx).trimEnd().replace(/[,;]\s*$/, "");
    if (!/[.!?]$/.test(t)) t += ".";
    if (wc(t) <= cap) return t;
    s = t;
  }

  // 3. Strip a trailing parenthetical qualifier ("(when she's upset)").
  s = s.replace(/\s*\([^)]*\)(?=[.!?]?\s*$)/, "");

  // 4. Still over cap after all mechanical strips. Return it anyway —
  //    empty state is worse than a slightly-long draft the coachee
  //    can edit.
  return s;
}

/**
 * Server-side assembly of the canonical "I worry that if I ..., ..."
 * sentence from the two LLM slots. Handles the same normalizations as
 * assembleCommitment / assembleAssumption: trims, strips punctuation
 * the template already provides, lowercases first char unless it's a
 * pronoun "I".
 */
export function assembleWorry(slots: {
  opposite_move: string;
  identity_landing: string;
}): string {
  const move = normalizeSlot(slots.opposite_move);
  const landing = normalizeSlot(slots.identity_landing);
  // "I" pronoun after the comma stays capital (normalizeSlot handles that).
  return `I worry that if I ${move}, ${landing}.`;
}

const DRAFT_WORRY_SYSTEM = `
You draft ONE ITC-canonical worry for a coachee's Column 3 map. Your draft is a starting point the coachee will review, accept (one tap), edit, or replace with his own.

This is the depth gate of the whole map. A shallow worry ("she'd be upset", "we'd fall behind") produces a shallow commitment, a shallow assumption, and a test that measures nothing. Your job is to draft the worry that lands at the felt "yuck" — the identity-level fear the Column 2 behavior is quietly protecting him from.

## How this works (structured slots)

You return TWO slots — opposite_move and identity_landing — that fill the blanks in a template the server writes:

    "I worry that if I <opposite_move>, <identity_landing>."

You never write "I worry that", "if I", or the trailing period. The server writes those. Focus entirely on the semantic content of each slot.

## LENGTH BAR (mandatory)

Kegan-canonical worries are 15-25 words but drafts should sit at the low end of canonical to leave room for the coachee to sharpen. Your target for the ASSEMBLED sentence: **12-18 words**. Hard ceiling: 20. The server drops anything over 20 words silently — the coachee sees no card for that behavior. Don't lose the draft to sprawl.

Per-slot targets (assembled template is 5 words: "I worry that if I"):
- **opposite_move: 3-6 words.** Terse counter-move.
- **identity_landing: 5-10 words.** Terse identity landing.

Symptoms of over-writing you must strip:
- **"Fully" as a modifier** — "I'd have to FULLY see..." cuts to "I'd have to see...".
- **"Actually" as a modifier** — "she'd know I've been more focused on defending myself than ACTUALLY loving her" cuts to "than loving her".
- **Double "and" chains** — "I'd have to see I'm the man who X and I've been Y and I've failed Z" — pick ONE identity truth. Adding more dilutes the wince.
- **Over-qualifying opposite_move** — "let her finish speaking without interrupting or defending myself IN THE MOMENT WHEN SHE'S CLEARLY UPSET" cuts to "let her finish speaking".
- **"Instead of..." clauses** — "asked her what she needs INSTEAD OF EXPLAINING MYSELF FIRST" cuts to "asked her what she needs". The opposite_move IS already the counter to the behavior; naming what it's counter to is redundant.

## What each slot must contain

### opposite_move
The counter-move — what he'd be doing if he did the OPPOSITE of the Column 2 behavior. Bare verb phrase, first-person present, no "if I" prefix.

The methodology (Vol 1 p. 13-14) is explicit: to find the worry, picture yourself doing the opposite of the behavior and ask "what's the worst part of that for you?" The opposite IS the antecedent.

  - Doing behavior "I interrupt her when she's upset" → opposite_move: "let her finish speaking".
  - Doing behavior "I raise my voice when she challenges me" → opposite_move: "stayed calm and heard her out".
  - Not-doing behavior "I don't ask what she needs" → opposite_move: "asked her what she needs" (affirmative form — NEVER "stopped not-asking her", that's an unreadable double-negative).
  - Not-doing behavior "I don't apologize when I'm wrong" → opposite_move: "admitted I was wrong".

3-6 words. Specific enough that he can picture himself doing it in a real moment. Don't over-qualify (skip "in the moment", "when she's upset" — the behavior implies the moment).

### identity_landing
The felt fear that lands when he pictures doing opposite_move. This is the whole point. If this slot is shallow, the map is shallow.

**MUST land at identity level.** Two valid shapes — accept whichever fits his goal/behavior more naturally:

  1. **Self-labeling identity**: names a label he'd apply to himself. "I'd have to see I'm not the man I've pretended to be." / "I'd find out I'm weaker than I let on." / "I'd have to admit I'm a fraud."
  2. **Role/relational identity**: names a role he'd have failed in or a relationship whose collapse he can't face. "she'd see I've been failing her all along." / "I'd have to face I've failed my family." / "she'd stop counting on me and I'd know I earned it."

BOTH are canonical. Do NOT force self-labeling when role/relational fits the coachee's stated goal (e.g., a Bond-pillar goal about his marriage naturally lands relationally).

5-10 words. Ends without a period (server adds one).

## The "yuck" bar — mandatory

Coachees can't feel a practical concern. They CAN feel identity landings. Every draft must produce a wince. Ask yourself: does this identity_landing describe something a man would rather not admit out loud? If it sounds reasonable, presentable, or noble, it isn't at the yuck rung yet.

### Practical-concern anti-patterns (banned in identity_landing)

Reject any draft where the fear is:
  - **Event-level**: "she'd get upset" / "we'd have a fight" / "she'd cry" — describes what happens, not what it CONFIRMS.
  - **Practical/operational**: "we'd fall behind" / "the day would fall apart" / "it'd waste time" — sounds like a project manager, not a fear.
  - **About her behavior alone**: "she'd walk out" / "she'd stop talking to me" — that's her move, not the meaning it lands for him. If the fear is her leaving, name what her leaving would PROVE about him ("she'd walk out and I'd know I'm the man who couldn't hold this together").
  - **Vague self-help language**: "I wouldn't feel like myself" / "I'd feel disconnected" / "I wouldn't be authentic" — abstract, doesn't wince.
  - **Noble/aspirational**: "I wouldn't be the husband she deserves" — sounds like a wedding toast. Replace with the specific self-truth: "she'd see I've never actually been the husband she thought she married".

### Yuck-passing examples (good identity_landing content, under 10 words each)

Blue-collar plain. Externalized where possible — someone else witnesses it, or bare identity claim. NO interior-witness verbs ("I'd have to see", "I'd have to face", "I'd have to admit") — those are banned per the voice rules. Rotate openers so a map's set doesn't read templated:

  - "she'd know I've been defending myself, not loving her." *(she'd know)*
  - "she'd realize I don't know how to love her without performing." *(she'd realize)*
  - "she'd stop pretending I've been showing up." *(she'd stop)*
  - "she'd start telling people she's married to a shell." *(she'd start)*
  - "I've been the father who's technically present and gone." *(bare identity claim)*
  - "I've been the guy who checks out when it counts." *(bare identity claim)*
  - "the truth would come out that I've never let her in." *(the truth would come out)*
  - "she'd hear it in my voice and finally believe her sister." *(she'd hear)*

Notice: each names a truth about WHO HE IS that would be witnessed by another person or stated bare. None use "I'd have to see", "I'd have to face", "actually", "fully", "land" as metaphor, or trailing "instead of" clauses — those are all banned.

## Preserve his specificity — copy his nouns

You are naming HIS fear in HIS world. Do NOT editorialize the nouns.
  - His goal mentions "my wife" → your draft says "she" or "my wife", never "my partner" / "the people I love".
  - His behavior mentions "my kids" → your draft stays with "my kids" / "them", never "my family" (unless he already said family).
  - His pillar is Bond → the fear is relational (about her/them), not abstract.
  - His pillar is Vitality → the fear is about his body, health, energy — not "purpose in life".
  - Never invent new characters or scenarios not implied by his goal + behavior.

## Pillar grounding

The pillar constrains the domain. A fear that could be pasted onto any pillar is too generic.
  - **B (Bond)**: identity as husband/partner/father in the relationship.
  - **R (Raise)**: identity as parent — the kind of father his kids will remember him as.
  - **A (Amplify)**: identity as a man who does or doesn't build the life/work he keeps claiming he'll build.
  - **V (Vitality)**: identity as a man in a body — how present, energetic, alive he is (or isn't).
  - **E (Endeavor)**: identity as a man in his work / craft / calling — who he actually is when the pressure is on.
  - **M (Movement)**: identity as a man who does or doesn't move (fitness, discipline in his body).
  - **N (Nourishment)**: identity as a man who does or doesn't take care of what he puts into himself.

## Silent derivation

  A. Read the goal and the specific behavior.
  B. Compute the OPPOSITE of the behavior — the counter-move he'd be doing. Fill opposite_move with that verb phrase.
  C. Ask: if he actually did opposite_move in a real moment, what would he most fear it would CONFIRM about who he is?
  D. Fill identity_landing with that felt fear, at the identity rung (self-labeling or role/relational — whichever fits his material). Wince test must pass.

Return only the structured slots ({ opposite_move: "...", identity_landing: "..." }). No prose, no explanation, no meta, no wrapping sentence — the server writes that.
`.trim();

/** Hard ceiling on assembled worry length. Kegan Vol 1 worries run
 *  15-25 words; 20 sits at the low end of canonical. Overshoots are
 *  mechanically trimmed server-side (see trimAssembledDraft) rather
 *  than silently dropped — prior LLM-obedience approach (retry with
 *  "you overshot") kept producing null drafts the coachee never saw. */
const WORRY_HARD_WORD_CAP = 20;

/**
 * Server-owned rotation across Kegan-canonical identity-landing
 * shapes. The four shapes are the ones Vol 1 pp 13-14 and p 27
 * explicitly enumerate as valid Column-3 landings. When the caller
 * (draftMissingWorriesAfterAdvance) rotates one shape per behavior
 * modulo, the whole map's worry set is guaranteed to vary across
 * canonical shapes rather than clustering on one ("she'd see I've
 * been the man who X" every time).
 *
 * Same architectural pattern as ANOTHER_ROTATION / SAFER_LADDER in
 * the test-design flow: the LLM sees a hard-typed constraint from
 * the server, not a soft "vary the shape" instruction. Prompt rules
 * are LLM-obedience (drift); rotation is server-owned structure.
 */
export type WorryIdentityShape =
  | "role_noun"
  | "role_failure_verb"
  | "seen_as"
  | "self_label";

export const WORRY_IDENTITY_SHAPES: readonly WorryIdentityShape[] = [
  "role_noun",
  "role_failure_verb",
  "seen_as",
  "self_label",
] as const;

const WORRY_SHAPE_INSTRUCTIONS: Record<WorryIdentityShape, string> = {
  role_noun:
    'For THIS draft, land the identity as a ROLE-NOUN CLAIM. Use the shape: "she\'d see I\'ve been the [husband|man|father|guy|one|kind of X] who [Y]" or "I\'ve been the [role] who [Y]". Kegan Vol 1 p 14 canonical example: "the husband who hurts her".',
  role_failure_verb:
    'For THIS draft, land the identity as an EXPLICIT ROLE-FAILURE VERB directed at her/him/them. Use the shape: "she\'d see I\'ve been [choosing myself over her | abandoning her | letting her down | hurting her | running from her | failing her]" or "I\'ve been [verb-ing] her all along". Kegan Vol 1 p 14 canonical example: "chose ego over her".',
  seen_as:
    'For THIS draft, land the identity via SEEN-AS framing (Kegan Vol 1 p 13 canonical vocabulary). Use the shape: "she\'d have seen me as [X]" / "she\'d see me as [role/label]" / "I\'d have been seen as [X]" / "she\'d know me as [X]". Kegan Vol 1 p 13 canonical example: "seen as incompetent".',
  self_label:
    'For THIS draft, land the identity as a SELF-LABEL (Kegan Vol 1 p 14). Use the shape: "she\'d know I\'ve been a [fraud|fake|phony|coward|failure]" / "the truth would come out that I\'ve never been [enough|the man she thought]" / "I couldn\'t pretend I\'m not a [X]". Kegan Vol 1 p 14 canonical example: "I\'d be a fraud".',
};

/**
 * Shared runner for the worry + commitment drafters. Both share the
 * exact same verification-and-retry shape:
 *
 *   1. Generate draft (mainModel) → assemble slots → trim overshoot.
 *   2. Score depth rubric (utilityModel) + run consistency check
 *      (deterministic pattern match) in PARALLEL. Depth fail-opens
 *      on rubric error; consistency cannot fail.
 *   3. If both pass, return the assembled draft.
 *   4. If either fails, one drafter retry with the failing reason(s)
 *      fed back as feedback. Return whatever comes back — never
 *      silent-drop, per the "coachee sees SOMETHING they can edit"
 *      invariant.
 *
 * Extracted from the two near-identical implementations of
 * draftWorryForBehavior / draftCommitmentForWorry. The batch
 * assumption drafter has a different shape (batch generation +
 * per-item verify + batch retry) so it stays separate.
 *
 * Config uses closures for the rubric + consistency calls so each
 * drafter can pass its own kind-specific inputs (worry needs
 * behaviorText + worryText; commitment needs worryText + commitmentText).
 */
type DrafterConfig<TSlots> = {
  /** For log lines only. "worry" | "commitment" etc. */
  kind: string;
  schema: z.ZodType<TSlots>;
  /** Full system prompt — caller applies `withVoiceRules()`. */
  system: string;
  /** Base prompt lines. Closure captures the drafter's inputs. */
  basePromptLines: string[];
  /** Slots → canonical sentence via server-owned template. */
  assemble: (slots: TSlots) => string;
  /** Hard word cap; trimAssembledDraft is applied. */
  hardCap: number;
  maxOutputTokens: number;
  /**
   * Depth rubric call. Receives the assembled sentence, returns the
   * rubric result or throws. Runner catches errors and treats them
   * as pass (fail-open) so a Haiku hiccup can't strand the draft.
   */
  scoreDepth: (assembled: string) => Promise<{ score: number; reason: string }>;
  /**
   * Deterministic consistency check. Receives the raw slots (not the
   * assembled sentence) so pattern checks can inspect individual
   * slot contents. Cannot fail.
   */
  checkConsistency: (slots: TSlots) => { consistent: boolean; reason: string };
};

async function runDrafterWithVerification<TSlots>(
  cfg: DrafterConfig<TSlots>,
): Promise<string | null> {
  const started = Date.now();

  async function generate(
    promptLines: string[],
  ): Promise<{ assembled: string; slots: TSlots } | null> {
    const { object } = await generateObject({
      model: mainModel(),
      schema: cfg.schema,
      system: cfg.system,
      prompt: promptLines.join("\n"),
      maxOutputTokens: cfg.maxOutputTokens,
    });
    const raw = scrubReply(cfg.assemble(object));
    if (!raw) return null;
    return {
      assembled: trimAssembledDraft(raw, cfg.hardCap),
      slots: object,
    };
  }

  try {
    const first = await generate(cfg.basePromptLines);
    if (!first) return null;

    // Parallel verification. Depth (LLM) + consistency (deterministic)
    // are independent — no reason to sequence them. Cuts ~50-300ms
    // per draft vs. the pre-extract sequential shape.
    const [depthResult, consistencyResult] = await Promise.all([
      cfg.scoreDepth(first.assembled).catch((err) => {
        console.warn(
          "[itc coach] %s depth rubric failed, treating as pass: %s",
          cfg.kind,
          err instanceof Error ? err.message : String(err),
        );
        return null;
      }),
      Promise.resolve(cfg.checkConsistency(first.slots)),
    ]);

    const depthOk = depthResult === null || depthResult.score >= 3;
    const consistencyOk = consistencyResult.consistent;
    if (depthOk && consistencyOk) return first.assembled;

    // One retry with the failing reason(s) fed back.
    const feedbackLines: string[] = [];
    if (!depthOk && depthResult) {
      feedbackLines.push(
        `The depth rubric rejected it (${depthResult.score}/3). Reason: "${depthResult.reason}"`,
      );
    }
    if (!consistencyOk) {
      feedbackLines.push(
        `The logical-consistency check rejected it: "${consistencyResult.reason}"`,
      );
    }
    const retry = await generate([
      ...cfg.basePromptLines,
      ``,
      `Your previous draft was: "${first.assembled}"`,
      ...feedbackLines,
      `Rewrite the slots so both checks pass. Preserve intent; fix the flaw(s) named. Same length target.`,
    ]);
    return retry?.assembled ?? first.assembled;
  } catch (err) {
    console.warn(
      "[itc coach] draft kind=%s failed: %s",
      cfg.kind,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    console.warn(
      "[itc timing] draft kind=%s ms=%d",
      cfg.kind,
      Date.now() - started,
    );
  }
}

/**
 * Server-side coach-draft generator for Column 3. Called once per
 * selected behavior when the coachee advances into the worries stage.
 *
 * Thin wrapper around runDrafterWithVerification — see that helper
 * for the verification pipeline shape. Kegan-canonical identity
 * shape rotation (WORRY_IDENTITY_SHAPES) is applied here via the
 * optional identityShape input; the caller rotates shapes across
 * behaviors to guarantee map-level variety.
 */
export async function draftWorryForBehavior(input: {
  goalText: string;
  behaviorText: string;
  pillar: PillarCode;
  identityShape?: WorryIdentityShape;
}): Promise<string | null> {
  const pillar = PILLAR_BY_CODE[input.pillar];
  const shapeLine = input.identityShape
    ? WORRY_SHAPE_INSTRUCTIONS[input.identityShape]
    : null;
  const basePromptLines = [
    `Pillar: ${pillar.label} (${pillar.domain})`,
    `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
    `Behavior (Column 2): ${input.behaviorText}`,
    ``,
    `Fill opposite_move with the affirmative counter-move to this behavior, and identity_landing with what DOING opposite_move would REVEAL about him — the new truth exposed by the counter-move, not the identity of the current behavior. Yuck bar mandatory. Assembled sentence must be under 20 words.`,
    ...(shapeLine ? [``, shapeLine] : []),
  ];

  return runDrafterWithVerification({
    kind: "worry",
    schema: WorryDraftSchema,
    system: withVoiceRules(DRAFT_WORRY_SYSTEM),
    basePromptLines,
    assemble: assembleWorry,
    hardCap: WORRY_HARD_WORD_CAP,
    maxOutputTokens: 200,
    scoreDepth: (assembled) =>
      scoreWorryDepth({
        goalText: input.goalText,
        behaviorText: input.behaviorText,
        worryText: assembled,
      }),
    checkConsistency: (slots) =>
      checkWorryLogicalConsistency({
        behaviorText: input.behaviorText,
        oppositeMove: slots.opposite_move,
        identityLanding: slots.identity_landing,
      }),
  });
}

// -------------------------------------------------------------------------
// draftCommitmentForWorry — coach-drafted Column 4 starting text
// -------------------------------------------------------------------------

/**
 * Structured-slots schema for the commitment drafter. Two slots:
 * the ACTIVE MECHANISM a part of him is running (verb-forward, the
 * move visible on the page), and the SELF-PROTECTIVE PURPOSE it
 * serves (what identity truth about HIM this move keeps hidden).
 * Server assembles the canonical Kegan/Lahey commitment sentence via
 * assembleCommitment.
 *
 * Why two slots (was one, forcing "I'm committed to never X"): the
 * single-slot template biased every draft toward the AVOIDANCE frame
 * ("never having to see I'm the man who X"), which the reaction coach
 * correctly rejects as "still noble" — it names what he doesn't want
 * to BE, not what a part of him is actively DOING to prevent the
 * confrontation. The commitments stage prompt's calibration pair
 * spells this out: "never being the one who's the problem" is WRONG;
 * "keeping her past mistakes available so mine are never the only
 * thing on the table" is RIGHT. The two-slot shape forces the active
 * mechanism onto the page — the SAME rubric the reaction coach applies.
 */
const CommitmentDraftSchema = z.object({
  /** The ACTIVE PROTECTIVE MECHANISM — the verb-forward, first-person
   *  present-participle move a part of him is DOING to prevent the
   *  confrontation the worry fears. 3-8 words. Terse.
   *
   *  Server prefixes "I'm committed to " so write WITHOUT the prefix,
   *  WITHOUT "never", WITHOUT "not".
   *
   *  Right (verb-forward, mechanism visible, punchy):
   *    - "keeping her past mistakes available"
   *    - "staying in the room but explaining why I'm right"
   *    - "making sure I'm always the one who's right"
   *    - "pre-empting her disappointment"
   *    - "over-preparing so I can't be caught off-guard"
   *    - "telling her she's overreacting"
   *
   *  BANNED (identity-aversion frames — reaction coach rejects these):
   *    - "never being the one who's the problem"
   *    - "never having to see I'm the man who…"
   *    - "not being the husband who fails her"
   *    - "avoiding vulnerability" (abstract, no mechanism)
   *
   *  BANNED (over-contextualization — adds words without meaning):
   *    - "keeping her past mistakes available WHEN SHE CRITICIZES ME"
   *    - "staying in the situation BUT SLIPPING IN SMALL CLARIFICATIONS
   *      ABOUT WHAT REALLY HAPPENED" — the "but slipping..." is a
   *      paragraph, not a mechanism. Cut to "staying but relitigating". */
  active_move: z.string().min(5).max(60),
  /** The SELF-PROTECTIVE PURPOSE — what this active_move keeps him
   *  from having to face about HIMSELF (never about her). Starts with
   *  "so" (the purpose clause). 4-12 words. Terse.
   *
   *  Server appends after active_move with a space, then adds the
   *  terminal period.
   *
   *  Right (self-protection, identity-level, punchy):
   *    - "so mine are never the only thing on the table"
   *    - "so I never have to face I've been coasting"
   *    - "so I don't have to sit with what I'm capable of"
   *    - "so I never have to admit she's been carrying us"
   *
   *  BANNED — the "protecting HER not HIM" test:
   *    - "so I don't hurt her" / "so I don't burden her"
   *    - "so I don't make things worse" / "so we don't fall apart"
   *    - "so she doesn't get upset"
   *
   *  BANNED (verbosity tics that add nothing):
   *    - "so I never have to FULLY face…" — "fully" is a filler tic.
   *      Cut it. "so I never have to face…" is stronger.
   *    - Double-"so" chains: "so I don't have to hear X so I never have
   *      to face Y" — pick ONE. */
  protective_purpose: z.string().min(4).max(80),
});

/**
 * Server-side assembly of the canonical commitment sentence from the
 * two LLM slots. Produces:
 *
 *   "I'm also committed to <active_move> <protective_purpose>."
 *
 * The "also" is Kegan-canonical: names the SECOND commitment sitting
 * next to the Column 1 goal (the open commitment) so the coexistence
 * with the improvement goal is unmissable. Every persisted commitment
 * must start with "I'm also committed to" per the commitments-stage
 * prompt.
 *
 * The server no longer auto-injects "never" (that biased every draft
 * toward the noble avoidance frame). The active_move slot IS the
 * mechanism; the protective_purpose slot names what it protects.
 * normalizeSlot handles trim, leading/trailing punctuation, and
 * first-char casing (preserves capital "I" pronoun).
 */
export function assembleCommitment(slots: {
  active_move: string;
  protective_purpose: string;
}): string {
  const move = normalizeSlot(slots.active_move);
  const purpose = normalizeSlot(slots.protective_purpose);
  return `I'm also committed to ${move} ${purpose}.`;
}

const DRAFT_COMMITMENT_SYSTEM = `
You draft ONE non-noble hidden competing commitment for a coachee's ITC map. This is Column 4 — the self-protective mechanism a part of him is running to keep the paired worry from ever coming true. Your draft is a starting point the coachee will review, accept, edit, or replace.

**CRITICAL — this is the whole game:** your draft MUST pass the rubric the reaction coach applies on the same map. If it doesn't pass, we've built you wrong. The reaction coach rejects drafts that read as "I'm also committed to never being the man who X" or "I'm also committed to never having to see Y" as STILL NOBLE — they name what he doesn't want to BE, not what a part of him is actively DOING to stay safe. Do not produce those.

## How this works (structured slots)

You return TWO slots — active_move and protective_purpose — that fill blanks in a template the server writes:

    "I'm also committed to <active_move> <protective_purpose>."

You never write "I'm also committed to". You never write "never" as the opening word of active_move — the mechanism is what a part of him is DOING, not what he's avoiding. You never write the terminal period.

## LENGTH BAR (mandatory)

Kegan-canonical commitments are short and punchy. Vol 1 examples average 10-15 words. Your target for the ASSEMBLED sentence: **12-18 words**. Hard ceiling: 20. Non-negotiable.

Per-slot targets:
- **active_move: 3-8 words.** Terse verb phrase.
- **protective_purpose: 4-12 words.** Terse purpose clause starting with "so".

If your first draft is longer than 18 words, cut. Symptoms of over-writing you must strip out before returning:
- **"Fully" as a modifier** — "so I never have to FULLY face…" — cut it. "so I never have to face…" is stronger. "Fully" is a filler tic.
- **Double-"so" chains** — "so I don't have to hear X so I never have to face Y" — pick ONE. The commitment names ONE self-protection, not a cascade.
- **Over-contextualization in active_move** — "keeping her past mistakes available WHEN SHE CRITICIZES ME" cuts to "keeping her past mistakes available". "Staying in the situation BUT SLIPPING IN SMALL CLARIFICATIONS ABOUT WHAT REALLY HAPPENED" cuts to "staying but relitigating". Kill the qualifiers.
- **"When" / "if" / "while" clauses in active_move** — the mechanism is a standing move a part of him does, not a conditional. Cut the timing clause.

## Anchor to the behavior (Kegan Vol 1 p 4 — non-negotiable)

**The active_move IS the Column 2 behavior, phrased as an active protective vow.** Vol 1 p 4: "how if he protected himself that way, he would behave as he named in Column 2." Column 4 makes Column 2 visible as a chosen self-protection. Do NOT invent a different mechanism the behavior doesn't already contain.

Concretely: your active_move MUST reference the same core act as the behavior text. If the behavior says "bringing up her past", the mechanism is bringing up / throwing back / keeping her past in play — not "speaking first" (a different, adjacent-but-different move). If the behavior says "walking out", the mechanism is walking out / leaving / checking out — not "staying quiet" (opposite of the behavior).

The through-line check: strip stopwords from the behavior and from your active_move. At least one content word (or verb-tense variation) must overlap. "walking out" / "walking out mid-conversation" overlaps ("walking"). "bringing up her past" / "keeping her mistakes in play" doesn't overlap by word but does semantically — prefer the direct-word version.

## Two-step derivation (mandatory — run this silently for every draft)

1. **Name the CONFRONTATION.** Read the paired worry. What is the specific ACT — the thing he'd have to DO — that would produce the fear the worry names? Not the fear itself. The ACT that would produce it. The confrontation is the OPPOSITE of the Column 2 behavior.
   - Behavior: "I bring up things she did in the past instead of listening to her"
   - Worry: "I worry that if I listen to her without bringing up her past, she'd see I've been the husband who can't let things go."
   - Confrontation: LISTENING WITHOUT BRINGING UP HER PAST.
   - Correct active_move: "keeping her old mistakes on the table" (mechanism = the behavior itself). WRONG: "speaking first" (unrelated adjacent mechanism).
   - Behavior: "I stop talking and walk out of the room"
   - Worry: "I worry that if I stayed and listened, she'd see me as weak and unable to handle her."
   - Confrontation: STAYING AND LISTENING.
   - Correct active_move: "walking out before she finishes" (mechanism = the behavior itself). WRONG: "staying quiet" (opposite of the behavior).

2. **Fill active_move with the specific protective move that prevents that confrontation.** Verb-forward (keeping, staying, explaining, making sure, over-preparing, deflecting, disqualifying), first-person present participle, observable — a friend watching him could spot it in the moment. Terse.
   - Confrontation: LISTENING WITHOUT SCOREKEEPING → active_move: "keeping her past mistakes available" *(4 words)*
   - Confrontation: STAYING AND LISTENING WITHOUT DEFENDING → active_move: "staying in the room but relitigating" *(6 words)*

3. **Fill protective_purpose with the SELF-protection this mechanism gives him.** Starts with "so". Names what a part of HIM is being protected from having to face about HIMSELF. Terse.

## Calibration pairs (this is the bar — match this length AND quality)

Blue-collar plain. Every RIGHT example uses concrete verbs a working man would actually say. NO metaphorical mechanisms ("keeping X loaded", "keeping X available", "one foot out the door"), NO "on the table" / "the door" abstractions, NO "so I never have to be the man who X" (that's the noble-avoidance frame in disguise), NO metaphorical "land" ("hear the lie land"). Those all fail the voice-rules "concrete over abstract" check.

**Pair 1** (Kegan/Lahey canonical shape):
  Worry: "I worry that if I stop bringing up her past mistakes, she'd know I've been the one who's the problem in this marriage."
  WRONG (noble — reads as wedding vow, mechanism hidden):
    "I'm also committed to never being the one who's the problem in this marriage."
  WRONG (abstract mechanism metaphor — banned by voice rules):
    active_move: "keeping her past mistakes available"
    protective_purpose: "so mine are never the only thing on the table"
  RIGHT (concrete verbal act, plain purpose):
    active_move: "throwing her past back at her"
    protective_purpose: "so mine doesn't have to come up"
  Assembled (15 words): "I'm also committed to throwing her past back at her so mine doesn't have to come up."

**Pair 2** (same behavior family, different worry):
  Worry: "I worry that if I stay in the room and hear her out, she'd know I've been running whenever it matters."
  WRONG (still noble — names what he doesn't want to BE):
    "I'm also committed to never having to see I'm the man who abandons her when she needs me most."
  WRONG (abstract mechanism metaphor — banned):
    active_move: "keeping one foot out the door"
    protective_purpose: "so I never have to be needed and stay"
  RIGHT (concrete physical act, plain purpose):
    active_move: "walking out mid-conversation"
    protective_purpose: "so she stops expecting me to be there"
  Assembled (14 words): "I'm also committed to walking out mid-conversation so she stops expecting me to be there."

**Pair 3** (short and punchy — canonical length):
  Worry: "I worry that if I admit I'm wrong, she'd see I've been the man who lies to protect himself."
  WRONG (metaphorical "land" — banned):
    active_move: "slipping in small clarifications"
    protective_purpose: "so I never have to hear the lie land"
  RIGHT (concrete verbal act, plain consequence):
    active_move: "adding little corrections to my story"
    protective_purpose: "so she can't call me out on the big one"
  Assembled (17 words): "I'm also committed to adding little corrections to my story so she can't call me out on the big one."

Notice: every RIGHT active_move names a specific act a bystander could witness (throwing, walking out, adding corrections). Every RIGHT protective_purpose names a plain consequence in the world (mine doesn't come up, she stops expecting me, she can't call me out) — not an interior self-witnessing ("so I never have to face X"). None use "fully", "actually", metaphors, or "so I never have to be the man who".

## Three checks — run silently before returning

1. **Length check.** Assembled sentence under 20 words? If not, cut the qualifiers, kill "fully", collapse double-"so" chains.

2. **Wince test.** Read the assembled sentence in your head. Would it appear on a LinkedIn post, in a wedding speech, or on a good-partner blog? If yes, it's noble. Rewrite. A stranger reading a non-noble commitment thinks "that's a weird thing to admit," not "that's good advice."

3. **Verb-vs-noun rule.** Is active_move VERB-forward (keeping, staying, explaining, making sure, pre-empting, deflecting, over-preparing, disqualifying) or NOUN-forward (being, becoming, staying-as, remaining)? Non-noble is verb-forward. Rewrite noun-forward.

4. **Protecting HIM vs. protecting HER.** Read protective_purpose. Does it name what a part of HIM is protected from feeling/facing? Or does it read as restraint on her behalf ("so I don't hurt her," "so I don't burden her")? If it reads as protecting HER, rewrite so the frame flips to self-preservation. Same act, different frame. (Guides also recognize loyalty/dishonor as valid self-protection — "not wanting to be like her father," "disappointing my family" — those count when framed as identity, not as protecting the other person.)

## Banned frames

In active_move (identity-aversion, no mechanism):
  - "never being [X]" / "never becoming [Y]" — noun-forward, hides mechanism
  - "never having to see [Z]" / "never having to admit [Z]" — avoidance frame, no active move
  - "not being the [X] who [Y]" — same failure
  - "avoiding [X]" / "not doing [Y]" — names omission, not the active move
  - "letting her [X]" — describes what he lets happen to her, not what he does

In active_move (abstract mechanism metaphors — banned by voice rules):
  - "keeping [X] loaded" / "keeping [X] available" / "keeping [X] ready" — the mechanism must be an actual verbal or physical act, not a metaphorical "loaded gun" stance
  - "keeping one foot out the door" — abstract, banned
  - "on the table" / "off the table" — banned metaphor
  - "before she can land it" / "before it lands" — "land" as metaphor is banned

In protective_purpose (interior-witness verbs — banned by voice rules):
  - "so I never have to face [X]" / "so I never have to see [Y]" / "so I don't have to admit [Z]" — the whole point is externalized consequence, not internal self-witnessing
  - "so I never have to be the man who [X]" — this is the noble-avoidance frame in disguise; name what would HAPPEN if the protection failed (something a bystander could witness), not what he'd internally recognize about himself
  - Preferred plain replacements: "so she doesn't get to say I picked myself over her" / "so she stops thinking I show up" / "so mine doesn't have to come up" / "so she can't call me out"

In protective_purpose (protecting HER, not HIM):
  - "so I don't hurt her" / "so I don't burden her" / "so I don't make things worse"
  - "so she doesn't get upset" / "so she stays"
  - "so we don't fall apart"

In protective_purpose (verbosity tics):
  - "so I never have to FULLY face…" — cut "fully" (banned everywhere)
  - "so I don't have to X so I never have to Y" — pick ONE "so" clause
  - "actually" as filler — banned everywhere

If any of these show up in your first draft, run the derivation again before returning.

## Preserve the coachee's own specificity — copy his nouns

You are naming HIS mechanism in HIS words.
  - If his worry says "her past", the commitment says "her past" (not "old grievances", "history", "what happened before").
  - If his worry says "she" / "my wife", the commitment stays with the same noun (not "my partner", "the people I love", "my family").
  - If his worry names a specific act ("scripting the questions", "bringing up her past mistakes", "shutting down"), the commitment stays inside that act's shape.

## Silent derivation checklist

  A. Read the paired worry. What is the CONFRONTATION — the specific ACT that would produce the fear?
  B. What move does a part of him do to prevent that confrontation? Fill active_move (verb-forward, 3-8 words).
  C. What self-truth does this move keep him from having to face? Fill protective_purpose (starts with "so", 4-12 words).
  D. Run length + wince + verb-vs-noun + protecting-HIM checks. If any fail, rewrite before returning.

Return only the structured slots ({ active_move: "...", protective_purpose: "..." }). No prose, no explanation, no meta.
`.trim();

/** Hard ceiling on assembled commitment length. Overshoots are
 *  mechanically trimmed server-side (see trimAssembledDraft) rather
 *  than silently dropped. */
const COMMITMENT_HARD_WORD_CAP = 20;

/**
 * Server-side coach-draft generator for Column 4. Called once per
 * worry when the coachee advances into the commitments stage.
 *
 * Thin wrapper around runDrafterWithVerification — see that helper
 * for the verification pipeline shape.
 */
export async function draftCommitmentForWorry(input: {
  goalText: string;
  behaviorText: string;
  worryText: string;
}): Promise<string | null> {
  const basePromptLines = [
    `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
    `Behavior (Column 2): ${input.behaviorText}`,
    `Paired worry (Column 3): ${input.worryText}`,
    ``,
    `Fill active_move with the specific verb-forward protective mechanism a part of him is running (3-8 words), and protective_purpose with the self-protection it gives him (4-12 words, starts with "so"). Assembled sentence must be under 20 words.`,
  ];

  return runDrafterWithVerification({
    kind: "commitment",
    schema: CommitmentDraftSchema,
    system: withVoiceRules(DRAFT_COMMITMENT_SYSTEM),
    basePromptLines,
    assemble: assembleCommitment,
    hardCap: COMMITMENT_HARD_WORD_CAP,
    maxOutputTokens: 200,
    scoreDepth: (assembled) =>
      scoreCommitmentDepth({
        goalText: input.goalText,
        worryText: input.worryText,
        commitmentText: assembled,
      }),
    checkConsistency: (slots) =>
      checkCommitmentLogicalConsistency({
        activeMove: slots.active_move,
        protectivePurpose: slots.protective_purpose,
        behaviorText: input.behaviorText,
      }),
  });
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

/**
 * Structured-slots schema for the assumption drafter. The LLM produces
 * three raw semantic ingredients per draft; the server assembles the
 * canonical sentence via assembleAssumption below.
 *
 * Form-First-pure: the LLM contributes only content (what act, what
 * observable, what identity); the server owns the sentence's shape
 * (stem, "if I", "then", "and", punctuation, length envelope).
 *
 * This replaced a freeform `text: string` schema that was accumulating
 * enforcement bandaids (ensureStem, ensureThenAfterIfClause, rubric
 * filter, compression retry). Every one of those bandaids is now
 * either unnecessary (server writes those tokens) or narrower in
 * scope (rubric filter still runs but only checks identity-landing
 * depth, not shape).
 *
 * Per-slot word caps enforce total length by construction: assembled
 * sentence is 15-25 words worst case (stem+connectives=~7 + slots).
 */
const AssumptionDraftSlotsSchema = z.object({
  /** The specific act the coachee would do differently — the counter-
   *  move the assumption predicts a bad outcome from. 2-6 words.
   *  Server prefixes "if I " so write it as a bare verb phrase without
   *  the "if I" prefix. Example: "stay in the room" or "listen and
   *  admit she's right" or "stop protecting her". */
  antecedent_act: z.string().min(5).max(50),
  /** The observable tell — what would happen in the world if the
   *  assumption's prediction were true. 2-5 words. A behavior he'd
   *  exhibit ("I'd lose control"), a reaction from another person
   *  ("she'd pull away"), or a specific felt state ("I'd feel the
   *  shame"). NOT a meta-verdict like "I'd prove" or "I'd realize". */
  consequent_tell: z.string().min(3).max(40),
  /** The identity landing — what the tell confirms about who he is.
   *  2-6 words. Anchored in the coachee's own commitment language
   *  when possible ("the husband who hurts her", "not good enough for
   *  her", "the man she can't trust"). */
  consequent_identity: z.string().min(3).max(50),
  /** 1-based indices into the commitments list passed to the prompt.
   *  At least one — a draft covering nothing is useless. */
  commitment_indices: z.array(z.number().int().min(1)).min(1),
});
type AssumptionDraftSlots = z.infer<typeof AssumptionDraftSlotsSchema>;

const AssumptionDraftsSchema = z.object({
  drafts: z.array(AssumptionDraftSlotsSchema).min(1).max(6),
});

/**
 * Server-side assembly of the canonical "I assume that if I ..., then
 * ... and ...." sentence from the three LLM-provided slots.
 *
 * Normalizes each slot: trims whitespace, strips trailing punctuation
 * (LLM sometimes writes "lose control." — we'd get double period),
 * lowercases the first char of act/tell/identity if it accidentally
 * came capitalized (server writes the sentence-initial capital via
 * the "I" in "I assume").
 *
 * Assembled result runs through scrubReply for final cleanup (dash
 * normalization, claim-of-action strip). No ensureStem or
 * ensureThenAfterIfClause needed — the server writes those tokens.
 */
export function assembleAssumption(slots: {
  antecedent_act: string;
  consequent_tell: string;
  consequent_identity: string;
}): string {
  const act = normalizeSlot(slots.antecedent_act);
  const tell = normalizeSlot(slots.consequent_tell);
  const identity = normalizeSlot(slots.consequent_identity);
  return `I assume that if I ${act}, then ${tell} and ${identity}.`;
}

/**
 * Slot-content normalization used by both drafter assemblers.
 * - Trim whitespace.
 * - Strip leading `,;:` and trailing `.!?,;:` (LLM sometimes writes
 *   punctuation the server template already provides).
 * - Lowercase the first char UNLESS it's a pronoun "I" (single-letter
 *   I followed by apostrophe/whitespace/end) — that MUST stay capital
 *   or "I'd" becomes "i'd" which looks wrong in "then i'd lose control".
 */
function normalizeSlot(s: string): string {
  const trimmed = s
    .trim()
    .replace(/^[,;:]+/, "")
    .replace(/[.!?,;:]+$/, "")
    .trim();
  // Preserve capital-I pronoun ("I", "I'd", "I'm", "I've", "I'll").
  // Smart-apostrophe U+2019 also counts.
  if (/^I(?:['\u2019]|\s|$)/.test(trimmed)) return trimmed;
  return trimmed.replace(/^./, (c) => c.toLowerCase());
}

const DRAFT_ASSUMPTIONS_SYSTEM = `
You cluster a coachee's competing commitments and draft the Big Assumptions underneath them for an ITC map (Column 5). Big Assumptions are beliefs the coachee holds about how the world works that make each hidden commitment in Column 4 feel NECESSARY. To him they don't feel like assumptions — they feel like TRUTH. That's why the immune system runs itself.

## How this works (structured slots)

You do NOT return a full sentence. You return three slots per draft — antecedent_act, consequent_tell, consequent_identity — plus commitment_indices. The SERVER assembles the canonical Kegan/Lahey sentence from your slots:

    "I assume that if I [antecedent_act], then [consequent_tell] and [consequent_identity]."

You never write "I assume that", "if I", "then", or the connecting "and". The server writes those. You never write the trailing period. The server writes that. Focus entirely on the semantic content of each slot.

## HARD CAP: 20 words per assembled draft. Non-negotiable.

The server rejects any assembled draft over 20 words. Rejected drafts are DROPPED — the coachee doesn't see them and you don't get a retry. So you must budget words carefully.

The connectives ("I assume that if I", "then", "and") are 7 words. That leaves 13 words to distribute across the three slots.

Per-slot targets:
  - **antecedent_act: 2–6 words.** Bare verb phrase. Terse.
  - **consequent_tell: 2–5 words.** Observable event, terse.
  - **consequent_identity: 2–6 words.** Identity landing, terse.

Total slot budget: 13 words. Plus 7 connectives = 20-word cap.

Kegan/Lahey's canonical Big Assumptions average ~15 words. Cut modifiers ("actually", "really", "in the moment"), cut articles when possible, cut adjectives. Precision, not paragraph.

## What each slot must contain

### antecedent_act
The specific act the coachee would do differently — the counter-move the assumption predicts a bad outcome from.

  - Bare verb phrase. Do NOT prefix with "if I" — the server writes that.
  - 3–12 words. Specific enough that the coachee could actually do it this week.
  - Wrong (with prefix): "if I stay in the room while she's angry"
  - Right (bare): "stay in the room while she's angry"

Right examples: "stay in the room while she's angry" / "listen and admit she's right" / "stop protecting her from seeing my failures" / "show her the worst of me" / "keep admitting I'm wrong"

### consequent_tell
An OBSERVABLE event — something the coachee could see, hear, or feel in real life if the assumption were true. This is the testability slot.

  - A behavior he'd exhibit: "I'd lose control" / "I'd shut down"
  - A reaction from another person: "she'd pull away" / "she'd stop trusting me" / "she'd show me I've been hurting her"
  - A specific felt state: "I'd feel the shame" / "I'd flood with the same old fear"

Banned in this slot (META-LANGUAGE — these are self-verdicts, not observable events; drafts containing these are rejected server-side):
  - "I'd prove" / "I'd confirm" / "I'd realize" / "I'd finally know" / "I'd see that I'm"
  - "I'd have to see" / "I'd have to face" / "I'd have to admit" — interior-witness verbs banned by the voice rules. These are not observable events; they're the coachee's internal recognition. Replace with something external ("she'd stop trusting me", "I'd lose control", "she'd walk out").

Do NOT start the tell with "then" — the server writes that.

### consequent_identity
What the tell CONFIRMS about who he is. Anchored in the coachee's own commitment language when possible.

  - Right: "the husband who hurts her" / "not good enough for her" / "the man she can't trust" / "the guy I'm terrified I am" / "not the husband she deserves"
  - Anchor to HIS words: if his commitment says "never becoming that guy", write "that guy" or "the guy I'm terrified I am" here.

Do NOT start with "and" — the server writes that.

Banned qualifiers in this slot (unfalsifiable universals — these make the belief impossible to test with a single interaction):
  - "no matter what I do" / "no matter what" / "always" / "every time" / "for good"

## Preserve the coachee's own specificity — copy his nouns

This is a hard rule, non-negotiable:

  - If his worry says "his wife", write "his wife". Do NOT substitute "his family" / "the people he loves" / "anyone he cares about" / "his loved ones".
  - If his worry says "she'd leave", write "she'd leave". Do NOT reword to "I'd end up alone".
  - If his worry says "I'd lose control", write "I'd lose control". Do NOT reword to "I'd become someone I don't recognize".
  - If his commitment says "admit she's right", write "admit she's right". Do NOT add "completely" or any other intensifier he didn't use.

You are naming HIS belief in HIS words. You are not editorializing a smoother, more literary, or more universal version.

## Do NOT re-stem the worry

The most common drafter failure: taking the paired worry (a chained "I worry that if X, Y, and Z, and W" sentence) and copying its shape into the assumption slots verbatim. That produces re-stemmed worries, not distilled beliefs.

The worry and the Big Assumption are different objects. The worry is a felt fear with piled-up catastrophic clauses. The assumption is the ONE atomic belief UNDERNEATH the worry — the taken-as-truth claim that makes the worry feel warranted.

To decompose a worry into slots:
  - Read the worry's chained catastrophes.
  - Identify ONE atomic testable belief inside it. If the worry is "if I stay in the room, I'd lose it and say something awful, and I'd be the husband who hurts his wife", the atomic belief is either "I can't handle her anger without losing control" (about him) OR "if I show her the worst, she couldn't stay" (about her). Pick ONE.
  - Fill antecedent_act with the specific act (not "if I stay in the room" verbatim — decompose to "stay in the room while she's angry" — sharper and shorter).
  - Fill consequent_tell with the observable IF the belief were true.
  - Fill consequent_identity with the identity claim underneath.

Wrong shape (worry re-stemmed into slots): antecedent_act="stay in the room instead of walking out", consequent_tell="I'd lose control and say something awful", consequent_identity="be the husband who hurts his wife". → assembled = "I assume that if I stay in the room instead of walking out, then I'd lose control and say something awful and be the husband who hurts his wife." That's the worry with prefix swap. 30 words. Rejected.

Right shape: antecedent_act="stay in the room while she's angry", consequent_tell="I'd lose control", consequent_identity="be the husband who hurts her". → assembled = "I assume that if I stay in the room while she's angry, then I'd lose control and be the husband who hurts her." Atomic. 22 words. Passes.

## Clustering — shared-root FIRST, split only as fallback

Kegan/Lahey's methodology explicitly favors finding ONE Big Assumption that underwrites MULTIPLE competing commitments when a genuine shared root exists — that's evidence you've found a deep assumption vs. a surface one. Many-to-many is the target when it's real.

BUT: a fake cluster is worse than a split. Coverage is determined by the ANTECEDENT ONLY — not by keywords in your consequent slots.

The cluster-coverage test (mandatory before you list a commitment_index):

  1. Read your antecedent_act.
  2. For EACH commitment you're about to link, ask: "Would this coachee actually perform the act named in antecedent_act under this commitment's protective vow?"
  3. If yes for all — cluster under one draft.
  4. If yes for only some — split. Do NOT list commitment_indices for the ones that don't fit.

The consequent-keyword trap — do NOT do this: if your consequent_tell contains a phrase that ALSO appears in a commitment's paired worry, that is NOT evidence the antecedent covers that commitment. That is just a shared FEAR downstream. The antecedent (the ACT) must fit independently.

A cluster with a wrong link is worse than a smaller cluster with no wrong links.

## Coverage

Every commitment on the input list must be covered by at least one draft. No orphans. Aim for FEWER drafts (2–4 is typical for a whole map); six is a ceiling, not a target.

## Silent derivation

  A. Read goal + commitments together. Is there ONE catastrophic belief that, if provisionally suspended, would loosen ALL these commitments? If yes → one cluster.
  B. For each cluster (or standalone commitment), fill the three slots. Use HIS words, HIS nouns. Aim for the assembled sentence to land under 20 words.

Return only structured drafts (the three slots + commitment_indices per draft). No prose, no meta, no explanation, no wrapping sentence — the server writes that.
`.trim();

/**
 * Server-side coach-draft generator for Column 5. Called once per
 * map when the coachee advances into the assumptions stage. Returns
 * drafts in a schema-safe shape; the caller resolves indices to
 * commitment_ids and persists via saveAssumptionDrafts.
 *
 * Two-model verification pipeline (matches the worry drafter one
 * column upstream). Batch-generated drafts get individually
 * consistency-checked (checkAssumptionLogicalConsistency) to catch
 * inversions like "if I stay in the room, then I'm the man who can't
 * even run away when it matters" where staying is the opposite of
 * running. If any drafts fail, one batch retry fires with per-draft
 * feedback naming which are inverted. Whatever comes back is
 * returned — never silent drop.
 */
export async function draftAssumptionsFromCommitments(input: {
  goalText: string;
  commitments: Array<{ text: string; worry_text: string }>;
}): Promise<Array<{ text: string; commitment_indices: number[] }>> {
  const started = Date.now();
  const HARD_WORD_CAP = 20;

  type BatchDraft = {
    text: string;
    commitment_indices: number[];
    slots: {
      antecedent_act: string;
      consequent_tell: string;
      consequent_identity: string;
    };
  };

  async function generateBatch(extraLines: string[]): Promise<BatchDraft[]> {
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
      system: withVoiceRules(DRAFT_ASSUMPTIONS_SYSTEM),
      prompt: [
        `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
        ``,
        `Competing commitments (Column 4) with their paired worries:`,
        commitmentBlock,
        ``,
        `Cluster these commitments and draft the Big Assumptions underneath. Use 1-based indices from the list above in each draft's commitment_indices.`,
        ...extraLines,
      ].join("\n"),
      maxOutputTokens: 1200,
    });
    const max = input.commitments.length;
    return object.drafts.map((d) => {
      const raw = scrubReply(
        assembleAssumption({
          antecedent_act: d.antecedent_act,
          consequent_tell: d.consequent_tell,
          consequent_identity: d.consequent_identity,
        }),
      );
      return {
        text: trimAssembledDraft(raw, HARD_WORD_CAP),
        commitment_indices: d.commitment_indices.filter(
          (n) => n >= 1 && n <= max,
        ),
        slots: {
          antecedent_act: d.antecedent_act,
          consequent_tell: d.consequent_tell,
          consequent_identity: d.consequent_identity,
        },
      };
    });
  }

  try {
    const first = await generateBatch([]);
    if (first.length === 0) return [];

    // Verify each draft's logical consistency (deterministic pattern
    // match, cannot fail). Each drafted assumption gets its own
    // verdict; the batch retry (if any) knows which ones failed.
    const checks = first.map((d) =>
      checkAssumptionLogicalConsistency({
        antecedentAct: d.slots.antecedent_act,
        consequentTell: d.slots.consequent_tell,
        consequentIdentity: d.slots.consequent_identity,
      }),
    );

    const inverted = first
      .map((d, i) => ({ d, check: checks[i], index: i + 1 }))
      .filter((x) => !x.check.consistent);

    if (inverted.length === 0) {
      return first.map(({ slots: _slots, ...rest }) => rest);
    }

    // One batch retry with per-draft inversion feedback. The retry
    // prompt names each broken draft AND its specific inversion so the
    // drafter fixes the pair, not the whole set. Return whatever the
    // retry produces; fall back to the first batch (with inversions
    // included) if the retry fails, so the coachee is never stranded.
    const feedbackBlock = inverted
      .map(
        (x) =>
          `  - Draft #${x.index} was: "${x.d.text}". The logical-consistency check rejected it: "${x.check.reason}"`,
      )
      .join("\n");
    const retry = await generateBatch([
      ``,
      `Your previous batch had ${inverted.length} draft(s) that failed the logical-consistency check:`,
      feedbackBlock,
      ``,
      `For each failed draft, the identity slot restated the CURRENT protective behavior's identity instead of describing what the antecedent_act would REVEAL. Rewrite the whole batch so every draft passes. Antecedent must be the counter-move; consequent must describe what DOING that counter-move would expose.`,
    ]).catch((err) => {
      console.warn(
        "[itc coach] assumption batch retry failed, returning first batch: %s",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    });
    const chosen = retry && retry.length > 0 ? retry : first;
    return chosen.map(({ slots: _slots, ...rest }) => rest);
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
      system: withVoiceRules(IMMUNE_SYSTEM_STAGE),
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
    // appear to "generate nothing" in the UI. ensureParagraphs is a
    // backstop for when the model doesn't insert \n\n between the
    // three movements even though the prompt tells it to.
    return ensureParagraphs(scrubReplyLight(text));
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
    /** Per-assumption test history — populated on repeat visits to
     *  prioritize (C-ε.6). Empty array on first visit. The coach's
     *  reasoning reads this: which assumptions have been tested, how
     *  many times, and what the verdicts were. This lets the second-
     *  visit recommendation weigh "diminishing returns" (Vol 2 pp
     *  279-284) against "still untouched" (has never been tested).
     *  Kegan's authentic move: name what's been learned, weigh it
     *  against what's still open, recommend accordingly. */
    testHistory: Array<{
      verdict: "held" | "partially_challenged" | "challenged" | null;
      whatItSaysAboutAssumption: string;
    }>;
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
        // Test history block — empty on first visit, populated on
        // repeat visits. The prompt reads this to weigh "already
        // tested, keep going or move on" vs. "still untouched."
        const history =
          a.testHistory.length === 0
            ? "     tested: no (this assumption has never been tested yet)"
            : `     tested: ${a.testHistory.length}× — verdicts:\n${a.testHistory
                .map(
                  (h, hi) =>
                    `        ${hi + 1}. ${h.verdict ?? "no verdict"} — coachee's take: "${(h.whatItSaysAboutAssumption ?? "").slice(0, 200)}"`,
                )
                .join("\n")}`;
        return `  ${i + 1}. assumption: ${a.text}\n     underwrites commitments:\n${coverage}\n${history}`;
      })
      .join("\n\n");

    const { PRIORITIZE_STAGE } = await import(
      "./prompts/stages/prioritize"
    );

    const { object } = await generateObject({
      model: mainModel(),
      schema: PrioritizeRecommendationSchema,
      system: withVoiceRules(PRIORITIZE_STAGE),
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
      prose: ensureParagraphs(scrubReplyLight(object.prose)),
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
   *  the counter-move runs. Max aligned with saveTestSchema (1000)
   *  so the coach's revise path never fails schema validation on a
   *  slightly long input the user was allowed to save. */
  assumption_says: z.string().min(10).max(1000),
  /** The behavior change — one specific move in one specific moment.
   *  Modest, actionable within a week, SAFE, and a real move against
   *  what the assumption dictates. */
  behavior_change: z.string().min(10).max(1000),
  /** Two kinds: observable data (what would show up on a videotape)
   *  and experiential data (how the coachee felt). Not interpretive
   *  data that requires reading anyone's mind. */
  data_to_collect: z.string().min(10).max(1000),
  /** What the coachee hopes to LEARN. Names a specific disconfirmation
   *  condition — what observation would tell them the assumption
   *  doesn't hold. */
  in_order_to_find_out: z.string().min(10).max(1000),
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
export type TestType =
  | "data_mining"
  | "observation"
  | "thought_experiment"
  | "behavioral";

/**
 * Draft a single test of a given type. Variation between drafts is
 * handled server-side by picking a different `testType` on each call
 * (see ANOTHER_ROTATION / SAFER_LADDER in actions.ts). This helper
 * has ONE job: write a well-formed test of the specified type. No
 * "produce something different" instructions to be ignored.
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
  /** Constrain the draft to this test_type. The LLM MUST produce a
   *  test that matches this type's structural shape (see the "four
   *  test types" section in prompts/stages/test-design.ts). If
   *  omitted, LLM picks whichever type fits best (used for the very
   *  first draft on advance to test_design). */
  testType?: TestType;
}): Promise<{
  testType: TestType;
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

    const typeConstraint = input.testType
      ? `\n\nTest type: this draft MUST be of type "${input.testType}". Read the "four test types" section carefully — the test's structural shape is defined by the type. Do NOT produce a test of a different shape and re-label it. Match the shape of the requested type.`
      : "";

    const { object } = await generateObject({
      model: mainModel(),
      schema: TestDraftSchema,
      system: withVoiceRules(TEST_DESIGN_STAGE),
      prompt: [
        `Draft one test of the specified type for the assumption below.${typeConstraint}`,
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
        `Fill all four fields and return the structured object.`,
      ].join("\n"),
      maxOutputTokens: 1200,
    });
    return {
      // If the caller pinned a testType, honor it; otherwise use LLM's choice.
      testType: input.testType ?? object.test_type,
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

/**
 * Structured SMART review. LLM writes semantic content only — the
 * pass/fail flags + one-sentence notes per criterion. The client
 * renders the visual card (bullets, icons, colored borders). This
 * matches the "server owns structure, LLM owns semantic content"
 * pattern — the LLM never writes markdown or formatting characters.
 */
const SmartCriterionSchema = z.object({
  pass: z.boolean(),
  /** One short sentence grounded in the specific test — not a
   *  generic definition of the criterion. Under ~140 chars. */
  note: z.string().min(3).max(240),
});
const TestReviewSchema = z.object({
  verdict: z.enum(["ready", "needs_work"]),
  smart: z.object({
    safe: SmartCriterionSchema,
    modest: SmartCriterionSchema,
    actionable: SmartCriterionSchema,
    researches: SmartCriterionSchema,
    /** Was tests_belief before we standardized on "assumption" as
     *  the single term for the Column 5 element (Kegan's Big
     *  Assumption). "Counters" is also more precise: the criterion
     *  is that the behavior moves AGAINST what the assumption
     *  dictates, not just any test in the abstract. */
    counters_assumption: SmartCriterionSchema,
  }),
  /** Present iff verdict === "needs_work". One sentence naming the
   *  single specific edit to make, pointing at the failed criterion. */
  one_thing_to_tighten: z.string().min(3).max(400).nullable(),
});
export type SmartReview = z.infer<typeof TestReviewSchema>;

/**
 * Review a coachee-saved test against the SMART criteria + the
 * "might it re-true?" check. Fires on every runTest action call.
 * Returns a structured verdict + per-criterion pass/note; the client
 * renders the visual card. Coachee edits and re-runs until verdict
 * === "ready", which advances to test_running.
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
}): Promise<SmartReview | null> {
  const started = Date.now();
  try {
    const { TEST_DESIGN_STAGE } = await import(
      "./prompts/stages/test-design"
    );
    const { object } = await generateObject({
      model: mainModel(),
      schema: TestReviewSchema,
      system: withVoiceRules(TEST_DESIGN_STAGE),
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
        `Return the structured SMART verdict per the schema. Each SMART criterion gets a pass/fail flag and one short sentence grounded in the SPECIFIC test above (not a generic definition). If verdict is "needs_work", one_thing_to_tighten names the single specific edit to make. If verdict is "ready", one_thing_to_tighten is null.`,
      ].join("\n"),
      maxOutputTokens: 1200,
    });
    return {
      verdict: object.verdict,
      smart: {
        safe: {
          pass: object.smart.safe.pass,
          note: scrubReply(object.smart.safe.note),
        },
        modest: {
          pass: object.smart.modest.pass,
          note: scrubReply(object.smart.modest.note),
        },
        actionable: {
          pass: object.smart.actionable.pass,
          note: scrubReply(object.smart.actionable.note),
        },
        researches: {
          pass: object.smart.researches.pass,
          note: scrubReply(object.smart.researches.note),
        },
        counters_assumption: {
          pass: object.smart.counters_assumption.pass,
          note: scrubReply(object.smart.counters_assumption.note),
        },
      },
      one_thing_to_tighten: object.one_thing_to_tighten
        ? scrubReply(object.one_thing_to_tighten)
        : null,
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

/**
 * Revise a test using the SMART feedback the coach just returned.
 * The coachee clicked "Have the coach revise this" on the SMART card.
 * Different from draftTestForAssumption: we're not writing from
 * scratch, we're targeted-editing the current test to fix the
 * specific criteria that failed. Preserve what worked; change what
 * didn't. Keep the same test_type unless the failure is fundamentally
 * a wrong-type problem — in which case, keep it anyway (type changes
 * are the user's call via the dropdown).
 */
export type ReviseTestResult =
  | {
      testType: TestType;
      assumptionSays: string;
      behaviorChange: string;
      dataToCollect: string;
      inOrderToFindOut: string;
      targetDate: string;
    }
  | { error: string };

export async function reviseTestFromReview(input: {
  goalText: string;
  assumptionText: string;
  underwrittenCommitments: Array<{ text: string; behaviorText: string }>;
  todayIso: string;
  currentTest: {
    testType: TestType;
    assumptionSays: string;
    behaviorChange: string;
    dataToCollect: string;
    inOrderToFindOut: string;
    targetDate: string;
  };
  review: SmartReview;
}): Promise<ReviseTestResult> {
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
    // Render the SMART verdict as prompt text so the model sees exactly
    // what failed + the one-sentence fix directive. Server-owned
    // rendering — the LLM never re-parses the structured object.
    const smartLines = [
      `  safe: ${input.review.smart.safe.pass ? "PASS" : "FAIL"} — ${input.review.smart.safe.note}`,
      `  modest: ${input.review.smart.modest.pass ? "PASS" : "FAIL"} — ${input.review.smart.modest.note}`,
      `  actionable: ${input.review.smart.actionable.pass ? "PASS" : "FAIL"} — ${input.review.smart.actionable.note}`,
      `  researches: ${input.review.smart.researches.pass ? "PASS" : "FAIL"} — ${input.review.smart.researches.note}`,
      `  counters_assumption: ${input.review.smart.counters_assumption.pass ? "PASS" : "FAIL"} — ${input.review.smart.counters_assumption.note}`,
    ].join("\n");
    const { object } = await generateObject({
      model: mainModel(),
      schema: TestDraftSchema,
      system: withVoiceRules(TEST_DESIGN_STAGE),
      prompt: [
        `Revise the coachee's current test to address the SMART failures below. This is targeted editing — preserve what worked, change what didn't. Do NOT write from scratch.`,
        ``,
        `Keep test_type as "${input.currentTest.testType}" — type changes are the coachee's call via the dropdown, not yours.`,
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
        `Current test the coachee saved:`,
        `  test_type: ${input.currentTest.testType}`,
        `  My Big Assumption Says: ${input.currentTest.assumptionSays}`,
        `  So I Will: ${input.currentTest.behaviorChange}`,
        `  And Collect the Following Data: ${input.currentTest.dataToCollect}`,
        `  In Order to Find Out Whether: ${input.currentTest.inOrderToFindOut}`,
        `  Target date: ${input.currentTest.targetDate}`,
        ``,
        `Your last SMART review of this test:`,
        `  verdict: ${input.review.verdict}`,
        smartLines,
        input.review.one_thing_to_tighten
          ? `  one_thing_to_tighten: ${input.review.one_thing_to_tighten}`
          : ``,
        ``,
        `Return the revised test as the full structured object.`,
        ``,
        `INVARIANT: the revised test MUST clear ALL FIVE SMART criteria — not just the one that failed. A revision that fixes counters_assumption but breaks modest has not helped the coachee. Before you return, mentally re-score the revision against every criterion. If addressing the failure requires touching a field that was passing, touch it — for example, if you rewrite behavior_change to counter the assumption more directly, you may need to sharpen data_to_collect + in_order_to_find_out to match, and you may need to bound the scope (specific moment, specific duration) so modest still passes.`,
        ``,
        `Prefer targeted edits over rewrites, but if the failure is fundamental — e.g., counters_assumption failed because the behavior is what the coachee already does — rewrite the affected field entirely rather than tweaking around the edges. Don't try to preserve a behavior that structurally can't pass the criterion.`,
      ].join("\n"),
      maxOutputTokens: 1200,
    });
    return {
      testType: input.currentTest.testType, // pinned — user owns type via dropdown
      assumptionSays: scrubReply(object.assumption_says),
      behaviorChange: scrubReply(object.behavior_change),
      dataToCollect: scrubReply(object.data_to_collect),
      inOrderToFindOut: scrubReply(object.in_order_to_find_out),
      targetDate: object.target_date,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[itc coach] reviseTestFromReview failed: %s", message);
    // Surface the underlying error to the client so we can debug
    // schema violations, timeouts, etc. from the failure toast
    // instead of a generic "couldn't produce" black box.
    return { error: message };
  } finally {
    console.warn(
      "[itc timing] revise kind=test ms=%d",
      Date.now() - started,
    );
  }
}

// -------------------------------------------------------------------------
// reviewTestResult — coach post-test debrief helper
// -------------------------------------------------------------------------
//
// Debrief scaffolds live in the client form as native HTML placeholders
// (results-form.tsx). No LLM pre-draft — the scaffolds don't depend on
// map content, and using placeholder= gives the coachee the correct
// visual affordance (gray, disappears on focus).

const TestResultReviewSchema = z.object({
  prose: z.string().min(30).max(1500),
});

/**
 * Kegan-voice review of the coachee's post-test debrief. Fires on
 * every save of the test result via saveTestResult server action.
 * Prose lands as entry_thread on the test result row so the coachee
 * can read it as they consider whether their verdict + next_step
 * actually match the data.
 */
export async function reviewTestResult(input: {
  goalText: string;
  assumptionText: string;
  test: {
    behaviorChange: string;
    dataToCollect: string;
    inOrderToFindOut: string;
  };
  result: {
    whatIDid: string;
    dataCollected: string;
    whatItSaysAboutAssumption: string;
    verdict: "held" | "partially_challenged" | "challenged";
    nextStep: "new_test" | "new_assumption" | "map_complete";
  };
}): Promise<{ prose: string } | null> {
  const started = Date.now();
  try {
    const { RESULTS_STAGE } = await import("./prompts/stages/results");
    const { object } = await generateObject({
      model: mainModel(),
      schema: TestResultReviewSchema,
      system: withVoiceRules(RESULTS_STAGE),
      prompt: [
        `MODE: review (interpret the coachee's saved debrief against the assumption's specific prediction).`,
        ``,
        `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
        `Big Assumption being tested: ${input.assumptionText}`,
        ``,
        `Test design:`,
        `  So I Will: ${input.test.behaviorChange}`,
        `  And Collect the Following Data: ${input.test.dataToCollect}`,
        `  In Order to Find Out Whether: ${input.test.inOrderToFindOut}`,
        ``,
        `The coachee's saved debrief:`,
        `  So in Order to Test it I Changed my Behavior This Way: ${input.result.whatIDid}`,
        `  This is What I Observed Happening: ${input.result.dataCollected}`,
        `  And This is What it Tells me About my Big Assumption: ${input.result.whatItSaysAboutAssumption}`,
        `  Verdict: ${input.result.verdict}`,
        `  Next step: ${input.result.nextStep}`,
        ``,
        `Return one to two short paragraphs of Kegan-voice interpretation.`,
      ].join("\n"),
      maxOutputTokens: 1500,
    });
    return { prose: ensureParagraphs(scrubReply(object.prose)) };
  } catch (err) {
    console.warn(
      "[itc coach] reviewTestResult failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    console.warn(
      "[itc timing] review kind=test_result ms=%d",
      Date.now() - started,
    );
  }
}

// -------------------------------------------------------------------------
// generateMapCloseSummary — coach closing beat on advance to done
// -------------------------------------------------------------------------

const MapCloseSummarySchema = z.object({
  prose: z.string().min(50).max(3000),
});

/**
 * Kegan-voice closing summary for the Done stage. Fires once on
 * advance to done (idempotent — skip if a done stage_note already
 * exists). Reads the full map + test history and produces a 3-5
 * paragraph reflection on what was learned, what's still open, and
 * a plain invitation to come back.
 *
 * Form-First-pure: returns prose; server persists as a stage_note
 * anchored to itc_maps with stage_at_creation=done.
 */
export async function generateMapCloseSummary(input: {
  goalText: string;
  assumptionsWithHistory: Array<{
    text: string;
    testHistory: Array<{
      whatIDid: string;
      dataCollected: string;
      whatItSaysAboutAssumption: string;
      verdict: "held" | "partially_challenged" | "challenged" | null;
    }>;
  }>;
}): Promise<string | null> {
  const started = Date.now();
  try {
    const assumptionsBlock = input.assumptionsWithHistory
      .map((a, i) => {
        const history =
          a.testHistory.length === 0
            ? "     tested: no"
            : `     tested: ${a.testHistory.length}× — details:\n${a.testHistory
                .map(
                  (h, hi) =>
                    `        Test ${hi + 1}:\n          What I did: ${h.whatIDid}\n          Data collected: ${h.dataCollected}\n          What it says about my assumption: ${h.whatItSaysAboutAssumption}\n          Verdict: ${h.verdict ?? "no verdict"}`,
                )
                .join("\n")}`;
        return `  ${i + 1}. ${a.text}\n${history}`;
      })
      .join("\n\n");

    const { DONE_STAGE } = await import("./prompts/stages/done");
    const { text } = await generateText({
      model: mainModel(),
      system: withVoiceRules(DONE_STAGE),
      prompt: [
        `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
        ``,
        `Big Assumptions (Column 5) with test history:`,
        assumptionsBlock || "  (none)",
        ``,
        `Write the closing summary now. 3-5 short paragraphs, blank line between each.`,
      ].join("\n"),
      maxOutputTokens: 2000,
    });
    return ensureParagraphs(scrubReplyLight(text));
  } catch (err) {
    console.warn(
      "[itc coach] generateMapCloseSummary failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    console.warn(
      "[itc timing] summary kind=done ms=%d",
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

/**
 * Post-process coach prose to guarantee paragraph breaks. The preamble
 * tells the model to use \n\n between beats for anything over ~3
 * sentences, but the model isn't reliable at it. This is a
 * deterministic backstop:
 *
 *   - If the text already has \n\n, respect them and return as-is.
 *   - If the text has fewer than 4 sentences, return as-is.
 *   - Otherwise, split into sentences and group into paragraphs of
 *     ~3 sentences each, joined with \n\n.
 *
 * Applied to the long-form generation paths (dock chat, walkthrough,
 * results review, closing summary, prioritize recommendation) — not
 * to entry-level reactions (those are 1-2 sentences and paragraph-
 * breaking would over-fragment them).
 */
export function ensureParagraphs(
  text: string,
  { sentencesPerParagraph = 3, minSentencesToSplit = 4 }: {
    sentencesPerParagraph?: number;
    minSentencesToSplit?: number;
  } = {},
): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return trimmed;
  // Already has paragraph breaks — trust them.
  if (/\n\s*\n/.test(trimmed)) return trimmed;
  // Split on sentence boundaries. Look for . / ! / ? followed by
  // whitespace and a capital letter or opening quote. Avoids splitting
  // on abbreviations like "Dr." because those aren't followed by a
  // capital + word boundary in normal prose.
  const sentences = trimmed
    .split(/(?<=[.!?])\s+(?=[A-Z"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length < minSentencesToSplit) return trimmed;
  const groups: string[] = [];
  for (let i = 0; i < sentences.length; i += sentencesPerParagraph) {
    groups.push(sentences.slice(i, i + sentencesPerParagraph).join(" "));
  }
  return groups.join("\n\n");
}
