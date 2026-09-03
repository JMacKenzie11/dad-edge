/**
 * Column 5 (Big Assumptions) criteria.
 *
 * Straight from the Kegan/Lahey Coach's Guide, Vol 1:
 *
 *  Appendix A (p 43), the Column 4 criteria:
 *   1. Makes the Column 3 commitment absolutely necessary
 *      → assumption_doesnt_underwrite
 *   2. Has a Big Time Bad conclusion for you
 *   3. Displays a contracted world
 *   4. Feels real
 *      → depth_shortfall_assumption (2–4, via the depth rubric) and
 *        vague_assumption_then_clause (4)
 *
 *  Checkpoint 2 (p 18), honing: "a testable assumption is one where
 *  the 'if' condition has degrees or shades to it so we can enact it
 *  safely" → assumption_not_enactable. At hone this is a MAP-level
 *  question (p 4: "are there testable assumptions, or do they all have
 *  such dire outcomes that there would be no safe way to test them?").
 *  A root assumption that's untestable as written is normal and
 *  powerful (p 21); it only becomes a problem when nothing on the
 *  column can be tested, or when he picks it to test (prioritize).
 *
 *  Plus one map-shape check: assumption_uncovered_commitment, a
 *  commitment with no assumption under it. Moderate, not critical:
 *  the guide says to start from the juiciest commitments (p 17), not
 *  to cover every one.
 *
 * Retired 2026-09-01: assumption_commitment_drift (per-link LLM
 * scenario match) and assumption_overload (per-assumption "distinct
 * identities" LLM call). Neither is in the guide. Both were biased
 * to fire and ran once per link, so a well-clustered map (one
 * assumption under several commitments, which the guide and the
 * drafter both want) produced a finding per link. The drafter's
 * cluster verifier and the hone audit now share ONE judge
 * (judgeAssumptionUnderwrites), so a cluster the drafter accepted
 * can't be rejected by the audit.
 */

import { generateObject } from "ai";
import { z } from "zod";
import { utilityModel } from "@/lib/model-config";
import type {
  ItcAssumption,
  ItcAssumptionCommitment,
  ItcBehavior,
  ItcCommitment,
} from "../maps";
import { ADVICE } from "./advice";
import { DEPTH_THRESHOLD, depthSeverity, type Finding } from "./types";

// ---------------------------------------------------------------------------
// depth_shortfall_assumption
// ---------------------------------------------------------------------------

