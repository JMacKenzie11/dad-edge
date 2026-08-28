/**
 * Deterministic renderer for hone-diagnostic audits. Given a typed list
 * of AuditFinding, produces coach-voice prose without an LLM.
 *
 * Motivation: the LLM synthesis pass kept inventing content (rewrites
 * that weren't in any finding, generalized "your worry hasn't reached
 * depth" claims when no depth finding fired, editorial framings). No
 * amount of prompt sharpening converged — the drift is a property of
 * asking an LLM to write free-form prose about structured findings.
 *
 * Architectural fix: the audit output is now a pure function of the
 * findings list. One template per issueType. Openings and action items
 * are also templated, varying based on severity distribution. Coach
 * voice is codified in the templates instead of requested from an LLM.
 *
 * Trade-off: stiffer prose than a good LLM synthesis. The templates
 * are the coach voice; if it needs to shift, edit the templates.
 * Invented content goes to zero.
 */

import type { AuditFinding, AuditIssueType } from "./audit-rules";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Compose the full audit prose from a findings list. Returns a coach-
 * voice string with paragraph breaks between sections and a numbered
 * action list at the end. When findings is empty, returns a short
 * "map holds up" message without any per-finding paragraphs.
 */
export function renderAudit(
  findings: AuditFinding[],
  context: { goalText: string; pillarLabel: string },
): string {
  if (findings.length === 0) {
    const holds =
      context.goalText.trim().length > 0
        ? `Your ${context.pillarLabel} map holds up`
        : "Your map holds up";
    return `${holds}. Nothing on it needs sharpening right now. When something on the map changes, run the audit again and I'll re-check.`;
  }

  const opening = renderOpening(findings, context);
  const paragraphs = findings.map((f) => renderFindingParagraph(f));
  const actions = renderActionList(findings);

  return [opening, ...paragraphs, actions].join("\n\n");
}

// ---------------------------------------------------------------------------
// Opening paragraph — varies by severity distribution
// ---------------------------------------------------------------------------

function renderOpening(
  findings: AuditFinding[],
  context: { pillarLabel: string },
): string {
  const criticals = findings.filter((f) => f.severity === "critical").length;
  const moderates = findings.filter((f) => f.severity === "moderate").length;
  const observations = findings.filter(
    (f) => f.severity === "observation",
  ).length;
  const total = findings.length;

  if (criticals > 0) {
    const critWord = criticals === 1 ? "one critical issue" : `${criticals} critical issues`;
    return `Your ${context.pillarLabel} map has ${critWord} to fix before this hone pass is worth much else. Working down from there.`;
  }

  if (moderates > 0 && observations === 0) {
    const modWord = moderates === 1 ? "one thing" : `${moderates} things`;
    return `Your ${context.pillarLabel} map holds up structurally. ${modWord} worth sharpening before you keep going.`;
  }

  if (moderates > 0 && observations > 0) {
    return `Your ${context.pillarLabel} map holds up structurally, with ${moderates} moderate issue${moderates === 1 ? "" : "s"} to sharpen and ${observations} smaller observation${observations === 1 ? "" : "s"} to consider.`;
  }

  // Only observations.
  const obsWord = total === 1 ? "one small thing" : `${total} small things`;
  return `Your ${context.pillarLabel} map is in good shape. ${obsWord} worth noting.`;
}

// ---------------------------------------------------------------------------
// Per-issueType paragraph renderers
// ---------------------------------------------------------------------------

function renderFindingParagraph(f: AuditFinding): string {
  switch (f.issueType) {
    case "bundled_goal":
      return renderBundledGoal(f);
    case "interior_witness_worry":
      return renderInteriorWitnessWorry(f);
    case "interior_witness_commitment":
      return renderInteriorWitnessCommitment(f);
    case "missing_commitment_stem":
      return renderMissingCommitmentStem(f);
    case "vague_assumption_then_clause":
      return renderVagueAssumptionThenClause(f);
    case "depth_shortfall_worry":
      return renderDepthShortfallWorry(f);
    case "depth_shortfall_commitment":
      return renderDepthShortfallCommitment(f);
    case "depth_shortfall_assumption":
      return renderDepthShortfallAssumption(f);
    case "assumption_commitment_drift":
      return renderAssumptionCommitmentDrift(f);
    case "assumption_overload":
      return renderAssumptionOverload(f);
    case "assumption_uncovered_commitment":
      return renderAssumptionUncoveredCommitment(f);
    case "test_coverage_gap":
      return renderTestCoverageGap(f);
    case "test_grip_through_data":
      return renderTestGripThroughData(f);
    case "worry_commitment_redundancy":
      return renderWorryCommitmentRedundancy(f);
  }
}

// ---------------------------------------------------------------------------
// Individual template functions
// ---------------------------------------------------------------------------

