/**
 * Column 3 (worries) criteria.
 *
 * Two checks:
 *  - depth_shortfall_worry: worry hasn't reached identity depth
 *    (reads stored rubric score set at save time by scoreWorryDepth).
 *  - interior_witness_worry: worry uses interior-witness verbs applied
 *    to a self-truth ("I'd have to see I'm...") instead of what the
 *    outside world would witness.
 *
 * Retired 2026-09-01: worry_redundancy (pairwise LLM check). It was
 * the only observation-severity finding on the map, and observations
 * were retired the same day — the self-service coach only surfaces
 * critical + moderate issues. Running an LLM per pair whose output
 * gets filtered out was pure token waste.
 */

import type { ItcBehavior, ItcWorry } from "../maps";
import { ADVICE } from "./advice";
import { DEPTH_THRESHOLD, depthSeverity, type Finding } from "./types";

// ---------------------------------------------------------------------------
// depth_shortfall_worry
// ---------------------------------------------------------------------------

export async function checkWorryDepth(input: {
  worries: ItcWorry[];
}): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const worry of input.worries) {
    if (worry.depth_score == null) continue;
    if (worry.depth_score >= DEPTH_THRESHOLD) continue;
    // detail = the rubric's own one-line reason (specific to this
    // worry, scrubbed at save time) or the canonical line when the
    // row predates rubric reasons. Same text on every surface.
    findings.push({
      entryRef: { table: "worries", id: worry.id },
      issueType: "depth_shortfall_worry",
      severity: depthSeverity(worry.depth_score),
      actualText: worry.text,
      detail: worry.rubric_reason?.trim() || ADVICE.depth_shortfall_worry,
      suggestedFix: worry.suggested_fix ?? undefined,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// interior_witness_worry
// ---------------------------------------------------------------------------

/**
 * Interior-witness verbs applied to a self-truth: "I'd have to see I've
 * been running", "I'd know I chose myself". The identity landing lives
 * inside the coachee's head rather than in something the outside world
 * could witness.
 *
 * Trip only when the interior verb is followed by a self-referential
 * object ("I", "my", "mine", "myself"). Cuts false positives like "I'd
 * have to see her" where the object is another person, not a self-truth.
 *
 * The fix direction lives in ADVICE.interior_witness_worry — single
 * source of truth used by the auditor, save-time sharpen, and the
 * worry-drafter's verify-loop feedback. Historically this file owned
 * a hand-written detail string that suggested "she'd see..." — that
 * violated scoreWorryDepth.is_first_person_felt, and the resulting
 * coach-vs-coach contradiction (audit push → depth-rubric reject)
 * is exactly the class of bug the ADVICE module prevents.
 */
const INTERIOR_WITNESS_WORRY_RE =
  /\bI\s?['\u2019]?d\s+(?:have\s+to\s+)?(?:see|know|feel|face|admit|hear|realize|understand|accept)\s+(?:that\s+)?(?:I\b|my\b|mine\b|myself\b)/i;

export async function checkInteriorWitnessInWorries(input: {
  worries: ItcWorry[];
  behaviors?: ItcBehavior[];
}): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const worry of input.worries) {
    if (!INTERIOR_WITNESS_WORRY_RE.test(worry.text)) continue;
    findings.push({
      entryRef: { table: "worries", id: worry.id },
      issueType: "interior_witness_worry",
      severity: "moderate",
      actualText: worry.text,
      detail: ADVICE.interior_witness_worry,
      suggestedFix: worry.suggested_fix ?? undefined,
    });
  }
  return findings;
}

