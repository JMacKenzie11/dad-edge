import { describe, expect, it } from "vitest";
import {
  checkAssumptionCoverage,
  checkDepthShortfall,
  checkInteriorWitnessInCommitments,
  checkInteriorWitnessInWorries,
  checkMissingCommitmentStem,
  checkTestCoverage,
  checkVagueAssumptionThenClause,
  validateQuotesAgainstFindings,
  type AuditFinding,
} from "../audit-rules";
import type {
  ItcAssumption,
  ItcAssumptionCommitment,
  ItcCommitment,
  ItcTest,
  ItcWorry,
} from "../maps";

// ---------------------------------------------------------------------------
// Fixture builders — the audit checks take real ItcXYZ rows so we build
// minimally-populated ones with sensible defaults per test.
// ---------------------------------------------------------------------------

function makeWorry(overrides: Partial<ItcWorry>): ItcWorry {
  return {
    id: "worry-1",
    map_id: "map-1",
    behavior_id: "behavior-1",
    text: "I worry that I would let my team down.",
    depth_score: 3,
    rubric_reason: null,
    attempts: 1,
    coach_commitment_draft: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeCommitment(overrides: Partial<ItcCommitment>): ItcCommitment {
  return {
    id: "commitment-1",
    map_id: "map-1",
    worry_id: "worry-1",
    text: "I'm also committed to never being the coach who watched someone fail.",
    depth_score: 3,
    rubric_reason: null,
    attempts: 1,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeAssumption(overrides: Partial<ItcAssumption>): ItcAssumption {
  return {
    id: "assumption-1",
    map_id: "map-1",
    sort_order: 0,
    text: "I assume that if I let someone struggle without stepping in, then I've been the coach who abandoned them.",
    depth_score: 3,
    rubric_reason: null,
    attempts: 1,
    selected_for_testing: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeTest(overrides: Partial<ItcTest>): ItcTest {
  return {
    id: "test-1",
    map_id: "map-1",
    assumption_id: "assumption-1",
    test_type: "behavioral",
    assumption_says: null,
    behavior_change: null,
    data_to_collect: null,
    in_order_to_find_out: null,
    target_date: null,
    status: "designed",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeLink(
  assumption_id: string,
  commitment_id: string,
): ItcAssumptionCommitment {
  return { assumption_id, commitment_id };
}

// ---------------------------------------------------------------------------
// checkInteriorWitnessInWorries
// ---------------------------------------------------------------------------

describe("checkInteriorWitnessInWorries", () => {
  it("flags a worry with interior-witness verb pointed at a self-truth", async () => {
    const worry = makeWorry({
      text: "I worry that I'd have to see I've been faking it the whole time.",
    });
    const findings = await checkInteriorWitnessInWorries({
      worries: [worry],
      behaviors: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe("interior_witness_worry");
    expect(findings[0].actualText).toBe(worry.text);
    // Guidance lives in `detail` rather than `suggestedFix` — the
    // check can't produce a full rewrite of the specific worry
    // (identity content is coachee-specific), so the sharper-form
    // guidance is folded into detail and no suggestedFix is emitted.
    expect(findings[0].suggestedFix).toBeUndefined();
    expect(findings[0].detail).toMatch(/external witness/i);
  });

  it("does not flag a worry that already uses external witness", async () => {
    const worry = makeWorry({
      text: "I worry that she'd see the pattern is mine and stop trusting me.",
    });
    const findings = await checkInteriorWitnessInWorries({
      worries: [worry],
      behaviors: [],
    });
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// checkInteriorWitnessInCommitments
// ---------------------------------------------------------------------------

describe("checkInteriorWitnessInCommitments", () => {
  it("flags a commitment framed around avoiding a feeling", async () => {
    const commitment = makeCommitment({
      text: "I'm also committed to avoiding the feeling that I picked myself over her.",
    });
    const findings = await checkInteriorWitnessInCommitments({
      commitments: [commitment],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe("interior_witness_commitment");
    expect(findings[0].actualText).toBe(commitment.text);
  });

  it("flags a commitment that names a 'never seeing / never knowing' shape", async () => {
    const commitment = makeCommitment({
      text: "I'm also committed to never having to know I let the family down.",
    });
    const findings = await checkInteriorWitnessInCommitments({
      commitments: [commitment],
    });
    expect(findings).toHaveLength(1);
  });

  it("does not flag a commitment that names an observable identity move", async () => {
    const commitment = makeCommitment({
      text: "I'm also committed to never being the husband who lets his wife carry the load alone.",
    });
    const findings = await checkInteriorWitnessInCommitments({
      commitments: [commitment],
    });
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// checkMissingCommitmentStem
// ---------------------------------------------------------------------------

describe("checkMissingCommitmentStem", () => {
  it("flags a commitment that drops the 'also'", async () => {
    const commitment = makeCommitment({
      text: "I'm committed to never being the guy who lets his team down.",
    });
    const findings = await checkMissingCommitmentStem({
      commitments: [commitment],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe("missing_commitment_stem");
    expect(findings[0].suggestedFix).toMatch(/I'm also committed to/i);
  });

  it("does not flag a commitment that leads with the canonical stem", async () => {
    const commitment = makeCommitment({
      text: "I'm also committed to never being the coach who watched someone fail.",
    });
    const findings = await checkMissingCommitmentStem({
      commitments: [commitment],
    });
    expect(findings).toHaveLength(0);
  });

  it("tolerates smart apostrophes in the canonical stem", async () => {
    const commitment = makeCommitment({
      text: "I\u2019m also committed to never being the husband who chose ego over her.",
    });
    const findings = await checkMissingCommitmentStem({
      commitments: [commitment],
    });
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// checkVagueAssumptionThenClause
// ---------------------------------------------------------------------------

describe("checkVagueAssumptionThenClause", () => {
  it("flags a then-clause that gestures at 'the man I'm terrified of'", async () => {
    const assumption = makeAssumption({
      text: "I assume that if I let this go, then I'd be the man I'm terrified of becoming.",
    });
    const findings = await checkVagueAssumptionThenClause({
      assumptions: [assumption],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe("vague_assumption_then_clause");
    expect(findings[0].actualText).toBe(assumption.text);
  });

  it("does not flag a then-clause that names a specific identity", async () => {
    const assumption = makeAssumption({
      text: "I assume that if I stop covering for the team, then I've been the coach who never let them try things.",
    });
    const findings = await checkVagueAssumptionThenClause({
      assumptions: [assumption],
    });
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// checkDepthShortfall
// ---------------------------------------------------------------------------

describe("checkDepthShortfall", () => {
  it("flags worries, commitments, and assumptions below depth 3", async () => {
    const worry = makeWorry({
      id: "worry-shallow",
      depth_score: 2,
      rubric_reason: "no identity landing",
    });
    const commitment = makeCommitment({
      id: "commitment-shallow",
      depth_score: 1,
      rubric_reason: null,
    });
    const assumption = makeAssumption({
      id: "assumption-shallow",
      depth_score: 2,
      rubric_reason: "then-clause not finished",
    });
    const findings = await checkDepthShortfall({
      worries: [worry],
      commitments: [commitment],
      assumptions: [assumption],
    });
    expect(findings.map((f) => f.issueType).sort()).toEqual(
      [
        "depth_shortfall_assumption",
        "depth_shortfall_commitment",
        "depth_shortfall_worry",
      ].sort(),
    );
    const worryFinding = findings.find(
      (f) => f.issueType === "depth_shortfall_worry",
    );
    expect(worryFinding?.detail).toContain("no identity landing");
  });

  it("does not flag entries that meet depth 3, and skips null scores", async () => {
    const worry = makeWorry({ depth_score: 3 });
    const commitment = makeCommitment({ depth_score: 3 });
    const assumption = makeAssumption({ depth_score: null });
    const findings = await checkDepthShortfall({
      worries: [worry],
      commitments: [commitment],
      assumptions: [assumption],
    });
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// checkAssumptionCoverage
// ---------------------------------------------------------------------------

describe("checkAssumptionCoverage", () => {
  it("flags each commitment with no linked Big Assumption", async () => {
    const commitmentA = makeCommitment({ id: "c-1" });
    const commitmentB = makeCommitment({ id: "c-2" });
    const assumption = makeAssumption({ id: "a-1" });
    const links: ItcAssumptionCommitment[] = [makeLink("a-1", "c-1")];
    const findings = await checkAssumptionCoverage({
      commitments: [commitmentA, commitmentB],
      assumptions: [assumption],
      links,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe("assumption_uncovered_commitment");
    expect(findings[0].entryRef).toEqual({ table: "commitments", id: "c-2" });
  });

  it("does not flag when every commitment has a linked assumption", async () => {
    const commitmentA = makeCommitment({ id: "c-1" });
    const commitmentB = makeCommitment({ id: "c-2" });
    const links: ItcAssumptionCommitment[] = [
      makeLink("a-1", "c-1"),
      makeLink("a-2", "c-2"),
    ];
    const findings = await checkAssumptionCoverage({
      commitments: [commitmentA, commitmentB],
      assumptions: [makeAssumption({ id: "a-1" }), makeAssumption({ id: "a-2" })],
      links,
    });
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// checkTestCoverage
// ---------------------------------------------------------------------------

describe("checkTestCoverage", () => {
  it("flags each assumption with no active test", async () => {
    const assumptionA = makeAssumption({ id: "a-1" });
    const assumptionB = makeAssumption({ id: "a-2" });
    const tests = [makeTest({ assumption_id: "a-1", status: "designed" })];
    const findings = await checkTestCoverage({
      assumptions: [assumptionA, assumptionB],
      tests,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe("test_coverage_gap");
    expect(findings[0].entryRef).toEqual({ table: "assumptions", id: "a-2" });
  });

  it("treats abandoned tests as no coverage", async () => {
    const assumption = makeAssumption({ id: "a-1" });
    const tests = [
      makeTest({ assumption_id: "a-1", status: "abandoned" }),
    ];
    const findings = await checkTestCoverage({
      assumptions: [assumption],
      tests,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].entryRef).toEqual({ table: "assumptions", id: "a-1" });
  });

  it("does not flag when every assumption has at least one active test", async () => {
    const assumption = makeAssumption({ id: "a-1" });
    const tests = [makeTest({ assumption_id: "a-1", status: "designed" })];
    const findings = await checkTestCoverage({
      assumptions: [assumption],
      tests,
    });
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateQuotesAgainstFindings — verbatim-quote validator
// ---------------------------------------------------------------------------

describe("validateQuotesAgainstFindings", () => {
  function findingFor(text: string): AuditFinding {
    return {
      entryRef: { table: "commitments", id: "c-1" },
      issueType: "interior_witness_commitment",
      severity: "moderate",
      actualText: text,
      detail: "sample detail",
    };
  }

  it("normalizes a near-full paraphrase back to the exact actualText", () => {
    const source =
      "I'm also committed to never seeing that my defensive behaviour is the problem.";
    // LLM dropped the "also" — the exact hallucination that keeps
    // showing up in synthesis output.
    const prose = `Your commitment now: "I'm committed to never seeing that my defensive behaviour is the problem." That's framed around a feeling.`;
    const { prose: fixed, violations } = validateQuotesAgainstFindings(
      prose,
      [findingFor(source)],
    );
    expect(fixed).toContain(`"${source}"`);
    expect(fixed).not.toContain(
      `"I'm committed to never seeing that my defensive behaviour is the problem."`,
    );
    expect(violations).toHaveLength(1);
  });

  it("leaves an exact-match quote untouched", () => {
    const source =
      "I'm also committed to never being the guy who isn't enough for her.";
    const prose = `Your commitment now: "${source}" That holds up.`;
    const { prose: fixed, violations } = validateQuotesAgainstFindings(
      prose,
      [findingFor(source)],
    );
    expect(fixed).toBe(prose);
    expect(violations).toHaveLength(0);
  });

  it("leaves a legitimate partial-substring quote alone", () => {
    // Coach quotes a fragment from a long actualText — that's fine,
    // not an attempted full quote, no rewrite.
    const source =
      "I assume that if I stop protecting her from my failures, then she'd see the pattern and I'd be the husband I'm terrified I am.";
    const prose = `The then-clause says "the husband I'm terrified I am" which is vague.`;
    const { prose: fixed, violations } = validateQuotesAgainstFindings(
      prose,
      [findingFor(source)],
    );
    expect(fixed).toBe(prose);
    expect(violations).toHaveLength(0);
  });

  it("does not touch quotes that don't near-match any source", () => {
    const source =
      "I'm also committed to never being the guy who isn't enough for her.";
    const prose = `Try something like "she'd see the pattern is mine" as a rewrite.`;
    const { prose: fixed, violations } = validateQuotesAgainstFindings(
      prose,
      [findingFor(source)],
    );
    expect(fixed).toBe(prose);
    expect(violations).toHaveLength(0);
  });
});
