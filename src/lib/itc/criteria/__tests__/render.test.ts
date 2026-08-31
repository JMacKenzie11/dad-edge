import { describe, expect, it } from "vitest";
import { renderFindings } from "../render";
import type { Finding, IssueType, Severity } from "../types";

type AuditFinding = Finding;
type AuditIssueType = IssueType;
type AuditSeverity = Severity;

/** Shim: pre-refactor tests called renderAudit(findings, context)
 *  which was hone mode by default. Preserve that here so this large
 *  test file didn't need per-call edits. */
function renderAudit(
  findings: AuditFinding[],
  context: { goalText: string; pillarLabel: string },
): string {
  return renderFindings(findings, {
    goalText: context.goalText,
    pillarLabel: context.pillarLabel,
    mode: "hone",
  });
}

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function finding(overrides: Partial<AuditFinding>): AuditFinding {
  return {
    entryRef: { table: "map", id: "map-1" },
    issueType: "bundled_goal",
    severity: "moderate",
    actualText: "sample text",
    detail: "sample detail",
    ...overrides,
  };
}

const CTX = { goalText: "sample goal", pillarLabel: "Bond" };

// ---------------------------------------------------------------------------
// Opening + empty behavior
// ---------------------------------------------------------------------------

describe("renderAudit — opening and empty", () => {
  it("returns a map-holds-up message when the findings list is empty", () => {
    const prose = renderAudit([], CTX);
    expect(prose).toMatch(/holds up/i);
    expect(prose).toContain("Bond");
    // No column headers when nothing's wrong.
    expect(prose).not.toMatch(/Your worries:/i);
    expect(prose).not.toMatch(/Your competing commitments:/i);
  });

  it("adjusts the opening based on severity distribution", () => {
    const critProse = renderAudit(
      [finding({ severity: "critical", issueType: "bundled_goal" })],
      CTX,
    );
    expect(critProse).toMatch(/critical/i);

    const modProse = renderAudit(
      [
        finding({
          severity: "moderate",
          issueType: "interior_witness_worry",
          entryRef: { table: "worries", id: "w-1" },
        }),
      ],
      CTX,
    );
    expect(modProse).toMatch(/holds up/i);
    expect(modProse).not.toMatch(/critical/i);
  });
});

// ---------------------------------------------------------------------------
// Column structure
// ---------------------------------------------------------------------------

describe("renderAudit — column structure", () => {
  it("groups findings under per-column headers, top-down (worries → commitments → assumptions)", () => {
    const prose = renderAudit(
      [
        finding({
          issueType: "depth_shortfall_assumption",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: "assumption text",
        }),
        finding({
          issueType: "depth_shortfall_worry",
          severity: "critical",
          entryRef: { table: "worries", id: "w-1" },
          actualText: "worry text",
        }),
        finding({
          issueType: "commitment_doesnt_mirror_worry",
          severity: "moderate",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: "I am committed to X",
        }),
      ],
      CTX,
    );
    const worriesIdx = prose.indexOf("Your worries:");
    const commitmentsIdx = prose.indexOf("Your competing commitments:");
    const assumptionsIdx = prose.indexOf("Your Big Assumptions:");
    expect(worriesIdx).toBeGreaterThan(-1);
    expect(commitmentsIdx).toBeGreaterThan(-1);
    expect(assumptionsIdx).toBeGreaterThan(-1);
    // Column order.
    expect(worriesIdx).toBeLessThan(commitmentsIdx);
    expect(commitmentsIdx).toBeLessThan(assumptionsIdx);
  });

  it("skips a column header entirely when the column has no findings", () => {
    const prose = renderAudit(
      [
        finding({
          issueType: "depth_shortfall_worry",
          severity: "critical",
          entryRef: { table: "worries", id: "w-1" },
          actualText: "worry text",
        }),
      ],
      CTX,
    );
    expect(prose).toContain("Your worries:");
    expect(prose).not.toContain("Your competing commitments:");
    expect(prose).not.toContain("Your Big Assumptions:");
  });
});

// ---------------------------------------------------------------------------
// Per-entry paragraph shape
// ---------------------------------------------------------------------------

