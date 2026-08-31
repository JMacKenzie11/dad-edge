/**
 * Shared types for the criteria module.
 *
 * A criterion is a pure function of a map slice that returns
 * `Finding[]`. The same criteria feed both the construction-side
 * column reviews (end-of-column feedback as the coachee builds the
 * map) and the on-demand hone waterfall. One source of truth so the
 * coachee never sees a criterion approved during construction and
 * flagged on hone.
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
  | "assumption_commitment_drift"
  | "assumption_overload"
  | "assumption_uncovered_commitment"
  | "test_coverage_gap"
  | "test_grip_through_data"
  | "worry_commitment_redundancy";

export type EntryRef =
  | { table: "goal"; id: string }
  | { table: "behaviors"; id: string }
  | { table: "worries"; id: string }
  | { table: "commitments"; id: string }
  | { table: "assumptions"; id: string }
  | { table: "tests"; id: string }
  | { table: "map"; id: string };

export type Severity = "critical" | "moderate" | "observation";

export type Finding = {
  entryRef: EntryRef;
  issueType: IssueType;
  severity: Severity;
  /** Verbatim quote of the source entry text (or a specific field).
   *  Never paraphrased. Any drift here corrupts the finding, so the
   *  renderer can quote the entry accurately. */
  actualText: string;
  /** Machine-readable description of what's wrong. The renderer
   *  translates this into coach voice via CRITIQUE_SPECS. */
  detail: string;
  /** Optional concrete rewrite suggestion. When present the renderer
   *  should surface it. */
  suggestedFix?: string;
  /** Optional cross-entry context (e.g. the paired commitment for a
   *  drifted assumption). */
  relatedEntryRef?: EntryRef;
  relatedText?: string;
  /** Structured labels from the drift check LLM. Short noun phrases
   *  the renderer synthesizes into "The assumption is about [scenario];
   *  the commitment protects [identity]." */
  assumptionScenario?: string;
  commitmentIdentity?: string;
};

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  moderate: 1,
  observation: 2,
};

/** Depth score threshold. Rubric scores 0–3; anything below 3 is a
 *  depth-shortfall finding. Shared across worries, commitments, and
 *  assumptions. */
export const DEPTH_THRESHOLD = 3;

