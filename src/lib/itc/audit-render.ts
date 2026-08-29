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
 * Grouping: findings on the same map entry share a single
 * `Your X now: "quote"` opener. Subsequent findings against the same
 * entry drop the opener and render just the critique body. Multiple
 * `assumption_commitment_drift` findings on the same assumption merge
 * into one paragraph that names all paired commitments. Action items
 * are deduped by (entry, action-family) so depth-shortfall and
 * interior-witness findings on the same commitment collapse to one
 * action, not two near-identical ones.
 */

import type {
  AuditEntryRef,
  AuditFinding,
  AuditIssueType,
} from "./audit-rules";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

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

  // Cross-entry aggregation: when the same generic-body critique fires
  // on 2+ entries, render ONE aggregated paragraph naming all affected
  // entries instead of N repetitive per-entry paragraphs. Types with
  // entry-specific bodies (drift, redundancy, overload, test-grip)
  // never aggregate — they always render per-entry.
  const aggregations = computeAggregations(findings);
  const aggregatedFindings = new Set<AuditFinding>();
  for (const arr of aggregations.values()) {
    for (const f of arr) aggregatedFindings.add(f);
  }

  const aggregatedParagraphs: string[] = [];
  for (const issueType of AGGREGATION_RENDER_ORDER) {
    const arr = aggregations.get(issueType);
    if (arr) aggregatedParagraphs.push(renderAggregatedParagraph(issueType, arr));
  }

  const remaining = findings.filter((f) => !aggregatedFindings.has(f));
  const groups = groupFindingsByEntry(remaining);
  const entryParagraphs = groups.flatMap((g) => renderEntryGroup(g));

  const actions = renderActionList(findings);

  return [
    opening,
    ...aggregatedParagraphs,
    ...entryParagraphs,
    actions,
  ].join("\n\n");
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
    const critWord =
      criticals === 1 ? "one critical issue" : `${criticals} critical issues`;
    return `Your ${context.pillarLabel} map has ${critWord} to fix before this hone pass is worth much else. Working down from there.`;
  }

  if (moderates > 0 && observations === 0) {
    const modWord = moderates === 1 ? "one thing" : `${moderates} things`;
    return `Your ${context.pillarLabel} map holds up structurally. ${modWord} worth sharpening before you keep going.`;
  }

  if (moderates > 0 && observations > 0) {
    return `Your ${context.pillarLabel} map holds up structurally, with ${moderates} moderate issue${moderates === 1 ? "" : "s"} to sharpen and ${observations} smaller observation${observations === 1 ? "" : "s"} to consider.`;
  }

  const obsWord = total === 1 ? "one small thing" : `${total} small things`;
  return `Your ${context.pillarLabel} map is in good shape. ${obsWord} worth noting.`;
}

// ---------------------------------------------------------------------------
// Cross-entry aggregation
// ---------------------------------------------------------------------------

const AGGREGATION_THRESHOLD = 2;

/**
 * Issue types with entry-agnostic critique bodies. These can collapse
 * across multiple entries into one aggregated paragraph. Types with
 * entry-specific content (drift, redundancy, overload, test-grip,
 * bundled-goal) are omitted — they always render per-entry.
 */
const AGGREGATABLE_TYPES: ReadonlySet<AuditIssueType> = new Set([
  "depth_shortfall_worry",
  "depth_shortfall_commitment",
  "depth_shortfall_assumption",
  "interior_witness_worry",
  "interior_witness_commitment",
  "missing_commitment_stem",
  "vague_assumption_then_clause",
  "test_coverage_gap",
  "assumption_uncovered_commitment",
]);

/**
 * Column-order for aggregated paragraphs so the reader walks the map
 * top-down: worries → commitments → assumptions.
 */
const AGGREGATION_RENDER_ORDER: readonly AuditIssueType[] = [
  "interior_witness_worry",
  "depth_shortfall_worry",
  "missing_commitment_stem",
  "interior_witness_commitment",
  "depth_shortfall_commitment",
  "assumption_uncovered_commitment",
  "vague_assumption_then_clause",
  "depth_shortfall_assumption",
  "test_coverage_gap",
];

type AggregationSpec = {
  columnNoun: string;
  linkVerb: string;
  intro: string;
  body: string;
};

