import { describe, expect, it } from "vitest";
import {
  findingLine,
  prioritizeEntries,
  renderFindings,
  renderRowSharpen,
} from "../render";
import { ADVICE } from "../advice";
import type { Finding, IssueType, Severity } from "../types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function finding(overrides: Partial<Finding>): Finding {
  const issueType = overrides.issueType ?? "bundled_goal";
  return {
    entryRef: { table: "map", id: "map-1" },
    issueType,
    severity: "moderate",
    actualText: "sample text",
    detail: ADVICE[issueType],
    ...overrides,
  };
}

const CTX = { goalText: "sample goal", pillarLabel: "Bond" };

function renderHone(findings: Finding[], limit?: number): string {
  return renderFindings(findings, { ...CTX, mode: "hone", limit });
}

function renderColumn(
  findings: Finding[],
  columnLabel: string,
  limit?: number,
): string {
  return renderFindings(findings, {
    ...CTX,
    mode: "column_review",
    columnLabel,
    limit,
  });
}

const ALL_ISSUE_TYPES: IssueType[] = [
  "bundled_goal",
  "depth_shortfall_behavior",
  "interior_witness_worry",
  "interior_witness_commitment",
  "commitment_doesnt_mirror_worry",
  "vague_assumption_then_clause",
  "depth_shortfall_worry",
  "depth_shortfall_commitment",
  "depth_shortfall_assumption",
  "assumption_doesnt_underwrite",
  "assumption_not_enactable",
  "assumption_uncovered_commitment",
  "test_coverage_gap",
  "test_grip_through_data",
];

// ---------------------------------------------------------------------------
// Empty state + openings
// ---------------------------------------------------------------------------

describe("renderFindings — empty state", () => {
  it("hone: map holds up, names the pillar, no entries", () => {
    const prose = renderHone([]);
    expect(prose).toMatch(/Your Bond map holds up/);
    expect(prose).not.toContain('"');
  });

  it("column_review: names the column", () => {
    expect(renderColumn([], "Your worries")).toMatch(/^Your worries holds up/);
    expect(
      renderFindings([], { ...CTX, mode: "column_review" }),
    ).toMatch(/^This column holds up/);
  });
});

