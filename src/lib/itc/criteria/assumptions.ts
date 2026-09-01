/**
 * Column 5 (Big Assumptions) criteria.
 *
 * Five checks:
 *  - depth_shortfall_assumption: assumption hasn't finished through to
 *    identity landing (reads stored rubric score).
 *  - vague_assumption_then_clause: then-clause gestures at an identity
 *    ("the man I'm terrified of") without naming it.
 *  - assumption_uncovered_commitment: a commitment has no linked
 *    assumption — untestable belief.
 *  - assumption_commitment_drift: assumption's if-clause names a
 *    different scenario than what the linked commitment protects.
 *  - assumption_overload: one assumption linked to 2+ commitments
 *    that name distinct identity concerns.
 */

import { generateObject } from "ai";
import { z } from "zod";
import { utilityModel } from "@/lib/model-config";
import type {
  ItcAssumption,
  ItcAssumptionCommitment,
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
    const detail = assumption.rubric_reason
      ? `${ADVICE.depth_shortfall_assumption} Rubric reason: ${assumption.rubric_reason}`
      : ADVICE.depth_shortfall_assumption;
    findings.push({
      entryRef: { table: "assumptions", id: assumption.id },
      issueType: "depth_shortfall_assumption",
      severity: "critical",
      actualText: assumption.text,
      detail,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// vague_assumption_then_clause
// ---------------------------------------------------------------------------

const VAGUE_THEN_CLAUSE_PATTERNS: RegExp[] = [
  /\bthe\s+(?:person|man|husband|father|coach|guy|dad)\s+(?:I\s?['\u2019]?m\s+terrified|I\s+fear|I\s+don['\u2019]?t\s+want\s+to|I\s?['\u2019]?d\s+hate\s+to)\b/i,
  /\bwhat\s+I(?:\s?['\u2019]?m\s+afraid|\s+fear)\b/i,
  /\bI\s?['\u2019]?d\s+become\s+(?:what|who)\s+I\b/i,
  /\bI\s?['\u2019]?d\s+be\s+the\s+(?:person|man|guy|dad|husband|father|coach)\s+I\b/i,
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
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// assumption_uncovered_commitment
// ---------------------------------------------------------------------------

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
      severity: "critical",
      actualText: commitment.text,
      detail: ADVICE.assumption_uncovered_commitment,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// assumption_commitment_drift
// ---------------------------------------------------------------------------

const DriftSchema = z.object({
  drifted: z.boolean(),
  commitment_identity: z.string().max(120).optional(),
  assumption_scenario: z.string().max(120).optional(),
});

const DRIFT_SYSTEM = `
You judge whether a Big Assumption's if-clause names the exact scenario the linked competing commitment is protecting against. Both fields are quoted verbatim from the coachee's map.

Two things need to match for drifted=false:
1. The commitment names an identity the coachee is protecting (a person, role, or self-perception).
2. The assumption's if-clause names the specific SCENARIO that, if it happened, would expose that same identity as true / real / seen. If the assumption's if-clause is about a DIFFERENT scenario than what the commitment is protecting against, they've drifted.

Don't require exact word-match. Semantic alignment is enough. But the scenario the assumption's if-clause names must be the one that would expose the specific identity the commitment protects.

Return { drifted: false } when the pair is aligned.

Return { drifted: true, commitment_identity: "<short noun phrase>", assumption_scenario: "<short noun phrase>" } when they name different scenarios. Each label MAX 10 WORDS. These are structured labels — the renderer synthesizes them into "The assumption is about [scenario]; the commitment protects [identity]." Do NOT write full sentences. Do NOT restate the commitment or assumption text. Just the two identifying phrases.

=== WORKED EXAMPLES ===

Example 1 (drifted=false — clean pair):
  Commitment: "I'm also committed to never becoming the husband who hurts her."
  Assumption: "I assume that if I stay in the room while she's angry, then I'd lose control and be the husband who hurts her."
  Verdict: { drifted: false }

Example 2 (drifted=true — different scenarios):
  Commitment: "I'm also committed to never being the guy who isn't enough for her."
  Assumption: "I assume that if I stop protecting her from my failures, then she'd see the pattern and I'd be the husband I'm terrified I am."
  Verdict: { drifted: true, commitment_identity: "the insufficient partner (not enough for her)", assumption_scenario: "revealing failures / stopping protection" }

Example 3 (drifted=false — semantic alignment despite different wording):
  Commitment: "I'm also committed to never letting my team see I don't have the answer."
  Assumption: "I assume that if I admit I don't know something in a meeting, then they'll stop trusting my judgment."
  Verdict: { drifted: false }

Example 4 (drifted=true — 3+ commitments case, one call at a time — same assumption_scenario returned each call):
  Assumption: "I assume that if something important goes badly and I didn't do everything within my power to prevent it, then it proves I can't be trusted."
  Commitment (call 1): "I'm also committed to avoiding the feeling that I could see the answer but was unable to help."
    Verdict: { drifted: true, commitment_identity: "the helper who couldn't guide when needed", assumption_scenario: "failing to prevent bad outcomes" }
  Commitment (call 2): "I'm also committed to protecting my identity as someone who consistently delivers at a high level."
    Verdict: { drifted: true, commitment_identity: "the consistent high performer", assumption_scenario: "failing to prevent bad outcomes" }
  (The scenario stays consistent across calls because it's derived from the same assumption. The identity varies because it's the commitment that differs.)

=== DECISION RULE ===

Bias for calling drift when the identity concern the commitment protects doesn't match the specific scenario the assumption's if-clause names. Don't default to "aligned" out of caution. False negatives on drift let real map problems slip through; false positives are cheap to review.
`.trim();

export async function checkAssumptionCommitmentDrift(input: {
  assumptions: ItcAssumption[];
  commitments: ItcCommitment[];
  links: ItcAssumptionCommitment[];
}): Promise<Finding[]> {
  const commitmentById = new Map(input.commitments.map((c) => [c.id, c]));
  const assumptionById = new Map(input.assumptions.map((a) => [a.id, a]));
  const findings: Finding[] = [];
  await Promise.all(
    input.links.map(async (link) => {
      const assumption = assumptionById.get(link.assumption_id);
      const commitment = commitmentById.get(link.commitment_id);
      if (!assumption || !commitment) return;
      try {
        const { object } = await generateObject({
          model: utilityModel(),
          schema: DriftSchema,
          system: DRIFT_SYSTEM,
          prompt: [
            `Competing commitment: ${commitment.text}`,
            `Big Assumption: ${assumption.text}`,
          ].join("\n"),
          maxOutputTokens: 300,
          temperature: 0.1,
        });
        if (!object.drifted) return;
        findings.push({
          entryRef: { table: "assumptions", id: assumption.id },
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          actualText: assumption.text,
          detail:
            "Assumption's if-clause and its linked commitment name different concerns.",
          suggestedFix:
            "Either sharpen the assumption so its if-clause names the exact scenario the commitment protects against, or the pair may be pointing at a missing commitment that hasn't been named yet.",
          relatedEntryRef: { table: "commitments", id: commitment.id },
          relatedText: commitment.text,
          assumptionScenario: object.assumption_scenario,
          commitmentIdentity: object.commitment_identity,
        });
      } catch (err) {
        console.warn(
          "[itc criteria] checkAssumptionCommitmentDrift failed (assumption=%s commitment=%s): %s",
          assumption.id,
          commitment.id,
          err instanceof Error ? err.message : String(err),
        );
      }
    }),
  );
  return findings;
}

// ---------------------------------------------------------------------------
// assumption_overload
// ---------------------------------------------------------------------------

const OverloadSchema = z.object({
  same_concern: z.boolean(),
  reason: z.string().max(400).optional(),
});

const OVERLOAD_SYSTEM = `
You judge whether a set of competing commitments (all linked to the same Big Assumption) name the same underlying identity concern, or distinct concerns.

Return { same_concern: true } when every commitment in the set is protecting the same identity fear in different wording (e.g. "the guy who fails his family" and "the man who can't provide" — same identity, two phrasings).

Return { same_concern: false } when the commitments name distinct identities the coachee is protecting — even if the identities are related, if they're distinguishable (different nouns, different consequences, different scenes), they're distinct concerns and the assumption is carrying more than one belief.

For same_concern=false, give reason MAX 30 WORDS. Name the identities in short form and one line naming what distinguishes them. DO NOT enumerate "Commitment 1 protects X, Commitment 2 protects Y" — that's how the coachee's map is already structured; the reason should name the KEY distinction, not walk each pair. Terseness matters — this reason renders inline in an audit and long reasons overwhelm the reader.

=== WORKED EXAMPLES ===

Example 1 (same_concern=true — genuine synonyms):
  Commitments:
    1. "I'm also committed to never being seen as the guy who fails his family."
    2. "I'm also committed to never being the man who couldn't provide when it mattered."
  Verdict: { same_concern: true }

Example 2 (same_concern=false — distinct identities, 2 commitments):
  Commitments:
    1. "I'm also committed to never seeing that my defensive behaviour is the problem."
    2. "I'm also committed to never being the guy who isn't enough for her."
  Verdict: { same_concern: false, reason: "Distinct identities: 'defensiveness IS the problem' vs 'insufficient partner'. Different scenarios expose each." }

Example 3 (same_concern=false — related but distinguishable):
  Commitments:
    1. "I'm also committed to never being the boss who makes his team scared to speak up."
    2. "I'm also committed to never being the boss who loses his temper at work."
  Verdict: { same_concern: false, reason: "Related but distinct: 'intimidating leader' (systemic pattern) vs 'loses-control' (single-moment failure)." }

Example 4 (same_concern=false — 3+ commitments, don't enumerate):
  Commitments:
    1. "I'm also committed to never being the coach who can't help."
    2. "I'm also committed to never being the professional whose work is questioned."
    3. "I'm also committed to never being the provider who didn't work hard enough."
  Verdict: { same_concern: false, reason: "Three distinct identities across three domains: helping (competence), reputation (quality), provision (effort). Different scenarios and consequences." }

=== DECISION RULE ===

Bias for same_concern=false when you can name distinct identities in the commitments. Overload findings surface real map problems (assumption carrying too much weight); missing them lets the coachee keep testing one thing when they're actually running multiple. False positives on overload are cheap — the coachee reviews and confirms or dismisses.
`.trim();

export async function checkAssumptionOverload(input: {
  assumptions: ItcAssumption[];
  commitments: ItcCommitment[];
  links: ItcAssumptionCommitment[];
}): Promise<Finding[]> {
  const commitmentById = new Map(input.commitments.map((c) => [c.id, c]));
  const linksByAssumption = new Map<string, string[]>();
  for (const link of input.links) {
    const prev = linksByAssumption.get(link.assumption_id) ?? [];
    prev.push(link.commitment_id);
    linksByAssumption.set(link.assumption_id, prev);
  }
  const findings: Finding[] = [];
  await Promise.all(
    input.assumptions.map(async (assumption) => {
      const commitmentIds = linksByAssumption.get(assumption.id) ?? [];
      if (commitmentIds.length < 2) return;
      const commitments = commitmentIds
        .map((id) => commitmentById.get(id))
        .filter((c): c is ItcCommitment => Boolean(c));
      if (commitments.length < 2) return;
      try {
        const { object } = await generateObject({
          model: utilityModel(),
          schema: OverloadSchema,
          system: OVERLOAD_SYSTEM,
          prompt: [
            `Big Assumption: ${assumption.text}`,
            "Linked competing commitments:",
            ...commitments.map((c, i) => `  ${i + 1}. ${c.text}`),
          ].join("\n"),
          maxOutputTokens: 300,
          temperature: 0.1,
        });
        if (object.same_concern) return;
        findings.push({
          entryRef: { table: "assumptions", id: assumption.id },
          issueType: "assumption_overload",
          severity: "moderate",
          actualText: assumption.text,
          detail: object.reason
            ? `Assumption is carrying multiple distinct identity concerns. ${object.reason}`
            : "Assumption is linked to commitments that name distinct identity concerns. One belief can't underwrite them all cleanly.",
          suggestedFix:
            "Additional Big Assumptions may need to be named so each commitment has an assumption pointed at its own specific concern.",
        });
      } catch (err) {
        console.warn(
          "[itc criteria] checkAssumptionOverload failed (assumption=%s): %s",
          assumption.id,
          err instanceof Error ? err.message : String(err),
        );
      }
    }),
  );
  return findings;
}
