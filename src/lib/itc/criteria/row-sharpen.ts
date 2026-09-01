/**
 * Row-level findings: the checks that can run on ONE entry with no
 * LLM call. Used at save time so the box under the row shows the
 * same lines the column review and hone audit would.
 *
 *   worry       → depth (stored score) + interior-witness regex
 *   commitment  → depth + mirrors-worry bool + interior-witness regex
 *   assumption  → depth + vague-then regex
 *   behavior    → depth
 *
 * Cross-entry checks (underwrite, coverage, enactable) need the
 * whole column and an LLM judge. They run in the column review and
 * the hone waterfall, and fixes.ts writes their result back onto the
 * row so the box picks them up too.
 *
 * These functions return Finding[]; src/lib/itc/fixes.ts turns that
 * into the persisted `sharpen_text` + `suggested_fix` pair.
 */

import type {
  ItcAssumption,
  ItcBehavior,
  ItcCommitment,
  ItcWorry,
} from "../maps";
import { checkAssumptionDepth, checkVagueAssumptionThenClause } from "./assumptions";
import { checkBehaviorDepth } from "./behaviors";
import {
  checkCommitmentDepth,
  checkCommitmentMirrorsWorry,
  checkInteriorWitnessInCommitments,
} from "./commitments";
import type { Finding } from "./types";
import { checkInteriorWitnessInWorries, checkWorryDepth } from "./worries";

export async function rowFindingsForWorry(input: {
  worry: ItcWorry;
  behaviors: ItcBehavior[];
}): Promise<Finding[]> {
  const [depth, iw] = await Promise.all([
    checkWorryDepth({ worries: [input.worry] }),
    checkInteriorWitnessInWorries({
      worries: [input.worry],
      behaviors: input.behaviors,
    }),
  ]);
  return [...depth, ...iw];
}

export async function rowFindingsForCommitment(input: {
  commitment: ItcCommitment;
  worry: ItcWorry;
}): Promise<Finding[]> {
  const [depth, mirror, iw] = await Promise.all([
    checkCommitmentDepth({ commitments: [input.commitment] }),
    checkCommitmentMirrorsWorry({
      commitments: [input.commitment],
      worries: [input.worry],
    }),
    checkInteriorWitnessInCommitments({ commitments: [input.commitment] }),
  ]);
  return [...depth, ...mirror, ...iw];
}

export async function rowFindingsForAssumption(input: {
  assumption: ItcAssumption;
}): Promise<Finding[]> {
  const [depth, vague] = await Promise.all([
    checkAssumptionDepth({ assumptions: [input.assumption] }),
    checkVagueAssumptionThenClause({ assumptions: [input.assumption] }),
  ]);
  return [...depth, ...vague];
}

export async function rowFindingsForBehavior(input: {
  behavior: ItcBehavior;
}): Promise<Finding[]> {
  return checkBehaviorDepth({ behaviors: [input.behavior] });
}
