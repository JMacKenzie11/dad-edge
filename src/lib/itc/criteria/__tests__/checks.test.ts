import { describe, expect, it, vi } from "vitest";
import type {
  ItcAssumption,
  ItcAssumptionCommitment,
  ItcBehavior,
  ItcCommitment,
  ItcWorry,
} from "../../maps";
import type { Finding } from "../types";

// Mock the goal check so waterfall tests can drive the goal layer
// deterministically without hitting the LLM in checkBundledGoal.
vi.mock("../goal", () => ({
  checkBundledGoal: vi.fn(async () => [] as Finding[]),
}));

import { checkBehaviorDepth } from "../behaviors";
import {
  checkCommitmentDepth,
  checkCommitmentMirrorsWorry,
  checkInteriorWitnessInCommitments,
} from "../commitments";
import { checkAssumptionCoverage, checkAssumptionDepth, checkVagueAssumptionThenClause } from "../assumptions";
import { checkInteriorWitnessInWorries, checkWorryDepth } from "../worries";
import { checkBundledGoal } from "../goal";
import { runHoneWaterfall } from "../orchestrator";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeBehavior(overrides: Partial<ItcBehavior>): ItcBehavior {
  return {
    id: "behavior-1",
    map_id: "map-1",
    sort_order: 0,
    text: "I check my phone during dinner",
    source: "user",
    selected: true,
    depth_score: 3,
    rubric_reason: null,
    attempts: 1,
    coach_worry_draft: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeWorry(overrides: Partial<ItcWorry>): ItcWorry {
  return {
    id: "worry-1",
    map_id: "map-1",
    behavior_id: "behavior-1",
    text: "I worry that I would let my team down.",
    depth_score: 3,
    rubric_reason: null,
    attempts: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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
    mirrors_worry_identity: null,
    attempts: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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
    updated_at: new Date().toISOString(),
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
    expect(findings[0].suggestedFix).toBeUndefined();
    // Detail is sourced from ADVICE.interior_witness_worry — the
    // aligned copy that keeps the fix framed in first-person felt
    // dread (not "she'd see", which would violate is_first_person_felt).
    expect(findings[0].detail).toMatch(/interior-witness/i);
    expect(findings[0].detail).toMatch(/(I['\u2019]m afraid|I worry I['\u2019]m|I['\u2019]d be)/);
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
// checkCommitmentMirrorsWorry
// ---------------------------------------------------------------------------

describe("checkCommitmentMirrorsWorry", () => {
  it("flags a commitment whose stored mirrors_worry_identity is false", async () => {
    const worry = makeWorry({ id: "worry-1" });
    const commitment = makeCommitment({
      id: "commitment-1",
      worry_id: "worry-1",
      mirrors_worry_identity: false,
    });
    const findings = await checkCommitmentMirrorsWorry({
      commitments: [commitment],
      worries: [worry],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe("commitment_doesnt_mirror_worry");
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].relatedText).toBe(worry.text);
  });

  it("does not flag when mirrors_worry_identity is true", async () => {
    const commitment = makeCommitment({ mirrors_worry_identity: true });
    const findings = await checkCommitmentMirrorsWorry({
      commitments: [commitment],
      worries: [makeWorry({})],
    });
    expect(findings).toHaveLength(0);
  });

  it("does not flag legacy rows where mirrors_worry_identity is null", async () => {
    const commitment = makeCommitment({ mirrors_worry_identity: null });
    const findings = await checkCommitmentMirrorsWorry({
      commitments: [commitment],
      worries: [makeWorry({})],
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
// depth checks (per column)
// ---------------------------------------------------------------------------

describe("depth checks", () => {
  it("flags a selected behavior below depth 3", async () => {
    const behavior = makeBehavior({
      depth_score: 2,
      rubric_reason: "not observable enough",
    });
    const findings = await checkBehaviorDepth({ behaviors: [behavior] });
    expect(findings.map((f) => f.issueType)).toEqual([
      "depth_shortfall_behavior",
    ]);
    expect(findings[0].detail).toContain("not observable enough");
    expect(findings[0].severity).toBe("critical");
  });

  it("does not flag unselected behaviors even if they're at depth < 3", async () => {
    // Suggested-but-unselected behaviors aren't on the map, so they
    // shouldn't count against the honing pass.
    const behavior = makeBehavior({ selected: false, depth_score: 1 });
    const findings = await checkBehaviorDepth({ behaviors: [behavior] });
    expect(findings).toHaveLength(0);
  });

  it("does not flag behaviors with null depth_score (pre-scored legacy rows)", async () => {
    const behavior = makeBehavior({ depth_score: null });
    const findings = await checkBehaviorDepth({ behaviors: [behavior] });
    expect(findings).toHaveLength(0);
  });

  it("flags a worry below depth 3", async () => {
    const worry = makeWorry({
      depth_score: 2,
      rubric_reason: "no identity landing",
    });
    const findings = await checkWorryDepth({ worries: [worry] });
    expect(findings.map((f) => f.issueType)).toEqual([
      "depth_shortfall_worry",
    ]);
    expect(findings[0].detail).toContain("no identity landing");
  });

  it("flags a commitment below depth 3", async () => {
    const commitment = makeCommitment({ depth_score: 1 });
    const findings = await checkCommitmentDepth({ commitments: [commitment] });
    expect(findings.map((f) => f.issueType)).toEqual([
      "depth_shortfall_commitment",
    ]);
  });

  it("flags an assumption below depth 3", async () => {
    const assumption = makeAssumption({
      depth_score: 2,
      rubric_reason: "then-clause not finished",
    });
    const findings = await checkAssumptionDepth({ assumptions: [assumption] });
    expect(findings.map((f) => f.issueType)).toEqual([
      "depth_shortfall_assumption",
    ]);
  });

  it("skips entries with null score, and does not flag at depth 3", async () => {
    const worry = makeWorry({ depth_score: 3 });
    const assumption = makeAssumption({ depth_score: null });
    const wf = await checkWorryDepth({ worries: [worry] });
    const af = await checkAssumptionDepth({ assumptions: [assumption] });
    expect(wf).toHaveLength(0);
    expect(af).toHaveLength(0);
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
// runHoneWaterfall — stops at first broken column
// ---------------------------------------------------------------------------

describe("runHoneWaterfall", () => {
  it("returns worries findings when a worry is at depth < 3, without proceeding to commitments/assumptions", async () => {
    // Broken worry AND broken commitment AND broken assumption — waterfall
    // should stop at worries because that's the first broken layer.
    // Everything downstream will be re-derived when the worry is fixed.
    const worry = makeWorry({ id: "worry-1", depth_score: 2 });
    const commitment = makeCommitment({
      id: "c-1",
      worry_id: "worry-1",
      depth_score: 1, // also broken
    });
    const assumption = makeAssumption({
      id: "a-1",
      depth_score: 2, // also broken
    });
    const { column, findings } = await runHoneWaterfall({
      mapId: "map-1",
      goalText: "getting better at coaching my team",
      behaviors: [],
      worries: [worry],
      commitments: [commitment],
      assumptions: [assumption],
      assumptionLinks: [makeLink("a-1", "c-1")],
    });
    expect(column).toBe("worries");
    const types = new Set(findings.map((f) => f.issueType));
    expect(types.has("depth_shortfall_worry")).toBe(true);
    expect(types.has("depth_shortfall_commitment")).toBe(false);
    expect(types.has("depth_shortfall_assumption")).toBe(false);
  });

  it("proceeds past clean columns and stops at the first broken one", async () => {
    // Worries clean, commitments broken, assumptions broken. Should stop at
    // commitments.
    const worry = makeWorry({ id: "worry-1", depth_score: 3 });
    const commitment = makeCommitment({
      id: "c-1",
      worry_id: "worry-1",
      depth_score: 2,
      mirrors_worry_identity: true,
    });
    const assumption = makeAssumption({ id: "a-1", depth_score: 2 });
    const { column, findings } = await runHoneWaterfall({
      mapId: "map-1",
      goalText: "getting better at coaching my team",
      behaviors: [],
      worries: [worry],
      commitments: [commitment],
      assumptions: [assumption],
      assumptionLinks: [makeLink("a-1", "c-1")],
    });
    expect(column).toBe("commitments");
    const types = new Set(findings.map((f) => f.issueType));
    expect(types.has("depth_shortfall_commitment")).toBe(true);
    expect(types.has("depth_shortfall_assumption")).toBe(false);
  });

  it("returns column=null when every column holds up", async () => {
    const worry = makeWorry({ id: "worry-1", depth_score: 3 });
    const commitment = makeCommitment({
      id: "c-1",
      worry_id: "worry-1",
      depth_score: 3,
      mirrors_worry_identity: true,
    });
    const assumption = makeAssumption({ id: "a-1", depth_score: 3 });
    const { column, findings } = await runHoneWaterfall({
      mapId: "map-1",
      goalText: "getting better at coaching my team",
      behaviors: [],
      worries: [worry],
      commitments: [commitment],
      assumptions: [assumption],
      assumptionLinks: [makeLink("a-1", "c-1")],
    });
    expect(column).toBe(null);
    expect(findings).toHaveLength(0);
  });

  it("stops at behaviors when the goal is clean but a behavior is shallow", async () => {
    // Goal clean via mock default. Broken behavior + broken downstream
    // entries. Waterfall should land on behaviors and not check further.
    const behavior = makeBehavior({
      id: "b-1",
      depth_score: 2,
      rubric_reason: "too vague",
    });
    const worry = makeWorry({ id: "worry-1", depth_score: 2 });
    const commitment = makeCommitment({
      id: "c-1",
      worry_id: "worry-1",
      depth_score: 1,
    });
    const assumption = makeAssumption({ id: "a-1", depth_score: 2 });
    const { column, findings } = await runHoneWaterfall({
      mapId: "map-1",
      goalText: "getting better at coaching my team",
      behaviors: [behavior],
      worries: [worry],
      commitments: [commitment],
      assumptions: [assumption],
      assumptionLinks: [makeLink("a-1", "c-1")],
    });
    expect(column).toBe("behaviors");
    expect(findings.map((f) => f.issueType)).toEqual([
      "depth_shortfall_behavior",
    ]);
    // Nothing downstream fired.
    const types = new Set(findings.map((f) => f.issueType));
    expect(types.has("depth_shortfall_worry")).toBe(false);
    expect(types.has("depth_shortfall_commitment")).toBe(false);
    expect(types.has("depth_shortfall_assumption")).toBe(false);
  });

  it("stops at goal when the goal is broken, even if downstream columns are also broken", async () => {
    // Force a bundled-goal finding via the mock. Also stack broken
    // entries downstream to prove the waterfall doesn't look past
    // the goal when it fires.
    vi.mocked(checkBundledGoal).mockResolvedValueOnce([
      {
        entryRef: { table: "goal", id: "map-1" },
        issueType: "bundled_goal",
        severity: "critical",
        actualText: "getting better at coaching my team and building my business",
        detail: "Two distinct improvements.",
      },
    ]);
    const worry = makeWorry({ id: "worry-1", depth_score: 2 });
    const commitment = makeCommitment({
      id: "c-1",
      worry_id: "worry-1",
      depth_score: 1,
      mirrors_worry_identity: false,
    });
    const assumption = makeAssumption({ id: "a-1", depth_score: 2 });
    const { column, findings } = await runHoneWaterfall({
      mapId: "map-1",
      goalText: "getting better at coaching my team and building my business",
      behaviors: [],
      worries: [worry],
      commitments: [commitment],
      assumptions: [assumption],
      assumptionLinks: [makeLink("a-1", "c-1")],
    });
    expect(column).toBe("goal");
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe("bundled_goal");
    // Downstream columns weren't checked — waterfall stopped at goal.
    const types = new Set(findings.map((f) => f.issueType));
    expect(types.has("depth_shortfall_worry")).toBe(false);
    expect(types.has("depth_shortfall_commitment")).toBe(false);
    expect(types.has("depth_shortfall_assumption")).toBe(false);
  });

  it("stops at assumptions when only the assumption layer is broken (coverage gap)", async () => {
    // Goal / worries / commitments all clean; commitment has NO linked
    // assumption, so checkAssumptionCoverage should fire an
    // assumption_uncovered_commitment finding and the waterfall should
    // land on the assumptions column.
    const worry = makeWorry({ id: "worry-1", depth_score: 3 });
    const commitment = makeCommitment({
      id: "c-1",
      worry_id: "worry-1",
      depth_score: 3,
      mirrors_worry_identity: true,
    });
    // No assumption links — commitment is uncovered.
    const { column, findings } = await runHoneWaterfall({
      mapId: "map-1",
      goalText: "getting better at coaching my team",
      behaviors: [],
      worries: [worry],
      commitments: [commitment],
      assumptions: [],
      assumptionLinks: [],
    });
    expect(column).toBe("assumptions");
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe("assumption_uncovered_commitment");
    // The finding's entryRef points at the uncovered commitment (that's
    // where the fix lands), even though the waterfall column is
    // "assumptions".
    expect(findings[0].entryRef).toEqual({ table: "commitments", id: "c-1" });
  });
});
