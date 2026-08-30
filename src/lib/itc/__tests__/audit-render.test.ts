import { describe, expect, it } from "vitest";
import { renderAudit } from "../audit-render";
import type {
  AuditFinding,
  AuditIssueType,
  AuditSeverity,
} from "../audit-rules";

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
          issueType: "missing_commitment_stem",
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
          issueType: "missing_commitment_stem",
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
          issueType: "missing_commitment_stem",
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
          issueType: "worry_commitment_redundancy",
          severity: "observation",
          entryRef: { table: "worries", id: "w-1" },
          actualText: "I worry X",
          detail: "Same identity concern in two forms.",
          relatedText: "I am committed to Y",
          relatedEntryRef: { table: "commitments", id: "c-1" },
        }),
      ],
      CTX,
    );
    expect(prose).toMatch(/Duplicates the commitment "I am committed to Y"/i);
    expect(prose).toMatch(/Push this worry into a distinct/i);
  });

  it("merges multiple redundancy findings on the same worry into one clause", () => {
    const prose = renderAudit(
      [
        finding({
          issueType: "worry_commitment_redundancy",
          severity: "observation",
          entryRef: { table: "worries", id: "w-1" },
          actualText: "I worry X",
          detail: "Same concern.",
          relatedText: "commitment A",
          relatedEntryRef: { table: "commitments", id: "c-1" },
        }),
        finding({
          issueType: "worry_commitment_redundancy",
          severity: "observation",
          entryRef: { table: "worries", id: "w-1" },
          actualText: "I worry X",
          detail: "Same concern.",
          relatedText: "commitment B",
          relatedEntryRef: { table: "commitments", id: "c-2" },
        }),
      ],
      CTX,
    );
    // Worry quote once.
    const quoteCount = prose.split('"I worry X"').length - 1;
    expect(quoteCount).toBe(1);
    // Both commitments listed.
    expect(prose).toContain('"commitment A"');
    expect(prose).toContain('"commitment B"');
    expect(prose).toMatch(/Duplicates both commitments/i);
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
          issueType: "missing_commitment_stem",
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
