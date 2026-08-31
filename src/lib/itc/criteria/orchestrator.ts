/**
 * Criteria orchestrator.
 *
 * Two public entry points:
 *   - runColumnCriteria(column, input) — fires the criteria for one
 *     column. Used at end-of-column construction reviews.
 *   - runHoneWaterfall(input) — walks the map top-down (goal → worries
 *     → commitments → assumptions) and stops at the first layer with
 *     any finding. Everything downstream of a broken column is
 *     re-derived when the coachee fixes it, so critiquing downstream
 *     entries now is asking them to fix something about to change.
 *     Matches the Kegan/Lahey guide's derivation chain (Vol 1 p 4:
 *     "do the fears stay present in the Column 3 commitments? do the
 *     Big Assumptions follow from key Column 3 commitments?").
 *
 * Both entry points return typed `Finding[]` that render.ts turns into
 * prose. Same criteria functions on both sides — the construction
 * coach and the hone audit will never contradict each other.
 */

import type {
  ItcAssumption,
  ItcAssumptionCommitment,
  ItcBehavior,
  ItcCommitment,
  ItcWorry,
} from "../maps";
import { checkBehaviorDepth } from "./behaviors";
import { checkBundledGoal } from "./goal";
import {
  checkInteriorWitnessInWorries,
  checkWorryCommitmentRedundancy,
  checkWorryDepth,
} from "./worries";
import {
  checkCommitmentDepth,
  checkCommitmentMirrorsWorry,
  checkInteriorWitnessInCommitments,
} from "./commitments";
import {
  checkAssumptionCommitmentDrift,
  checkAssumptionCoverage,
  checkAssumptionDepth,
  checkAssumptionOverload,
  checkVagueAssumptionThenClause,
} from "./assumptions";
import { SEVERITY_ORDER, type Finding } from "./types";

export type ColumnName =
  | "goal"
  | "behaviors"
  | "worries"
  | "commitments"
  | "assumptions";

export const COLUMN_ORDER: readonly ColumnName[] = [
  "goal",
  "behaviors",
  "worries",
  "commitments",
  "assumptions",
] as const;

export type CriteriaInput = {
  mapId: string;
  goalText: string;
  behaviors: ItcBehavior[];
  worries: ItcWorry[];
  commitments: ItcCommitment[];
  assumptions: ItcAssumption[];
  assumptionLinks: ItcAssumptionCommitment[];
};

// ---------------------------------------------------------------------------
// Per-column criteria runners
// ---------------------------------------------------------------------------

async function runGoalCriteria(input: CriteriaInput): Promise<Finding[]> {
  return checkBundledGoal({ mapId: input.mapId, goalText: input.goalText });
}

async function runBehaviorsCriteria(
  input: CriteriaInput,
): Promise<Finding[]> {
  return checkBehaviorDepth({ behaviors: input.behaviors });
}

async function runWorriesCriteria(input: CriteriaInput): Promise<Finding[]> {
  const results = await Promise.all([
    checkWorryDepth({ worries: input.worries }),
    checkInteriorWitnessInWorries({
      worries: input.worries,
      behaviors: input.behaviors,
    }),
    checkWorryCommitmentRedundancy({
      worries: input.worries,
      commitments: input.commitments,
    }),
  ]);
  return sortFindings(results.flat());
}

async function runCommitmentsCriteria(
  input: CriteriaInput,
): Promise<Finding[]> {
  const results = await Promise.all([
    checkCommitmentDepth({ commitments: input.commitments }),
    checkCommitmentMirrorsWorry({
      commitments: input.commitments,
      worries: input.worries,
    }),
    checkInteriorWitnessInCommitments({ commitments: input.commitments }),
  ]);
  return sortFindings(results.flat());
}

async function runAssumptionsCriteria(
  input: CriteriaInput,
): Promise<Finding[]> {
  const results = await Promise.all([
    checkAssumptionDepth({ assumptions: input.assumptions }),
    checkVagueAssumptionThenClause({ assumptions: input.assumptions }),
    checkAssumptionCoverage({
      commitments: input.commitments,
      assumptions: input.assumptions,
      links: input.assumptionLinks,
    }),
    checkAssumptionCommitmentDrift({
      assumptions: input.assumptions,
      commitments: input.commitments,
      links: input.assumptionLinks,
    }),
    checkAssumptionOverload({
      assumptions: input.assumptions,
      commitments: input.commitments,
      links: input.assumptionLinks,
    }),
  ]);
  return sortFindings(results.flat());
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export async function runColumnCriteria(
  column: ColumnName,
  input: CriteriaInput,
): Promise<Finding[]> {
  switch (column) {
    case "goal":
      return runGoalCriteria(input);
    case "behaviors":
      return runBehaviorsCriteria(input);
    case "worries":
      return runWorriesCriteria(input);
    case "commitments":
      return runCommitmentsCriteria(input);
    case "assumptions":
      return runAssumptionsCriteria(input);
  }
}

export type WaterfallResult = {
  /** The first column with findings, or null if the whole map holds up. */
  column: ColumnName | null;
  findings: Finding[];
};

export async function runHoneWaterfall(
  input: CriteriaInput,
): Promise<WaterfallResult> {
  for (const column of COLUMN_ORDER) {
    const findings = await runColumnCriteria(column, input);
    if (findings.length > 0) {
      return { column, findings };
    }
  }
  return { column: null, findings: [] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}
