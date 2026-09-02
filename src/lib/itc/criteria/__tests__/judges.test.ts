/**
 * The two LLM-backed Column 5 checks, with the model mocked so the
 * tests pin the CONTRACT: how a verdict turns into a finding, which
 * entries get judged at all, and that both checks fail open.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ItcAssumption,
  ItcAssumptionCommitment,
  ItcBehavior,
  ItcCommitment,
} from "../../maps";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }));
vi.mock("@/lib/model-config", () => ({
  utilityModel: () => "utility-model",
  mainModel: () => "main-model",
}));

import {
  checkAssumptionEnactable,
  checkAssumptionsHaveAnEnactableIf,
  checkAssumptionUnderwritesCommitments,
  judgeAssumptionUnderwrites,
} from "../assumptions";

function assumption(overrides: Partial<ItcAssumption>): ItcAssumption {
  return {
    id: "a-1",
    map_id: "map-1",
    sort_order: 0,
    text: "I assume that if I stay in the room, then I'd lose it and be the husband who hurts her.",
    depth_score: 3,
    rubric_reason: null,
    sharpen_text: null,
    suggested_fix: null,
    attempts: 1,
    selected_for_testing: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function commitment(id: string, text: string): ItcCommitment {
  return {
    id,
    map_id: "map-1",
    worry_id: `w-${id}`,
    text,
    depth_score: 3,
    rubric_reason: null,
    sharpen_text: null,
    suggested_fix: null,
    mirrors_worry_identity: true,
    attempts: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function behavior(id: string, text: string, selected = true): ItcBehavior {
  return {
    id,
    map_id: "map-1",
    sort_order: 0,
    text,
    source: "user",
    selected,
    depth_score: 3,
    rubric_reason: null,
    sharpen_text: null,
    suggested_fix: null,
    attempts: 1,
    coach_worry_draft: null,
    coach_worry_draft_depth_score: null,
    coach_worry_draft_rubric_reason: null,
    created_at: new Date().toISOString(),
  };
}

const link = (a: string, c: string): ItcAssumptionCommitment => ({
  assumption_id: a,
  commitment_id: c,
});

beforeEach(() => {
  generateObject.mockReset();
});

describe("judgeAssumptionUnderwrites", () => {
  it("returns every index in exactly one list, ignoring indices the model invents", async () => {
    generateObject.mockResolvedValue({
      object: { fits: [1], doesnt_fit: [{ index: 2, reason: "different scene" }, { index: 9, reason: "?" }] },
    });
    const v = await judgeAssumptionUnderwrites({
      assumptionText: "x",
      commitments: [
        { index: 1, text: "a" },
        { index: 2, text: "b" },
        { index: 3, text: "c" },
      ],
    });
    expect(v.fits).toEqual([1, 3]);
    expect(v.doesntFit).toEqual([{ index: 2, reason: "different scene" }]);
  });
});

describe("checkAssumptionUnderwritesCommitments", () => {
  const c1 = commitment("c-1", "I'm also committed to never being the man who can't handle her anger.");
  const c2 = commitment("c-2", "I'm also committed to never being the guy whose team sees he has no answer.");
  const c3 = commitment("c-3", "I'm also committed to never being the husband who says what he can't take back.");

  it("judges a single-link assumption too (Appendix A criterion 1 asks it of every one)", async () => {
    generateObject.mockResolvedValue({
      object: { fits: [], doesnt_fit: [{ index: 1, reason: "different scene" }] },
    });
    const findings = await checkAssumptionUnderwritesCommitments({
      assumptions: [assumption({})],
      commitments: [c1, c2],
      links: [link("a-1", "c-1")],
    });
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(findings).toHaveLength(1);
    expect(findings[0].unfitCommitmentPositions).toEqual([1]);
  });

  it("skips an assumption with no links at all (nothing to judge)", async () => {
    const findings = await checkAssumptionUnderwritesCommitments({
      assumptions: [assumption({})],
      commitments: [c1, c2],
      links: [],
    });
    expect(findings).toEqual([]);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("fires one finding per assumption naming the unfit commitments by map position", async () => {
    generateObject.mockResolvedValue({
      object: { fits: [1, 3], doesnt_fit: [{ index: 2, reason: "work, not home" }] },
    });
    const findings = await checkAssumptionUnderwritesCommitments({
      assumptions: [assumption({})],
      commitments: [c1, c2, c3],
      links: [link("a-1", "c-1"), link("a-1", "c-2"), link("a-1", "c-3")],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe("assumption_doesnt_underwrite");
    expect(findings[0].severity).toBe("moderate");
    expect(findings[0].entryRef).toEqual({ table: "assumptions", id: "a-1" });
    expect(findings[0].unfitCommitmentPositions).toEqual([2]);
    // One call for the whole cluster, not one per link.
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it("no finding when every linked commitment fits (the guide's many-to-one target)", async () => {
    generateObject.mockResolvedValue({ object: { fits: [1, 2], doesnt_fit: [] } });
    const findings = await checkAssumptionUnderwritesCommitments({
      assumptions: [assumption({})],
      commitments: [c1, c3],
      links: [link("a-1", "c-1"), link("a-1", "c-3")],
    });
    expect(findings).toEqual([]);
  });

  it("fails open when the model errors", async () => {
    generateObject.mockRejectedValue(new Error("boom"));
    const findings = await checkAssumptionUnderwritesCommitments({
      assumptions: [assumption({})],
      commitments: [c1, c3],
      links: [link("a-1", "c-1"), link("a-1", "c-3")],
    });
    expect(findings).toEqual([]);
  });
});

describe("checkAssumptionEnactable", () => {
  const b1 = behavior("b-1", "I walk out when she raises her voice.");
  const b2 = behavior("b-2", "I don't ask what she needs.", false);

  it("fires a moderate finding when the 'if' isn't his move, and only sends selected behaviors", async () => {
    generateObject.mockResolvedValue({
      object: { enactable: false, reverses_behavior_index: null, reason: "an outcome, not an act" },
    });
    const findings = await checkAssumptionEnactable({
      assumptions: [
        assumption({
          text: "I assume that if something important goes badly, then I can't be trusted.",
        }),
      ],
      behaviors: [b1, b2],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe("assumption_not_enactable");
    expect(findings[0].severity).toBe("moderate");
    const prompt = generateObject.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("I walk out when she raises her voice.");
    expect(prompt).not.toContain("I don't ask what she needs.");
  });

  it("no finding when the 'if' is his move", async () => {
    generateObject.mockResolvedValue({
      object: { enactable: true, reverses_behavior_index: 1, reason: "his move" },
    });
    expect(
      await checkAssumptionEnactable({ assumptions: [assumption({})], behaviors: [b1] }),
    ).toEqual([]);
  });

  it("fails open when the model errors", async () => {
    generateObject.mockRejectedValue(new Error("boom"));
    expect(
      await checkAssumptionEnactable({ assumptions: [assumption({})], behaviors: [b1] }),
    ).toEqual([]);
  });
});

describe("checkAssumptionsHaveAnEnactableIf (hone: map-level, Vol 1 p 4)", () => {
  const b1 = behavior("b-1", "I walk out when she raises her voice.");
  const root = assumption({
    id: "a-root",
    text: "I assume that if something important goes badly, then I can't be trusted.",
  });
  const child = assumption({
    id: "a-child",
    text: "I assume that if I stay in the room while she's angry, then I'd lose it and be the husband who hurts her.",
  });

  it("stays quiet when at least one assumption is enactable, even if the root isn't", async () => {
    generateObject.mockImplementation(async ({ prompt }: { prompt: string }) => ({
      object: prompt.includes("stay in the room")
        ? { enactable: true, reverses_behavior_index: 1, reason: "his move" }
        : { enactable: false, reverses_behavior_index: null, reason: "an outcome" },
    }));
    const findings = await checkAssumptionsHaveAnEnactableIf({
      assumptions: [root, child],
      behaviors: [b1],
    });
    expect(findings).toEqual([]);
  });

  it("fires on every assumption when none is enactable", async () => {
    generateObject.mockResolvedValue({
      object: { enactable: false, reverses_behavior_index: null, reason: "an outcome" },
    });
    const findings = await checkAssumptionsHaveAnEnactableIf({
      assumptions: [root, child],
      behaviors: [b1],
    });
    expect(findings.map((f) => f.entryRef.id)).toEqual(["a-root", "a-child"]);
    expect(findings.every((f) => f.issueType === "assumption_not_enactable")).toBe(true);
  });

  it("treats a judge error as enactable (fail open)", async () => {
    generateObject.mockRejectedValue(new Error("boom"));
    expect(
      await checkAssumptionsHaveAnEnactableIf({ assumptions: [root], behaviors: [b1] }),
    ).toEqual([]);
  });

  it("empty column: nothing to say", async () => {
    expect(
      await checkAssumptionsHaveAnEnactableIf({ assumptions: [], behaviors: [b1] }),
    ).toEqual([]);
    expect(generateObject).not.toHaveBeenCalled();
  });
});