const AGGREGATION_SPECS: Record<string, AggregationSpec> = {
  depth_shortfall_worry: {
    columnNoun: "worries",
    linkVerb: "are",
    intro: "still at the practical level",
    body: "The fear needs to land on who you'd be if the opposite move happened, not on the immediate consequence of the move itself.",
  },
  depth_shortfall_commitment: {
    columnNoun: "commitments",
    linkVerb: "are",
    intro: "still at the practical level",
    body: "The vow needs to name the identity being protected and what the outside world would see you take the hit on, not the feeling or the situation you're avoiding.",
  },
  depth_shortfall_assumption: {
    columnNoun: "assumptions",
    linkVerb: "have",
    intro: "then-clauses that haven't reached identity depth",
    body: "Each needs to finish through to an identity landing or a Big Time Bad conclusion, not stop at a practical consequence.",
  },
  interior_witness_worry: {
    columnNoun: "worries",
    linkVerb: "use",
    intro: 'an interior-witness verb applied to a truth about you ("I\'d have to see", "I\'d know", "I\'d face")',
    body: "The sharper form flips to external witness. Instead of what you'd have to see, name what SHE would see, know, or say out loud. Let the outside world be the one who registers it.",
  },
  interior_witness_commitment: {
    columnNoun: "commitments",
    linkVerb: "are",
    intro: 'framed around avoiding a feeling or an interior reckoning ("never seeing", "never knowing", "avoiding the feeling that")',
    body: 'The sharper form names the identity you\'re committed to never being, plus the observable action a friend on your shoulder would see you take to protect it. Not "never seeing X" but "never being the [specific role] who [specific action]."',
  },
  missing_commitment_stem: {
    columnNoun: "commitments",
    linkVerb: "are",
    intro: 'missing the canonical stem "I\'m also committed to"',
    body: 'The "also" is load-bearing. It names each as the SECOND commitment sitting next to your improvement goal, so the coexistence with the primary commitment stays unmissable.',
  },
  vague_assumption_then_clause: {
    columnNoun: "assumptions",
    linkVerb: "have",
    intro: "then-clauses that gesture at an identity without naming it",
    body: "Vague then-clauses don't test. Reality can't disconfirm what isn't specified. Name each identity plainly: the guy who what? The husband whose what? Write out the concrete failure or flaw you're afraid arrives at you.",
  },
  test_coverage_gap: {
    columnNoun: "assumptions",
    linkVerb: "have",
    intro: "no active test on them",
    body: "Untested assumptions still shape your behavior, but no evidence is being gathered against them. A data-mining test (looking back at what's already happened) or a thought experiment can gather evidence cheaply without staging a whole new behavioral round.",
  },
  assumption_uncovered_commitment: {
    columnNoun: "commitments",
    linkVerb: "have",
    intro: "no Big Assumption linked to them",
    body: "Each is protecting something you haven't yet named as a testable belief, so nothing about them can be challenged with evidence. Draft a Big Assumption for each whose if-clause names the exact scenario the commitment is protecting against, and whose then-clause names the identity or Big Time Bad conclusion the commitment fears.",
  },
};

function computeAggregations(
  findings: AuditFinding[],
): Map<AuditIssueType, AuditFinding[]> {
  const byType = new Map<AuditIssueType, AuditFinding[]>();
  for (const f of findings) {
    if (!AGGREGATABLE_TYPES.has(f.issueType)) continue;
    const arr = byType.get(f.issueType) ?? [];
    arr.push(f);
    byType.set(f.issueType, arr);
  }
  const result = new Map<AuditIssueType, AuditFinding[]>();
  for (const [issueType, arr] of byType) {
    const byEntry = new Map<string, AuditFinding>();
    for (const f of arr) {
      const key = entryKey(f.entryRef);
      if (!byEntry.has(key)) byEntry.set(key, f);
    }
    if (byEntry.size >= AGGREGATION_THRESHOLD) {
      result.set(issueType, Array.from(byEntry.values()));
    }
  }
  return result;
}

function renderAggregatedParagraph(
  issueType: AuditIssueType,
  findings: AuditFinding[],
): string {
  const spec = AGGREGATION_SPECS[issueType];
  const countWord = countWordCapitalized(findings.length);
  const quotes = findings.map((f) => `- "${f.actualText}"`).join("\n");
  return `${countWord} of your ${spec.columnNoun} ${spec.linkVerb} ${spec.intro}:\n${quotes}\n\n${spec.body}`;
}