function renderBundledGoal(f: AuditFinding): string {
  const consider = f.suggestedFix ? ` ${f.suggestedFix}` : "";
  return `Your goal now: "${f.actualText}" This packs two distinct improvements pointed at different objects. Each half implies different behaviors and different tests, so running them as one map produces muddy data on both.${consider}`;
}

function renderInteriorWitnessWorry(f: AuditFinding): string {
  return `Your worry now: "${f.actualText}" This uses an interior-witness verb ("I'd have to see", "I'd know", "I'd face") applied to a truth about you. The identity landing lives inside your head rather than in something the outside world would witness. The sharper form flips to external witness — instead of what you'd have to see, name what SHE would see, know, or say out loud. Let the outside world be the one who registers it.`;
}

function renderInteriorWitnessCommitment(f: AuditFinding): string {
  return `Your commitment now: "${f.actualText}" This is framed around avoiding a feeling or an interior reckoning ("never seeing", "never knowing", "avoiding the feeling that"). The sharper form names the identity you're committed to never being, plus the observable action a friend on your shoulder would see you take to protect it. Not "never seeing X" — "never being the [specific role] who [specific action]."`;
}

function renderMissingCommitmentStem(f: AuditFinding): string {
  const consider = f.suggestedFix ? ` Consider: "${f.suggestedFix}"` : "";
  return `Your commitment now: "${f.actualText}" This is missing the canonical stem "I'm also committed to". The "also" is load-bearing — it names this as the SECOND commitment sitting next to your improvement goal, so the coexistence with the primary commitment stays unmissable.${consider}`;
}

function renderVagueAssumptionThenClause(f: AuditFinding): string {
  return `Your assumption now: "${f.actualText}" The then-clause gestures at an identity ("the man I'm terrified of", "what I fear I am", "the guy I don't want to be") without naming it. Vague then-clauses don't test — reality can't disconfirm what isn't specified. Name the identity plainly: the guy who what? The husband whose what? Write out the concrete failure or flaw you're afraid arrives at you.`;
}

function renderDepthShortfallWorry(f: AuditFinding): string {
  return `Your worry now: "${f.actualText}" This is still at the practical level — what would happen, what you'd have to do — rather than at the identity level. The fear needs to land on who you'd be if the opposite move happened, not on the immediate consequence of the move itself.`;
}

function renderDepthShortfallCommitment(f: AuditFinding): string {
  return `Your commitment now: "${f.actualText}" This is still at the practical level. The vow needs to name the identity being protected and what the outside world would see you take the hit on, not the feeling or the situation you're avoiding.`;
}

function renderDepthShortfallAssumption(f: AuditFinding): string {
  return `Your assumption now: "${f.actualText}" The then-clause hasn't reached identity depth yet. It needs to finish through to an identity landing or a Big Time Bad conclusion, not stop at a practical consequence.`;
}

function renderAssumptionCommitmentDrift(f: AuditFinding): string {
  const relatedQuote = f.relatedText
    ? ` The paired commitment says: "${f.relatedText}"`
    : "";
  // Detail carries the drift reason from the LLM check. Strip the
  // machinery prefix if present.
  const reason = stripDetailPrefix(f.detail);
  return `Your assumption now: "${f.actualText}"${relatedQuote} These have drifted apart. ${reason} Either sharpen the assumption so its if-clause names the exact scenario this commitment is protecting against, or the pair may be pointing at a missing commitment that hasn't been named yet.`;
}

function renderAssumptionOverload(f: AuditFinding): string {
  const reason = stripDetailPrefix(f.detail);
  return `Your assumption now: "${f.actualText}" This is carrying more weight than one belief can hold. ${reason} Additional Big Assumptions may need to be named so each commitment has an assumption pointed at its own specific concern.`;
}

function renderAssumptionUncoveredCommitment(f: AuditFinding): string {
  return `Your commitment now: "${f.actualText}" No Big Assumption is linked to this one. The commitment is protecting something you haven't yet named as a testable belief, so nothing about it can be challenged with evidence. Draft a Big Assumption whose if-clause names the exact scenario this commitment is protecting against, and whose then-clause names the identity or Big Time Bad conclusion the commitment fears.`;
}

function renderTestCoverageGap(f: AuditFinding): string {
  return `Your assumption now: "${f.actualText}" This has no active test on it. Untested assumptions still shape your behavior, but no evidence is being gathered against them. A data-mining test (looking back at what's already happened) or a thought experiment can gather evidence cheaply without staging a whole new behavioral round.`;
}

function renderTestGripThroughData(f: AuditFinding): string {
  return `Your test result now: "${f.actualText}" The "what it says about the assumption" reading looks like the assumption still running the show, not a conclusion drawn from the data. When the world doesn't produce the predicted consequence, that's evidence AGAINST the assumption, not permission to double down on the protective move. Re-read the data as data, not as a prescription.`;
}

