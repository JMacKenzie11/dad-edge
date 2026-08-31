/**
 * BACKWARDS-COMPAT SHIM.
 *
 * The check implementations moved into `./criteria/*.ts` — one file
 * per column. This file re-exports the check functions + types so
 * existing consumers (actions.ts, coach.ts, tests) keep working while
 * the honing rework is in flight.
 *
 * Once tasks 4-5 complete (runHoneDiagnostic rewired to the waterfall,
 * construction wired to the shared criteria), task 6 deletes this file.
 *
 * The `runAllAuditChecks` orchestrator + downstream commitment
 * suppression logic still lives here for the current hone-diagnostic
 * caller. Task 4 replaces it with the waterfall orchestrator; task 6
 * deletes this file entirely.
 */

import type { ItcCommitment } from "./maps";
import { checkBundledGoal } from "./criteria/goal";
import {
  checkInteriorWitnessInWorries,
  checkWorryCommitmentRedundancy,
  checkWorryDepth,
} from "./criteria/worries";
import {
  checkCommitmentDepth,
  checkInteriorWitnessInCommitments,
  checkMissingCommitmentStem,
} from "./criteria/commitments";
import {
  checkAssumptionCommitmentDrift,
  checkAssumptionCoverage,
  checkAssumptionDepth,
  checkAssumptionOverload,
  checkVagueAssumptionThenClause,
} from "./criteria/assumptions";
import { checkTestCoverage, checkTestInterpretation } from "./criteria/tests";
import {
  SEVERITY_ORDER,
  type AuditEntryRef,
  type AuditFinding,
  type AuditIssueType,
  type AuditSeverity,
  type Finding,
  type IssueType,
} from "./criteria/types";
import type {
  ItcAssumption,
  ItcAssumptionCommitment,
  ItcBehavior,
  ItcTest,
  ItcTestResult,
  ItcWorry,
} from "./maps";

export type { AuditEntryRef, AuditFinding, AuditIssueType, AuditSeverity };

export {
  checkBundledGoal,
  checkInteriorWitnessInWorries,
  checkWorryCommitmentRedundancy,
  checkInteriorWitnessInCommitments,
  checkMissingCommitmentStem,
  checkVagueAssumptionThenClause,
  checkAssumptionCoverage,
  checkAssumptionCommitmentDrift,
  checkAssumptionOverload,
  checkTestCoverage,
  checkTestInterpretation,
};

/**
 * Backwards-compat: the original checkDepthShortfall spanned all three
 * columns. New per-column checks live in criteria/*.ts. This wrapper
 * preserves the old signature so audit-rules.test.ts and any other
 * callers keep working until task 6 deletes this shim.
 */
export async function checkDepthShortfall(input: {
  worries: ItcWorry[];
  commitments: ItcCommitment[];
  assumptions: ItcAssumption[];
}): Promise<AuditFinding[]> {
  const [w, c, a] = await Promise.all([
    checkWorryDepth({ worries: input.worries }),
    checkCommitmentDepth({ commitments: input.commitments }),
    checkAssumptionDepth({ assumptions: input.assumptions }),
  ]);
  return [...w, ...c, ...a];
}

export type FullAuditInput = {
  mapId: string;
  goalText: string;
  behaviors: ItcBehavior[];
  worries: ItcWorry[];
  commitments: ItcCommitment[];
  assumptions: ItcAssumption[];
  assumptionLinks: ItcAssumptionCommitment[];
  tests: ItcTest[];
  testResults: ItcTestResult[];
};

/**
 * Commitment critique types that are downstream of the worry they're
 * paired to. When the paired worry fires a rewrite-triggering critique
 * (depth-shortfall or interior-witness), the commitment gets rewritten
 * from scratch during the worry-sharpening pass, so surfacing these
 * commitment-structural critiques on top is redundant.
 *
 * Cross-column commitment findings (assumption_uncovered_commitment,
 * assumption_commitment_drift) are NOT in this set — they're about the
 * assumption/commitment linking, not the commitment's own shape.
 */
const SUPPRESSIBLE_COMMITMENT_TYPES: ReadonlySet<AuditIssueType> = new Set([
  "depth_shortfall_commitment",
  "interior_witness_commitment",
  "missing_commitment_stem",
]);

/**
 * Worry critique types that trigger a full worry rewrite. When any of
 * these fires on a worry, the commitment paired to that worry gets
 * suppressed for its structural critiques.
 */
