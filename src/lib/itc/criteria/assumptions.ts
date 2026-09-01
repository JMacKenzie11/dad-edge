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
 *  safely" → assumption_not_enactable
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
import { DEPTH_THRESHOLD, type Finding } from "./types";

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
      severity: "critical",
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
      // One link can't be "the wrong one of the set". Coverage of a
      // single commitment is the drafter's job; nothing to judge.
      if (linked.length < 2) return;
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
You check whether a Big Assumption's "if" half is something the coachee could go do himself, in a small dose, this week. Kegan/Lahey (Coach's Guide Vol 1 p 21): a testable assumption is one where the "if" condition has degrees to it so it can be enacted safely.

You receive the assumption and a numbered list of the coachee's own behaviors (the moves he makes that work against his goal). The strongest "if" is him doing the opposite of one of those behaviors.

enactable = true when the "if" names an act he would take (stay in the room, send it without rewriting it, let the client answer first, tell her no). Conditions attached to the act are fine ("when money is low", "while she's angry"). Degrees are fine ("one message", "for ten minutes").

enactable = false when the "if" is:
- an outcome, not an act ("if I fail", "if something important goes badly", "if I'm not perfect")
- someone else's move ("if they don't make the change", "if my team pushes back")
- all-or-nothing with no small dose ("if I never sold again")

reverses_behavior_index: when enactable and the act is the opposite of one listed behavior, give that behavior's number. Otherwise null.

reason: under 25 words, plain words, naming what the "if" is (an outcome, someone else's move) when not enactable.

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

export async function checkAssumptionEnactable(input: {
  assumptions: ItcAssumption[];
  behaviors: ItcBehavior[];
}): Promise<Finding[]> {
  const behaviors = input.behaviors
    .filter((b) => b.selected)
    .map((b, i) => ({ index: i + 1, text: b.text }));
  const findings: Finding[] = [];
  await Promise.all(
    input.assumptions.map(async (assumption) => {
      try {
        const verdict = await judgeAssumptionEnactable({
          assumptionText: assumption.text,
          behaviors,
        });
        if (verdict.enactable) return;
        findings.push({
          entryRef: { table: "assumptions", id: assumption.id },
          issueType: "assumption_not_enactable",
          severity: "moderate",
          actualText: assumption.text,
          detail: ADVICE.assumption_not_enactable,
          suggestedFix: assumption.suggested_fix ?? undefined,
        });
      } catch (err) {
        console.warn(
          "[itc criteria] checkAssumptionEnactable failed (assumption=%s): %s",
          assumption.id,
          err instanceof Error ? err.message : String(err),
        );
      }
    }),
  );
  return findings;
}
