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
import { mainModel, mainModelIdOrUnset, utilityModel } from "@/lib/model-config";
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
  checkWorryLogicalConsistency,
  scoreAssumptionDepth,
  scoreBehaviorDepth,
  scoreCommitmentDepth,
  scoreWorryDepth,
} from "./rubric";
import { hasCompetingGoalFraming } from "./rules";
import { ADVICE } from "./criteria/advice";
import {
  checkAssumptionKeepsCommitmentIdentity,
  checkVagueAssumptionThenClause,
  judgeAssumptionEnactable,
  judgeAssumptionUnderwrites,
} from "./criteria/assumptions";
import { checkPeopleFromMap, witnessFromMap } from "./criteria/people";
import { checkInteriorWitnessInCommitments } from "./criteria/commitments";
import { checkInteriorWitnessInWorries } from "./criteria/worries";
import { ASSUMPTION_STEM, GOAL_STEM, ensureStem, type ItcStage } from "./stage";

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
// Coach chips — the persisted shape of a coach message with tappable chips
// -------------------------------------------------------------------------

/**
 * What persistReaction (action-helpers.ts) writes: prose plus optional
 * chips. Only "Give me ideas" produces this now. The per-entry LLM
 * reactions (generateCoachReaction) and the chat reply
 * (generateCoachChat) were deleted 2026-09-01: every judgment about an
 * entry comes from the criteria module and the rubrics, rendered
 * deterministically, so the system can never say one thing in a
 * reaction and another in the audit.
 */
export type ReactionOutput = {
  reply: string;
  refinement?: string;
  suggestions?: string[];
  durationMs: number;
};

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

/**
 * The save-time judge for a suggestion kind. Same function the save
 * action runs when the coachee taps the chip, so the chip and the
 * entry it becomes are held to one bar. Kinds without a rubric pass.
 */
function mapTextsOf(input: MapContextInput, extra: string[] = []): string[] {
  return [
    input.improvementGoal ?? "",
    ...input.behaviors.map((b) => b.text),
    ...input.worries.map((w) => w.text),
    ...input.commitments.map((c) => c.text),
    ...input.assumptions.map((a) => a.text),
    ...extra,
  ];
}

async function verifySuggestion(
  input: SuggestionsInput,
  text: string,
): Promise<{ ok: boolean; reason: string }> {
  const people = checkPeopleFromMap({
    draftText: text,
    mapTexts: mapTextsOf(input, input.contextText ? [input.contextText] : []),
  });
  if (!people.ok) return { ok: false, reason: people.reason };
  try {
    switch (input.kind) {
      case "behavior": {
        const r = await scoreBehaviorDepth({
          goalText: input.improvementGoal ?? "",
          behaviorText: text,
        });
        return { ok: r.score >= 3, reason: r.reason };
      }
      case "goal": {
        if (hasCompetingGoalFraming(text)) {
          return {
            ok: false,
            reason: `Starts as a competing commitment, not an improvement goal. Must start with "${GOAL_STEM}".`,
          };
        }
        return { ok: true, reason: "" };
      }
      case "worry": {
        const r = await scoreWorryDepth({
          goalText: input.improvementGoal ?? "",
          behaviorText: input.contextText ?? "",
          worryText: text,
        });
        return { ok: r.score >= 3, reason: r.reason };
      }
      case "commitment": {
        const r = await scoreCommitmentDepth({
          goalText: input.improvementGoal ?? "",
          worryText: input.contextText ?? "",
          commitmentText: text,
        });
        return { ok: r.score >= 3, reason: r.reason };
      }
      case "assumption": {
        const r = await scoreAssumptionDepth({
          goalText: input.improvementGoal ?? "",
          assumptionText: text,
        });
        return { ok: r.score >= 3, reason: r.reason };
      }
    }
  } catch (err) {
    console.warn(
      "[itc coach suggestions] judge failed, keeping chip: %s",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: true, reason: "" };
  }
}

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
    `- ${peopleLine(mapTextsOf(input, input.contextText ? [input.contextText] : []))}`,
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

  const existingNormalized = new Set(existing.map(normalizeMapText));

  /**
   * Deterministic filter, then the save-time judge. A chip the
   * coachee taps becomes an entry and gets scored by the same rubric
   * on save; a chip that would draw a red box never reaches him.
   * Rejected chips come back with the rubric's reason so one retry
   * can replace them. Judge errors keep the chip (fail open).
   */
  async function generateAndVerify(
    extraLines: string[],
  ): Promise<{ reply: string; kept: string[]; rejected: Array<{ text: string; reason: string }> }> {
    const { object } = await generateObject({
      model: mainModel(),
      schema: SuggestionsSchema,
      system,
      prompt: [prompt, ...extraLines].join("\n"),
      maxOutputTokens: 1200,
    });
    const cleaned = object.suggestions
      .map((s) => scrubBannedCoachWords(scrubReply(s)))
      .filter((s) => !isQuestionShaped(s))
      .filter((s) => !existingNormalized.has(normalizeMapText(s)));
    const verdicts = await Promise.all(
      cleaned.map((text) => verifySuggestion(input, text)),
    );
    const kept: string[] = [];
    const rejected: Array<{ text: string; reason: string }> = [];
    cleaned.forEach((text, i) => {
      const v = verdicts[i];
      if (v.ok) kept.push(text);
      else rejected.push({ text, reason: v.reason });
    });
    return { reply: scrubBannedCoachWords(scrubReply(object.reply)), kept, rejected };
  }

  try {
    const first = await generateAndVerify([]);
    if (first.rejected.length === 0 || first.kept.length >= 3) {
      return {
        reply: first.reply,
        suggestions: first.kept,
        durationMs: Date.now() - started,
      };
    }
    const retry = await generateAndVerify([
      ``,
      `Your previous set had ${first.rejected.length} option(s) that don't meet the bar for a ${input.kind}:`,
      ...first.rejected.map((r) => `  - "${r.text}": ${r.reason}`),
      ``,
      `Keep these, which do meet it: ${first.kept.map((k) => `"${k}"`).join(", ") || "(none)"}.`,
      `Replace the rejected ones with options that meet the bar. Return the full set.`,
    ]).catch(() => null);
    const kept = retry && retry.kept.length >= first.kept.length ? retry.kept : first.kept;
    return {
      reply: (retry ?? first).reply,
      suggestions: kept,
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

/**
 * Rewrite mode for the drafters. When present, the drafter is
 * rewriting the coachee's OWN entry rather than drafting from
 * scratch: it gets the current text plus the coach's lines on what's
 * off (the same lines the row box shows, from criteria/advice.ts),
 * and it only returns text that clears every check. Null means the
 * drafter couldn't produce a verified rewrite; the caller shows the
 * lines without one rather than offering a fix that fails the bar.
 */
export type ReviseInput = {
  currentText: string;
  problems: string[];
};

/**
 * A model call that comes back with nothing is an infrastructure
 * blip, not a coaching verdict. Observed in production 2026-09-02:
 * nine of ten worry-draft calls failed with "No object generated: the
 * model did not return a response", which the drafter counted as a
 * Kegan shape that "didn't fit" and burned, so the coachee got no
 * draft at all.
 *
 * Retries the generation once on an error (short backoff). A refusal
 * by the CHECKS is never routed here: that's a real verdict about the
 * text, and it already has its own retry with feedback. Only the call
 * itself failing is retried, and the error is rethrown if it fails
 * twice so the caller can record it.
 */
async function generateWithRetry<T>(
  label: string,
  generate: () => Promise<T>,
): Promise<T> {
  try {
    return await generate();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      "[itc coach] %s generation failed (model=%s), retrying once: %s",
      label,
      mainModelIdOrUnset(),
      message,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    return generate();
  }
}

/**
 * One prompt line naming who the map already has, so the model
 * reaches for those people (or "they") instead of a training
 * example's wife. The verify loops enforce it with checkPeopleFromMap.
 */
function peopleLine(mapTexts: string[]): string {
  const { onMap } = checkPeopleFromMap({ draftText: "", mapTexts });
  return onMap.length > 0
    ? `People this map names: ${onMap.join(", ")}. Use them, or "they" / "the other person". Never add anyone the map doesn't have.`
    : `This map names no one in particular. Say "they", "the other person", "people". Never add a wife, a boss, or kids the map doesn't have.`;
}

function reviseLines(revise: ReviseInput | undefined, what: string): string[] {
  if (!revise) return [];
  return [
    ``,
    `REWRITE MODE. The coachee already wrote this ${what}:`,
    `  "${revise.currentText}"`,
    `What's off with it:`,
    ...revise.problems.map((p, i) => `  ${i + 1}. ${p}`),
    `Rewrite it so every one of those is fixed. Keep his nouns, his people, his scene. Change as little as the fix needs. Don't start over with a different fear or a different move unless the problems above say the current one can't work.`,
  ];
}

// -------------------------------------------------------------------------
// reviseBehavior — rewrite ONE Column 2 behavior against the coach's lines
// -------------------------------------------------------------------------

const BehaviorRewriteSchema = z.object({
  /** The behavior, complete, first-person present. 5-25 words. Server
   *  trims trailing punctuation and adds the period. */
  behavior: z.string().min(5).max(200),
});

const REVISE_BEHAVIOR_SYSTEM = `
You rewrite ONE Column 2 behavior on a coachee's Immunity to Change map. A Column 2 entry is a concrete, observable move the coachee himself makes (or fails to make) in the moments that pull him away from his goal. Not a feeling, not a label about himself, not what he should do instead, not something someone else does.

The bar (the same one that scores the entry when he saves it):
1. A friend standing next to him could point at it the moment it happens. "I stop talking and look at my phone" passes. "I shut down" / "I withdraw" / "I get defensive" fail on their own; name the physical or verbal move they stand for.
2. It clearly pulls him away from his stated goal in that moment.
3. It's what HE actually does or fails to do, present tense. Not what he wishes he did, not "I'm a bad listener", not what she does.

You get his current text and the coach's lines on what's off. Keep his scene, his people, his nouns. Change as little as the fix needs. One sentence, first-person present, 5-25 words. Return only the behavior text.
`.trim();

/**
 * Rewrite mode for a behavior. Verified against scoreBehaviorDepth,
 * the judge that scores the row on save, and returned only when it
 * clears 3/3; one retry with the rubric's reason as feedback. Null
 * means no verified rewrite: the row shows the coach's lines alone.
 */
export async function reviseBehavior(input: {
  goalText: string;
  currentText: string;
  problems: string[];
}): Promise<string | null> {
  const started = Date.now();
  const baseLines = [
    `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
    peopleLine([input.goalText, input.currentText]),
    ...reviseLines(
      { currentText: input.currentText, problems: input.problems },
      "behavior",
    ),
  ];
  async function generate(lines: string[]): Promise<string | null> {
    const { object } = await generateObject({
      model: mainModel(),
      schema: BehaviorRewriteSchema,
      system: withVoiceRules(REVISE_BEHAVIOR_SYSTEM),
      prompt: lines.join("\n"),
      maxOutputTokens: 150,
    });
    const text = scrubReply(object.behavior).trim().replace(/[.!?,;:]+$/, "");
    return text.length >= 5 ? `${text}.` : null;
  }
  async function verify(text: string): Promise<{ ok: boolean; feedback: string | null }> {
    const people = checkPeopleFromMap({
      draftText: text,
      mapTexts: [input.goalText, input.currentText],
    });
    if (!people.ok) return { ok: false, feedback: people.reason };
    const r = await scoreBehaviorDepth({
      goalText: input.goalText,
      behaviorText: text,
    }).catch((err) => {
      console.warn(
        "[itc coach] behavior rewrite rubric failed, treating as pass: %s",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    });
    if (!r || r.score >= 3) return { ok: true, feedback: null };
    return {
      ok: false,
      feedback: `The depth rubric rejected it (${r.score}/3). Reason: "${r.reason}"`,
    };
  }
  try {
    const first = await generate(baseLines);
    if (!first) return null;
    const v1 = await verify(first);
    if (v1.ok) return first;
    const retry = await generate([
      ...baseLines,
      ``,
      `Your previous rewrite was: "${first}"`,
      v1.feedback ?? "",
      `Rewrite so it passes. Name the physical or verbal move a friend could point at.`,
    ]);
    if (!retry) return null;
    const v2 = await verify(retry);
    if (!v2.ok) {
      console.warn(
        "[itc coach] behavior rewrite refused after retry: draft=%o feedback=%o",
        retry,
        v2.feedback,
      );
      return null;
    }
    return retry;
  } catch (err) {
    console.warn(
      "[itc coach] reviseBehavior failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    console.warn("[itc timing] revise kind=behavior ms=%d", Date.now() - started);
  }
}

// -------------------------------------------------------------------------
// draftWorryOpening — the half of a worry the server can be right about
// -------------------------------------------------------------------------

const WorryOpeningSchema = z.object({
  /** The counter-move: what he'd be doing if he did the opposite of
   *  the Column 2 behavior. Past tense, bare verb phrase, no "if I"
   *  prefix (the server writes that). 3-10 words. */
  opposite_move: z.string().min(5).max(90),
});

const DRAFT_WORRY_OPENING_SYSTEM = `
You write the OPENING of a Column 3 worry for an Immunity to Change map, and nothing else. The coachee finishes it himself.

Given his Column 2 behavior, return the counter-move: what he would be doing if he did the OPPOSITE of that behavior. The server writes it into "I worry that if I <opposite_move>, " and he supplies the fear.

Rules for opposite_move:
  - PAST tense, bare verb phrase. No "if I" prefix, no trailing punctuation.
  - 3-10 words. Specific enough that he can picture the moment.
  - For a doing behavior ("I interrupt her"), the counter-move is the restraint: "let her finish".
  - For a not-doing behavior ("I don't ask what she needs"), the counter-move is the affirmative act: "asked her what she needed". NEVER "stopped not-asking" — unreadable double negative.
  - Use HIS nouns, from his goal and behavior. Never introduce a person he hasn't named.
  - Do not write the fear, the consequence, or any "then" clause. Only the act.

Examples:
  behavior "I interrupt her when she's upset" -> "let her finish"
  behavior "I don't ask what the client actually needs before pitching" -> "asked what they actually needed first"
  behavior "I over-promise on scope to keep the client happy" -> "told them the real scope and timeline"
  behavior "I avoid naming my price" -> "named my price and held it"
`.trim();

/**
 * The opening only. Kegan/Lahey (Vol 1 p 12) have the coach ask "what
 * are the worst things that could happen to you if you were to do the
 * opposite?" — the coach supplies the QUESTION, the client supplies
 * the fear. This app used to author the whole worry, and the fear is
 * the one input it cannot have: measured on live maps, the
 * counter-move was right every time while the identity ending was
 * wrong roughly one time in three, and no amount of tuning the judge
 * moved that much (2026-09-02).
 *
 * So the server writes the half it is reliably right about and stops.
 * The row's input opens with "I worry that if I <counter-move>, " and
 * he finishes the sentence. The depth rubric still scores what he
 * writes and the coach box still offers a sharper version of HIS
 * fear, which is a far easier and more legitimate job than inventing
 * one.
 *
 * Returns null rather than a guess: an empty box with a placeholder
 * is better than an opening pointed at the wrong act.
 */
export async function draftWorryOpening(input: {
  goalText: string;
  behaviorText: string;
  mapTexts?: string[];
}): Promise<string | null> {
  const started = Date.now();
  const mapTexts = [input.goalText, input.behaviorText, ...(input.mapTexts ?? [])];
  try {
    const { object } = await generateWithRetry("worry opening", () =>
      generateObject({
        model: mainModel(),
        schema: WorryOpeningSchema,
        system: withVoiceRules(DRAFT_WORRY_OPENING_SYSTEM),
        prompt: [
          `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
          `Behavior (Column 2): ${input.behaviorText}`,
          peopleLine(mapTexts),
          ``,
          `Return the counter-move only.`,
        ].join("\n"),
        maxOutputTokens: 200,
      }),
    );
    const move = normalizeSlot(stripRedundantIf(object.opposite_move)).replace(
      /[.!?,;:]+$/,
      "",
    );
    if (move.split(/\s+/).filter(Boolean).length < 2) return null;
    const opening = `I worry that if I ${move}, `;
    // Same bar as any other coach text: no people he hasn't named.
    const people = checkPeopleFromMap({ draftText: opening, mapTexts });
    if (!people.ok) {
      console.warn("[itc coach] worry opening refused: %s", people.reason);
      return null;
    }
    return opening;
  } catch (err) {
    console.warn(
      "[itc coach] draftWorryOpening failed (model=%s): %s",
      mainModelIdOrUnset(),
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    console.warn("[itc timing] draft kind=worry_opening ms=%d", Date.now() - started);
  }
}