describe("renderAudit — per-entry paragraph shape", () => {
  it("renders single-critique entries as quote + one plain-sentence fix", () => {
    const prose = renderAudit(
      [
        finding({
          issueType: "depth_shortfall_worry",
          severity: "critical",
          entryRef: { table: "worries", id: "w-1" },
          actualText: "I worry X will happen",
        }),
      ],
      CTX,
    );
    expect(prose).toContain('"I worry X will happen"');
    expect(prose).toMatch(/Push it to identity depth/i);
    // No "N things to fix" enumeration for a single critique.
    expect(prose).not.toMatch(/things to fix/i);
  });

  it("enumerates multi-critique entries as 'N things to fix. (a) … (b) … (c) …'", () => {
    // Commitment with three structural critiques: stem + interior + depth.
    const prose = renderAudit(
      [
        finding({
          issueType: "commitment_doesnt_mirror_worry",
          severity: "moderate",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: "I am committed to avoiding the feeling that Y",
        }),
        finding({
          issueType: "interior_witness_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: "I am committed to avoiding the feeling that Y",
        }),
        finding({
          issueType: "depth_shortfall_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: "I am committed to avoiding the feeling that Y",
        }),
      ],
      CTX,
    );
    // Quote appears once.
    const quoteCount =
      prose.split('"I am committed to avoiding the feeling that Y"').length - 1;
    expect(quoteCount).toBe(1);
    // Enumerated as "Three things to fix. (a) … (b) … (c) …"
    expect(prose).toMatch(/Three things to fix\./);
    expect(prose).toContain("(a)");
    expect(prose).toContain("(b)");
    expect(prose).toContain("(c)");
    // All three fix phrasings appear.
    expect(prose).toMatch(/I'm also committed to/i);
    expect(prose).toMatch(/never being the/i);
    expect(prose).toMatch(/identity depth/i);
  });

  it("orders enumerated critiques stably (stem → interior → depth)", () => {
    const prose = renderAudit(
      [
        // Deliberately reversed insertion order.
        finding({
          issueType: "depth_shortfall_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: "commitment text",
        }),
        finding({
          issueType: "interior_witness_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: "commitment text",
        }),
        finding({
          issueType: "commitment_doesnt_mirror_worry",
          severity: "moderate",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: "commitment text",
        }),
      ],
      CTX,
    );
    const stemIdx = prose.indexOf("I'm also committed to");
    const interiorIdx = prose.indexOf("never being the");
    const depthIdx = prose.indexOf("identity depth");
    expect(stemIdx).toBeGreaterThan(-1);
    expect(interiorIdx).toBeGreaterThan(-1);
    expect(depthIdx).toBeGreaterThan(-1);
    expect(stemIdx).toBeLessThan(interiorIdx);
    expect(interiorIdx).toBeLessThan(depthIdx);
  });
});

// ---------------------------------------------------------------------------
// Drift / overload / redundancy clauses
// ---------------------------------------------------------------------------

describe("renderAudit — drift, overload, redundancy clauses", () => {
  it("renders single drift as a per-entry clause with scenario + identity", () => {
    const prose = renderAudit(
      [
        finding({
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: "assumption text",
          detail: "Different concerns.",
          relatedText: "I'm also committed to X",
          relatedEntryRef: { table: "commitments", id: "c-1" },
          assumptionScenario: "scenario A",
          commitmentIdentity: "identity 1",
        }),
      ],
      CTX,
    );
    expect(prose).toMatch(/Sharpen the "if" half/i);
    expect(prose).toContain("scenario A");
    expect(prose).toContain("identity 1");
    expect(prose).toContain('"I\'m also committed to X"');
  });

  it("merges multiple drift findings on the same assumption into one clause", () => {
    const prose = renderAudit(
      [
        finding({
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: "assumption A",
          detail: "Different concerns.",
          relatedText: "commitment 1",
          relatedEntryRef: { table: "commitments", id: "c-1" },
          assumptionScenario: "shared scenario",
          commitmentIdentity: "identity 1",
        }),
        finding({
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: "assumption A",
          detail: "Different concerns.",
          relatedText: "commitment 2",
          relatedEntryRef: { table: "commitments", id: "c-2" },
          assumptionScenario: "shared scenario",
          commitmentIdentity: "identity 2",
        }),
        finding({
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: "assumption A",
          detail: "Different concerns.",
          relatedText: "commitment 3",
          relatedEntryRef: { table: "commitments", id: "c-3" },
          assumptionScenario: "shared scenario",
          commitmentIdentity: "identity 3",
        }),
      ],
      CTX,
    );
    // Assumption quote appears once (per-entry group).
    const quoteCount = prose.split('"assumption A"').length - 1;
    expect(quoteCount).toBe(1);
    // Shared scenario stated once (factored out of per-pair beats).
    const scenarioCount = prose.split("shared scenario").length - 1;
    expect(scenarioCount).toBe(1);
    // All three identities appear.
    expect(prose).toContain("identity 1");
    expect(prose).toContain("identity 2");
    expect(prose).toContain("identity 3");
    // Uses "all three" for N>=3.
    expect(prose).toMatch(/all three paired commitments/i);
  });

  it("uses 'both' for N=2 merged drift", () => {
    const prose = renderAudit(
      [
        finding({
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: "assumption A",
          detail: "Different concerns.",
          relatedText: "commitment 1",
          relatedEntryRef: { table: "commitments", id: "c-1" },
          assumptionScenario: "shared scenario",
          commitmentIdentity: "identity 1",
        }),
        finding({
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: "assumption A",
          detail: "Different concerns.",
          relatedText: "commitment 2",
          relatedEntryRef: { table: "commitments", id: "c-2" },
          assumptionScenario: "shared scenario",
          commitmentIdentity: "identity 2",
        }),
      ],
      CTX,
    );
    expect(prose).toMatch(/both paired commitments/i);
  });

  it("renders overload as a clause carrying the LLM detail plus generic fix", () => {
    const prose = renderAudit(
      [
        finding({
          issueType: "assumption_overload",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: "assumption text",
          detail:
            "Assumption is carrying multiple distinct identity concerns. Distinct: helper vs provider.",
        }),
      ],
      CTX,
    );
    expect(prose).toMatch(/Carrying more weight than one belief can hold/i);
    // Machinery prefix stripped, substantive reason kept.
    expect(prose).toContain("Distinct: helper vs provider.");
    expect(prose).toMatch(/Draft additional Big Assumptions/i);
  });

  it("renders single redundancy as a per-worry clause", () => {
    const prose = renderAudit(
      [
        finding({
          issueType: "worry_redundancy",
          severity: "observation",
          entryRef: { table: "worries", id: "w-2" },
          actualText: "I worry X",
          detail: "Same identity concern in two forms.",
          relatedText: "I worry that Y",
          relatedEntryRef: { table: "worries", id: "w-1" },
        }),
      ],
      CTX,
    );
    expect(prose).toMatch(/Duplicates the worry "I worry that Y"/i);
    expect(prose).toMatch(/Push this worry into a distinct/i);
  });

  it("merges multiple redundancy findings on the same worry into one clause", () => {
    const prose = renderAudit(
      [
        finding({
          issueType: "worry_redundancy",
          severity: "observation",
          entryRef: { table: "worries", id: "w-3" },
          actualText: "I worry X",
          detail: "Same concern.",
          relatedText: "worry A",
          relatedEntryRef: { table: "worries", id: "w-1" },
        }),
        finding({
          issueType: "worry_redundancy",
          severity: "observation",
          entryRef: { table: "worries", id: "w-3" },
          actualText: "I worry X",
          detail: "Same concern.",
          relatedText: "worry B",
          relatedEntryRef: { table: "worries", id: "w-2" },
        }),
      ],
      CTX,
    );
    // Worry quote once.
    const quoteCount = prose.split('"I worry X"').length - 1;
    expect(quoteCount).toBe(1);
    // Both related worries listed.
    expect(prose).toContain('"worry A"');
    expect(prose).toContain('"worry B"');
    expect(prose).toMatch(/Duplicates both worries/i);
  });

  it("combines generic critiques with drift/overload in one enumerated paragraph", () => {
    // An assumption with vague-then + drift + overload should render as
    // a single paragraph enumerating all three fixes.
    const prose = renderAudit(
      [
        finding({
          issueType: "vague_assumption_then_clause",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: "assumption text",
          detail: "Vague then.",
        }),
        finding({
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: "assumption text",
          detail: "Different concerns.",
          relatedText: "commitment 1",
          assumptionScenario: "scenario X",
          commitmentIdentity: "identity 1",
        }),
        finding({
          issueType: "assumption_overload",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: "assumption text",
          detail: "Distinct concerns.",
        }),
      ],
      CTX,
    );
    // Quote once.
    const quoteCount = prose.split('"assumption text"').length - 1;
    expect(quoteCount).toBe(1);
    // Enumerated with three clauses.
    expect(prose).toMatch(/Three things to fix\./);
    expect(prose).toContain("(a)");
    expect(prose).toContain("(b)");
    expect(prose).toContain("(c)");
    expect(prose).toMatch(/Name the identity plainly/i); // vague-then
    expect(prose).toMatch(/Sharpen the "if" half/i); // drift
    expect(prose).toMatch(/Carrying more weight/i); // overload
  });
});

// ---------------------------------------------------------------------------
// Exhaustiveness + voice hygiene
// ---------------------------------------------------------------------------

describe("renderAudit — exhaustiveness and voice hygiene", () => {
  it("renders every issue type without throwing", () => {
    const allIssueTypes: AuditIssueType[] = [
      "bundled_goal",
      "interior_witness_worry",
      "interior_witness_commitment",
      "commitment_doesnt_mirror_worry",
      "vague_assumption_then_clause",
      "depth_shortfall_worry",
      "depth_shortfall_commitment",
      "depth_shortfall_assumption",
      "assumption_commitment_drift",
      "assumption_overload",
      "assumption_uncovered_commitment",
      "test_coverage_gap",
      "test_grip_through_data",
      "worry_redundancy",
    ];
    const severities: AuditSeverity[] = [
      "critical",
      "moderate",
      "observation",
    ];
    for (const issueType of allIssueTypes) {
      for (const severity of severities) {
        const f = finding({
          issueType,
          severity,
          actualText: "sample entry text for rendering",
          detail: "sample explanatory detail for the issue",
          suggestedFix: "sample suggested fix",
          relatedText: "sample paired entry text",
          relatedEntryRef: { table: "commitments", id: "c-related" },
          assumptionScenario: "sample scenario",
          commitmentIdentity: "sample identity",
        });
        expect(() => renderAudit([f], CTX)).not.toThrow();
      }
    }
  });

  it("does not include machinery words (rubric, depth score, criterion, canonical stem, interior reckoning, if-clause, then-clause)", () => {
    const prose = renderAudit(
      [
        finding({
          severity: "critical",
          issueType: "depth_shortfall_worry",
          entryRef: { table: "worries", id: "w-1" },
          actualText: "I worry I'd fall behind",
          detail:
            "Worry hasn't reached identity depth yet. The fear needs to land on who he'd be, not on the immediate consequence.",
        }),
        finding({
          severity: "moderate",
          issueType: "commitment_doesnt_mirror_worry",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: "I am committed to X",
        }),
      ],
      CTX,
    );
    expect(prose).not.toMatch(/\brubric\b/i);
    expect(prose).not.toMatch(/\bdepth score\b/i);
    expect(prose).not.toMatch(/\bcriterion\b/i);
    expect(prose).not.toMatch(/canonical stem/i);
    expect(prose).not.toMatch(/interior reckoning/i);
    // "if-clause" / "then-clause" replaced by "'if' half" / "'then' half".
    expect(prose).not.toMatch(/if-clause/i);
    expect(prose).not.toMatch(/then-clause/i);
  });
});

// ---------------------------------------------------------------------------
// column_review mode — end-of-column construction feedback
// ---------------------------------------------------------------------------

/** Shim for column_review mode so each test can add findings without
 *  re-typing the full RenderContext every time. */
function renderColumnReview(
  findings: AuditFinding[],
  columnLabel: string,
): string {
  return renderFindings(findings, {
    goalText: "sample goal",
    pillarLabel: "Bond",
    mode: "column_review",
    columnLabel,
  });
}

describe("renderFindings — column_review mode", () => {
  it("returns a column-holds-up empty state that names the column", () => {
    const prose = renderColumnReview([], "Your worries");
    expect(prose).toMatch(/your worries holds up/i);
    expect(prose).toMatch(/carry on/i);
    // Does not fall back to the hone-mode "map holds up" phrasing.
    expect(prose).not.toMatch(/Bond map holds up/i);
    // No column headers, no findings.
    expect(prose).not.toContain("Your competing commitments:");
    expect(prose).not.toContain("Your Big Assumptions:");
  });

  it("falls back to a generic label when columnLabel is not provided", () => {
    const prose = renderFindings([], {
      goalText: "sample goal",
      pillarLabel: "Bond",
      mode: "column_review",
    });
    expect(prose).toMatch(/this column holds up/i);
  });

  it("opens with the column label + severity count on a single-critical finding", () => {
    const prose = renderColumnReview(
      [
        finding({
          issueType: "depth_shortfall_worry",
          severity: "critical",
          entryRef: { table: "worries", id: "w-1" },
          actualText: "I worry X will happen",
        }),
      ],
      "Your worries",
    );
    // Column-review opening — mentions the column, not the whole map.
    expect(prose).toMatch(/one critical thing to sharpen on your worries/i);
    // Hone-mode phrasing should be absent — this is a column-scoped
    // review, not a whole-map audit.
    expect(prose).not.toMatch(/Bond map/i);
    expect(prose).not.toMatch(/hone pass/i);
    // Column section still renders under its header.
    expect(prose).toContain("Your worries:");
    // Per-entry paragraph still renders quote + fix inline.
    expect(prose).toContain('"I worry X will happen"');
    expect(prose).toMatch(/Push it to identity depth/i);
  });

  it("uses the moderate-only phrasing when there are no criticals or observations", () => {
    const prose = renderColumnReview(
      [
        finding({
          issueType: "interior_witness_worry",
          severity: "moderate",
          entryRef: { table: "worries", id: "w-1" },
          actualText: "I worry I'd have to see the truth about myself",
        }),
        finding({
          issueType: "interior_witness_worry",
          severity: "moderate",
          entryRef: { table: "worries", id: "w-2" },
          actualText: "I worry I'd have to face who I am",
        }),
      ],
      "Your worries",
    );
    expect(prose).toMatch(/2 things worth sharpening on your worries/i);
    expect(prose).not.toMatch(/critical/i);
    // Both worry entries appear with their own quoted openers.
    expect(prose).toContain('"I worry I\'d have to see the truth about myself"');
    expect(prose).toContain('"I worry I\'d have to face who I am"');
  });

  it("renders only the section for the column being reviewed even when finding data straddles tables", () => {
    // Column reviews are scoped: the caller only ever passes findings
    // for one column via runColumnCriteria, but the renderer is
    // section-driven, so verify it still lands correctly with a
    // single-column payload.
    const prose = renderColumnReview(
      [
        finding({
          issueType: "commitment_doesnt_mirror_worry",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: "I'm also committed to being present",
          relatedText: "I worry that I'd let my team down",
        }),
      ],
      "Your competing commitments",
    );
    expect(prose).toMatch(
      /one critical thing to sharpen on your competing commitments/i,
    );
    // Only the commitments section header appears.
    expect(prose).toContain("Your competing commitments:");
    expect(prose).not.toContain("Your worries:");
    expect(prose).not.toContain("Your Big Assumptions:");
    // Fix clause references the "rewrite as vow" template line.
    expect(prose).toMatch(/I'm also committed to never/i);
  });

  it("shares the same per-entry rendering as hone mode (same voice, same quote-plus-fix shape)", () => {
    const sharedFinding = finding({
      issueType: "depth_shortfall_commitment",
      severity: "critical",
      entryRef: { table: "commitments", id: "c-1" },
      actualText: "I am committed to trying harder",
    });
    const columnProse = renderFindings([sharedFinding], {
      goalText: "sample goal",
      pillarLabel: "Bond",
      mode: "column_review",
      columnLabel: "Your competing commitments",
    });
    const honeProse = renderFindings([sharedFinding], {
      goalText: "sample goal",
      pillarLabel: "Bond",
      mode: "hone",
    });
    // Opening lines diverge (mode-tuned) — grab everything after the
    // first blank line so we can compare the entry body itself.
    const columnBody = columnProse.split("\n\n").slice(1).join("\n\n");
    const honeBody = honeProse.split("\n\n").slice(1).join("\n\n");
    expect(columnBody).toBe(honeBody);
    // Both include the same quote + fix.
    expect(columnBody).toContain('"I am committed to trying harder"');
    expect(columnBody).toMatch(/identity depth/i);
  });
});
