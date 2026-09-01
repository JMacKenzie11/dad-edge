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
import { DEPTH_THRESHOLD, type Finding } from "./types";

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
    const detail = worry.rubric_reason
      ? `Worry hasn't reached identity depth yet. Rubric reason: ${worry.rubric_reason}`
      : "Worry hasn't reached identity depth yet. The fear needs to land on who he'd be, not on the immediate consequence.";
    findings.push({
      entryRef: { table: "worries", id: worry.id },
      issueType: "depth_shortfall_worry",
      severity: "critical",
      actualText: worry.text,
      detail,
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
 * could witness. Sharper form flips to external witness ("she'd see...",
 * "she'd say...").
 *
 * Trip only when the interior verb is followed by a self-referential
 * object ("I", "my", "mine", "myself"). Cuts false positives like "I'd
 * have to see her" where the object is another person, not a self-truth.
 */
const INTERIOR_WITNESS_WORRY_RE =
  /\bI\s?['\u2019]?d\s+(?:have\s+to\s+)?(?:see|know|feel|face|admit|hear|realize|understand|accept)\s+(?:that\s+)?(?:I\b|my\b|mine\b|myself\b)/i;

function pickExternalPronounForWorries(
  otherWorries: ItcWorry[],
  behaviors: ItcBehavior[],
): string {
  const corpus = [
    ...otherWorries.map((w) => w.text),
    ...behaviors.map((b) => b.text),
  ].join(" ");
  if (/\b(she'?d|she'?ll|she\s+would|\bshe\s+says\b|\bshe\b|her\b)/i.test(corpus)) {
    return "she'd";
  }
  if (/\b(he'?d|he'?ll|he\s+would|\bhe\s+says\b|\bhe\b|him\b)/i.test(corpus)) {
    return "he'd";
  }
  if (/\bmy\s+team\b|\bthey\b|\bthem\b/i.test(corpus)) {
    return "they'd";
  }
  return "they'd";
}

export async function checkInteriorWitnessInWorries(input: {
  worries: ItcWorry[];
  behaviors?: ItcBehavior[];
}): Promise<Finding[]> {
  const behaviors = input.behaviors ?? [];
  const findings: Finding[] = [];
  for (const worry of input.worries) {
    if (!INTERIOR_WITNESS_WORRY_RE.test(worry.text)) continue;
    const others = input.worries.filter((w) => w.id !== worry.id);
    const pronoun = pickExternalPronounForWorries(others, behaviors);
    findings.push({
      entryRef: { table: "worries", id: worry.id },
      issueType: "interior_witness_worry",
      severity: "moderate",
      actualText: worry.text,
      detail: `Worry uses an interior-witness verb applied to a self-truth. The identity landing lives inside the coachee's head rather than in something the outside world could witness. The sharper form flips to external witness — instead of "I'd have to see/know/face...", "${pronoun} see..." or "${pronoun} say it out loud..." — so the outside world is the one who registers it.`,
    });
  }
  return findings;
}