// -------------------------------------------------------------------------
// draftAssumptionOpening — Column 5's half of the same bargain
// -------------------------------------------------------------------------

const AssumptionOpeningSchema = z.object({
  /** The act the assumption is about: the coachee doing the opposite
   *  of one of his behaviors, which is what makes the belief testable
   *  (Kegan Vol 1 p 21, the "if" needs degrees he can enact). Past
   *  tense, bare verb phrase, no "if I" prefix. 3-10 words. */
  antecedent_act: z.string().min(5).max(90),
});

const DRAFT_ASSUMPTION_OPENING_SYSTEM = `
You write the OPENING of a Big Assumption for an Immunity to Change map, and nothing else. The coachee finishes it himself.

Given his behavior and the competing commitment it protects, return the act the assumption is about: the coachee doing the OPPOSITE of that behavior. The server writes it into "I assume that if I <antecedent_act>, then " and he supplies what he believes would follow.

Rules for antecedent_act:
  - PAST tense, bare verb phrase. No "if I" prefix, no trailing punctuation.
  - 3-10 words. Something he could actually do in a small dose this week: that is what makes the belief testable (Coach's Guide Vol 1 p 21, the "if" must have degrees so it can be enacted safely).
  - It is the counter-move to his behavior, never an outcome ("if something went badly") and never someone else's move ("if they walked away").
  - Use HIS nouns. Never introduce a person he hasn't named.
  - Do not write the "then", the consequence, or the identity. Only the act.

Examples:
  behavior "I avoid naming my price" -> "named my price and held it"
  behavior "I rewrite the message until it's perfect" -> "sent the message without rewriting it"
  behavior "I chase prospects instead of letting the work speak" -> "let the work speak for a week"
`.trim();

/**
 * The opening only, for the same reason as draftWorryOpening: the
 * server writes the half it is reliably right about (the enactable
 * act, which is also the guide's testability bar) and leaves the
 * belief to the man. A Big Assumption's "then" is his Big Time Bad,
 * and authoring it has the same failure mode the worry drafter had.
 *
 * Returns null rather than a guess.
 */