function countWordCapitalized(n: number): string {
  const CARDINALS = [
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
  ];
  const word = CARDINALS[n - 1];
  if (!word) return `${n}`;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// ---------------------------------------------------------------------------
// Entry grouping — findings on the same entry share one opener
// ---------------------------------------------------------------------------

interface EntryGroup {
  key: string;
  findings: AuditFinding[];
}

function entryKey(ref: AuditEntryRef): string {
  return `${ref.table}:${ref.id}`;
}

function groupFindingsByEntry(findings: AuditFinding[]): EntryGroup[] {
  const byKey = new Map<string, AuditFinding[]>();
  const order: string[] = [];
  for (const f of findings) {
    const key = entryKey(f.entryRef);
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(f);
  }
  return order.map((key) => ({ key, findings: byKey.get(key)! }));
}

const SEVERITY_ORDER: Record<AuditFinding["severity"], number> = {
  critical: 0,
  moderate: 1,
  observation: 2,
};

const ISSUE_TYPE_ORDER: Record<AuditIssueType, number> = {
  bundled_goal: 0,
  missing_commitment_stem: 1,
  interior_witness_worry: 2,
  depth_shortfall_worry: 3,
  worry_commitment_redundancy: 4,
  interior_witness_commitment: 5,
  depth_shortfall_commitment: 6,
  assumption_uncovered_commitment: 7,
  vague_assumption_then_clause: 8,
  depth_shortfall_assumption: 9,
  test_coverage_gap: 10,
  test_grip_through_data: 11,
  assumption_commitment_drift: 12,
  assumption_overload: 13,
};

function orderFindingsWithinGroup(findings: AuditFinding[]): AuditFinding[] {
  return [...findings].sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    return ISSUE_TYPE_ORDER[a.issueType] - ISSUE_TYPE_ORDER[b.issueType];
  });
}

function renderEntryGroup(group: EntryGroup): string[] {
  const ordered = orderFindingsWithinGroup(group.findings);

  // Gate off the missing-stem "Consider:" suggestion when a heavier
  // commitment critique fires on the same entry. The suggestion just
  // prepends "I'm also " to the existing text, which understates the
  // fix a depth or interior-witness finding is prescribing. Reader
  // still gets the stem paragraph — only the trailing rewrite is
  // suppressed.
  const hasHeavyCommitmentCritique = ordered.some(
    (f) =>
      f.issueType === "depth_shortfall_commitment" ||
      f.issueType === "interior_witness_commitment",
  );
  const gated = hasHeavyCommitmentCritique
    ? ordered.map((f) =>
        f.issueType === "missing_commitment_stem"
          ? { ...f, suggestedFix: undefined }
          : f,
      )
    : ordered;

  const drifts = gated.filter(
    (f) => f.issueType === "assumption_commitment_drift",
  );
  const redundancies = gated.filter(
    (f) => f.issueType === "worry_commitment_redundancy",
  );
  const others = gated.filter(
    (f) =>
      f.issueType !== "assumption_commitment_drift" &&
      f.issueType !== "worry_commitment_redundancy",
  );

  const paragraphs: string[] = [];
  let openerEmitted = false;

  for (const f of others) {
    paragraphs.push(renderFindingParagraph(f, openerEmitted));
    openerEmitted = true;
  }

  if (redundancies.length === 1) {
    paragraphs.push(renderFindingParagraph(redundancies[0], openerEmitted));
    openerEmitted = true;
  } else if (redundancies.length >= 2) {
    paragraphs.push(renderMergedRedundancy(redundancies, openerEmitted));
    openerEmitted = true;
  }

  if (drifts.length === 1) {
    paragraphs.push(renderFindingParagraph(drifts[0], openerEmitted));
    openerEmitted = true;
  } else if (drifts.length >= 2) {
    paragraphs.push(renderMergedDrift(drifts, openerEmitted));
    openerEmitted = true;
  }

  return paragraphs;
}

// ---------------------------------------------------------------------------
// Per-issueType paragraph renderers
// ---------------------------------------------------------------------------

