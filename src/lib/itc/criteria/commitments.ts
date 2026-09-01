/**
 * Column 4 (competing commitments) criteria.
 *
 * Three checks:
 *  - depth_shortfall_commitment: commitment hasn't reached identity
 *    depth (reads stored rubric score set at save time).
 *  - commitment_doesnt_mirror_worry: commitment doesn't carry the
 *    identity/outcome its paired worry fears (reads stored rubric
 *    boolean set at save time).
 *  - interior_witness_commitment: commitment is framed around avoiding
 *    a feeling / interior reckoning instead of naming the identity
 *    plus observable action.
 */

import type { ItcCommitment, ItcWorry } from "../maps";
import { ADVICE } from "./advice";
import { DEPTH_THRESHOLD, type Finding } from "./types";

// ---------------------------------------------------------------------------
// depth_shortfall_commitment
// ---------------------------------------------------------------------------

export async function checkCommitmentDepth(input: {
  commitments: ItcCommitment[];
}): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const commitment of input.commitments) {
    if (commitment.depth_score == null) continue;
    if (commitment.depth_score >= DEPTH_THRESHOLD) continue;
    findings.push({
      entryRef: { table: "commitments", id: commitment.id },
      issueType: "depth_shortfall_commitment",
      severity: "critical",
      actualText: commitment.text,
      detail:
        commitment.rubric_reason?.trim() || ADVICE.depth_shortfall_commitment,
      suggestedFix: commitment.suggested_fix ?? undefined,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// interior_witness_commitment
// ---------------------------------------------------------------------------

const INTERIOR_WITNESS_COMMITMENT_PATTERNS: RegExp[] = [
  /\bnever\s+(?:seeing|knowing|feeling|facing|admitting|hearing|realizing|accepting)\b/i,
  /\bavoiding\s+the\s+feeling\s+that\b/i,
  /\bhaving\s+to\s+(?:see|know|believe|face|feel|admit)\b/i,
  /\bso\s+I\s+never\s+have\s+to\s+(?:see|know|believe|face|feel|admit)\b/i,
  /\bprotecting\s+myself\s+from\s+having\s+to\b/i,
];

export async function checkInteriorWitnessInCommitments(input: {
  commitments: ItcCommitment[];
}): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const commitment of input.commitments) {
    const matched = INTERIOR_WITNESS_COMMITMENT_PATTERNS.some((re) =>
      re.test(commitment.text),
    );
    if (!matched) continue;
    findings.push({
      entryRef: { table: "commitments", id: commitment.id },
      issueType: "interior_witness_commitment",
      severity: "moderate",
      actualText: commitment.text,
      detail: ADVICE.interior_witness_commitment,
      suggestedFix: commitment.suggested_fix ?? undefined,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// commitment_doesnt_mirror_worry
// ---------------------------------------------------------------------------

/**
 * Kegan/Lahey's introductory form (Vol 1 pp 26-27): the competing
 * commitment is the paired worry mirrored into "I'm also committed to
 * never <the identity/outcome the worry fears>". The rubric already
 * scores this at save time via mirrors_worry_identity and persists the
 * boolean. If the value is false, the commitment has drifted from its
 * worry — the derivation chain is broken and everything downstream
 * (assumption, test) inherits the drift. Fire critical.
 *
 * Skips when the boolean is null (legacy rows saved before the field
 * existed — no verdict, so no finding).
 */
export async function checkCommitmentMirrorsWorry(input: {
  commitments: ItcCommitment[];
  worries: ItcWorry[];
}): Promise<Finding[]> {
  const worryById = new Map(input.worries.map((w) => [w.id, w]));
  const findings: Finding[] = [];
  for (const commitment of input.commitments) {
    if (commitment.mirrors_worry_identity !== false) continue;
    const worry = worryById.get(commitment.worry_id);
    findings.push({
      entryRef: { table: "commitments", id: commitment.id },
      issueType: "commitment_doesnt_mirror_worry",
      severity: "critical",
      actualText: commitment.text,
      detail: ADVICE.commitment_doesnt_mirror_worry,
      suggestedFix: commitment.suggested_fix ?? undefined,
      relatedEntryRef: worry ? { table: "worries", id: worry.id } : undefined,
      relatedText: worry?.text,
    });
  }
  return findings;
}

