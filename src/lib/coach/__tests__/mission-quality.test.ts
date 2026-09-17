import { describe, expect, it } from "vitest";
import {
  CRITERIA,
  CRITERION_MAX,
  renderMissionFeedback,
  type Criterion,
} from "../mission-quality";

function scores(
  overrides: Partial<Record<Criterion, number>>,
): Record<Criterion, number> {
  return { concrete: 4, binary: 4, time_bound: 2, ...overrides };
}

describe("renderMissionFeedback", () => {
  it("returns the ready-to-run praise when every criterion is maxed", () => {
    expect(renderMissionFeedback(scores({}))).toMatch(/sharp mission/i);
  });

  it("returns the tighten-if-you-feel-it note when total >= 8 with no zeros", () => {
    // concrete=3, rest max → total = 9, ready
    const out = renderMissionFeedback(scores({ concrete: 3 }));
    expect(out).not.toMatch(/wording is vague/i);
    expect(out).toMatch(/ready to save/i);
  });

  it("picks the weakest criterion by share of available points", () => {
    // concrete 0/4 vs time_bound 1/2 → concrete is weaker
    const out = renderMissionFeedback(scores({ concrete: 0, time_bound: 1 }));
    expect(out).toMatch(/vague/i);
    expect(out).toMatch(/specifics/i);
  });

  it("prompts a target day when time_bound=0", () => {
    expect(renderMissionFeedback(scores({ time_bound: 0 }))).toMatch(
      /target day/i,
    );
  });

  it("never judges what the man chose to do — no pillar, goal, or domain talk", () => {
    // The rubric dropped its two domain criteria on 2026-09-17. No
    // sentence may mention a pillar, a goal, or a substitute activity.
    const banned =
      /off-pillar|pillar|goal|domain|sauna|walk|swap|instead|activity|training|modality|programming|zone 2|tempo/i;
    for (const c of CRITERIA) {
      for (let v = 0; v <= CRITERION_MAX[c]; v++) {
        expect(renderMissionFeedback(scores({ [c]: v }))).not.toMatch(banned);
      }
    }
  });

  it("takes no pillar argument, so a domain judgement is unreachable", () => {
    expect(renderMissionFeedback.length).toBe(1);
  });
});