function renderFindingParagraph(f: AuditFinding, skipOpener: boolean): string {
  switch (f.issueType) {
    case "bundled_goal":
      return renderBundledGoal(f, skipOpener);
    case "interior_witness_worry":
      return renderInteriorWitnessWorry(f, skipOpener);
    case "interior_witness_commitment":
      return renderInteriorWitnessCommitment(f, skipOpener);
    case "missing_commitment_stem":
      return renderMissingCommitmentStem(f, skipOpener);
    case "vague_assumption_then_clause":
      return renderVagueAssumptionThenClause(f, skipOpener);
    case "depth_shortfall_worry":
      return renderDepthShortfallWorry(f, skipOpener);
    case "depth_shortfall_commitment":
      return renderDepthShortfallCommitment(f, skipOpener);
    case "depth_shortfall_assumption":
      return renderDepthShortfallAssumption(f, skipOpener);
    case "assumption_commitment_drift":
      return renderAssumptionCommitmentDrift(f, skipOpener);
    case "assumption_overload":
      return renderAssumptionOverload(f, skipOpener);
    case "assumption_uncovered_commitment":
      return renderAssumptionUncoveredCommitment(f, skipOpener);
    case "test_coverage_gap":
      return renderTestCoverageGap(f, skipOpener);
    case "test_grip_through_data":
      return renderTestGripThroughData(f, skipOpener);
    case "worry_commitment_redundancy":
      return renderWorryCommitmentRedundancy(f, skipOpener);
  }
}

function opener(subject: string, text: string, skip: boolean): string {
  return skip ? "" : `Your ${subject} now: "${text}" `;
}

// ---------------------------------------------------------------------------
// Individual template functions
// ---------------------------------------------------------------------------

function renderBundledGoal(f: AuditFinding, skip: boolean): string {
  const consider = f.suggestedFix ? ` ${f.suggestedFix}` : "";
  return `${opener("goal", f.actualText, skip)}This packs two distinct improvements pointed at different objects. Each half implies different behaviors and different tests, so running them as one map produces muddy data on both.${consider}`;
}

function renderInteriorWitnessWorry(f: AuditFinding, skip: boolean): string {
  return `${opener("worry", f.actualText, skip)}This uses an interior-witness verb ("I'd have to see", "I'd know", "I'd face") applied to a truth about you. The identity landing lives inside your head rather than in something the outside world would witness. The sharper form flips to external witness. Instead of what you'd have to see, name what SHE would see, know, or say out loud. Let the outside world be the one who registers it.`;
}

function renderInteriorWitnessCommitment(f: AuditFinding, skip: boolean): string {
  return `${opener("commitment", f.actualText, skip)}This is framed around avoiding a feeling or an interior reckoning ("never seeing", "never knowing", "avoiding the feeling that"). The sharper form names the identity you're committed to never being, plus the observable action a friend on your shoulder would see you take to protect it. Not "never seeing X" but "never being the [specific role] who [specific action]."`;
}

function renderMissingCommitmentStem(f: AuditFinding, skip: boolean): string {
  const consider = f.suggestedFix ? ` Consider: "${f.suggestedFix}"` : "";
  return `${opener("commitment", f.actualText, skip)}This is missing the canonical stem "I'm also committed to". The "also" is load-bearing. It names this as the SECOND commitment sitting next to your improvement goal, so the coexistence with the primary commitment stays unmissable.${consider}`;
}

function renderVagueAssumptionThenClause(f: AuditFinding, skip: boolean): string {
  return `${opener("assumption", f.actualText, skip)}The then-clause gestures at an identity ("the man I'm terrified of", "what I fear I am", "the guy I don't want to be") without naming it. Vague then-clauses don't test. Reality can't disconfirm what isn't specified. Name the identity plainly: the guy who what? The husband whose what? Write out the concrete failure or flaw you're afraid arrives at you.`;
}

function renderDepthShortfallWorry(f: AuditFinding, skip: boolean): string {
  return `${opener("worry", f.actualText, skip)}This is still at the practical level. What would happen, what you'd have to do, rather than the identity level. The fear needs to land on who you'd be if the opposite move happened, not on the immediate consequence of the move itself.`;
}

function renderDepthShortfallCommitment(f: AuditFinding, skip: boolean): string {
  return `${opener("commitment", f.actualText, skip)}This is still at the practical level. The vow needs to name the identity being protected and what the outside world would see you take the hit on, not the feeling or the situation you're avoiding.`;
}

