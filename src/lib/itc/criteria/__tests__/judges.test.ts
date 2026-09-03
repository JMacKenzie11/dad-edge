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

describe("checkAssumptionEnactable is turned off", () => {
  const a1 = assumption({ id: "a-1", text: "I assume that I can never be good at this." });
  const a2 = assumption({ id: "a-2", text: "I assume that if I say no, they leave." });
  const beh = behavior("b-1", "I say yes to everything");

  // Turned off 2026-09-03 at the user's request: the flag never
  // fires. It asked for an ACT he could take, while the guides' bar
  // is data ("what data, if they existed, could call the assumption
  // into doubt", Vol 1 p 19) and Appendix D tests one Big Assumption
  // with a thought experiment and no behaviour change at all. It was
  // also a dead end: nothing blocks on it, so the red box could
  // neither be cleared nor acted on.
  it("returns nothing, whatever it is given", async () => {
    const findings = await checkAssumptionEnactable({
      assumptions: [a1, a2],
      behaviors: [beh],
    });
    expect(findings).toEqual([]);
  });

  it("makes no model call", async () => {
    generateObject.mockClear();
    await checkAssumptionEnactable({ assumptions: [a1], behaviors: [beh] });
    expect(generateObject).not.toHaveBeenCalled();
  });
});

describe("enactability is asked of the selected assumption, not the column", () => {
  // checkAssumptionsHaveAnEnactableIf was tested here: a column-wide
  // check that flagged every assumption when none had an "if" he
  // could go do. Deleted 2026-09-03, because Appendix D puts the
  // action in the test rather than the assumption ("I don't believe I
  // can ever be skillful at managing my anger" -> "So I Will: Take an
  // anger management course"). See the note where it lived.
  it("the assumptions column criteria no longer run it", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const orch = readFileSync(resolve(here, "..", "orchestrator.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(orch).not.toMatch(/checkAssumptionsHaveAnEnactableIf/);
  });

  it("but the selected-for-testing path still does", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const fixes = readFileSync(resolve(here, "..", "..", "fixes.ts"), "utf8");
    const sel = fixes.slice(
      fixes.indexOf("export async function coachTextForSelectedAssumption"),
      fixes.indexOf("async function attachFixes"),
    );
    expect(sel).toMatch(/checkAssumptionEnactable\(/);
  });
});

