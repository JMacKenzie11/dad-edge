/**
 * Column 4 (competing commitments) criteria.
 *
 * Three checks:
 *  - depth_shortfall_commitment: commitment hasn't reached identity
 *    depth (reads stored rubric score set at save time).
 *  - interior_witness_commitment: commitment is framed around avoiding
 *    a feeling / interior reckoning instead of naming the identity
 *    plus observable action.
 *  - missing_commitment_stem: commitment doesn't start with the
 *    canonical "I'm also committed to" stem. NOTE: this check is
 *    currently unreachable because `ensureCommitmentStem` normalizes
 *    at save time. Kept here for behavior-preserving refactor; task 6
 *    deletes it.
 */

import type { ItcCommitment } from "../maps";
import { COMMITMENT_STEM, ensureCommitmentStem } from "../stage";
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
    const detail = commitment.rubric_reason
      ? `Commitment hasn't reached identity depth yet. Rubric reason: ${commitment.rubric_reason}`
      : "Commitment hasn't reached identity depth yet. The vow needs to name the identity being protected and what the outside world would see.";
    findings.push({
      entryRef: { table: "commitments", id: commitment.id },
      issueType: "depth_shortfall_commitment",
      severity: "critical",
      actualText: commitment.text,
      detail,
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
      detail:
        "Commitment is framed around avoiding a feeling or an interior reckoning. The sharper form names the identity being protected AND what the outside world would see the coachee take the hit on — 'never being the [specific role] who [observable action]' rather than 'never seeing / knowing / feeling / facing X'.",
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// missing_commitment_stem (unreachable — see file-level comment)
// ---------------------------------------------------------------------------

const COMMITMENT_STEM_RE = /^\s*i\s?['\u2019]?m\s+also\s+committed\s+to\b/i;

export async function checkMissingCommitmentStem(input: {
  commitments: ItcCommitment[];
}): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const commitment of input.commitments) {
    if (COMMITMENT_STEM_RE.test(commitment.text)) continue;
    findings.push({
      entryRef: { table: "commitments", id: commitment.id },
      issueType: "missing_commitment_stem",
      severity: "moderate",
      actualText: commitment.text,
      detail: `Commitment does not start with the canonical stem "${COMMITMENT_STEM}...". The "also" is load-bearing because it names this as the SECOND commitment sitting next to the improvement goal.`,
      suggestedFix: ensureCommitmentStem(commitment.text),
    });
  }
  return findings;
}