function renderDepthShortfallAssumption(f: AuditFinding, skip: boolean): string {
  return `${opener("assumption", f.actualText, skip)}The then-clause hasn't reached identity depth yet. It needs to finish through to an identity landing or a Big Time Bad conclusion, not stop at a practical consequence.`;
}

function renderAssumptionCommitmentDrift(f: AuditFinding, skip: boolean): string {
  const head = opener("assumption", f.actualText, skip);
  const relatedQuote = f.relatedText
    ? `The paired commitment says: "${f.relatedText}" `
    : "";
  const reason = stripDetailPrefix(f.detail);
  return `${head}${relatedQuote}These have drifted apart. ${reason} Either sharpen the assumption so its if-clause names the exact scenario this commitment is protecting against, or the pair may be pointing at a missing commitment that hasn't been named yet.`;
}

function renderMergedDrift(findings: AuditFinding[], skip: boolean): string {
  const first = findings[0];
  const commitmentQuotes = findings
    .map((f) => (f.relatedText ? `"${f.relatedText}"` : null))
    .filter((s): s is string => s !== null);
  const joinedQuotes = joinList(commitmentQuotes);
  const reasons = findings
    .map((f, i) => {
      const label = ORDINALS[i] ?? `#${i + 1}`;
      return `Against the ${label}: ${stripDetailPrefix(f.detail)}`;
    })
    .join(" ");
  const head = opener("assumption", first.actualText, skip);
  const from = pluralCountPhrase(findings.length);
  return `${head}The paired commitments say: ${joinedQuotes}. These have drifted apart from ${from}. ${reasons} Either sharpen the assumption so its if-clause names the exact scenarios these commitments protect against, or the pair may be pointing at missing commitments that haven't been named yet.`;
}

function renderMergedRedundancy(findings: AuditFinding[], skip: boolean): string {
  const first = findings[0];
  const commitmentQuotes = findings
    .map((f) => (f.relatedText ? `"${f.relatedText}"` : null))
    .filter((s): s is string => s !== null);
  const joinedQuotes = joinList(commitmentQuotes);
  const reasons = findings
    .map((f, i) => {
      const label = ORDINALS[i] ?? `#${i + 1}`;
      return `Against the ${label}: ${stripDetailPrefix(f.detail)}`;
    })
    .join(" ");
  const head = opener("worry", first.actualText, skip);
  return `${head}The commitments that duplicate it: ${joinedQuotes}. These name the same identity concern the worry names, just in different forms. ${reasons} Either push the worry into a distinct identity concern, or drop it so the map isn't doubled up.`;
}

function renderAssumptionOverload(f: AuditFinding, skip: boolean): string {
  const reason = stripDetailPrefix(f.detail);
  return `${opener("assumption", f.actualText, skip)}This is carrying more weight than one belief can hold. ${reason} Additional Big Assumptions may need to be named so each commitment has an assumption pointed at its own specific concern.`;
}

function renderAssumptionUncoveredCommitment(f: AuditFinding, skip: boolean): string {
  return `${opener("commitment", f.actualText, skip)}No Big Assumption is linked to this one. The commitment is protecting something you haven't yet named as a testable belief, so nothing about it can be challenged with evidence. Draft a Big Assumption whose if-clause names the exact scenario this commitment is protecting against, and whose then-clause names the identity or Big Time Bad conclusion the commitment fears.`;
}

function renderTestCoverageGap(f: AuditFinding, skip: boolean): string {
  return `${opener("assumption", f.actualText, skip)}This has no active test on it. Untested assumptions still shape your behavior, but no evidence is being gathered against them. A data-mining test (looking back at what's already happened) or a thought experiment can gather evidence cheaply without staging a whole new behavioral round.`;
}

function renderTestGripThroughData(f: AuditFinding, skip: boolean): string {
  return `${opener("test result", f.actualText, skip)}The "what it says about the assumption" reading looks like the assumption still running the show, not a conclusion drawn from the data. When the world doesn't produce the predicted consequence, that's evidence AGAINST the assumption, not permission to double down on the protective move. Re-read the data as data, not as a prescription.`;
}