export async function checkAssumptionDepth(input: {
  assumptions: ItcAssumption[];
}): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const assumption of input.assumptions) {
    if (assumption.depth_score == null) continue;
    if (assumption.depth_score >= DEPTH_THRESHOLD) continue;
    findings.push({
      entryRef: { table: "assumptions", id: assumption.id },
      issueType: "depth_shortfall_assumption",
      severity: depthSeverity(assumption.depth_score),
      actualText: assumption.text,
      detail: assumption.rubric_reason?.trim() || ADVICE.depth_shortfall_assumption,
      suggestedFix: assumption.suggested_fix ?? undefined,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// vague_assumption_then_clause
// ---------------------------------------------------------------------------

const VAGUE_THEN_CLAUSE_PATTERNS: RegExp[] = [
  /\bthe\s+(?:person|man|husband|father|coach|guy|dad)\s+(?:I\s?['’]?m\s+terrified|I\s+fear|I\s+don['’]?t\s+want\s+to|I\s?['’]?d\s+hate\s+to)\b/i,
  /\bwhat\s+I(?:\s?['’]?m\s+afraid|\s+fear)\b/i,
  /\bI\s?['’]?d\s+become\s+(?:what|who)\s+I\b/i,
  /\bI\s?['’]?d\s+be\s+the\s+(?:person|man|guy|dad|husband|father|coach)\s+I\b/i,
];

function extractThenClause(text: string): string | null {
  const commaThen = text.match(/,\s*then\s+(.+)$/i);
  if (commaThen) return commaThen[1].trim();
  const bareThen = text.match(/\bthen\s+(.+)$/i);
  if (bareThen) return bareThen[1].trim();
  return null;
}

export async function checkVagueAssumptionThenClause(input: {
  assumptions: ItcAssumption[];
}): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const assumption of input.assumptions) {
    const thenClause = extractThenClause(assumption.text);
    if (!thenClause) continue;
    const matched = VAGUE_THEN_CLAUSE_PATTERNS.some((re) => re.test(thenClause));
    if (!matched) continue;
    findings.push({
      entryRef: { table: "assumptions", id: assumption.id },
      issueType: "vague_assumption_then_clause",
      severity: "moderate",
      actualText: assumption.text,
      detail: ADVICE.vague_assumption_then_clause,
      suggestedFix: assumption.suggested_fix ?? undefined,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// assumption_uncovered_commitment
// ---------------------------------------------------------------------------

/**
 * A commitment with no Big Assumption under it. The fix isn't a
 * rewrite of the commitment; it's a draft assumption (fixes.ts
 * writes one to itc_assumption_drafts and puts its text in
 * suggestedFix). Rendered under the Big Assumptions header, because
 * that's the column with the gap.
 */
export async function checkAssumptionCoverage(input: {
  commitments: ItcCommitment[];
  assumptions: ItcAssumption[];
  links: ItcAssumptionCommitment[];
}): Promise<Finding[]> {
  const findings: Finding[] = [];
  const linkedCommitmentIds = new Set(input.links.map((l) => l.commitment_id));
  for (const commitment of input.commitments) {
    if (linkedCommitmentIds.has(commitment.id)) continue;
    findings.push({
      entryRef: { table: "commitments", id: commitment.id },
      issueType: "assumption_uncovered_commitment",
      severity: "moderate",
      actualText: commitment.text,
      detail: ADVICE.assumption_uncovered_commitment,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// assumption_doesnt_underwrite — ONE judge, shared by drafter + audit
// ---------------------------------------------------------------------------

const UnderwriteSchema = z.object({
  fits: z.array(z.number().int().min(1)),
  doesnt_fit: z.array(
    z.object({
      index: z.number().int().min(1),
      reason: z.string().max(200),
    }),
  ),
});

export type UnderwriteVerdict = {
  fits: number[];
  doesntFit: Array<{ index: number; reason: string }>;
};

const UNDERWRITE_SYSTEM = `
You check one Big Assumption against the competing commitments it's linked to, using Kegan/Lahey's Column 4 criterion: a Big Assumption "makes the Column 3 commitment absolutely necessary." If the coachee took the assumption as fact, the commitment would feel like the only sane move.

You receive the assumption and a numbered list of commitments. For each commitment ask: "If he believed this assumption as fact, would this commitment feel necessary?" If yes, it fits. If the assumption is about a different scene entirely and believing it wouldn't touch this vow, it doesn't fit.

Rules:
- One assumption usually holds up several commitments. That's the guide's target, not a problem. Different wording between the assumption and the commitment is fine; different scene is not.
- The test is about the belief driving the vow, not keyword overlap.
- Return every index in exactly one of the two lists.
- For doesnt_fit, give a reason under 25 words naming the different scene. Plain words, no jargon.

=== WORKED EXAMPLES ===

Example 1 (all fit):
  Assumption: "I assume that if I stay in the room while she's angry, then I'd lose control and be the husband who hurts her."
  Commitments:
    1. "I'm also committed to never being the man who can't handle her anger."
    2. "I'm also committed to never being the husband who says something he can't take back."
  Verdict: { fits: [1, 2], doesnt_fit: [] }

Example 2 (one doesn't fit):
  Assumption: "I assume that if I stay in the room while she's angry, then I'd lose control and be the husband who hurts her."
  Commitments:
    1. "I'm also committed to never being the man who can't handle her anger."
    2. "I'm also committed to never being the guy whose team sees he doesn't have the answer."
  Verdict: { fits: [1], doesnt_fit: [{ index: 2, reason: "Different scene: the assumption is about her anger at home, this vow is about looking capable at work." }] }

Example 3 (broad root, all fit):
  Assumption: "I assume that if something important goes badly and I didn't do everything in my power to prevent it, then I can't be trusted when people depend on me."
  Commitments:
    1. "I'm also committed to never being the coach who talked a great game but couldn't help them change."
    2. "I'm also committed to never being the father who was passive when my family needed me to provide."
  Verdict: { fits: [1, 2], doesnt_fit: [] }
  (Both vows are the same belief in two rooms. Believing it makes both necessary.)

=== DECISION RULE ===

Keep the link unless the scenes are clearly different. The coachee reads these results himself, without a coach in the room. A wrong "doesn't fit" makes him unlink something true; a wrong "fits" costs nothing until he tests, and testing sorts it out.
`.trim();

/**
 * Shared judge. The drafter's cluster verifier (coach.ts
 * verifyDraftClusters) and the hone check below both call this, so
 * the bar for "this assumption holds up that commitment" is one
 * function with one prompt. Positions are 1-based into the
 * `commitments` array the caller passes.
 */
export async function judgeAssumptionUnderwrites(input: {
  assumptionText: string;
  commitments: Array<{ index: number; text: string }>;
}): Promise<UnderwriteVerdict> {
  const { object } = await generateObject({
    model: utilityModel(),
    schema: UnderwriteSchema,
    system: UNDERWRITE_SYSTEM,
    prompt: [
      `Big Assumption: ${input.assumptionText}`,
      "",
      "Linked competing commitments:",
      ...input.commitments.map((c) => `  ${c.index}. "${c.text}"`),
    ].join("\n"),
    maxOutputTokens: 400,
    temperature: 0.1,
  });
  const valid = new Set(input.commitments.map((c) => c.index));
  const doesntFit = object.doesnt_fit.filter((d) => valid.has(d.index));
  const unfit = new Set(doesntFit.map((d) => d.index));
  const fits = input.commitments
    .map((c) => c.index)
    .filter((i) => !unfit.has(i));
  return { fits, doesntFit };
}

export async function checkAssumptionUnderwritesCommitments(input: {
  assumptions: ItcAssumption[];
  commitments: ItcCommitment[];
  links: ItcAssumptionCommitment[];
}): Promise<Finding[]> {
  // Map positions are the "#N" chips the coachee sees on the row, in
  // commitment order. The renderer speaks in those numbers.
  const positionById = new Map(input.commitments.map((c, i) => [c.id, i + 1]));
  const textById = new Map(input.commitments.map((c) => [c.id, c.text]));
  const linksByAssumption = new Map<string, string[]>();
  for (const link of input.links) {
    const prev = linksByAssumption.get(link.assumption_id) ?? [];
    prev.push(link.commitment_id);
    linksByAssumption.set(link.assumption_id, prev);
  }
  const findings: Finding[] = [];
  await Promise.all(
    input.assumptions.map(async (assumption) => {
      const linked = (linksByAssumption.get(assumption.id) ?? [])
        .map((id) => ({ index: positionById.get(id) ?? 0, text: textById.get(id) ?? "" }))
        .filter((c) => c.index > 0 && c.text.length > 0)
        .sort((a, b) => a.index - b.index);
      // Runs on one link as readily as on several. The guard used to
      // skip single-link assumptions on the theory that one link
      // can't be "the wrong one of the set", but Appendix A criterion
      // 1 asks of EVERY assumption whether believing it makes its
      // commitment necessary, and the judge answers that correctly
      // for a set of one (verified 2026-09-02).
      if (linked.length === 0) return;
      try {
        const verdict = await judgeAssumptionUnderwrites({
          assumptionText: assumption.text,
          commitments: linked,
        });
        if (verdict.doesntFit.length === 0) return;
        findings.push({
          entryRef: { table: "assumptions", id: assumption.id },
          issueType: "assumption_doesnt_underwrite",
          severity: "moderate",
          actualText: assumption.text,
          detail: ADVICE.assumption_doesnt_underwrite,
          unfitCommitmentPositions: verdict.doesntFit
            .map((d) => d.index)
            .sort((a, b) => a - b),
        });
      } catch (err) {
        console.warn(
          "[itc criteria] checkAssumptionUnderwritesCommitments failed (assumption=%s): %s",
          assumption.id,
          err instanceof Error ? err.message : String(err),
        );
      }
    }),
  );
  return findings;
}

// ---------------------------------------------------------------------------
// assumption_not_enactable — Checkpoint 2, the "if" has to be his move
// ---------------------------------------------------------------------------

const EnactableSchema = z.object({
  enactable: z.boolean(),
  reverses_behavior_index: z.number().int().min(1).nullable(),
  reason: z.string().max(200),
});

export type EnactableVerdict = {
  enactable: boolean;
  /** 1-based index into the behaviors passed in, when the "if" is
   *  the coachee doing the opposite of one of them. Null otherwise. */
  reversesBehaviorIndex: number | null;
  reason: string;
};

const ENACTABLE_SYSTEM = `
You check whether a Big Assumption can be TESTED. The guides' standard is Vol 1 p 19: "ask yourself what data, if they existed, could call the assumption into doubt. If you can't think of any, then it will be impossible to test it."

Data, not necessarily action. That is the whole bar, and it is wider than it sounds. Appendix D's worked tests include a course taken ("Take an anger management course"), a thing said ("I tell my husband about my concerns"), and a thought experiment with no behaviour change at all ("I will engage in some thought experiments, to imagine situations where others might possibly view me negatively that would actually not lead me to have low self-worth"). All three are real tests of real Big Assumptions.

You receive the assumption and a numbered list of the coachee's own behaviors. Doing the opposite of one of them is ONE way to gather the data and often the sharpest, but it is not required, and an assumption that names no behaviour at all is not thereby untestable.

enactable = true when you can name, in one line, something he could do, say, watch for, or imagine that would produce evidence bearing on this belief. Examples that PASS:
- an act he would take: "stay in the room", "send it without rewriting it", "tell her no"
- something observable he could watch for: "notice what actually happens the next three times a client hesitates"
- a thought experiment: "imagine a client who thinks the price is fair, and see whether he can picture it"
- a flat belief with no "if" at all: "I don't believe I can ever be skillful at managing my anger" — he could take a course, or watch for a single moment where he handled it. PASSES.

enactable = false ONLY when nothing could count as evidence either way:
- someone else's move with nothing for him to observe ("if they don't make the change")
- a claim so total that no single instance could bear on it AND nothing observable follows from it ("I don't deserve to feel happy" — the guides name this one as not yet testable, Vol 1 p 19)

When in doubt, TRUE. A wrong "not testable" sends him back to rewrite an assumption that was fine, and the guides are explicit that the assumption does not need to be sharp yet: "You don't need to have the exact assumption yet, because that is likely to get sharpened through his engaging it."

reverses_behavior_index: when the data would come from him doing the opposite of one listed behavior, give that behavior's number. Otherwise null. Null is common and fine; it does not mean not testable.

reason: under 25 words, plain words. When not testable, name what could not be observed rather than telling him to pick an action.

=== WORKED EXAMPLES ===

Example 1:
  Assumption: "I assume that if I send the message without rewriting it, then it won't land and I'd be the guy who claims to be a leader but isn't the real thing."
  Behaviors: 1. "I rewrite emails over and over until they sound perfect." 2. "I rush through conversations to chase more prospects."
  Verdict: { enactable: true, reverses_behavior_index: 1, reason: "Sending one message unrewritten is his move, the opposite of behavior 1." }

Example 2:
  Assumption: "I assume that if someone trusts me to coach them and they fail to make a change I could see, then I've failed at the thing I claim to be great at."
  Behaviors: 1. "I push people toward what I think they need instead of letting them find it."
  Verdict: { enactable: false, reverses_behavior_index: null, reason: "The 'if' is the client failing to change. That's their outcome, not a move he can make." }

Example 3:
  Assumption: "I assume that if something important goes badly and I didn't do everything in my power to prevent it, then I can't be trusted when people depend on me."
  Behaviors: 1. "I take over tasks my team could handle."
  Verdict: { enactable: false, reverses_behavior_index: null, reason: "The 'if' is something going badly. An outcome, not an act he can do in a small dose." }

=== DECISION RULE ===

When the act is his and could be done in a small dose, say enactable. Only flag an "if" that plainly isn't his move. The coachee reads this himself.
`.trim();

export async function judgeAssumptionEnactable(input: {
  assumptionText: string;
  behaviors: Array<{ index: number; text: string }>;
}): Promise<EnactableVerdict> {
  const { object } = await generateObject({
    model: utilityModel(),
    schema: EnactableSchema,
    system: ENACTABLE_SYSTEM,
    prompt: [
      `Big Assumption: ${input.assumptionText}`,
      "",
      "Behaviors:",
      ...input.behaviors.map((b) => `  ${b.index}. "${b.text}"`),
    ].join("\n"),
    maxOutputTokens: 300,
    temperature: 0.1,
  });
  const valid = new Set(input.behaviors.map((b) => b.index));
  const idx = object.reverses_behavior_index;
  return {
    enactable: object.enactable,
    reversesBehaviorIndex: idx != null && valid.has(idx) ? idx : null,
    reason: object.reason,
  };
}

/**
 * TURNED OFF 2026-09-03. Returns [] unconditionally; the flag never
 * fires and no coachee sees it.
 *
 * Why it is off rather than deleted: the question it asks is real and
 * belongs here (Vol 1 p 18, Checkpoint 2, asked of the assumption he
 * has SELECTED for testing), but the bar it was applying was the
 * wrong one and it was the least stable judge in the app.
 *
 * Wrong bar: it required the "if" to name an ACT he could take in a
 * small dose this week. The guides' standard is data, not action
 * (Vol 1 p 19: "what data, if they existed, could call the assumption
 * into doubt"), and Appendix D tests one Big Assumption with a
 * thought experiment and no behaviour change at all. So a man could
 * hold a perfectly testable belief, be unable to name an act, and be
 * told he was stuck.
 *
 * Worse, it was a dead end with no exit. Nothing downstream blocks on
 * it, so the red box could not be cleared and could not be acted on,
 * and if he carried on to test design the SMART review then critiqued
 * his TEST while the flagged assumption sat unmentioned one column up.
 *
 * The prompt below (ENACTABLE_SYSTEM) has been rewritten to the data
 * standard for whenever this is revived, and judgeAssumptionEnactable
 * still works if called directly. Turning it back on is deleting the
 * early return.
 */
export async function checkAssumptionEnactable(_input: {
  assumptions: ItcAssumption[];
  behaviors: ItcBehavior[];
}): Promise<Finding[]> {
  return [];
}

// checkAssumptionsHaveAnEnactableIf lived here: a column-wide check
// that flagged EVERY assumption when it judged that none had an "if"
// he could go do. Removed 2026-09-03.
//
// Appendix D puts the action in the TEST, not in the assumption. Its
// test-design table reads "My Big Assumption Says" / "So I Will
// (Change my Behavior This Way)", and the worked rows are "I don't
// believe I can ever be skillful at managing my anger" -> "Take an
// anger management course", and "My self-worth is based on how others
// view me" -> "I will engage in some thought experiments". Neither
// assumption carries an "if" or an action, and the guides treat both
// as testable. Holding Column 5 to a bar the guides set in Chapter 6
// is the same category error as the identity bar removed in f5a89cb.
//
// checkAssumptionEnactable above asks the same question where the
// guides ask it: of the ONE assumption he has selected for testing
// (Vol 1 p 18, Checkpoint 2), which is the moment it is live.
//
// It was also the least stable judge here. As an LLM call on the
// audit path only, it passed a column on "Hone this map" and failed
// the same text on a page load 100 seconds later, because a reload
// regenerates the review and takes a fresh sample.


// ---------------------------------------------------------------------------
// Identity carried from the commitments — drafter verification bar
// ---------------------------------------------------------------------------

/**
 * Role nouns from the commitments an assumption holds up. Commitments
 * are canonical "I'm also committed to never being the [role] who …"
 * (ensureCommitmentStem + the drafter's mirror form), so the role is
 * mechanically extractable. Self-label commitments ("never being a
 * fraud") contribute the label. Returns lowercase, de-duplicated.
 */
export function extractIdentityNouns(commitmentTexts: string[]): string[] {
  const out = new Set<string>();
  for (const text of commitmentTexts) {
    for (const m of text.matchAll(/\b(?:the|a|an)\s+([a-z][a-z\-\/']*?)\s+(?:who|that|whose)\b/gi)) {
      const noun = m[1].toLowerCase();
      if (noun.length >= 3) out.add(noun);
    }
    for (const m of text.matchAll(/\b(fraud|fake|phony|failure|coward|imposter|impostor)\b/gi)) {
      out.add(m[1].toLowerCase());
    }
  }
  return [...out];
}

export type IdentityKeptResult = {
  kept: boolean;
  /** Nouns the draft had to carry. Empty when nothing was extractable,
   *  in which case kept=true (fail open: no bar, no rejection). */
  expected: string[];
  reason: string;
};

/**
 * Deterministic check that a drafted or rewritten assumption names
 * the identity its commitments vow against, in the coachee's own
 * nouns. Kegan/Lahey Vol 1 p 27: the wording has to "keep the yuk in
 * it from the fear box." The drift this catches: a rewrite of the
 * root that ends on "the man who's been faking it" when every linked
 * commitment says "the coach who…" / "the father who…". Zero LLM
 * cost. Companion to checkAssumptionLogicalConsistency in rubric.ts
 * and the same bar for the fresh drafter and rewrite mode.
 */
export function checkAssumptionKeepsCommitmentIdentity(input: {
  assumptionText: string;
  commitmentTexts: string[];
}): IdentityKeptResult {
  const expected = extractIdentityNouns(input.commitmentTexts);
  if (expected.length === 0) {
    return { kept: true, expected, reason: "no identity noun to carry" };
  }
  const hay = input.assumptionText.toLowerCase();
  const hit = expected.find((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\b`).test(hay));
  if (hit) {
    return { kept: true, expected, reason: `carries "${hit}"` };
  }
  return {
    kept: false,
    expected,
    reason: `The "then" doesn't name the identity his commitments vow against. Use his own noun: ${expected.map((n) => `"the ${n} who…"`).join(" / ")}.`,
  };
}

// -------------------------------------------------------------------------
// The assumption must not be the worry said again
// -------------------------------------------------------------------------
//
// Observed 2026-09-02. Worry: "I worry that if I said the price and
// waited, they'd see I'm not worth what I'm charging." Offered
// assumption: "I assume that if I say the price and wait, then they'd
// see I'm not worth it and I'd be the consultant who's been charging
// more than he's worth." Same act, same dread, stem swapped.
//
// It was not the model going off-script. reviseAssumption's prompt
// told it "antecedent_act must be the coachee doing the OPPOSITE of
// one of his behaviors", and that IS the worry's if-clause, so the
// consequent had nowhere to go but the worry's. The design produced
// the restatement.
//
// The guides anchor the "if" somewhere else: on the COMMITMENT being
// violated. Every worked example does it (see
// src/lib/itc/guide-examples.ts):
//
//   "not becoming my brother (Kurt)"
//     -> "I assume that if I am bragging, I am just like Kurt."
//   "always feeling the freedom of having lots of options"
//     -> "I assume that if I don't have lots of options, I will feel
//        resentful, angry, impotent, and stressed."
//
// The act in the "if" is the vow being broken, not the behavior being
// reversed. That is what makes Column 5 a different sentence from
// Column 3 rather than a rewording of it.
//
// This check is the backstop, not the fix: the fix is the anchor.
// Deterministic on purpose. The failure is structural (the assumption
// covers the worry's own content words), so a regex-level test is
// cheaper than another model call, explains itself in the feedback,
// and cannot drift.

/** Words carrying no topic: shared by every entry, so they say nothing
 *  about whether two sentences are the same sentence. */
const RESTATE_STOPWORDS = new Set([
  "i", "im", "id", "ive", "me", "my", "myself", "we", "our",
  "a", "an", "the", "this", "that", "there", "it", "its",
  "and", "or", "but", "if", "then", "so", "as", "than", "of", "to",
  "in", "on", "at", "for", "with", "by", "from", "into", "about",
  "is", "am", "are", "was", "were", "be", "been", "being",
  "do", "dont", "does", "did", "have", "has", "had",
  "will", "would", "wont", "can", "cant", "could", "should",
  "not", "no", "never", "ever", "just", "even", "more", "most",
  "what", "who", "whos", "when", "where", "how", "why",
  "worry", "worries", "assume", "assumption", "committed", "commit",
  "they", "theyd", "them", "he", "hes", "him", "she", "shes", "her",
  "you", "your", "up", "out", "over",
]);

/** Crude stem so "charging"/"charged"/"charge" collide, and the
 *  handful of irregulars these entries actually use. */
const RESTATE_IRREGULARS: Record<string, string> = {
  said: "say",
  says: "say",
  saw: "see",
  seen: "see",
  told: "tell",
  felt: "feel",
  kept: "keep",
  lost: "lose",
  went: "go",
};

function restateStem(word: string): string {
  const w = RESTATE_IRREGULARS[word] ?? word;
  return w
    .replace(/ing$/, "")
    .replace(/ed$/, "")
    .replace(/e?s$/, "")
    .replace(/(.)\1$/, "$1");
}

function restateContentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().replace(/[’']/g, "").split(/[^a-z]+/)) {
    if (!raw || RESTATE_STOPWORDS.has(raw)) continue;
    const stem = restateStem(raw);
    if (stem.length >= 3) out.add(stem);
  }
  return out;
}

export type RestateVerdict = { restates: boolean; coverage: number; reason: string };

/**
 * True when the assumption is the paired worry wearing a different
 * stem. Measures how much of the WORRY the assumption reproduces, not
 * the other way round: an assumption is allowed to be longer and to
 * bring its own words, but it is not allowed to carry the worry whole.
 *
 * Threshold is deliberately high (80%). Sharing the map's nouns is
 * normal and expected — both entries are about the same part of his
 * life — so only near-total reproduction counts. Short worries are
 * skipped: with three content words, coincidence is likely.
 */
export function checkAssumptionRestatesWorry(input: {
  assumptionText: string;
  worryText: string;
}): RestateVerdict {
  const worry = restateContentWords(input.worryText);
  const assumption = restateContentWords(input.assumptionText);
  if (worry.size < 4) {
    return { restates: false, coverage: 0, reason: "worry too short to compare" };
  }
  let shared = 0;
  for (const w of worry) if (assumption.has(w)) shared += 1;
  const coverage = shared / worry.size;
  if (coverage < 0.8) {
    return { restates: false, coverage, reason: "assumption stands on its own words" };
  }
  return {
    restates: true,
    coverage,
    reason:
      `This is the worry again with a different opening. The worry already says what he fears if he does the opposite. ` +
      `A Big Assumption says what has to be TRUE for the vow to feel necessary, so put the COMMITMENT BEING BROKEN in the "if" ` +
      `(the guides: "if I am bragging…", "if I don't have lots of options…"), not the behavior being reversed. ` +
      `The paired worry, for contrast: "${input.worryText}"`,
  };
}
