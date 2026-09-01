/**
 * SINGLE SOURCE OF TRUTH for coachee-facing fix-suggestion advice.
 *
 * Every coach surface that tells the coachee how to fix a finding —
 * the hone audit (via render.ts CRITIQUE_SPECS), the save-time
 * sharpen box (via the check functions' Finding.detail), and the
 * drafter retry-loop feedback (in coach.ts) — reads from HERE.
 *
 * Why this module exists (2026-09-01): before the extraction, three
 * places owned coachee-facing advice text:
 *   1. render.ts CRITIQUE_SPECS — audit output
 *   2. worries.ts / commitments.ts / assumptions.ts detail strings —
 *      save-time sharpen box
 *   3. coach.ts drafter retry-loop feedback lines
 *
 * Copies drifted independently. Interior-witness worry advice told
 * the coachee to "flip to 'she'd see...'" while scoreWorryDepth's
 * is_first_person_felt criterion explicitly rejects centering on
 * her reaction. Two coaches, opposite advice, coachee whiplash.
 *
 * The class of bug: any advice text can drift from the depth
 * rubric's criteria without a structural guard catching it. The
 * fix: one string per IssueType, referenced everywhere, plus a
 * lint-test that catches known-violating patterns (see
 * __tests__/advice-alignment.test.ts).
 *
 * RULES for editing:
 *   1. Advice must align with the depth rubrics in rubric.ts. If
 *      you're editing an advice string here, verify the suggested
 *      rewrite pattern would PASS scoreWorryDepth / scoreCommitmentDepth
 *      / scoreAssumptionDepth (as applicable).
 *   2. Interior-witness advice must NOT include "she'd see" or
 *      "she'd say" patterns as fix examples — those violate the
 *      depth rubric's is_first_person_felt. The alignment test
 *      catches this.
 *   3. If you add a new IssueType, add its advice entry here too —
 *      the exhaustiveness test at the bottom of types.ts (and the
 *      alignment test) will fail otherwise.
 */

import type { IssueType } from "./types";

export const ADVICE: Record<IssueType, string> = {
  bundled_goal:
    "Split this into two improvements — pick one for this map, save the other for later.",

  depth_shortfall_behavior:
    "Push it to observable depth — name a specific move you make that works against your goal, phrased as something you actually do (not what you wish you did).",

  depth_shortfall_worry:
    "Push it to identity depth — name who you'd be if the opposite behavior happened, not just what would happen.",

  depth_shortfall_commitment:
    "Push it to identity depth — name the identity you're protecting and what a friend on your shoulder would see you take the hit on.",

  depth_shortfall_assumption:
    'Push the "then" half to identity depth — who you\'d be, not just what would happen next.',

  // Aligned with scoreWorryDepth.is_first_person_felt (which rejects
  // centering on her reaction). The fix keeps the frame in his felt
  // dread and lands on a named identity the outside world can register.
  interior_witness_worry:
    "Interior-witness verb applied to a self-truth ('I'd have to see I…'). Keep the frame in your own dread — start with 'I'm afraid I'd be…' or 'I worry I'm the [role] who…' — and land on an identity the outside world could register ('the husband she'd never respect', 'the guy who couldn't let things go'). Don't pivot to 'she'd see X' — that centers on her reaction instead of your felt fear.",

  interior_witness_commitment:
    'Rewrite as "never being the [specific role] who [specific action]" instead of "avoiding the feeling that…" — name the identity plus the observable action.',

  commitment_doesnt_mirror_worry:
    "Rewrite so it names the exact identity or outcome the paired worry fears. Same nouns, same specificity, wrapped in \"I'm also committed to never...\" — the commitment is supposed to be the worry rewritten as a vow.",

  vague_assumption_then_clause:
    'Name the identity plainly in the "then" half — write out what that guy actually is, not "the guy I\'m terrified of".',

  assumption_uncovered_commitment:
    "Draft a Big Assumption for this commitment — an if-then belief that names the scenario the commitment protects against and the identity it fears.",

  // The drift + overload findings render via specialized functions in
  // render.ts (they embed dynamic LLM-provided labels — assumption
  // scenario, commitment identity — into the sentence structure). The
  // sentence templates live in render.ts as renderDriftClause /
  // renderOverloadClause, not here, because they're not static strings.
  // ADVICE entries below are the reference text used by drafters and
  // fallback consumers.
  assumption_commitment_drift:
    'Sharpen the "if" half so it names the scenario the paired commitment actually protects against, not a different scenario.',

  assumption_overload:
    "Carrying more weight than one belief can hold. Draft additional Big Assumptions so each commitment has one pointed at its own specific concern.",

  // Test-related issue types don't have a rendered fix suggestion
  // today (tests are shaped via the design/results forms). Advice
  // entries here are placeholders so future consumers have a canonical
  // hook — the alignment test's exhaustiveness check requires them.
  test_coverage_gap:
    "Design a test for this assumption so you have data to hold it up against.",

  test_grip_through_data:
    "Bring the test back to grip — what data will you actually collect that could prove the assumption wrong?",
};