function renderWorryCommitmentRedundancy(f: AuditFinding, skip: boolean): string {
  const head = opener("worry", f.actualText, skip);
  const relatedQuote = f.relatedText
    ? `The commitment that duplicates it: "${f.relatedText}" `
    : "";
  const reason = stripDetailPrefix(f.detail);
  return `${head}${relatedQuote}These duplicate the same identity concern in two forms. ${reason} Either push the worry into a distinct identity concern, or drop it so the map isn't doubled up.`;
}

// ---------------------------------------------------------------------------
// Numbered action list — deduped by (entry, action-family)
// ---------------------------------------------------------------------------

function actionFamilyKey(f: AuditFinding): string {
  const entry = `${f.entryRef.table}:${f.entryRef.id}`;
  switch (f.issueType) {
    case "depth_shortfall_commitment":
    case "interior_witness_commitment":
      return `${entry}:commitment_identity_rewrite`;
    case "vague_assumption_then_clause":
    case "depth_shortfall_assumption":
      return `${entry}:assumption_identity_rewrite`;
    case "interior_witness_worry":
    case "depth_shortfall_worry":
      return `${entry}:worry_identity_rewrite`;
    case "assumption_commitment_drift":
      return `${entry}:assumption_drift`;
    default:
      return `${entry}:${f.issueType}`;
  }
}

function renderActionList(findings: AuditFinding[]): string {
  const byFamily = new Map<string, AuditFinding[]>();
  const order: string[] = [];
  for (const f of findings) {
    const key = actionFamilyKey(f);
    if (!byFamily.has(key)) {
      byFamily.set(key, []);
      order.push(key);
    }
    byFamily.get(key)!.push(f);
  }

  // Render each family, then dedupe by rendered text. Two different
  // families can produce the same action string (e.g., depth_shortfall
  // on two different commitments both render "Push the commitment to
  // identity depth…"). The paragraph section already quotes each
  // affected entry; the action list is a prescription, so identical
  // rendered items would just read as noise.
  const seen = new Set<string>();
  const uniqueActions: string[] = [];
  for (const key of order) {
    const action = renderMergedAction(key, byFamily.get(key)!);
    if (seen.has(action)) continue;
    seen.add(action);
    uniqueActions.push(action);
  }

  const items = uniqueActions
    .slice(0, 5)
    .map((action, i) => `${i + 1}. ${action}`);
  return items.join("\n");
}

function renderMergedAction(family: string, findings: AuditFinding[]): string {
  const uniqueTypes = new Set(findings.map((f) => f.issueType));
  if (family.endsWith(":commitment_identity_rewrite") && uniqueTypes.size > 1) {
    return 'Rewrite the commitment to name the identity you\'re never being AND the observable action a friend on your shoulder would see you take to protect it. Not "never seeing X" but "never being the [specific role] who [specific action]."';
  }
  if (family.endsWith(":assumption_identity_rewrite") && uniqueTypes.size > 1) {
    return 'Push the assumption\'s then-clause to identity depth. Write out the specific identity plainly. Not "the guy I\'m terrified of" but what that guy actually is.';
  }
  if (family.endsWith(":worry_identity_rewrite") && uniqueTypes.size > 1) {
    return "Rewrite the worry to land on the identity you'd have if the opposite move happened, and let the outside world be the one who registers it.";
  }
  if (family.endsWith(":assumption_drift") && findings.length > 1) {
    return "Sharpen the assumption so its if-clause names the exact scenarios both paired commitments protect against, or name missing commitments that pair cleanly with the current assumption.";
  }
  return renderActionItem(findings[0]);
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

const ORDINALS = ["first", "second", "third", "fourth", "fifth"] as const;
const CARDINALS = ["one", "two", "three", "four", "five"] as const;

/**
 * "both" for N=2, "all three" / "all four" / … for N>=3. Used in
 * merged-drift/redundancy templates so the count phrase reads
 * naturally regardless of how many entries fired.
 */
function pluralCountPhrase(n: number): string {
  if (n === 2) return "both";
  const word = CARDINALS[n - 1];
  return word ? `all ${word}` : `all ${n}`;
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Some check `detail` strings lead with a machinery-style summary
 * before the substantive reason. Strip the summary prefix so the
 * templated paragraph reads cleanly.
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
void _EXHAUSTIVENESS;