function renderWorryCommitmentRedundancy(f: AuditFinding): string {
  const relatedQuote = f.relatedText
    ? ` The commitment that duplicates it: "${f.relatedText}"`
    : "";
  const reason = stripDetailPrefix(f.detail);
  return `Your worry now: "${f.actualText}"${relatedQuote} These duplicate the same identity concern in two forms. ${reason} Either push the worry into a distinct identity concern, or drop it so the map isn't doubled up.`;
}

// ---------------------------------------------------------------------------
// Numbered action list
// ---------------------------------------------------------------------------

function renderActionList(findings: AuditFinding[]): string {
  // Cap at 5 — anything beyond that becomes a survey. Findings are
  // already severity-sorted by runAllAuditChecks so we take the top 5.
  const items = findings.slice(0, 5).map((f, i) => {
    const action = renderActionItem(f);
    return `${i + 1}. ${action}`;
  });
  return items.join("\n");
}

function renderActionItem(f: AuditFinding): string {
  switch (f.issueType) {
    case "bundled_goal":
      return "Split the goal into two. Pick one to run for this map and save the other for later.";
    case "interior_witness_worry":
      return "Rewrite the worry to name what SHE would see or say out loud, not what you'd have to see or know internally.";
    case "interior_witness_commitment":
      return "Rewrite the commitment to name the specific identity you're never being, not the feeling you're avoiding.";
    case "missing_commitment_stem":
      return "Fix the commitment stem to start with \"I'm also committed to...\" — the \"also\" is load-bearing.";
    case "vague_assumption_then_clause":
      return "Name the specific identity in the assumption's then-clause. Not \"the guy I'm terrified of\" — write out what that guy actually is.";
    case "depth_shortfall_worry":
      return "Push the worry to identity depth. Name who you'd be if the opposite behavior happened, not just what would happen.";
    case "depth_shortfall_commitment":
      return "Push the commitment to identity depth. Name what identity you're protecting and what the outside world would see you take the hit on.";
    case "depth_shortfall_assumption":
      return "Push the assumption's then-clause to identity depth. Land on who you'd be, not just what would happen next.";
    case "assumption_commitment_drift":
      return "Sharpen the assumption so its if-clause names the exact scenario the linked commitment protects against, or name a missing commitment that pairs cleanly with the current assumption.";
    case "assumption_overload":
      return "Draft an additional Big Assumption so each commitment has one pointed at its own specific concern.";
    case "assumption_uncovered_commitment":
      return "Draft a Big Assumption for the uncovered commitment. Its if-clause names the scenario the commitment protects against.";
    case "test_coverage_gap":
      return "Add a test on this assumption. A data-mining or thought-experiment test gathers evidence cheaply without a new behavioral round.";
    case "test_grip_through_data":
      return "Re-read the test data as data. If the world didn't produce the predicted consequence, that's disconfirmation, not a signal to double down.";
    case "worry_commitment_redundancy":
      return "Push this worry into a distinct identity concern, or drop it so the map isn't carrying the same fear twice.";
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Some check `detail` strings lead with a machinery-style summary
 * before the substantive reason ("Assumption is carrying multiple
 * distinct identity concerns. <reason>"). Strip the summary prefix
 * so the templated paragraph reads cleanly — the surrounding template
 * already establishes the finding type in coach voice.
 */
function stripDetailPrefix(detail: string): string {
  const stripped = detail
    .replace(/^Assumption is carrying multiple distinct identity concerns\.\s*/i, "")
    .replace(/^Assumption is linked to commitments that name distinct identity concerns\.\s*[^.]*\.\s*/i, "")
    .replace(/^Assumption's if-clause and its linked commitment name different concerns\.\s*/i, "")
    .replace(/^Worry duplicates the identity concern in a commitment on the map\.\s*/i, "")
    .replace(/^Worry duplicates a concern already carried by one of the competing commitments\.\s*[^.]*\.\s*/i, "")
    .trim();
  return stripped.length > 0 ? stripped : detail;
}

// Exhaustiveness check for AuditIssueType — if a new issue type is added
// to the union and not handled above, TypeScript will surface it here.
const _EXHAUSTIVENESS: readonly AuditIssueType[] = [
  "bundled_goal",
  "interior_witness_worry",
  "interior_witness_commitment",
  "missing_commitment_stem",
  "vague_assumption_then_clause",
  "depth_shortfall_worry",
  "depth_shortfall_commitment",
  "depth_shortfall_assumption",
  "assumption_commitment_drift",
  "assumption_overload",
  "assumption_uncovered_commitment",
  "test_coverage_gap",
  "test_grip_through_data",
  "worry_commitment_redundancy",
];
// Silence unused-var lint by referencing the constant.
void _EXHAUSTIVENESS;
