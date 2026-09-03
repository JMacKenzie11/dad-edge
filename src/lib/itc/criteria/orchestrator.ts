/**
 * Criteria orchestrator.
 *
 * Two public entry points:
 *   - runColumnCriteria(column, input) — fires the criteria for one
 *     column. Used at end-of-column construction reviews.
 *   - runHoneWaterfall(input) — walks the map top-down (goal →
 *     behaviors → worries → commitments → assumptions) and stops at
 *     the first layer with any finding. Everything downstream of a
 *     broken column is re-derived when the coachee fixes it, so
 *     critiquing downstream entries now is asking them to fix
 *     something about to change. Matches the Kegan/Lahey guide's
 *     derivation chain (Vol 1 p 4: "do the fears stay present in the
 *     Column 3 commitments? do the Big Assumptions follow from key
 *     Column 3 commitments?").
 *
 * Both return typed `Finding[]`. Rewrites are attached one layer up
 * (src/lib/itc/fixes.ts), and render.ts turns the result into prose.
 * Same criteria functions on every surface, so the row box, the
 * column review and the hone audit never contradict each other.
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
  checkWorryDepth,
} from "./worries";
import {
  checkCommitmentDepth,
  checkCommitmentMirrorsWorry,
  checkInteriorWitnessInCommitments,
} from "./commitments";
import {
  checkAssumptionCoverage,
  checkAssumptionDepth,
  checkAssumptionUnderwritesCommitments,
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
    checkAssumptionUnderwritesCommitments({
      assumptions: input.assumptions,
      commitments: input.commitments,
      links: input.assumptionLinks,
    }),
    // No enactability check here. It used to run
    // checkAssumptionsHaveAnEnactableIf over the whole column and, if
    // it judged that no assumption had an "if" he could go do, flag
    // every one of them.
    //
    // The guides don't ask that of Column 5. Appendix D's test-design
    // table has four columns, and the action sits in the SECOND one,
    // invented at test-design time: "I don't believe I can ever be
    // skillful at managing my anger" -> "So I Will: Take an anger
    // management course". The assumption carries no "if" and no
    // action, and the guides treat it as testable. Same for "My
    // self-worth is based on how others view me" -> "I will engage in
    // some thought experiments". Requiring the assumption to carry
    // what the guides put in the test is the same category error as
    // the identity bar removed in f5a89cb.
    //
    // Enactability still runs where the guides ask it: on the
    // assumption he SELECTS for testing (checkAssumptionEnactable via
    // coachTextForSelectedAssumption, Vol 1 p 18 Checkpoint 2), which
    // is the moment the question is live.
    //
    // It was also the flakiest judge in the app. Being an LLM call in
    // the audit path only, it passed a column on "Hone this map" and
    // failed the same text on the next page load 100 seconds later
    // (2026-09-03), because a reload regenerates the review and takes
    // a fresh sample.
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
