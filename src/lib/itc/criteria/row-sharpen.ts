/**
 * Row-level sharpen composition.
 *
 * Combines the depth rubric's "why depth failed" reason with the
 * row-level criteria checks (interior-witness regex, mirror-worry
 * bool, vague-then regex) into ONE sharpen text persisted on the
 * row's `rubric_reason` column and displayed inline by the "One
 * thing to sharpen" box.
 *
 * Purpose: keep the inline row feedback in sync with what the hone
 * waterfall would flag for the same entry. Before this helper, the
 * row only showed depth-based feedback — an interior-witness worry
 * or a mirror-broken commitment saved cleanly (from the row's point
 * of view) even though the hone banner would flag it.
 *
 * Cross-column checks (worry-commitment redundancy, assumption
 * drift/overload/coverage) are NOT run here. They're LLM-backed and
 * need the whole column set. They still fire in the hone waterfall
 * and end-of-column review; running them per-save would multiply
 * LLM cost per entry save.
 */

import type {
  ItcAssumption,
  ItcBehavior,
  ItcCommitment,
  ItcWorry,
} from "../maps";
import { checkVagueAssumptionThenClause } from "./assumptions";
import {
  checkCommitmentMirrorsWorry,
  checkInteriorWitnessInCommitments,
} from "./commitments";
import { checkInteriorWitnessInWorries } from "./worries";
import { DEPTH_THRESHOLD } from "./types";

/**
 * Combine depth-rubric feedback + row-level criteria findings into
 * one persisted sharpen text. Returns null when nothing needs
 * sharpening (row is clean end-to-end).
 */
export async function composeWorrySharpen(input: {
  worry: ItcWorry;
  behaviors: ItcBehavior[];
  depthReason: string;
}): Promise<string | null> {
  const parts: string[] = [];
  if ((input.worry.depth_score ?? DEPTH_THRESHOLD) < DEPTH_THRESHOLD) {
    parts.push(input.depthReason);
  }
  const iw = await checkInteriorWitnessInWorries({
    worries: [input.worry],
    behaviors: input.behaviors,
  });
  if (iw.length > 0) parts.push(iw[0].detail);
  return joinParts(parts);
}

export async function composeCommitmentSharpen(input: {
  commitment: ItcCommitment;
  worry: ItcWorry;
  depthReason: string;
}): Promise<string | null> {
  const parts: string[] = [];
  if ((input.commitment.depth_score ?? DEPTH_THRESHOLD) < DEPTH_THRESHOLD) {
    parts.push(input.depthReason);
  }
  const iw = await checkInteriorWitnessInCommitments({
    commitments: [input.commitment],
  });
  if (iw.length > 0) parts.push(iw[0].detail);
  const mirror = await checkCommitmentMirrorsWorry({
    commitments: [input.commitment],
    worries: [input.worry],
  });
  if (mirror.length > 0) parts.push(mirror[0].detail);
  return joinParts(parts);
}

export async function composeAssumptionSharpen(input: {
  assumption: ItcAssumption;
  depthReason: string;
}): Promise<string | null> {
  const parts: string[] = [];
  if ((input.assumption.depth_score ?? DEPTH_THRESHOLD) < DEPTH_THRESHOLD) {
    parts.push(input.depthReason);
  }
  const vague = await checkVagueAssumptionThenClause({
    assumptions: [input.assumption],
  });
  if (vague.length > 0) parts.push(vague[0].detail);
  return joinParts(parts);
}

/**
 * Behaviors currently only have the depth criterion at the row
 * level. Exposed as a helper so callers can use one uniform pattern.
 */
export function composeBehaviorSharpen(input: {
  depthScore: number;
  depthReason: string;
}): string | null {
  if (input.depthScore >= DEPTH_THRESHOLD) return null;
  return input.depthReason.trim() || null;
}

function joinParts(parts: string[]): string | null {
  const cleaned = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  if (cleaned.length === 0) return null;
  return cleaned.join(" · ");
}