export async function draftAssumptionOpening(input: {
  goalText: string;
  behaviorText: string;
  commitmentText: string;
  mapTexts?: string[];
}): Promise<string | null> {
  const started = Date.now();
  const mapTexts = [
    input.goalText,
    input.behaviorText,
    input.commitmentText,
    ...(input.mapTexts ?? []),
  ];
  try {
    const { object } = await generateWithRetry("assumption opening", () =>
      generateObject({
        model: mainModel(),
        schema: AssumptionOpeningSchema,
        system: withVoiceRules(DRAFT_ASSUMPTION_OPENING_SYSTEM),
        prompt: [
          `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
          `Behavior (Column 2): ${input.behaviorText}`,
          `Competing commitment this assumption holds up: ${input.commitmentText}`,
          peopleLine(mapTexts),
          ``,
          `Return the act only.`,
        ].join("\n"),
        maxOutputTokens: 200,
      }),
    );
    const act = normalizeSlot(stripRedundantIf(object.antecedent_act)).replace(
      /[.!?,;:]+$/,
      "",
    );
    if (act.split(/\s+/).filter(Boolean).length < 2) return null;
    const opening = `I assume that if I ${act}, then `;
    const people = checkPeopleFromMap({ draftText: opening, mapTexts });
    if (!people.ok) {
      console.warn("[itc coach] assumption opening refused: %s", people.reason);
      return null;
    }
    return opening;
  } catch (err) {
    console.warn(
      "[itc coach] draftAssumptionOpening failed (model=%s): %s",
      mainModelIdOrUnset(),
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    console.warn(
      "[itc timing] draft kind=assumption_opening ms=%d",
      Date.now() - started,
    );
  }
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
/**
 * The server writes "if I " in front of the antecedent slot, so a
 * second "if" inside the slot doubles it: "if I brought up the harder
 * truth if it costs me the deal" (observed on a live draft
 * 2026-09-02). Strips a leading "if I " / "if " the drafter wrote
 * redundantly, and a trailing subordinate "if …" clause.
 *
 * "when …" and "while …" conditions are left alone: they duplicate
 * nothing the server wrote, and the guides treat a named moment as
 * part of the counter-move ("stay in the room while she's angry").
 * Server-owned sentence shape, per Form-First: the slot carries
 * content, the server owns every connective.
 */
export function stripRedundantIf(slot: string): string {
  return slot
    .replace(/^\s*if\s+(i\s+)?/i, "")
    // Trailing "… if X" with no further clause boundary. Conservative:
    // a comma after the "if" means the clause continues, so leave it.
    .replace(/,?\s+if\s+[^,]*$/i, "")
    .trim();
}

/**
 * Past participles the drafters actually reach for, mapped to their
 * base form. Used only to collapse "would have SEEN" into "would
 * SEE". Anything not listed is left alone rather than guessed at: an
 * odd tense is survivable, a mangled verb is not.
 */
const PARTICIPLE_TO_BASE: Record<string, string> = {
  seen: "see", known: "know", thought: "think", felt: "feel",
  found: "find", been: "be", become: "become", heard: "hear",
  told: "tell", said: "say", got: "get", gotten: "get",
  taken: "take", made: "make", lost: "lose", written: "write",
  given: "give", shown: "show", spoken: "speak",
  understood: "understand", watched: "watch", noticed: "notice",
  called: "call", treated: "treat", judged: "judge", walked: "walk",
  asked: "ask", looked: "look", realized: "realize",
};

/**
 * The server writes the "if I" frame, so it owns the sentence's
 * grammar, and the two slots have to agree in tense. The drafters
 * kept producing "if I held the price, they'd HAVE SEEN me as…": a
 * present counterfactual in the "if" half, a past counterfactual in
 * the result. Observed on live drafts 2026-09-02.
 *
 * Collapses "would have <participle>" to "would <base>", which is the
 * mismatch that actually reads as broken. The other direction (a
 * present-tense move, "if I ask … they'd see") is handled by the
 * slot spec instead of here, because converting present to past
 * needs a full conjugator and would mangle irregular verbs.
 */
export function normalizeConditionalTense(landing: string): string {
  return landing.replace(
    /\b(\w+['\u2019]d|would)\s+have\s+([a-z]+)\b/gi,
    (whole: string, subject: string, participle: string) => {
      const base = PARTICIPLE_TO_BASE[participle.toLowerCase()];
      return base ? `${subject} ${base}` : whole;
    },
  );
}

export function assembleWorry(slots: {
  opposite_move: string;
  identity_landing: string;
}): string {
  const move = normalizeSlot(stripRedundantIf(slots.opposite_move));
  const landing = normalizeSlot(normalizeConditionalTense(slots.identity_landing));
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

Kegan-canonical worries run 15-25 words. Your target for the ASSEMBLED sentence: **15-22 words**. Hard ceiling: 26. Write a COMPLETE, grammatical sentence: finishing the thought matters more than saving three words. Clipped endings ("seen me as not enough alone", "not the expert I claim") are failures, not economy. Don't sprawl either; every word earns its place.

Per-slot targets (assembled template is 5 words: "I worry that if I"):
- **opposite_move: 3-8 words.** Terse counter-move.
- **identity_landing: 6-13 words.** The identity landing, as a complete phrase. Never truncate it to hit a count.

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

### TENSE (the two slots must agree)

The server writes "I worry that if I <opposite_move>, <identity_landing>." That frame is a present counterfactual, so:

  - opposite_move: PAST tense. "stayed quiet", "asked what they needed", "held the price", "let the silence sit". Not "stay", not "asking".
  - identity_landing: WOULD + base verb. "they'd see…", "I'd be…", "they'd know…". NEVER "would have seen" or "would have known": that is a past counterfactual and clashes with the "if" half.

  Right: "if I held the price, they'd see me as unsure of my own worth."
  Wrong: "if I hold the price, they'd have seen me as unsure of my own worth."

### identity_landing
The felt fear that lands when he pictures doing opposite_move. This is the whole point. If this slot is shallow, the map is shallow.

**It names what the behavior PROTECTS him from.** Kegan/Lahey (Vol 1 p 12): "what are the worst things that could happen to you if you were to do the opposite?" Two ways that lands, both canonical; use whichever fits his material:

  - **Exposure**: what doing opposite_move would show about who he's been. It has to be something the behavior HIDES (the fraud, the guy who was never as good as he claimed, the man who's been faking it). It is NEVER the behavior itself said back. "I've been the guy who never listens" when the behavior is not listening is a confession, not a fear; the map turns this worry straight into a commitment, and that confession becomes a vow to stop the behavior, which explains nothing. Ask: what does not-listening keep him from finding out?
  - **Consequence**: who he'd be, or be seen as, if he did opposite_move and it went the way he dreads. "If I stood behind the call and it failed, I'd be the expert who got it wrong with nowhere to hide." "If I asked what they needed, I'd hear my offer isn't it and be the guy selling what nobody asked for." Vol 1 p 13: "seen as incompetent."

Test before you write: under this fear, does the behavior make perfect sense as protection? If the fear accuses the behavior instead of explaining it, start over.

**MUST land at identity level.** Two valid shapes for the landing itself — accept whichever fits his goal/behavior more naturally:

  1. **Self-labeling identity**: names a label he'd apply to himself. "I'd have to see I'm not the man I've pretended to be." / "I'd find out I'm weaker than I let on." / "I'd have to admit I'm a fraud."
  2. **Role/relational identity**: names a role he'd have failed in or a relationship whose collapse he can't face. Examples vary by domain — MATCH THE RELATIONAL NOUN TO HIS ACTUAL MAP:
     - Bond: "she'd see I've been failing her all along."
     - Endeavor/work: "my team would see I've been the leader who fakes it."
     - Raise/kids: "my kid would stop coming to me because I never actually listen."
     - Amplify/self: "I'd have to face I've never done the work I claim."

BOTH are canonical. Do NOT force self-labeling when role/relational fits the coachee's stated goal. The relational noun MUST come from HIS map — never introduce "she" or "her" for a work/team map.

5-10 words. Ends without a period (server adds one).

## The "yuck" bar — mandatory

Coachees can't feel a practical concern. They CAN feel identity landings. Every draft must produce a wince. Ask yourself: does this identity_landing describe something a man would rather not admit out loud? If it sounds reasonable, presentable, or noble, it isn't at the yuck rung yet.

### Practical-concern anti-patterns (banned in identity_landing)

Reject any draft where the fear is:
  - **Event-level**: "she'd get upset" / "we'd have a fight" / "she'd cry" / "the meeting would end awkwardly" — describes what happens, not what it CONFIRMS.
  - **Practical/operational**: "we'd fall behind" / "the day would fall apart" / "it'd waste time" — sounds like a project manager, not a fear.
  - **About the other person's behavior alone**: "she'd walk out" / "my team would stop asking me questions" / "he'd stop coming to me" — that's their move, not the meaning it lands for him. If the fear is them pulling away, name what that pulling away would PROVE about him ("she'd walk out and I'd know I'm the man who couldn't hold this together" / "my team would stop asking and I'd know I was never the one they actually trusted").
  - **Vague self-help language**: "I wouldn't feel like myself" / "I'd feel disconnected" / "I wouldn't be authentic" — abstract, doesn't wince.
  - **Noble/aspirational**: "I wouldn't be the husband she deserves" / "I wouldn't be the leader my team needs" — sounds like a wedding toast or a corporate values slide. Replace with the specific self-truth about who he'd be revealed to be: "she'd see I've never actually been the husband she thought she married" / "my team would realize I've been pretending to be someone I'm not."

### Yuck-passing examples (good identity_landing content, under 10 words each)

Blue-collar plain. Externalized where possible — someone else witnesses it, or bare identity claim. NO interior-witness verbs ("I'd have to see", "I'd have to face", "I'd have to admit") — those are banned per the voice rules. Rotate openers so a map's set doesn't read templated. Match the WITNESS to the coachee's own context — if his map is about his wife, "she'd know"; if it's about his team, "they'd know" or "my team would see"; if it's about his kids, "my kid would tell his mom"; if it's about customers, "they'd stop calling":

Bond context (partner/spouse):
  - "she'd know I've been defending myself, not loving her." *(she'd know)*
  - "she'd realize I don't know how to love her without performing." *(she'd realize)*

Endeavor context (work/team/customers):
  - "my team would see I've been faking authority I never had." *(team would see)*
  - "the customer would stop calling and I'd know I lost them." *(customer would stop)*

Raise context (kids/family):
  - "my kid would tell his mom I never actually listen." *(kid would tell)*
  - "I've been the father who's technically present and gone." *(bare identity claim)*

Amplify context (self / life-building):
  - "I've been the guy who checks out when it counts." *(bare identity claim)*
  - "the truth would come out that I've never done the work I claim." *(the truth would come out)*

Notice: each names a truth about WHO HE IS that would be witnessed by another person or stated bare. The witness or noun MUST match his map's context — never introduce "she'd" if his map is about his team. None use "I'd have to see", "I'd have to face", "actually", "fully", "land" as metaphor, or trailing "instead of" clauses — those are all banned.

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
  C. Ask: what does the behavior protect him from? If he actually did opposite_move in a real moment and it went the way he dreads, who would he be, or what would it expose about who he's been (something the behavior hides, never the behavior said back)?
  D. Fill identity_landing with that felt fear, at the identity rung (self-labeling or role/relational — whichever fits his material). Wince test must pass. Under it, the behavior must make sense as protection.

Return only the structured slots ({ opposite_move: "...", identity_landing: "..." }). No prose, no explanation, no meta, no wrapping sentence — the server writes that.
`.trim();

/** Hard ceiling on assembled worry length. Kegan Vol 1 worries run
 *  15-25 words; 20 sits at the low end of canonical. Overshoots are
 *  mechanically trimmed server-side (see trimAssembledDraft) rather
 *  than silently dropped — prior LLM-obedience approach (retry with
 *  "you overshot") kept producing null drafts the coachee never saw. */
const WORRY_HARD_WORD_CAP = 26;

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

/**
 * Shape instructions are built per map: the witness ("she'd" / "he'd" /
 * "they'd") and the object ("her" / "him" / "them") come from the
 * coachee's own text via witnessFromMap, never from the example. A
 * map about "the other person" gets "they'd see…"; the example verbs
 * are written against that same witness. Server-owned, so the model
 * can't import a wife from a training example.
 */
function worryShapeInstruction(
  shape: WorryIdentityShape,
  w: { subject: string; would: string; object: string },
): string {
  const W = w.would;
  const O = w.object;
  switch (shape) {
    case "role_noun":
      return `For THIS draft, land the identity as a ROLE-NOUN CLAIM. Use the shape: "${W} see I've been the [man|guy|father|husband|coach|leader|one] who [Y]" or "I've been the [role] who [Y]". The [Y] slot MUST be a PLAIN CONCRETE VERB describing an OBSERVABLE ACTION (physical or verbal) toward ${O}, something a friend on his shoulder could point at when it happens. Kegan Vol 1 p 14 canonical shape: "the [role] who [hurts ${O}]" (plain concrete verb). Good [Y] shapes: "got it wrong when it counted", "couldn't back up what I promised", "walks out on ${O}", "talks over ${O}". [Y] must be what the behavior HIDES or what the opposite would cost, never the behavior itself said back. BANNED [Y] shapes (literary condensations): "never let ${O} matter", "kept ${O} small", "diminished ${O}", "erased ${O}", "silenced ${O}". Foreman-at-the-tailgate test: would a working guy say [Y] to his buddy at a bar? The role noun must fit HIS map (a work map gets "the leader who…", not "the husband who…").`;
    case "role_failure_verb":
      return `For THIS draft, land the identity as an EXPLICIT ROLE-FAILURE VERB directed at ${O}: what he'd have done TO ${O} if the opposite went the way he dreads, or what the opposite would expose he's been doing to ${O}. Use the shape: "I'd be the one who [let ${O} down when it counted | cost ${O} the thing they came for | failed ${O}]" or "${W} see I've been [failing ${O} | letting ${O} down] all along". The verb must be what the behavior PROTECTS him from: under this fear, the behavior has to make sense. Do not reach for "choosing myself over ${O}" unless the behavior is literally a way of putting himself first; on most maps that accuses the behavior instead of explaining it. Kegan Vol 1 p 14 canonical shape (a marriage map): "chose ego over ${O}".`;
    case "seen_as":
      return `For THIS draft, land the identity via SEEN-AS framing (Kegan Vol 1 p 13 canonical vocabulary). Use the shape: "${W} have seen me as [X]" / "${W} see me as [role/label]" / "I'd have been seen as [X]" / "${W} know me as [X]". [X] is what the behavior PROTECTS him from being seen as. Kegan Vol 1 p 13 canonical example: "seen as incompetent".`;
    case "self_label":
      return `For THIS draft, land the identity as a SELF-LABEL (Kegan Vol 1 p 14). Use the shape: "${W} know I've been a [fraud|fake|phony|coward|failure]" / "the truth would come out that I've never been [enough|the man ${w.subject} thought]" / "I'd be a [X]". The label is what the behavior PROTECTS him from being found to be. Kegan Vol 1 p 14 canonical example: "I'd be a fraud".`;
  }
}

/**
 * Server-side coach-draft generator for Column 3. Called once per
 * selected behavior when the coachee advances into the worries stage.
 *
 * Form-First-pure: LLM returns METADATA (two slots); server assembles
 * the canonical "I worry that if I ..., ..." sentence and mechanically
 * trims any overshoot via trimAssembledDraft.
 *
 * Verification pipeline (server-owned structure over LLM obedience):
 *
 *   1. Drafter (mainModel) fills opposite_move + identity_landing.
 *   2. Depth rubric (utilityModel, scoreWorryDepth) scores 0-3 —
 *      answers "is this deep enough?"
 *   3. Consistency check (deterministic pattern match,
 *      checkWorryLogicalConsistency) verifies the identity landing
 *      uses past-tense/witnessed/truth-frame framing. Catches
 *      bare-present-tense inversions like "if I stayed and heard her
 *      out, I'd have to see I'm the man who abandons her" (staying is
 *      the opposite of abandoning; "I'm the [X-er]" reads as staying
 *      creating the abandoner identity). Zero LLM cost, no judgment.
 *   4. Interior-witness regex (checkInteriorWitnessInWorries) — same
 *      check the hone auditor runs. Catches drafts where the identity
 *      landing hides inside interior verbs applied to a self-truth
 *      ("I'd have to see I…", "I'd know I…") instead of naming what
 *      the outside world would witness. Added 2026-09-01 so drafter
 *      and auditor speak with one voice (same alignment fix as
 *      commitments 2026-08-31).
 *   5. If any check fails, one drafter retry fires with all failing
 *      reasons as feedback. Only a draft that clears every check is
 *      returned (2026-09-01). A draft the judge would reject on tap
 *      is worse than no draft: the coachee writes his own and the
 *      row's coach box does the coaching.
 */
export type WorryDraftOutcome = {
  /** The verified draft, or null when nothing cleared every check. */
  text: string | null;
  /** The verdict verification produced for `text`. Carried so the
   *  save path can reuse it rather than scoring the same words a
   *  second time, which is where drafter/coach disagreements came
   *  from (see migration 20260902000001). Null when there's no text
   *  or the depth rubric errored and verification failed open. */
  verdict?: { depthScore: number; rubricReason: string } | null;
  /** Every draft the checks refused, with the checks' own lines. Lands
   *  in turn events so a missing draft is explainable after the fact. */
  refusals: Array<{ draft: string; feedback: string[] }>;
  /** Set when the drafter threw (model error, schema mismatch). */
  error?: string;
};

/** See draftWorryOutcome. Kept for callers that only need the text. */
export async function draftWorryForBehavior(
  input: Parameters<typeof draftWorryOutcome>[0],
): Promise<string | null> {
  return (await draftWorryOutcome(input)).text;
}

export async function draftWorryOutcome(input: {
  goalText: string;
  behaviorText: string;
  pillar: PillarCode;
  /**
   * Optional server-owned identity-landing shape hint. When present,
   * the drafter is constrained to one of the four Kegan-canonical
   * shapes (see WORRY_IDENTITY_SHAPES). The caller rotates shapes
   * across behaviors to guarantee map-level variety.
   */
  identityShape?: WorryIdentityShape;
  /** Rewrite the coachee's own worry instead of drafting fresh. See
   *  ReviseInput. In this mode only a verified draft is returned. */
  revise?: ReviseInput;
  /** Everything else the coachee has written on this map. People in
   *  the draft (pronouns, relational nouns) must trace to this text
   *  plus the goal and behavior. */
  mapTexts?: string[];
}): Promise<WorryDraftOutcome> {
  const started = Date.now();
  const refusals: WorryDraftOutcome["refusals"] = [];
  const pillar = PILLAR_BY_CODE[input.pillar];
  const mapTexts = [input.goalText, input.behaviorText, ...(input.mapTexts ?? [])];
  const witness = witnessFromMap(mapTexts);
  const shapeLine = input.identityShape
    ? worryShapeInstruction(input.identityShape, witness)
    : null;
  const basePromptLines = [
    `Pillar: ${pillar.label} (${pillar.domain})`,
    `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
    `Behavior (Column 2): ${input.behaviorText}`,
    peopleLine(mapTexts),
    ``,
    `Fill opposite_move with the affirmative counter-move to this behavior, and identity_landing with what the behavior PROTECTS him from: what doing opposite_move would expose about who he's been (something the behavior hides, never the behavior said back), or who he'd be if opposite_move went the way he dreads. Under the fear, the behavior must make sense as protection. Yuck bar mandatory. Assembled sentence must be under 20 words.`,
    ...(shapeLine ? [``, shapeLine] : []),
    ...reviseLines(input.revise, "worry"),
  ];

  type DraftShape = {
    assembled: string;
    slots: { opposite_move: string; identity_landing: string };
  };

  async function generateDraft(promptLines: string[]): Promise<DraftShape | null> {
    const { object } = await generateWithRetry("worry draft", () =>
      generateObject({
        model: mainModel(),
        schema: WorryDraftSchema,
        system: withVoiceRules(DRAFT_WORRY_SYSTEM),
        prompt: promptLines.join("\n"),
        // 200 was the tightest budget in this file for a two-field
        // schema under a very large system prompt. A model that emits
        // any preamble (or reasoning) before the object hits the cap
        // and returns nothing. 600 is still small and removes the
        // whole truncation class.
        maxOutputTokens: 600,
      }),
    );
    const raw = scrubReply(assembleWorry(object));
    if (!raw) return null;
    return {
      assembled: trimAssembledDraft(raw, WORRY_HARD_WORD_CAP),
      slots: object,
    };
  }

  /**
   * Run the same criteria the hone auditor uses. All three verifiers
   * run in parallel. Depth (LLM) may fail — a transient Haiku hiccup
   * shouldn't strand the drafter, so fail-open to pass on rubric
   * error. Consistency (deterministic slot check) and interior-
   * witness (deterministic regex on the assembled text) never throw.
   */
  async function verifyDraft(
    draft: DraftShape,
  ): Promise<{
    ok: boolean;
    feedback: string[];
    verdict: { depthScore: number; rubricReason: string } | null;
  }> {
    const [depthResult, iwFindings] = await Promise.all([
      scoreWorryDepth({
        goalText: input.goalText,
        behaviorText: input.behaviorText,
        worryText: draft.assembled,
      }).catch((err) => {
        console.warn(
          "[itc coach] worry depth rubric failed, treating as pass: %s",
          err instanceof Error ? err.message : String(err),
        );
        return null;
      }),
      // Wrap the assembled text in a minimal ItcWorry shape so the
      // shared auditor check runs unchanged.
      checkInteriorWitnessInWorries({
        worries: [
          {
            id: "draft",
            map_id: "draft",
            behavior_id: "draft",
            text: draft.assembled,
            depth_score: null,
            rubric_reason: null,
            sharpen_text: null,
            suggested_fix: null,
            attempts: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        behaviors: [],
      }),
    ]);
    const consistencyResult = checkWorryLogicalConsistency({
      behaviorText: input.behaviorText,
      oppositeMove: draft.slots.opposite_move,
      identityLanding: draft.slots.identity_landing,
    });

    const depthOk = depthResult === null || depthResult.score >= 3;
    const consistencyOk = consistencyResult.consistent;
    const interiorWitnessOk = iwFindings.length === 0;
    const feedback: string[] = [];
    if (!depthOk && depthResult) {
      feedback.push(
        `The depth rubric rejected it (${depthResult.score}/3). Reason: "${depthResult.reason}"`,
      );
    }
    if (!consistencyOk) {
      feedback.push(
        `The logical-consistency check rejected it: "${consistencyResult.reason}"`,
      );
    }
    if (!interiorWitnessOk) {
      // Advice reads from ADVICE — single source of truth for what
      // to tell the LLM (and the coachee) about how to fix this
      // class of finding.
      feedback.push(ADVICE.interior_witness_worry);
    }
    const people = checkPeopleFromMap({ draftText: draft.assembled, mapTexts });
    if (!people.ok) feedback.push(people.reason);
    return {
      ok: feedback.length === 0,
      feedback,
      verdict: depthResult
        ? { depthScore: depthResult.score, rubricReason: depthResult.reason }
        : null,
    };
  }

  try {
    const first = await generateDraft(basePromptLines);
    if (!first) return { text: null, refusals };
    const firstVerdict = await verifyDraft(first);
    if (firstVerdict.ok) {
      return { text: first.assembled, refusals, verdict: firstVerdict.verdict };
    }
    refusals.push({ draft: first.assembled, feedback: firstVerdict.feedback });

    // One retry with all failing reasons fed back.
    const retry = await generateDraft([
      ...basePromptLines,
      ``,
      `Your previous draft was: "${first.assembled}"`,
      ...firstVerdict.feedback,
      `Rewrite the slots so ALL checks pass. Preserve intent; fix every flaw named. Same length target (under 20 words).`,
    ]);
    // Only a draft that clears every check is offered, in draft mode
    // and rewrite mode alike. Anything the system offers has already
    // passed the judge that scores it on save.
    if (!retry) return { text: null, refusals };
    const retryVerdict = await verifyDraft(retry);
    if (!retryVerdict.ok) {
      refusals.push({ draft: retry.assembled, feedback: retryVerdict.feedback });
      console.warn(
        "[itc coach] worry draft refused after retry: draft=%o feedback=%o",
        retry.assembled,
        retryVerdict.feedback,
      );
      return { text: null, refusals };
    }
    return { text: retry.assembled, refusals, verdict: retryVerdict.verdict };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      "[itc coach] draftWorryOutcome failed (model=%s): %s",
      mainModelIdOrUnset(),
      message,
    );
    return { text: null, refusals, error: `${message} (model=${mainModelIdOrUnset()})` };
  } finally {
    console.warn(
      "[itc timing] draft kind=worry ms=%d",
      Date.now() - started,
    );
  }
}

// -------------------------------------------------------------------------
// draftCommitmentForWorry — coach-drafted Column 4 starting text
// -------------------------------------------------------------------------

/**
 * Structured-slots schema for the commitment drafter (introductory
 * form). ONE slot: the identity/outcome the coachee is vowing never
 * to be or have happen. Server assembles the canonical Kegan/Lahey
 * competing-commitment sentence via assembleCommitment.
 *
 * Why the introductory form (Kegan Vol 1 pp 26-27) instead of the
 * mechanism form (Vol 2): this is a self-service tool, not a live
 * 1:1 coaching engagement. The mechanism form ("I'm also committed
 * to keeping her past on the table so mine doesn't come up") is
 * sharper but requires a live coach to keep excavating past the
 * noble first pass. The introductory form is legible on first read,
 * correct on its own terms, and gives Column 5 enough to work with.
 * The commitment mirrors the paired worry's identity content: worry
 * "I fear being the guy who's difficult to work with" becomes
 * "I'm also committed to never being the guy who's difficult to
 * work with."
 */
const CommitmentDraftSchema = z.object({
  /** The identity/outcome the coachee vows never to be or have happen.
   *  Server prefixes "I'm also committed to never " and appends a
   *  period. Write WITHOUT the prefix, WITHOUT the trailing period,
   *  WITHOUT a leading "never". 3-18 words.
   *
   *  Shape: mirrors the identity content of the paired worry.
   *    Worry: "I fear being the guy who's defensive."
   *    vow: "being the guy who's defensive"
   *  Or the outcome content:
   *    Worry: "I worry I don't have the answer and look incompetent."
   *    vow: "looking incompetent in front of my team"
   *
   *  Preserve the coachee's nouns. If the worry says "my team,"
   *  the vow says "my team." Never swap in generic replacements. */
  vow: z.string().min(3).max(120),
});

/**
 * Server-side assembly of the canonical introductory-form commitment
 * sentence from the single LLM slot. Produces:
 *
 *   "I'm also committed to never <vow>."
 *
 * The "also" is Kegan-canonical: names the SECOND commitment sitting
 * next to the Column 1 goal (the open commitment) so the coexistence
 * with the improvement goal is unmissable. Every persisted commitment
 * must start with "I'm also committed to" per the commitments-stage
 * prompt.
 *
 * Normalizations on the vow slot: trim, strip leading "never " if
 * the LLM redundantly wrote it (the server writes "never" as part
 * of the prefix), strip trailing punctuation, lowercase first char
 * unless it's a pronoun "I".
 */
export function assembleCommitment(slots: { vow: string }): string {
  let vow = normalizeSlot(slots.vow);
  vow = vow.replace(/^never\s+/i, "");
  return `I'm also committed to never ${vow}.`;
}

const DRAFT_COMMITMENT_SYSTEM = `
You draft ONE hidden competing commitment for a coachee's ITC map — in the introductory form (Kegan Vol 1 pp 26-27). The commitment is the vow a part of him has quietly made to keep the paired worry from ever coming true. Your draft is a starting point the coachee will review, accept, edit, or replace.

## How this works (single slot)

You return ONE slot — vow — that fills the blank in a template the server writes:

    "I'm also committed to never <vow>."

You never write "I'm also committed to". You never write the leading "never" (the server writes it). You never write the trailing period.

## Two-step derivation (silent — run for every worry)

1. **Read the paired worry.** Identify the identity/outcome it fears — the "I'd be the guy who X" or "she'd see me as Y" or "I'd have failed at Z" or "I'd look Q" content sitting inside the worry.

2. **Mirror that content into a vow.** If the worry names an identity, vow never to be it. If it names an outcome, vow never to have it happen. Same nouns, same specificity, same relational context.

## Worked examples

Worry: "I worry that I don't have the proper answer and look incompetent in front of my team."
vow: "looking incompetent in front of my team"
Assembled: "I'm also committed to never looking incompetent in front of my team."

Worry: "I fear being the guy who is defensive or difficult to work with."
vow: "being the guy who is defensive or difficult to work with"
Assembled: "I'm also committed to never being the guy who is defensive or difficult to work with."

Worry: "I worry that if I stop scripting the questions, they walk away without help and I've failed my family as the provider."
vow: "failing my family as the provider"
Assembled: "I'm also committed to never failing my family as the provider."

Worry: "I worry that if I stay quiet and let her finish, she'd know I've been the husband who can't let things go."
vow: "being the husband who can't let things go"
Assembled: "I'm also committed to never being the husband who can't let things go."

## Anti-pattern: "if I did X" worries — mirror the CONSEQUENT identity, not the antecedent behavior

Worries of the form "if I did OPPOSITE_BEHAVIOR, she'd know I'm THE KIND OF GUY WHO Y" contain two parts:
  - Antecedent (the "if" clause): the behavior. NOT the vow content.
  - Consequent (what she'd know): the identity/outcome. THIS is the vow content.

Worry: "I worry that if I admitted I was wrong, she'd know I'm the kind of guy who is incapable of changing"
  WRONG vow: "admitting I'm wrong"                              (that's the antecedent — a behavior, not an identity)
  RIGHT vow: "being the kind of guy who is incapable of changing"  (mirrors the identity in the consequent)
  Assembled: "I'm also committed to never being the kind of guy who is incapable of changing."

Worry: "I worry that if I let her see my flaws, she'd know she married a loser."
  WRONG vow: "letting her see my flaws"                (that's the antecedent — a behavior)
  RIGHT vow: "being the loser husband she'd discover if she saw my flaws"  (mirrors the identity in the consequent)

Rule: if the worry has an "if I…, she'd know / see / find out that…" shape, the vow ALWAYS mirrors what she'd know / see / find out — never the "if I…" part.

## Length target

Target for the assembled sentence: 10-20 words. Cap: 22. If the paired worry's identity content runs longer, keep the specificity — don't crop nouns just to hit the target.

## Preserve his nouns — do NOT swap in generics

- Worry says "my team" → vow says "my team." Never "the people I work with," never "colleagues."
- Worry says "she" / "my wife" → vow keeps that noun. Never "my partner," never "my family."
- Worry says "my kid" (singular) → vow keeps "my kid." Never "my kids."
- Worry says "my customers" → vow says "my customers."

The pronoun / relational noun rule from the voice rules applies here doubly: every noun in your vow must come from the paired worry (or the goal/behavior context). Never introduce nouns the coachee didn't already use.

## Banned in vow

- Positive aspirations ("being the best husband I can be", "being a great leader"). Those are Column 1 goals, not competing commitments. Competing commitments are about what he vows NEVER to be or have happen.
- Generic values with no specificity ("failing", "being a bad person"). If the vow could belong to any map, it's too generic — pull in the specific role/outcome the paired worry names.
- Interior-witness verbs ("having to face myself", "having to see who I am"). The vow names the outward identity/outcome, not an interior reckoning.
- The word "never" at the start of the slot (the server writes "never" as part of the prefix — writing it here produces "never never").

## Silent checklist

  A. Read the paired worry. What identity/outcome does it fear?
  B. Fill vow with that identity/outcome, mirroring the worry's nouns.
  C. Length target met? Nouns from the worry preserved? No positive aspiration, no interior-witness verb?

Return only the structured slot ({ vow: "..." }). No prose, no explanation, no meta.
`.trim();

/** Hard ceiling on assembled commitment length. Introductory-form
 *  commitments can run longer than the mechanism form did because
 *  the vow may need to carry a full role phrase from the worry
 *  ("being the guy who is defensive or difficult to work with").
 *  Overshoots are mechanically trimmed server-side (see
 *  trimAssembledDraft) rather than silently dropped. */
const COMMITMENT_HARD_WORD_CAP = 24;

/**
 * Server-side coach-draft generator for Column 4. Called once per
 * worry when the coachee advances into the commitments stage.
 *
 * Uses the introductory form (Kegan Vol 1 pp 26-27): the paired
 * worry's identity/outcome content is mirrored into an "I'm also
 * committed to never..." vow. The mechanism form (Vol 2, "keeping
 * X on the table so mine doesn't come up") was more excavation
 * work than a self-service tool could sustain — the noble first
 * pass got rejected by the reaction coach and coachees never got
 * a legible draft.
 *
 * Verification: the drafter checks its own output against the SAME
 * criteria the hone auditor uses, so the coach never contradicts
 * itself. Three failure modes gate the retry:
 *   1. Depth rubric (LLM): score < 3.
 *   2. Mirror check (LLM, folded into the depth call): the vow
 *      doesn't carry the paired worry's identity concern.
 *   3. Interior-witness regex: the vow ducks identity by framing as
 *      "never seeing/knowing/feeling/admitting…" rather than naming
 *      the outward identity plus observable action.
 *
 * Any failure triggers one retry with combined feedback naming ALL
 * failed checks — the LLM should fix them together, not one at a
 * time. If the retry still fails, we persist the best of the two
 * attempts (fewest failed checks; ties → later attempt), never
 * silent-drop. The persisted row will still carry a sharpen box from
 * `composeCommitmentSharpen`, so the coachee sees "one thing to
 * sharpen" from the moment the row lands — same signal the hone
 * audit would surface, no contradiction between the two surfaces.
 */
export type CommitmentDraftOutcome = {
  text: string | null;
  /** The verdict verification produced for `text`. Reused by the
   *  caller instead of scoring the same words again; see
   *  WorryDraftOutcome.verdict for why that matters. */
  verdict?: {
    depthScore: number;
    rubricReason: string;
    mirrorsWorryIdentity: boolean;
  } | null;
};

/** See draftCommitmentOutcome. Kept for callers that only need text. */
export async function draftCommitmentForWorry(
  input: Parameters<typeof draftCommitmentOutcome>[0],
): Promise<string | null> {
  return (await draftCommitmentOutcome(input)).text;
}

export async function draftCommitmentOutcome(input: {
  goalText: string;
  behaviorText: string;
  worryText: string;
  /** Rewrite the coachee's own commitment instead of drafting fresh.
   *  See ReviseInput. In this mode only a verified draft is returned. */
  revise?: ReviseInput;
  /** See draftWorryForBehavior.mapTexts. */
  mapTexts?: string[];
}): Promise<CommitmentDraftOutcome> {
  const started = Date.now();
  const mapTexts = [
    input.goalText,
    input.behaviorText,
    input.worryText,
    ...(input.mapTexts ?? []),
  ];
  const basePromptLines = [
    `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
    `Behavior (Column 2): ${input.behaviorText}`,
    `Paired worry (Column 3): ${input.worryText}`,
    peopleLine(mapTexts),
    ``,
    `Fill vow with the identity/outcome the paired worry fears, mirrored into never-form. Preserve the coachee's nouns. Target 10-20 words assembled.`,
    ...reviseLines(input.revise, "competing commitment"),
  ];

  type DraftShape = { assembled: string; slots: { vow: string } };
  type Verdict = {
    ok: boolean;
    failures: string[];
    depthScore: number | null;
    carried: CommitmentDraftOutcome["verdict"];
  };

  async function generateDraft(promptLines: string[]): Promise<DraftShape | null> {
    const { object } = await generateWithRetry("commitment draft", () =>
      generateObject({
        model: mainModel(),
        schema: CommitmentDraftSchema,
        system: withVoiceRules(DRAFT_COMMITMENT_SYSTEM),
        prompt: promptLines.join("\n"),
        // See the worry drafter: 200 leaves no room under a large
        // system prompt if the model writes anything before the object.
        maxOutputTokens: 600,
      }),
    );
    const raw = scrubReply(assembleCommitment(object));
    if (!raw) return null;
    return {
      assembled: trimAssembledDraft(raw, COMMITMENT_HARD_WORD_CAP),
      slots: object,
    };
  }

  /**
   * Run the same criteria the hone auditor uses. Returns a verdict
   * naming every failed check so the retry prompt can address all of
   * them together. Fail-open on rubric error (transient Haiku hiccup
   * shouldn't strand the drafter — depthScore=null skips the depth
   * and mirror gates but the interior-witness regex still runs).
   */
  async function verifyDraft(assembled: string): Promise<Verdict> {
    const failures: string[] = [];
    let depthScore: number | null = null;

    const depthResult = await scoreCommitmentDepth({
      goalText: input.goalText,
      worryText: input.worryText,
      commitmentText: assembled,
    }).catch((err) => {
      console.warn(
        "[itc coach] commitment depth rubric failed, treating as pass: %s",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    });
    if (depthResult) {
      depthScore = depthResult.score;
      if (depthResult.score < 3) {
        failures.push(
          `Depth rubric rejected it (${depthResult.score}/3). Reason: "${depthResult.reason}". Push the vow to identity depth — name the identity being protected, not just the behavior.`,
        );
      }
      if (depthResult.mirrors_worry_identity === false) {
        // Advice reads from ADVICE (see src/lib/itc/criteria/advice.ts).
        // Worry text is quoted inline so the LLM has the exact identity
        // it needs to mirror — the canonical advice tells it HOW,
        // the quote tells it WHAT.
        failures.push(
          `${ADVICE.commitment_doesnt_mirror_worry} The paired worry is: "${input.worryText}".`,
        );
      }
    }

    // Regex check — cheap, deterministic. Wrap the assembled text in
    // a minimal ItcCommitment shape so the shared check runs unchanged.
    const iwFindings = await checkInteriorWitnessInCommitments({
      commitments: [
        {
          id: "draft",
          map_id: "draft",
          worry_id: "draft",
          text: assembled,
          depth_score: null,
          rubric_reason: null,
          sharpen_text: null,
          suggested_fix: null,
          mirrors_worry_identity: null,
          attempts: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });
    if (iwFindings.length > 0) {
      // Advice reads from ADVICE (see src/lib/itc/criteria/advice.ts)
      // so drafter feedback stays aligned with the auditor's fix
      // suggestion and the save-time sharpen box.
      failures.push(ADVICE.interior_witness_commitment);
    }
    const people = checkPeopleFromMap({ draftText: assembled, mapTexts });
    if (!people.ok) failures.push(people.reason);

    return {
      ok: failures.length === 0,
      failures,
      depthScore,
      carried: depthResult
        ? {
            depthScore: depthResult.score,
            rubricReason: depthResult.reason,
            mirrorsWorryIdentity: depthResult.mirrors_worry_identity,
          }
        : null,
    };
  }

  try {
    const first = await generateDraft(basePromptLines);
    if (!first) return { text: null };

    const firstVerdict = await verifyDraft(first.assembled);
    if (firstVerdict.ok) {
      return { text: first.assembled, verdict: firstVerdict.carried };
    }

    const retry = await generateDraft([
      ...basePromptLines,
      ``,
      `Your previous draft was: "${first.assembled}"`,
      `It failed ${firstVerdict.failures.length} check${firstVerdict.failures.length === 1 ? "" : "s"}:`,
      ...firstVerdict.failures.map((f, i) => `${i + 1}. ${f}`),
      ``,
      `Rewrite the vow to pass ALL failing checks at once. Preserve intent; fix every flaw named.`,
    ]);

    // Rewrite mode returns only a draft that clears every check (a
    // rewrite that fails the bar it's fixing is the coach contradicting
    // itself). Draft mode prefers the attempt with fewer failed checks,
    // tie → later attempt, and never silent-drops: the persisted row
    // still carries its own sharpen box.
    if (input.revise) {
      if (!retry) return { text: null };
      const retryVerdict = await verifyDraft(retry.assembled);
      if (!retryVerdict.ok) {
        console.warn(
          "[itc coach] commitment rewrite refused after retry: draft=%o feedback=%o",
          retry.assembled,
          retryVerdict.failures,
        );
        return { text: null };
      }
      return { text: retry.assembled, verdict: retryVerdict.carried };
    }
    if (!retry) return { text: first.assembled, verdict: firstVerdict.carried };
    const retryVerdict = await verifyDraft(retry.assembled);
    if (retryVerdict.failures.length <= firstVerdict.failures.length) {
      return { text: retry.assembled, verdict: retryVerdict.carried };
    }
    return { text: first.assembled, verdict: firstVerdict.carried };
  } catch (err) {
    console.warn(
      "[itc coach] draftCommitmentOutcome failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    return { text: null };
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
 * The tell/identity join is shape-aware (see buildIdentityPredicate).
 * Old dumb template `then ${tell} and ${identity}` broke when tell
 * was "she'd V O" and identity was a bare noun — the "and" stranded
 * the noun with no verb to attach to (produced "then she'd build the
 * list and the man whose wife has outgrown him", ungrammatical).
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
  // Same doubled-"if" guard the worry assembler uses: the server
  // writes "if I " and the slot must not write its own.
  const act = normalizeSlot(stripRedundantIf(slots.antecedent_act));
  const tell = normalizeSlot(slots.consequent_tell);
  const identity = normalizeSlot(slots.consequent_identity);
  return `I assume that if I ${act}, then ${tell} ${buildIdentityPredicate(tell, identity)}.`;
}

/**
 * Grammar-safe join between the observable tell and the identity
 * landing. Handles three identity shapes:
 *
 *   (a) Bare noun/adjective phrase — "the husband who hurts her" /
 *       "not good enough for her" / "the man whose wife has outgrown
 *       him". Server writes an "I'd be" (or bare "be", reusing the
 *       tell's I-subject if it has one) so the noun becomes a
 *       predicate.
 *
 *   (b) Predicate the LLM led with "be" / "become" — "be the husband
 *       who hurts her". Strip the leading verb and re-derive from the
 *       tell's subject so we don't end up with "she'd build the list
 *       and be the man..." (that parses as "she'd be the man").
 *
 *   (c) Full clause with its own subject — "she'd see I've been
 *       hiding" / "the truth would come out" / "I've been the man who
 *       X". Join with bare "and "; the clause carries its own subject.
 *
 * Server-owned structure over LLM-obedience: the drafter prompt still
 * asks for a bare identity slot, but if the model reaches for the
 * "be X" walkthrough shape (or a full clause), the join adapts rather
 * than breaking the sentence.
 */
function buildIdentityPredicate(tell: string, identity: string): string {
  // Strip a leading predicate verb ("be", "become", "I'd be", "I would
  // be") so we can re-derive it against the tell's subject.
  const bareIdentity = identity.replace(
    /^(?:i['\u2019]d\s+|i\s+would\s+)?(?:be|become)\s+/i,
    "",
  );
  // Shape (c): already a full clause with its own subject.
  const startsWithClauseSubject =
    /^(?:i['\u2019](?:d|ve|ll|m)\b|i\s+would\b|she['\u2019](?:d|ll|s)\b|he['\u2019](?:d|ll|s)\b|they['\u2019](?:d|ll|ve)\b|she\s+would\b|he\s+would\b|they\s+would\b|the\s+truth\b|my\s+(?:wife|kids|family)\s+would\b)/i.test(
      bareIdentity,
    );
  if (startsWithClauseSubject) {
    return `and ${bareIdentity}`;
  }
  // Shape (a)/(b): bare noun or adjective. Reuse the tell's I-subject
  // if it has one; otherwise start a fresh "I'd be".
  const tellStartsWithI = /^i['\u2019](?:d|ll|ve|m)\b/i.test(tell);
  return tellStartsWithI ? `and be ${bareIdentity}` : `and I'd be ${bareIdentity}`;
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

You never write "I assume that", "if I", "then", or the connecting "and". The server writes those. You never write the trailing period. The server writes that. The server also writes the predicate verb ("I'd be" / "be") between "and" and the identity noun when needed — you do NOT need to prefix your identity slot with "be" or "I'd be". Just write the identity itself. Focus entirely on the semantic content of each slot.

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

Wrong shape (worry re-stemmed into slots): antecedent_act="stay in the room instead of walking out", consequent_tell="I'd lose control and say something awful", consequent_identity="the husband who hurts his wife". → assembled = "I assume that if I stay in the room instead of walking out, then I'd lose control and say something awful and be the husband who hurts his wife." That's the worry with prefix swap. 30 words. Rejected.

Right shape: antecedent_act="stay in the room while she's angry", consequent_tell="I'd lose control", consequent_identity="the husband who hurts her". → assembled = "I assume that if I stay in the room while she's angry, then I'd lose control and be the husband who hurts her." Atomic. 22 words. Passes.

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
export type AssumptionDraftsOutcome = {
  drafts: Array<{ text: string; commitment_indices: number[] }>;
  /** Every draft the checks refused, with the checks' own lines, and
   *  which commitments were left with nothing. Lands in turn events
   *  so "one draft for three commitments" is explainable after the
   *  fact rather than invisible (the gap that made the worry-draft
   *  failures so hard to diagnose). */
  refusals: Array<{ draft: string; reason: string }>;
  uncoveredCommitmentIndices: number[];
  error?: string;
};

/** See draftAssumptionsOutcome. Kept for callers that only need the drafts. */
export async function draftAssumptionsFromCommitments(input: {
  goalText: string;
  commitments: Array<{ text: string; worry_text: string }>;
}): Promise<Array<{ text: string; commitment_indices: number[] }>> {
  return (await draftAssumptionsOutcome(input)).drafts;
}

export async function draftAssumptionsOutcome(input: {
  goalText: string;
  commitments: Array<{ text: string; worry_text: string }>;
}): Promise<AssumptionDraftsOutcome> {
  const started = Date.now();
  const HARD_WORD_CAP = 20;
  const refusals: AssumptionDraftsOutcome["refusals"] = [];

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
        peopleLine([
          input.goalText,
          ...input.commitments.flatMap((c) => [c.text, c.worry_text]),
        ]),
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
    if (first.length === 0) {
      return { drafts: [], refusals, uncoveredCommitmentIndices: input.commitments.map((_c, i) => i + 1) };
    }

    // Verify each draft's logical consistency (deterministic pattern
    // match, cannot fail). Each drafted assumption gets its own
    // verdict; the batch retry (if any) knows which ones failed.
    // Same bar as rewrite mode and as the save that follows a tap on
    // the draft card: the depth rubric (LLM, fail-open), the identity
    // is REVEALED by the counter-move (consistency), it's named in
    // the coachee's own commitment nouns (identity kept), and its
    // people come from the map. A draft that would draw a red box on
    // tap doesn't reach the card.
    const verifyBatch = (drafts: BatchDraft[]) => Promise.all(
      drafts.map(async (d) => {
        const depth = await scoreAssumptionDepth({
          goalText: input.goalText,
          assumptionText: d.text,
        }).catch((err) => {
          console.warn(
            "[itc coach] assumption draft depth rubric failed, treating as pass: %s",
            err instanceof Error ? err.message : String(err),
          );
          return null;
        });
        const consistency = checkAssumptionLogicalConsistency({
          antecedentAct: d.slots.antecedent_act,
          consequentTell: d.slots.consequent_tell,
          consequentIdentity: d.slots.consequent_identity,
        });
        const identity = checkAssumptionKeepsCommitmentIdentity({
          assumptionText: d.text,
          commitmentTexts: d.commitment_indices
            .map((i) => input.commitments[i - 1]?.text ?? "")
            .filter((t) => t.length > 0),
        });
        const people = checkPeopleFromMap({
          draftText: d.text,
          mapTexts: [
            input.goalText,
            ...input.commitments.flatMap((c) => [c.text, c.worry_text]),
          ],
        });
        const depthOk = depth === null || depth.score >= 3;
        return {
          consistent: depthOk && consistency.consistent && identity.kept && people.ok,
          reason: [
            depthOk ? null : `The depth rubric rejected it (${depth!.score}/3): "${depth!.reason}"`,
            consistency.consistent ? null : consistency.reason,
            identity.kept ? null : identity.reason,
            people.ok ? null : people.reason,
          ]
            .filter((r): r is string => Boolean(r))
            .join(" "),
        };
      }),
    );
    const checks = await verifyBatch(first);

    const inverted = first
      .map((d, i) => ({ d, check: checks[i], index: i + 1 }))
      .filter((x) => !x.check.consistent);

    if (inverted.length === 0) {
      return {
        drafts: first.map(({ slots: _slots, ...rest }) => rest),
        refusals,
        uncoveredCommitmentIndices: [],
      };
    }

    // One batch retry with per-draft inversion feedback. The retry
    // prompt names each broken draft AND its specific inversion so the
    // drafter fixes the pair, not the whole set. Return whatever the
    // retry produces; fall back to the first batch (with inversions
    // included) if the retry fails, so the coachee is never stranded.
    const feedbackBlock = inverted
      .map(
        (x) =>
          `  - Draft #${x.index} was: "${x.d.text}". Rejected: "${x.check.reason}"`,
      )
      .join("\n");
    const retry = await generateBatch([
      ``,
      `Your previous batch had ${inverted.length} draft(s) that failed verification:`,
      feedbackBlock,
      ``,
      `Rewrite the whole batch so every draft passes. Antecedent must be the counter-move; consequent must describe what DOING that counter-move would expose, and it must name the identity in the coachee's own commitment words (the same role noun his commitment uses).`,
    ]).catch((err) => {
      console.warn(
        "[itc coach] assumption batch retry failed, returning first batch: %s",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    });
    // Only drafts that clear every check reach the card. After the
    // batch retry, drop what still fails; then give each commitment
    // left uncovered one targeted attempt of its own. What still
    // fails is left to the coachee (and to honing's coverage draft).
    const chosen = retry && retry.length > 0 ? retry : first;
    const chosenChecks = await verifyBatch(chosen);
    chosen.forEach((d, i) => {
      if (!chosenChecks[i].consistent) {
        refusals.push({ draft: d.text, reason: chosenChecks[i].reason });
      }
    });
    const passing = chosen.filter((_d, i) => chosenChecks[i].consistent);
    const covered = new Set(passing.flatMap((d) => d.commitment_indices));
    const uncovered = input.commitments
      .map((_c, i) => i + 1)
      .filter((i) => !covered.has(i));
    for (const idx of uncovered) {
      const c = input.commitments[idx - 1];
      const single = await generateBatch([
        ``,
        `Draft ONE Big Assumption for commitment ${idx} only: "${c.text}" (paired worry: "${c.worry_text}"). commitment_indices must be [${idx}].`,
      ]).catch(() => [] as BatchDraft[]);
      const d = single.find((s) => s.commitment_indices.includes(idx));
      if (!d) continue;
      const [check] = await verifyBatch([d]);
      if (check.consistent) passing.push({ ...d, commitment_indices: [idx] });
      else refusals.push({ draft: d.text, reason: check.reason });
    }
    const verified = await verifyDraftClusters(passing, input.commitments);
    const coveredAfterVerify = new Set(verified.flatMap((d) => d.commitment_indices));
    return {
      drafts: verified.map(({ slots: _slots, ...rest }) => rest),
      refusals,
      uncoveredCommitmentIndices: input.commitments
        .map((_c, i) => i + 1)
        .filter((i) => !coveredAfterVerify.has(i)),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      "[itc coach] draftAssumptionsOutcome failed (model=%s): %s",
      mainModelIdOrUnset(),
      message,
    );
    return {
      drafts: [],
      refusals,
      uncoveredCommitmentIndices: input.commitments.map((_c, i) => i + 1),
      error: `${message} (model=${mainModelIdOrUnset()})`,
    };
  } finally {
    console.warn(
      "[itc timing] draft kind=assumptions ms=%d",
      Date.now() - started,
    );
  }

  /**
   * Draft-time cluster-fit verifier. For each draft that clusters 2+
   * commitments, ask whether believing the assumption would make each
   * linked commitment feel necessary (Kegan/Lahey Appendix A criterion
   * 1). Drop the ones it wouldn't.
   *
   * Same judge the hone audit runs (`judgeAssumptionUnderwrites` in
   * criteria/assumptions.ts) — preventative here, so bad clusters
   * never reach the coachee's Draft card, and by construction never
   * approved here then flagged on hone. Server-owned structure over
   * LLM-obedience: the drafter prompt asks for antecedent-based
   * coverage (`## Clustering` section), but the model isn't fully
   * reliable at it, so verify the output structurally.
   *
   * Design choices:
   *   - Never strip a draft's cluster to zero. If the verifier drops
   *     everything, we keep the original — the LLM verifier can be
   *     wrong too, and orphaned assumptions confuse the coachee. Let
   *     honing catch a wrong cluster instead of hiding the draft.
   *   - On verifier error, keep the draft's original cluster (never
   *     worse than the pre-verifier status quo).
   *   - Filtered-out commitments may become uncovered — that's the
   *     right outcome. Honing's `checkAssumptionCoverage` will flag
   *     "commitment X needs a Big Assumption", which is exactly the
   *     K/L guidance for an unclustered concern.
   */
  async function verifyDraftClusters(
    drafts: BatchDraft[],
    commitments: Array<{ text: string; worry_text: string }>,
  ): Promise<BatchDraft[]> {
    return Promise.all(
      drafts.map(async (draft) => {
        if (draft.commitment_indices.length < 2) return draft;
        const cluster = draft.commitment_indices
          .map((i) => ({ index: i, text: commitments[i - 1]?.text ?? "" }))
          .filter((c) => c.text.length > 0);
        if (cluster.length < 2) return draft;
        try {
          // ONE judge for "does this assumption hold up that commitment",
          // shared with the hone audit (checkAssumptionUnderwritesCommitments).
          // A cluster the drafter accepts here is, by construction, a
          // cluster the audit accepts later.
          const verdict = await judgeAssumptionUnderwrites({
            assumptionText: draft.text,
            commitments: cluster,
          });
          const kept = verdict.fits.filter((i) =>
            draft.commitment_indices.includes(i),
          );
          if (kept.length === 0) return draft;
          if (kept.length === draft.commitment_indices.length) return draft;
          console.warn(
            "[itc coach] draft cluster split: draft=%o kept=%o dropped=%o",
            draft.text,
            kept,
            verdict.doesntFit
              .map((d) => `${d.index}: ${d.reason}`)
              .join(" | "),
          );
          return { ...draft, commitment_indices: kept };
        } catch (err) {
          console.warn(
            "[itc coach] cluster verify failed (draft=%o): %s",
            draft.text,
            err instanceof Error ? err.message : String(err),
          );
          return draft;
        }
      }),
    );
  }
}

// -------------------------------------------------------------------------
// reviseAssumption — rewrite ONE Big Assumption against the coach's lines
// -------------------------------------------------------------------------

/**
 * Rewrite mode for a single Big Assumption. Same slot drafter and the
 * same server assembly as draftAssumptionsFromCommitments, pointed at
 * one existing entry: the coachee's current text plus the coach's
 * lines on what's off (from criteria/advice.ts, the same lines the
 * row box shows).
 *
 * Verified against the SAME checks the hone auditor runs on a saved
 * assumption: depth rubric, logical consistency of the slots, the
 * vague-then regex, and (when the problem is enactability) the
 * enactable judge with the coachee's own behaviors as anchors. Returns
 * only a draft that clears every check, else null. One retry with
 * combined feedback, like the other drafters.
 */
/**
 * Rewrite-mode slots. Same three slots as the fresh drafter, looser
 * per-slot caps: a rewrite keeps the coachee's own nouns and scene,
 * and his entries run longer than a fresh 15-word draft. No
 * commitment_indices: the links are the caller's, not the model's.
 */
const ReviseAssumptionSchema = z.object({
  antecedent_act: z.string().min(3).max(120),
  consequent_tell: z.string().min(3).max(100),
  consequent_identity: z.string().min(3).max(120),
});

export async function reviseAssumption(input: {
  goalText: string;
  currentText: string;
  /** The commitments this assumption is linked to, with their worries,
   *  so the rewrite keeps holding them up. */
  linkedCommitments: Array<{ text: string; worry_text: string }>;
  /** Selected Column 2 behaviors, map order. The "if" half should be
   *  the coachee doing the opposite of one of them. */
  behaviors: string[];
  problems: string[];
  /** True when one of the problems is that the "if" isn't his move.
   *  The verifier then runs the enactable judge too. */
  requireEnactable: boolean;
}): Promise<string | null> {
  const started = Date.now();
  // Fresh drafts are capped at 20 words. A rewrite gets the room the
  // coachee's own entry already takes (never less than 24), so the
  // trimmer doesn't cut a long-but-honest assumption into a fragment.
  const HARD_WORD_CAP = Math.max(
    24,
    input.currentText.trim().split(/\s+/).filter(Boolean).length,
  );
  const commitmentBlock =
    input.linkedCommitments.length > 0
      ? input.linkedCommitments
          .map(
            (c, i) =>
              `  ${i + 1}. commitment: ${c.text}\n     paired worry: ${c.worry_text}`,
          )
          .join("\n")
      : "  (none linked yet)";
  const behaviorBlock =
    input.behaviors.length > 0
      ? input.behaviors.map((b, i) => `  ${i + 1}. ${b}`).join("\n")
      : "  (none)";
  const basePromptLines = [
    `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
    peopleLine([
      input.goalText,
      input.currentText,
      ...input.behaviors,
      ...input.linkedCommitments.flatMap((c) => [c.text, c.worry_text]),
    ]),
    ``,
    `The coachee's behaviors (Column 2):`,
    behaviorBlock,
    ``,
    `Competing commitments (Column 4) this assumption holds up, with their paired worries:`,
    commitmentBlock,
    ``,
    `Return the three slots for ONE rewritten assumption. antecedent_act must be the coachee doing the OPPOSITE of one of his behaviors above (a move he could make in a small dose this week), and the assumption must keep holding up every commitment listed. Ignore the batch-drafting instructions about commitment_indices and draft counts; there is exactly one assumption here.`,
    ...reviseLines(
      { currentText: input.currentText, problems: input.problems },
      "Big Assumption",
    ),
  ];

  type Draft = {
    text: string;
    slots: { antecedent_act: string; consequent_tell: string; consequent_identity: string };
  };

  async function generate(lines: string[]): Promise<Draft | null> {
    const { object: d } = await generateObject({
      model: mainModel(),
      schema: ReviseAssumptionSchema,
      system: withVoiceRules(DRAFT_ASSUMPTIONS_SYSTEM),
      prompt: lines.join("\n"),
      maxOutputTokens: 600,
    });
    const raw = scrubReply(assembleAssumption(d));
    if (!raw) return null;
    return {
      text: trimAssembledDraft(raw, HARD_WORD_CAP),
      slots: {
        antecedent_act: d.antecedent_act,
        consequent_tell: d.consequent_tell,
        consequent_identity: d.consequent_identity,
      },
    };
  }

  const linkedTexts = input.linkedCommitments.map((c) => c.text);

  async function verify(draft: Draft): Promise<{ ok: boolean; feedback: string[] }> {
    const feedback: string[] = [];
    const [depth, vague, enactable, underwrite] = await Promise.all([
      scoreAssumptionDepth({
        goalText: input.goalText,
        assumptionText: draft.text,
      }).catch((err) => {
        console.warn(
          "[itc coach] assumption depth rubric failed, treating as pass: %s",
          err instanceof Error ? err.message : String(err),
        );
        return null;
      }),
      checkVagueAssumptionThenClause({
        assumptions: [
          {
            id: "draft",
            map_id: "draft",
            sort_order: 0,
            text: draft.text,
            depth_score: null,
            rubric_reason: null,
            sharpen_text: null,
            suggested_fix: null,
            attempts: 0,
            selected_for_testing: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      }),
      input.requireEnactable && input.behaviors.length > 0
        ? judgeAssumptionEnactable({
            assumptionText: draft.text,
            behaviors: input.behaviors.map((text, i) => ({ index: i + 1, text })),
          }).catch((err) => {
            console.warn(
              "[itc coach] enactable judge failed, treating as pass: %s",
              err instanceof Error ? err.message : String(err),
            );
            return null;
          })
        : Promise.resolve(null),
      // The rewrite has to keep holding up the SAME commitments the
      // original does. Same judge the hone audit runs, so a rewrite
      // that drifts into another commitment's room is refused here
      // instead of flagged later.
      linkedTexts.length > 0
        ? judgeAssumptionUnderwrites({
            assumptionText: draft.text,
            commitments: linkedTexts.map((text, i) => ({ index: i + 1, text })),
          }).catch((err) => {
            console.warn(
              "[itc coach] underwrite judge failed on rewrite, treating as pass: %s",
              err instanceof Error ? err.message : String(err),
            );
            return null;
          })
        : Promise.resolve(null),
    ]);
    if (depth && depth.score < 3) {
      feedback.push(
        `The depth rubric rejected it (${depth.score}/3). Reason: "${depth.reason}"`,
      );
    }
    const consistency = checkAssumptionLogicalConsistency({
      antecedentAct: draft.slots.antecedent_act,
      consequentTell: draft.slots.consequent_tell,
      consequentIdentity: draft.slots.consequent_identity,
    });
    if (!consistency.consistent) {
      feedback.push(`The logical-consistency check rejected it: "${consistency.reason}"`);
    }
    const identity = checkAssumptionKeepsCommitmentIdentity({
      assumptionText: draft.text,
      commitmentTexts: linkedTexts,
    });
    if (!identity.kept) feedback.push(identity.reason);
    const people = checkPeopleFromMap({
      draftText: draft.text,
      mapTexts: [
        input.goalText,
        input.currentText,
        ...input.behaviors,
        ...input.linkedCommitments.flatMap((c) => [c.text, c.worry_text]),
      ],
    });
    if (!people.ok) feedback.push(people.reason);
    if (vague.length > 0) feedback.push(ADVICE.vague_assumption_then_clause);
    if (enactable && !enactable.enactable) {
      feedback.push(`${ADVICE.assumption_not_enactable} (${enactable.reason})`);
    }
    if (underwrite && underwrite.doesntFit.length > 0) {
      feedback.push(
        `The rewrite stopped holding up ${underwrite.doesntFit
          .map((d) => `commitment ${d.index} ("${linkedTexts[d.index - 1]}"): ${d.reason}`)
          .join("; ")}. Keep the same belief underneath all of them.`,
      );
    }
    return { ok: feedback.length === 0, feedback };
  }

  try {
    const first = await generate(basePromptLines);
    if (!first) return null;
    const firstVerdict = await verify(first);
    if (firstVerdict.ok) return first.text;
    const retry = await generate([
      ...basePromptLines,
      ``,
      `Your previous draft was: "${first.text}"`,
      `It failed ${firstVerdict.feedback.length} check${firstVerdict.feedback.length === 1 ? "" : "s"}:`,
      ...firstVerdict.feedback.map((f, i) => `${i + 1}. ${f}`),
      ``,
      `Rewrite so ALL checks pass at once. Keep his nouns. Under 20 words assembled.`,
    ]);
    if (!retry) return null;
    const retryVerdict = await verify(retry);
    if (!retryVerdict.ok) {
      console.warn(
        "[itc coach] assumption rewrite refused after retry: draft=%o feedback=%o",
        retry.text,
        retryVerdict.feedback,
      );
      return null;
    }
    return retry.text;
  } catch (err) {
    console.warn(
      "[itc coach] reviseAssumption failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    console.warn(
      "[itc timing] revise kind=assumption ms=%d",
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
 * Draft a single test of a given type, self-verified against SMART.
 *
 * Two-phase pipeline (matches the shape of `reviseTestFromCoach`'s
 * loop in actions.ts, which already ran for the client-clicked
 * "Have the coach revise this" path):
 *
 *   1. Initial draft (mainModel + TEST_DESIGN_STAGE).
 *   2. `reviewTestDesign` scores the draft against the five SMART
 *      criteria + might-it-re-true check.
 *   3. If verdict === "ready" (or review LLM failed) → return draft.
 *   4. Otherwise fire `reviseTestFromReview` with the failing SMART
 *      feedback + re-review. Cap: DRAFT_VERIFY_MAX_ATTEMPTS revise
 *      cycles. Return the final revision.
 *
 * Why: the initial draft was passing schema validation but sometimes
 * failing Modest (bundling multiple triggers/behaviors) or Counters
 * (drifting to a variant the coachee already does). Coachees hit Run
 * the Test, saw "needs_work", and had to click Revise anyway. Running
 * the same loop on the pre-draft server-side gives them a Modest-clean
 * first draft by construction. Cost: +1 review call always, +1-2
 * revise+review cycles when the first draft fails. Absorbed by the
 * spinner on advance to test_design.
 *
 * Variation between drafts (initial vs "another draft" vs "safer") is
 * still handled server-side via `testType` picked by the caller
 * (ANOTHER_ROTATION / SAFER_LADDER in actions.ts). This helper never
 * self-decides variation.
 */
const DRAFT_VERIFY_MAX_ATTEMPTS = 2;

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
        // Assumption-first ordering: the assumption leads the prompt
        // and the drafter must derive behavior_change from its if-
        // clause. Commitments and behaviors follow as CONTEXT for how
        // the inversion shows up in his specific life, NOT as the
        // source of the counter-move. See the ASSUMPTION-FIRST
        // DRAFTING section in test-design.ts for the drift trap.
        `Draft one test of the specified type for the Big Assumption below.${typeConstraint}`,
        ``,
        `Today's date (ISO): ${input.todayIso}`,
        `Target date must be in the future, on or within about a week from today.`,
        ``,
        `====== Big Assumption being tested (Column 5) ======`,
        input.assumptionText,
        ``,
        `Derive the behavior_change from THIS assumption's if-clause. Read the antecedent (what he "does" or "doesn't do" that the assumption predicts leads to the catastrophic then-clause), invert it into the smallest livable moment, and use THAT as the behavior_change. Before finalizing, run the drift check: if the test as drafted would give information about a DIFFERENT assumption than this one, redraft against this one's actual if-clause.`,
        ``,
        `====== Context (do NOT use as the source of the counter-move) ======`,
        `Improvement goal (Column 1): ${input.goalText || "(not set)"}`,
        ``,
        `Competing commitments this assumption underwrites (Column 4):`,
        commitmentsBlock || "  (none)",
        ``,
        `====== Instructions ======`,
        `Fill all four fields and return the structured object. If the assumption's if-clause cannot be inverted into a livable near-term moment (identity-scale outcomes, other-person antecedents, past-evidence patterns), default the test_type to data_mining or thought_experiment rather than forcing behavioral.`,
      ].join("\n"),
      maxOutputTokens: 1200,
    });
    let currentDraft = {
      // If the caller pinned a testType, honor it; otherwise use LLM's choice.
      testType: input.testType ?? object.test_type,
      assumptionSays: scrubReply(object.assumption_says),
      behaviorChange: scrubReply(object.behavior_change),
      dataToCollect: scrubReply(object.data_to_collect),
      inOrderToFindOut: scrubReply(object.in_order_to_find_out),
      targetDate: object.target_date,
    };

    // Self-verify loop. Fires reviewTestDesign; if verdict !== ready,
    // reviseTestFromReview + re-review, capped at DRAFT_VERIFY_MAX_ATTEMPTS.
    // Fail-open on review LLM error — the initial draft is still
    // valid metadata to seed the coachee's form.
    let review = await reviewTestDesign({
      goalText: input.goalText,
      assumptionText: input.assumptionText,
      test: currentDraft,
    });
    let verifyAttempts = 0;
    while (
      review !== null &&
      review.verdict !== "ready" &&
      verifyAttempts < DRAFT_VERIFY_MAX_ATTEMPTS
    ) {
      verifyAttempts += 1;
      const revised = await reviseTestFromReview({
        goalText: input.goalText,
        assumptionText: input.assumptionText,
        underwrittenCommitments: input.underwrittenCommitments,
        todayIso: input.todayIso,
        currentTest: currentDraft,
        review,
      });
      if ("error" in revised) {
        // Revise errored — keep the last valid draft. Coachee sees the
        // pre-draft anyway, hits Run the Test, gets the client-side
        // revise path if needed.
        console.warn(
          "[itc coach] draftTestForAssumption verify-loop revise failed on attempt %d: %s",
          verifyAttempts,
          revised.error,
        );
        break;
      }
      currentDraft = revised;
      const next = await reviewTestDesign({
        goalText: input.goalText,
        assumptionText: input.assumptionText,
        test: currentDraft,
      });
      if (next === null) break; // review LLM failed on the revision; return what we have
      review = next;
    }
    console.warn(
      "[itc timing] draft-verify attempts=%d final_verdict=%s",
      verifyAttempts,
      review?.verdict ?? "review_failed",
    );
    return currentDraft;
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
  /** Present iff verdict === "needs_work". A concrete rewrite fragment
   *  the coachee could drop into the failing field verbatim (or
   *  adapt). Bridges the gap between "I understand the problem" and
   *  "I know what to write." Renders below one_thing_to_tighten with
   *  an "e.g." marker. */
  example_rewrite: z.string().min(3).max(240).nullable(),
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
        `Return the structured SMART verdict per the schema. Each SMART criterion gets a pass/fail flag and one short sentence grounded in the SPECIFIC test above (not a generic definition). If verdict is "needs_work", one_thing_to_tighten names the single specific edit to make AND example_rewrite gives a concrete rewrite fragment the coachee could drop into the failing field. The example_rewrite is what a well-formed version of the failing field would look like given THIS assumption and THIS behavior — not a generic template. Write the example in HIS voice, first-person, plain prose he could paste and adapt. If verdict is "ready", set both one_thing_to_tighten and example_rewrite to null.`,
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
      example_rewrite: object.example_rewrite
        ? scrubReply(object.example_rewrite)
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
/**
 * Deterministic scrub for the words that keep leaking into coach
 * audits despite explicit prompt callouts: `land`/`lands` as a
 * concreteness metaphor, `shape` as pattern-speak, `notice` as
 * therapy-speak, `read` as a noun, and the `worth [verb]ing` filler
 * family. Applied to hone-diagnostic + column-review output only —
 * these words have legitimate uses in other coach turns (a real
 * "notice" of a specific behavior, "landing the plane" as a plain
 * verb, etc.) but the audit format is structured enough that we
 * can safely rewrite them here.
 *
 * Patterns match phrasing seen in actual model output, not every
 * possible use. Keeps the scrub conservative: only touches known-
 * bad shapes, leaves anything ambiguous alone.
 */
export function scrubBannedCoachWords(text: string): string {
  return text
    // "behaviors land" / "the set lands" — metaphor for concreteness.
    // Rewrite to a factual verb ("holds") since audit outputs use
    // this shape a lot ("Behaviors land.").
    .replace(
      /\b(behaviors?|worries|commitments|assumptions|the set|the goal|the pairing|the point|the map)\s+lands?\b/gi,
      "$1 holds",
    )
    // "lands different" / "lands right" — same family.
    .replace(/\blands?\s+(different|right|wrong|clean|hard)\b/gi, "reads $1")
    // "land(s) on / at / against / in" — metaphor for "arrive(s) at."
    // Common phrasing: "that lands on the actual vow." Keeps the
    // verb's number ("we land on" → "we arrive at", not "we arrives").
    .replace(/\b(lands?)\s+(?:on|at|against|in)\s+/gi, (_m, verb: string) =>
      verb.toLowerCase() === "lands" ? "arrives at " : "arrive at ",
    )
    // "one thing to notice" — therapy-speak intro.
    .replace(/\bone\s+thing\s+to\s+notice\b/gi, "one thing")
    // "worth [any -ing verb]" — broader banned family. Catches
    // "worth untangling," "worth fixing," "worth doing," etc. in
    // addition to the specific ones we hand-rolled before.
    .replace(/\b(it'?s\s+)?worth\s+\w+ing\b/gi, (match) =>
      match.replace(/\b(it'?s\s+)?worth\s+/i, ""),
    )
    // "worth noting / mentioning / pausing on / etc." — original
    // hand-rolled family, kept as a belt-and-suspenders.
    .replace(
      /\b(it'?s\s+)?worth\s+(noting|noticing|mentioning|pausing\s+on|remembering|pointing\s+out|flagging)\s+/gi,
      "",
    )
    // "the rubric [any verb]" — machinery leak. Applied to hone /
    // column review surfaces only. Broader than the original which
    // enumerated specific verbs; this catches "the rubric wants to
    // know", "the rubric asks", "the rubric needs", etc.
    .replace(/\bthe\s+rubric\s+/gi, "")
    // Bare "rubric" anywhere else in audit output — catches
    // stragglers like "your rubric" or "rubric caught". Same
    // reasoning: no legitimate use of the word in audit prose.
    .replace(/\brubric\b/gi, "check")
    // Markdown asterisks for italic / bold emphasis. The chat UI
    // shows the literal asterisks — the LLM keeps producing `*seeing*`
    // and `**strong**` despite prompt bans. Strip the syntax, keep
    // the emphasized word.
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\s][^*\n]*[^*\s]|[^*\s])\*/g, "$1")
    // "own up to" family — banned interior-witness verb per the
    // voice doc's Column-4 section. When the coach uses it in audit
    // prose reacting to the coachee's map, it's the same violation
    // the check functions look for INSIDE map entries.
    .replace(/\bhave\s+to\s+own\s+up\s+to\s+being\b/gi, "be seen as")
    .replace(/\bown\s+up\s+to\s+being\b/gi, "be seen as")
    .replace(/\bown\s+up\s+to\b/gi, "admit")
    // "the shape of X" — pattern-speak. Rewrite to "the way X."
    .replace(/\bthe\s+shape\s+of\b/gi, "the way")
    // "the shape in / that shape / this shape" — pattern-speak.
    .replace(/\bthe\s+shape\s+in\b/gi, "the pattern in")
    .replace(/\bin\s+(that|this)\s+shape\b/gi, "in $1 pattern")
    .replace(/\bmatch\s+the\s+shape\b/gi, "match the pattern")
    // "coach's read" / "honest read" / "my read" etc. — "read" as
    // noun is banned. Rewrite to "take."
    .replace(
      /\b(coach'?s|honest|my|your|his|her|the|our|first|initial|quick|another)\s+read\b/gi,
      "$1 take",
    )
    // Second-person only. The coach never says "our map" / "our
    // worries" / etc. — the map belongs to the coachee.
    .replace(
      /\bour\s+(map|goal|worry|worries|commitment|commitments|assumption|assumptions|behavior|behaviors|test|tests|pattern|patterns)\b/gi,
      "your $1",
    )
    // Collapse any double spaces the removals introduced.
    .replace(/  +/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}

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

// ---------------------------------------------------------------------------
// Column-close reviews — all five columns now run the shared criteria
// module and render via renderFindings in actions.ts. The old
// generateColumnReview + per-column LLM prompts have been retired.
// ---------------------------------------------------------------------------
