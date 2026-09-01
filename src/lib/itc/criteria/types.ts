/**
 * Shared types for the criteria module.
 *
 * A criterion is a pure function of a map slice that returns
 * `Finding[]`. The same criteria feed three surfaces: the row box
 * under an entry (save-time), the end-of-column review, and the
 * whole-map hone audit. One source of truth so the coachee never
 * sees a criterion approved during construction and flagged on hone.
 *
 * Every Finding can carry a `suggestedFix`: a verified rewrite that
 * clears the finding. The drafters produce it (see
 * src/lib/itc/fixes.ts); the renderer prints it; the row shows a
 * "Use this" button for it. A finding without a fix still renders,
 * it just asks the coachee to do the rewrite himself.
 */

export type IssueType =
  | "bundled_goal"
  | "depth_shortfall_behavior"
  | "interior_witness_worry"
  | "interior_witness_commitment"
  | "commitment_doesnt_mirror_worry"
  | "vague_assumption_then_clause"
  | "depth_shortfall_worry"
  | "depth_shortfall_commitment"
  | "depth_shortfall_assumption"
  /** Kegan/Lahey Appendix A criterion 1 for Big Assumptions: the
   *  assumption makes the linked commitment absolutely necessary.
   *  Fires when believing the assumption would NOT make one (or more)
   *  of its linked commitments feel necessary. Fix is a link change,
   *  not a rewrite. Replaces the retired drift + overload checks,
   *  which enforced a 1:1 scenario match the guides never asked for. */
  | "assumption_doesnt_underwrite"
  /** Kegan/Lahey Checkpoint 2 (Vol 1 p 18): the "if" half must have
   *  degrees to it so the coachee can enact it safely. Fires when
   *  the "if" isn't a move he could make himself this week. */
  | "assumption_not_enactable"
  | "assumption_uncovered_commitment"
  | "test_coverage_gap"
  | "test_grip_through_data";

export type EntryRef =
  | { table: "goal"; id: string }
  | { table: "behaviors"; id: string }
  | { table: "worries"; id: string }
  | { table: "commitments"; id: string }
  | { table: "assumptions"; id: string }
  | { table: "tests"; id: string }
  | { table: "map"; id: string };

/**
 * Only two severities. `critical` = structurally broken (blocks
 * downstream derivation). `moderate` = worth fixing before he tests.
 */
export type Severity = "critical" | "moderate";

export type Finding = {
  entryRef: EntryRef;
  issueType: IssueType;
  severity: Severity;
  /** Verbatim quote of the source entry text (or a specific field).
   *  Never paraphrased. */
  actualText: string;
  /** For depth findings: the rubric's one-line reason (raw LLM text,
   *  scrubbed of machinery words). For the dynamic finding types
   *  (underwrite, coverage) the renderer builds the sentence from
   *  the structured fields below and this is a fallback. For every
   *  other type it's a copy of ADVICE[issueType]. */
  detail: string;
  /** Verified rewrite that clears this finding. Produced by the
   *  drafters (fixes.ts), never by the check itself. For coverage
   *  findings it's the text of a Big Assumption draft. */
  suggestedFix?: string;
  /** Optional cross-entry context (e.g. the paired worry for a
   *  mirror-broken commitment, or the commitment a coverage finding
   *  is about). */
  relatedEntryRef?: EntryRef;
  relatedText?: string;
  /** assumption_doesnt_underwrite only: 1-based map positions of the
   *  linked commitments this assumption does NOT make necessary, in
   *  the order the commitments appear on the map. The renderer turns
   *  these into "#2 and #4". */
  unfitCommitmentPositions?: number[];
};

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  moderate: 1,
};

/** Depth score threshold. Rubric scores 0–3; anything below 3 is a
 *  depth-shortfall finding. Shared across worries, commitments, and
 *  assumptions. */
export const DEPTH_THRESHOLD = 3;

/**
 * Severity of a depth-shortfall finding mirrors the advance gate
 * (rules.ts worryPassesDepth): 2/3 can pass the gate after a second
 * honest attempt, so it's "one thing to fix" (moderate); below 2 is
 * blocked outright, so it's "broken" (critical). Before 2026-09-01
 * anything under 3 rendered as broken, which overstated a 2/3.
 */
export function depthSeverity(score: number): Severity {
  return score < 2 ? "critical" : "moderate";
}