const WORRY_REWRITE_TYPES: ReadonlySet<AuditIssueType> = new Set([
  "depth_shortfall_worry",
  "interior_witness_worry",
]);

export async function runAllAuditChecks(
  input: FullAuditInput,
): Promise<AuditFinding[]> {
  const results = await Promise.all([
    checkBundledGoal({ mapId: input.mapId, goalText: input.goalText }),
    checkInteriorWitnessInWorries({
      worries: input.worries,
      behaviors: input.behaviors,
    }),
    checkInteriorWitnessInCommitments({ commitments: input.commitments }),
    checkMissingCommitmentStem({ commitments: input.commitments }),
    checkVagueAssumptionThenClause({ assumptions: input.assumptions }),
    checkDepthShortfall({
      worries: input.worries,
      commitments: input.commitments,
      assumptions: input.assumptions,
    }),
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
    checkWorryCommitmentRedundancy({
      worries: input.worries,
      commitments: input.commitments,
    }),
  ]);
  const flat = results.flat();

  const worriesNeedingRewrite = new Set<string>();
  for (const f of flat) {
    if (
      f.entryRef.table === "worries" &&
      WORRY_REWRITE_TYPES.has(f.issueType)
    ) {
      worriesNeedingRewrite.add(f.entryRef.id);
    }
  }
  const commitmentToWorry = new Map<string, string>();
  for (const c of input.commitments) {
    if (c.worry_id) commitmentToWorry.set(c.id, c.worry_id);
  }
  const filtered = flat.filter((f) => {
    if (!SUPPRESSIBLE_COMMITMENT_TYPES.has(f.issueType)) return true;
    if (f.entryRef.table !== "commitments") return true;
    const pairedWorryId = commitmentToWorry.get(f.entryRef.id);
    if (!pairedWorryId) return true;
    return !worriesNeedingRewrite.has(pairedWorryId);
  });

  filtered.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  return filtered;
}

// ---------------------------------------------------------------------------
// Verbatim-quote validator (used only by tests — deleted in task 6)
// ---------------------------------------------------------------------------

/**
 * Legacy validator from the LLM-synthesis era. Not called by any real
 * production path since the audit went fully deterministic (commit
 * 17c63b7). Task 6 deletes this along with its tests.
 */
export function validateQuotesAgainstFindings(
  prose: string,
  findings: AuditFinding[],
): { prose: string; violations: string[] } {
  const violations: string[] = [];
  let corrected = prose;
  const sources = new Set<string>();
  for (const f of findings) {
    sources.add(f.actualText);
    if (f.relatedText) sources.add(f.relatedText);
  }
  const orderedSources = [...sources].sort((a, b) => b.length - a.length);
  for (const source of orderedSources) {
    const sourceTokens = tokenize(source);
    if (sourceTokens.length < 4) continue;
    const quotedRe = /["\u201C]([^"\u201C\u201D]{6,})["\u201D]/g;
    let match: RegExpExecArray | null;
    const replacements: Array<{
      start: number;
      end: number;
      replaceWith: string;
      original: string;
    }> = [];
    while ((match = quotedRe.exec(corrected)) !== null) {
      const candidate = match[1];
      if (candidate === source) continue;
      const candidateTokens = tokenize(candidate);
      if (candidateTokens.length < 3) continue;
      if (candidateTokens.length < sourceTokens.length * 0.6) continue;
      if (candidateTokens.length > sourceTokens.length * 1.4) continue;
      const candidateSet = new Set(candidateTokens);
      const overlap = sourceTokens.filter((t) => candidateSet.has(t)).length;
      const overlapRatio = overlap / sourceTokens.length;
      if (overlapRatio < 0.6) continue;
      replacements.push({
        start: match.index,
        end: match.index + match[0].length,
        replaceWith: `"${source}"`,
        original: candidate,
      });
    }
    replacements.sort((a, b) => b.start - a.start);
    for (const r of replacements) {
      corrected =
        corrected.slice(0, r.start) + r.replaceWith + corrected.slice(r.end);
      violations.push(
        `Paraphrased quote normalized: "${r.original}" → "${source}"`,
      );
    }
  }
  return { prose: corrected, violations };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/i'?m\b/g, "im")
    .replace(/i\s+am\b/g, "im")
    .replace(/won'?t\b/g, "wont")
    .replace(/don'?t\b/g, "dont")
    .replace(/didn'?t\b/g, "didnt")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

// Suppress an "unused" warning for the re-exported types when consumers
// import only the check functions.
void SEVERITY_ORDER;
void ({} as Finding);
void ({} as IssueType);