describe("renderFindings — openings", () => {
  it("hone: a critical finding opens with 'broken', a moderate one with 'holds up'", () => {
    const crit = renderHone([
      finding({
        severity: "critical",
        issueType: "depth_shortfall_worry",
        entryRef: { table: "worries", id: "w-1" },
      }),
    ]);
    expect(crit).toMatch(/^Your Bond map has one thing that's broken\./);
    expect(crit).not.toMatch(/critical/i);

    const mod = renderHone([
      finding({
        severity: "moderate",
        issueType: "interior_witness_worry",
        entryRef: { table: "worries", id: "w-1" },
      }),
    ]);
    expect(mod).toMatch(/^Your Bond map holds up\. One thing to fix before you pick what to test\./);
  });

  it("column_review: counts entries, not findings, and speaks about the column", () => {
    const prose = renderColumn(
      [
        finding({
          issueType: "depth_shortfall_worry",
          severity: "critical",
          entryRef: { table: "worries", id: "w-1" },
        }),
        finding({
          issueType: "interior_witness_worry",
          entryRef: { table: "worries", id: "w-1" },
        }),
      ],
      "Your worries",
    );
    // Two findings on one entry = one thing.
    expect(prose).toMatch(/^One thing on your worries is broken\. Fix it before you move on\./);
    expect(prose).not.toMatch(/Bond map/);
  });

  it("never uses the banned 'worth ___ing' family or 'critical'", () => {
    const prose = renderHone(
      ALL_ISSUE_TYPES.map((issueType, i) =>
        finding({
          issueType,
          severity: i % 2 === 0 ? "critical" : "moderate",
          entryRef: { table: "assumptions", id: `a-${i}` },
        }),
      ),
      Number.POSITIVE_INFINITY,
    );
    expect(prose).not.toMatch(/\bworth\s+\w+ing\b/i);
    expect(prose).not.toMatch(/\bcritical\b/i);
  });
});

// ---------------------------------------------------------------------------
// Per-entry paragraph: quote + line + sharper
// ---------------------------------------------------------------------------

describe("renderFindings — per-entry paragraph", () => {
  it("renders quote, then the what's-off line, then the sharper version", () => {
    const prose = renderHone([
      finding({
        issueType: "depth_shortfall_worry",
        severity: "critical",
        entryRef: { table: "worries", id: "w-1" },
        actualText: "I worry I'd fall behind",
        detail: "This stops at what would happen. Who would you be?",
        suggestedFix: "I worry that if I let them run the meeting, I'd be the leader nobody needed.",
      }),
    ]);
    const paragraph = prose.split("\n\n")[1];
    const lines = paragraph.split("\n");
    expect(lines[0]).toBe('"I worry I\'d fall behind"');
    expect(lines[1]).toBe("This stops at what would happen. Who would you be?");
    expect(lines[2]).toBe(
      'Sharper: "I worry that if I let them run the meeting, I\'d be the leader nobody needed."',
    );
  });

  it("omits the sharper line when there is no verified rewrite", () => {
    const prose = renderHone([
      finding({
        issueType: "depth_shortfall_worry",
        severity: "critical",
        entryRef: { table: "worries", id: "w-1" },
        actualText: "I worry I'd fall behind",
      }),
    ]);
    expect(prose).not.toMatch(/Sharper:/);
  });

  it("merges several findings on one entry into one paragraph with one quote and no (a)/(b) list", () => {
    const prose = renderHone([
      finding({
        issueType: "depth_shortfall_commitment",
        severity: "critical",
        entryRef: { table: "commitments", id: "c-1" },
        actualText: "I am committed to avoiding the feeling that Y",
        suggestedFix: "I'm also committed to never being the man who lets her down.",
      }),
      finding({
        issueType: "interior_witness_commitment",
        entryRef: { table: "commitments", id: "c-1" },
        actualText: "I am committed to avoiding the feeling that Y",
      }),
    ]);
    expect(prose.split('"I am committed to avoiding the feeling that Y"').length - 1).toBe(1);
    expect(prose).not.toMatch(/\(a\)/);
    expect(prose).not.toMatch(/things to fix\./);
    expect(prose).toContain(ADVICE.interior_witness_commitment);
    expect(prose).toContain(ADVICE.depth_shortfall_commitment);
    expect(prose.split("Sharper:").length - 1).toBe(1);
  });

  it("de-duplicates identical lines on one entry", () => {
    const prose = renderRowSharpen([
      finding({ issueType: "depth_shortfall_worry", detail: "Same line." }),
      finding({ issueType: "interior_witness_worry", detail: "Same line." }),
    ]);
    expect(prose).toBe("Same line.");
  });
});

// ---------------------------------------------------------------------------
// Dynamic lines: underwrite + coverage
// ---------------------------------------------------------------------------

describe("renderFindings — dynamic lines", () => {
  it("underwrite names the commitments by map position and asks for a link change", () => {
    const f = finding({
      issueType: "assumption_doesnt_underwrite",
      entryRef: { table: "assumptions", id: "a-1" },
      actualText: "I assume that if I stay, then I'd lose it.",
      unfitCommitmentPositions: [2, 4],
    });
    const line = findingLine(f);
    expect(line).toBe(
      'Believing this doesn\'t make #2 and #4 feel necessary. Drop #2 and #4 from it, or rewrite the "if" so doing it would break those vows too.',
    );
    // No rewrite is offered for a link problem.
    expect(renderHone([f])).not.toMatch(/Sharper:/);
  });

  it("underwrite falls back to the static advice when positions are missing", () => {
    const f = finding({
      issueType: "assumption_doesnt_underwrite",
      entryRef: { table: "assumptions", id: "a-1" },
    });
    expect(findingLine(f)).toBe(ADVICE.assumption_doesnt_underwrite);
  });

  it("coverage quotes the commitment and points at the drafted assumption", () => {
    const prose = renderHone([
      finding({
        issueType: "assumption_uncovered_commitment",
        entryRef: { table: "commitments", id: "c-2" },
        actualText: "I'm also committed to never being the passive father.",
        suggestedFix:
          "I assume that if I let the work speak, then the money wouldn't come and I'd be the passive father.",
      }),
    ]);
    expect(prose).toContain('"I\'m also committed to never being the passive father."');
    expect(prose).toContain(ADVICE.assumption_uncovered_commitment);
    expect(prose).toMatch(/A Big Assumption that would hold it up: "I assume that if I let the work speak/);
    expect(prose).not.toMatch(/Sharper:/);
  });

  it("bundled goal prints the split as-is", () => {
    const prose = renderHone([
      finding({
        issueType: "bundled_goal",
        severity: "critical",
        entryRef: { table: "goal", id: "map-1" },
        actualText: "I'm committed to coaching my team and building my business",
        suggestedFix: 'Pick one for this map. First half: "coaching my team". Second half: "building my business".',
      }),
    ]);
    expect(prose).toContain('Pick one for this map. First half: "coaching my team".');
    expect(prose).not.toMatch(/Sharper:/);
  });
});

// ---------------------------------------------------------------------------
// Budget: one entry on hone, three on column review, rest counted
// ---------------------------------------------------------------------------

describe("renderFindings — budget", () => {
  const four = [1, 2, 3, 4].map((i) =>
    finding({
      issueType: "interior_witness_worry",
      entryRef: { table: "worries", id: `w-${i}` },
      actualText: `worry ${i}`,
    }),
  );

  it("hone prints one entry and counts the rest", () => {
    const prose = renderHone(four);
    expect(prose).toContain('"worry 1"');
    expect(prose).not.toContain('"worry 2"');
    expect(prose).toMatch(/Four things to fix/);
    expect(prose).toMatch(/Three more after this\. They're marked on the map\.$/);
  });

  it("column review prints three and counts one", () => {
    const prose = renderColumn(four, "Your worries");
    expect(prose).toContain('"worry 3"');
    expect(prose).not.toContain('"worry 4"');
    expect(prose).toMatch(/One more after this\. It's marked on the map\.$/);
  });

  it("no trailer when everything fits", () => {
    expect(renderColumn(four.slice(0, 3), "Your worries")).not.toMatch(/more after this/);
  });

  it("limit override prints everything", () => {
    const prose = renderHone(four, Number.POSITIVE_INFINITY);
    expect(prose).toContain('"worry 4"');
    expect(prose).not.toMatch(/more after this/);
  });
});

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

describe("prioritizeEntries", () => {
  it("broken before fixable, then top of the map before bottom, then arrival order", () => {
    const groups = prioritizeEntries([
      finding({ issueType: "vague_assumption_then_clause", entryRef: { table: "assumptions", id: "a-1" } }),
      finding({ issueType: "interior_witness_worry", entryRef: { table: "worries", id: "w-2" } }),
      finding({ issueType: "depth_shortfall_commitment", severity: "critical", entryRef: { table: "commitments", id: "c-1" } }),
      finding({ issueType: "interior_witness_worry", entryRef: { table: "worries", id: "w-1" } }),
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      "commitments:c-1",
      "worries:w-2",
      "worries:w-1",
      "assumptions:a-1",
    ]);
  });

  it("a coverage finding on a commitment sorts with the assumptions column", () => {
    const groups = prioritizeEntries([
      finding({ issueType: "assumption_uncovered_commitment", entryRef: { table: "commitments", id: "c-1" } }),
      finding({ issueType: "vague_assumption_then_clause", entryRef: { table: "assumptions", id: "a-1" } }),
    ]);
    // Same column rank → arrival order holds.
    expect(groups.map((g) => g.key)).toEqual(["commitments:c-1", "assumptions:a-1"]);
  });
});

// ---------------------------------------------------------------------------
// Exhaustiveness + voice hygiene
// ---------------------------------------------------------------------------

describe("renderFindings — exhaustiveness and voice hygiene", () => {
  it("renders every issue type without throwing", () => {
    const severities: Severity[] = ["critical", "moderate"];
    for (const issueType of ALL_ISSUE_TYPES) {
      for (const severity of severities) {
        const f = finding({
          issueType,
          severity,
          actualText: "sample entry text for rendering",
          suggestedFix: "sample suggested fix",
          relatedText: "sample paired entry text",
          relatedEntryRef: { table: "commitments", id: "c-related" },
          unfitCommitmentPositions: [2],
        });
        expect(() => renderHone([f])).not.toThrow();
        expect(() => renderRowSharpen([f])).not.toThrow();
      }
    }
  });

  it("no machinery words, no em dashes, no interface verbs in any advice line or opening", () => {
    const prose = renderHone(
      ALL_ISSUE_TYPES.map((issueType, i) =>
        finding({
          issueType,
          entryRef: { table: "assumptions", id: `a-${i}` },
          unfitCommitmentPositions: [1],
        }),
      ),
      Number.POSITIVE_INFINITY,
    );
    for (const banned of [
      /\brubric\b/i,
      /\bdepth score\b/i,
      /\bcriterion\b/i,
      /\bcriteria\b/i,
      /\bvalidation\b/i,
      /\bif-clause\b/i,
      /\bthen-clause\b/i,
      /[—–]/,
      /\b(click|tap|hit|press)\b/i,
      /\bnotice\b/i,
      /\bleverage\b/i,
      /\bunpack\b/i,
      /\bsharpen (it|this|up)\b/i,
    ]) {
      expect(prose, `banned pattern ${banned} in:\n${prose}`).not.toMatch(banned);
    }
  });

  it("column review and hone share the same per-entry rendering", () => {
    const shared = finding({
      issueType: "depth_shortfall_commitment",
      severity: "critical",
      entryRef: { table: "commitments", id: "c-1" },
      actualText: "I am committed to trying harder",
      suggestedFix: "I'm also committed to never being the man who quits on her.",
    });
    const columnBody = renderColumn([shared], "Your competing commitments")
      .split("\n\n")
      .slice(1)
      .join("\n\n");
    const honeBody = renderHone([shared]).split("\n\n").slice(1).join("\n\n");
    expect(columnBody).toBe(honeBody);
    // And the row box is the same lines minus the quote.
    expect(honeBody).toContain(renderRowSharpen([shared])!);
  });
});
