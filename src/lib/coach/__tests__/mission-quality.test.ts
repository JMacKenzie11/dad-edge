import { describe, expect, it } from "vitest";
import { renderMissionFeedback, type Criterion } from "../mission-quality";

function scores(overrides: Partial<Record<Criterion, 0 | 1 | 2>>): Record<
  Criterion,
  0 | 1 | 2
> {
  return {
    concrete: 2,
    binary: 2,
    leverage: 2,
    aligned: 2,
    time_bound: 2,
    ...overrides,
  };
}

describe("renderMissionFeedback", () => {
  it("returns the ready-to-run praise when every criterion is 2", () => {
    expect(renderMissionFeedback(scores({}), "Vitality")).toMatch(
      /sharp mission/i,
    );
  });

  it("returns the tighten-if-you-feel-it note when total >= 8 with no zeros", () => {
    // concrete=1 (partial), rest 2 → total = 9, ready
    const out = renderMissionFeedback(scores({ concrete: 1 }), "Vitality");
    // With a 1 in concrete, ready is true (total 9, no zero) — but a
    // single criterion at 1 also matches the "one small thing" path;
    // check we didn't fall into a zero-critique.
    expect(out).not.toMatch(/wording is vague/i);
  });

  it("picks the lowest-scoring criterion for a zero critique", () => {
    // concrete=0, aligned=1, rest 2 → weakest is concrete
    const out = renderMissionFeedback(
      scores({ concrete: 0, aligned: 1 }),
      "Vitality",
    );
    expect(out).toMatch(/vague/i);
    expect(out).toMatch(/specifics/i);
  });

  it("names the pillar when leverage=0", () => {
    const out = renderMissionFeedback(
      scores({ leverage: 0, aligned: 0 }),
      "Amplify",
    );
    // leverage and aligned both 0 — sort is stable; concrete/binary
    // pass, so weakest is leverage (declared first in CRITERIA).
    expect(out).toMatch(/off-pillar/i);
    expect(out).toContain("Amplify");
  });

  it("prompts a target day when time_bound=0", () => {
    const out = renderMissionFeedback(
      scores({ time_bound: 0 }),
      "Vitality",
    );
    expect(out).toMatch(/target day/i);
  });

  it("never mentions activity, training, or substitutes — the whole point of the rewrite", () => {
    // Try every combination of zeros. None of the resulting sentences
    // should mention activity choice, training modality, sauna, walk,
    // swap, or instead — the LLM's editorializing was the bug we
    // structurally removed by hardcoding these strings.
    const criteria: Criterion[] = ["concrete", "binary", "leverage", "aligned", "time_bound"];
    const banned = /sauna|walk|swap|instead|activity|training|modality|programming|zone 2|tempo/i;
    for (const c of criteria) {
      const s = scores({ [c]: 0 } as Partial<Record<Criterion, 0 | 1 | 2>>);
      expect(renderMissionFeedback(s, "Vitality")).not.toMatch(banned);
    }
    for (const c of criteria) {
      const s = scores({ [c]: 1 } as Partial<Record<Criterion, 0 | 1 | 2>>);
      expect(renderMissionFeedback(s, "Vitality")).not.toMatch(banned);
    }
  });
});
