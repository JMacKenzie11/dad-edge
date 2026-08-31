/**
 * Column 3 (worries) criteria.
 *
 * Three checks:
 *  - depth_shortfall_worry: worry hasn't reached identity depth
 *    (reads stored rubric score set at save time by scoreWorryDepth).
 *  - interior_witness_worry: worry uses interior-witness verbs applied
 *    to a self-truth ("I'd have to see I'm...") instead of what the
 *    outside world would witness.
 *  - worry_commitment_redundancy: worry names the same identity fear
 *    a competing commitment already carries. Fires only on non-paired
 *    combinations (worry.id ≠ commitment.worry_id).
 */

import { generateObject } from "ai";
import { z } from "zod";
import { utilityModel } from "@/lib/model-config";
import type { ItcBehavior, ItcCommitment, ItcWorry } from "../maps";
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

// ---------------------------------------------------------------------------
// worry_commitment_redundancy
// ---------------------------------------------------------------------------

const RedundancySchema = z.object({
  redundant: z.boolean(),
  reason: z.string().max(400).optional(),
});

const REDUNDANCY_SYSTEM = `
You judge whether a worry and a competing commitment name the same identity fear in different framing (worry-language vs commitment-language).

Return redundant=true only when both entries clearly point at the same identity concern (the map is bigger than it is — one is the shallow version of the other). Return redundant=false when they name distinct concerns, even if the framing overlaps.

When in doubt, redundant=false. If redundant=true, give a short reason MAX 25 WORDS. Name the shared identity fear in one clause — don't enumerate "worry says X, commitment says Y" (the audit already quotes both). Terseness matters — this reason renders inline and long reasons overwhelm the reader.
`.trim();

export async function checkWorryCommitmentRedundancy(input: {
  worries: ItcWorry[];
  commitments: ItcCommitment[];
}): Promise<Finding[]> {
  const findings: Finding[] = [];
  const pairs: Array<{ worry: ItcWorry; commitment: ItcCommitment }> = [];
  for (const worry of input.worries) {
    for (const commitment of input.commitments) {
      if (commitment.worry_id === worry.id) continue;
      pairs.push({ worry, commitment });
    }
  }
  await Promise.all(
    pairs.map(async ({ worry, commitment }) => {
      try {
        const { object } = await generateObject({
          model: utilityModel(),
          schema: RedundancySchema,
          system: REDUNDANCY_SYSTEM,
          prompt: [
            `Worry: ${worry.text}`,
            `Competing commitment: ${commitment.text}`,
          ].join("\n"),
          maxOutputTokens: 300,
          temperature: 0.1,
        });
        if (!object.redundant) return;
        findings.push({
          entryRef: { table: "worries", id: worry.id },
          issueType: "worry_commitment_redundancy",
          severity: "observation",
          actualText: worry.text,
          detail: object.reason
            ? `Worry duplicates the identity concern in a commitment on the map. ${object.reason}`
            : "Worry duplicates a concern already carried by one of the competing commitments. The map reads as if it holds more distinct fears than it does.",
          suggestedFix:
            "Either push the worry deeper into a different identity concern, or drop it so the map isn't doubled up.",
          relatedEntryRef: { table: "commitments", id: commitment.id },
          relatedText: commitment.text,
        });
      } catch (err) {
        console.warn(
          "[itc criteria] checkWorryCommitmentRedundancy failed (worry=%s commitment=%s): %s",
          worry.id,
          commitment.id,
          err instanceof Error ? err.message : String(err),
        );
      }
    }),
  );
  return findings;
}
