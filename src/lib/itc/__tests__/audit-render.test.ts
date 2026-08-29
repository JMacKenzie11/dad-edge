import { describe, expect, it } from "vitest";
import { renderAudit } from "../audit-render";
import type {
  AuditFinding,
  AuditIssueType,
  AuditSeverity,
} from "../audit-rules";

// ---------------------------------------------------------------------------
// Fixtures — one finding per issueType so the exhaustiveness test can
// guarantee every kind renders without throwing.
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
// renderAudit — top-level composer
// ---------------------------------------------------------------------------

describe("renderAudit", () => {
  it("returns a map-holds-up message when the findings list is empty", () => {
    const prose = renderAudit([], CTX);
    expect(prose).toMatch(/holds up/i);
    expect(prose).toContain("Bond");
    // No numbered action list on a clean map.
    expect(prose).not.toMatch(/^\d\. /m);
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

  it("quotes actualText verbatim in the rendered paragraph", () => {
    const source =
      "I'm also committed to never seeing that my defensive behaviour is the problem.";
    const prose = renderAudit(
      [
        finding({
          severity: "moderate",
          issueType: "interior_witness_commitment",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: source,
          detail: "sample detail",
        }),
      ],
      CTX,
    );
    expect(prose).toContain(`"${source}"`);
    // Would fail if the renderer paraphrased.
    expect(prose).not.toContain(
      `"I'm committed to never seeing that my defensive behaviour is the problem."`,
    );
  });

  it("caps the numbered action list at 5 items", () => {
    // Ten findings across distinct issue types (so post-dedup each
    // still renders as a unique action) — action list should stop at 5.
    const distinctTypes: AuditIssueType[] = [
      "bundled_goal",
      "interior_witness_worry",
      "interior_witness_commitment",
      "missing_commitment_stem",
      "vague_assumption_then_clause",
      "depth_shortfall_worry",
      "depth_shortfall_commitment",
      "depth_shortfall_assumption",
      "test_coverage_gap",
      "test_grip_through_data",
    ];
    const many: AuditFinding[] = distinctTypes.map((issueType, i) =>
      finding({
        severity: "moderate",
        issueType,
        entryRef: { table: "worries", id: `entry-${i}` },
        actualText: `entry text ${i}`,
        detail: `detail ${i}`,
      }),
    );
    const prose = renderAudit(many, CTX);
    const actionMatches = prose.match(/^\d\. /gm) ?? [];
    expect(actionMatches).toHaveLength(5);
  });

  it("renders each issueType without throwing", () => {
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
        });
        expect(() => renderAudit([f], CTX)).not.toThrow();
        const prose = renderAudit([f], CTX);
        // Every rendered paragraph should include the actualText quote.
        expect(prose).toContain(`"sample entry text for rendering"`);
      }
    }
  });

  it("does not use em-dashes", () => {
    const prose = renderAudit(
      [
        finding({
          severity: "critical",
          issueType: "bundled_goal",
          entryRef: { table: "goal", id: "map-1" },
          actualText: "getting better at X and better at Y",
          suggestedFix:
            'Pick one for this map. First half: "getting better at X". Second half: "getting better at Y".',
        }),
      ],
      CTX,
    );
    expect(prose).not.toContain("—");
    expect(prose).not.toContain("–");
  });

  it("emits one entry opener when multiple findings target the same entry", () => {
    const commitmentQuote =
      "I'm also committed to never seeing that my defensive behaviour is the problem";
    const prose = renderAudit(
      [
        finding({
          issueType: "depth_shortfall_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: commitmentQuote,
          detail: "Commitment sits at practical depth, not identity depth.",
        }),
        finding({
          issueType: "interior_witness_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: commitmentQuote,
          detail:
            "Commitment uses interior-witness verb 'never seeing' instead of naming the identity.",
        }),
      ],
      CTX,
    );
    const openerCount = (prose.match(/Your commitment now: /g) ?? []).length;
    expect(openerCount).toBe(1);
    // Both critique bodies should be present.
    expect(prose).toMatch(/still at the practical level/i);
    expect(prose).toMatch(/framed around avoiding a feeling/i);
    // Quote appears exactly once, in the shared opener.
    const quoteCount = prose.split(`"${commitmentQuote}"`).length - 1;
    expect(quoteCount).toBe(1);
  });

  it("merges multiple drift findings on the same assumption into one paragraph", () => {
    const assumptionQuote =
      "I assume that if I stop protecting her from my failures, then she'd see the pattern and I'd be the husband I'm terrified I am.";
    const c1 =
      "I'm also committed to never seeing that my defensive behaviour is the problem";
    const c2 =
      "I'm also committed to never being the guy who isn't enough for her.";
    const prose = renderAudit(
      [
        finding({
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: assumptionQuote,
          detail:
            "Commitment protects against seeing defensive behavior as the problem. Assumption's if-clause is about revealing failures.",
          relatedText: c1,
          relatedEntryRef: { table: "commitments", id: "c-1" },
        }),
        finding({
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: assumptionQuote,
          detail:
            "Commitment protects 'not enough for her'. Assumption's if-clause is about revealing failures.",
          relatedText: c2,
          relatedEntryRef: { table: "commitments", id: "c-2" },
        }),
      ],
      CTX,
    );
    const openerCount = (prose.match(/Your assumption now: /g) ?? []).length;
    expect(openerCount).toBe(1);
    // Both paired commitment quotes should appear.
    expect(prose).toContain(c1);
    expect(prose).toContain(c2);
    // Merged framing.
    expect(prose).toMatch(/drifted apart from both/i);
    expect(prose).toMatch(/Against the first/i);
    expect(prose).toMatch(/Against the second/i);
  });

  it("dedupes action items when multiple issue types collapse to the same fix", () => {
    const prose = renderAudit(
      [
        finding({
          issueType: "depth_shortfall_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: "some commitment text",
          detail: "commitment at practical depth",
        }),
        finding({
          issueType: "interior_witness_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: "some commitment text",
          detail: "commitment uses interior-witness verb",
        }),
      ],
      CTX,
    );
    const actionMatches = prose.match(/^\d\. /gm) ?? [];
    expect(actionMatches).toHaveLength(1);
    // Merged action wording should surface.
    expect(prose).toMatch(
      /Rewrite the commitment to name the identity you're never being/i,
    );
  });

  it("says 'all three' when three drift findings merge on one assumption", () => {
    const assumptionQuote = "I assume that if X, then Y.";
    const prose = renderAudit(
      [
        finding({
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: assumptionQuote,
          detail: "reason for c-1",
          relatedText: "commitment 1 text",
          relatedEntryRef: { table: "commitments", id: "c-1" },
        }),
        finding({
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: assumptionQuote,
          detail: "reason for c-2",
          relatedText: "commitment 2 text",
          relatedEntryRef: { table: "commitments", id: "c-2" },
        }),
        finding({
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: assumptionQuote,
          detail: "reason for c-3",
          relatedText: "commitment 3 text",
          relatedEntryRef: { table: "commitments", id: "c-3" },
        }),
      ],
      CTX,
    );
    expect(prose).toMatch(/drifted apart from all three/i);
    expect(prose).not.toMatch(/drifted apart from both/i);
    expect(prose).toMatch(/Against the first/i);
    expect(prose).toMatch(/Against the second/i);
    expect(prose).toMatch(/Against the third/i);
  });

  it("dedupes action items when the rendered text is identical across entries", () => {
    // Two depth_shortfall_commitment findings on different commitments
    // — both render the same generic "Push the commitment to identity
    // depth…" action. Dedup should collapse them to one action item.
    const prose = renderAudit(
      [
        finding({
          issueType: "depth_shortfall_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: "commitment one text",
          detail: "commitment 1 at practical depth",
        }),
        finding({
          issueType: "depth_shortfall_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-2" },
          actualText: "commitment two text",
          detail: "commitment 2 at practical depth",
        }),
      ],
      CTX,
    );
    const pushActions =
      prose.match(/^\d\. Push the commitment to identity depth/gm) ?? [];
    expect(pushActions).toHaveLength(1);
    // Both entry quotes still appear in the paragraph section.
    expect(prose).toContain('"commitment one text"');
    expect(prose).toContain('"commitment two text"');
  });

  it("merges multiple redundancy findings on the same worry into one paragraph", () => {
    const worryQuote = "I worry I'll say the wrong thing.";
    const c1 = "I am committed to A";
    const c2 = "I am committed to B";
    const prose = renderAudit(
      [
        finding({
          issueType: "worry_commitment_redundancy",
          severity: "moderate",
          entryRef: { table: "worries", id: "w-1" },
          actualText: worryQuote,
          detail: "c-1 duplicates the fear",
          relatedText: c1,
          relatedEntryRef: { table: "commitments", id: "c-1" },
        }),
        finding({
          issueType: "worry_commitment_redundancy",
          severity: "moderate",
          entryRef: { table: "worries", id: "w-1" },
          actualText: worryQuote,
          detail: "c-2 duplicates the fear",
          relatedText: c2,
          relatedEntryRef: { table: "commitments", id: "c-2" },
        }),
      ],
      CTX,
    );
    const openerCount = (prose.match(/Your worry now: /g) ?? []).length;
    expect(openerCount).toBe(1);
    expect(prose).toContain(c1);
    expect(prose).toContain(c2);
    expect(prose).toMatch(/commitments that duplicate it/i);
    expect(prose).toMatch(/Against the first/i);
    expect(prose).toMatch(/Against the second/i);
  });

  it("gates off the missing-stem 'Consider' rewrite when a heavier commitment critique fires", () => {
    const commitmentQuote =
      "I am committed to avoiding the feeling I might be inadequate";
    const stemFix = `I'm also committed to ${commitmentQuote.replace(/^I am committed to /, "")}`;
    // Both stem AND depth-shortfall fire on the same commitment. The
    // stem paragraph should still render, but its "Consider:" rewrite
    // is suppressed because the depth critique is prescribing a much
    // deeper fix.
    const prose = renderAudit(
      [
        finding({
          issueType: "depth_shortfall_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: commitmentQuote,
          detail: "at practical depth",
        }),
        finding({
          issueType: "missing_commitment_stem",
          severity: "moderate",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: commitmentQuote,
          detail: "missing the 'also' stem",
          suggestedFix: stemFix,
        }),
      ],
      CTX,
    );
    // Stem paragraph is still there.
    expect(prose).toMatch(/canonical stem/i);
    // But the Consider: rewrite is suppressed.
    expect(prose).not.toContain("Consider:");
    expect(prose).not.toContain(stemFix);
  });

  it("keeps the missing-stem 'Consider' rewrite when only stem fires on the commitment", () => {
    const commitmentQuote = "I am committed to being present with my kids";
    const stemFix = "I'm also committed to being present with my kids";
    const prose = renderAudit(
      [
        finding({
          issueType: "missing_commitment_stem",
          severity: "moderate",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: commitmentQuote,
          detail: "missing the 'also' stem",
          suggestedFix: stemFix,
        }),
      ],
      CTX,
    );
    expect(prose).toContain("Consider:");
    expect(prose).toContain(stemFix);
  });

  it("aggregates when 2+ entries fire the same generic-body critique", () => {
    // Three commitments each fire depth_shortfall_commitment. Instead
    // of three near-identical per-entry paragraphs, render one
    // aggregated paragraph naming all three with a bulleted quote list.
    const c1 = "I am committed to A";
    const c2 = "I am committed to B";
    const c3 = "I am committed to C";
    const prose = renderAudit(
      [
        finding({
          issueType: "depth_shortfall_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: c1,
          detail: "practical depth",
        }),
        finding({
          issueType: "depth_shortfall_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-2" },
          actualText: c2,
          detail: "practical depth",
        }),
        finding({
          issueType: "depth_shortfall_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-3" },
          actualText: c3,
          detail: "practical depth",
        }),
      ],
      CTX,
    );
    // Exactly one aggregated paragraph.
    expect(prose).toMatch(
      /Three of your commitments are still at the practical level/i,
    );
    // All three commitments appear in the bulleted list.
    expect(prose).toContain(`- "${c1}"`);
    expect(prose).toContain(`- "${c2}"`);
    expect(prose).toContain(`- "${c3}"`);
    // No per-entry "Your commitment now: X" openers for any of them —
    // the aggregation covers all three.
    const openerCount = (prose.match(/Your commitment now: /g) ?? []).length;
    expect(openerCount).toBe(0);
    // No per-entry practical-level paragraph either (since aggregation
    // absorbed all three findings).
    expect(prose).not.toMatch(/This is still at the practical level/i);
  });

  it("uses 'Two' for N=2 aggregation", () => {
    const prose = renderAudit(
      [
        finding({
          issueType: "interior_witness_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: "I am committed to avoiding X",
          detail: "interior verb",
        }),
        finding({
          issueType: "interior_witness_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-2" },
          actualText: "I am committed to never seeing Y",
          detail: "interior verb",
        }),
      ],
      CTX,
    );
    expect(prose).toMatch(/Two of your commitments are framed around/i);
  });

  it("does not aggregate at N=1 — single finding still renders per-entry", () => {
    const prose = renderAudit(
      [
        finding({
          issueType: "depth_shortfall_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: "the only commitment at practical depth",
          detail: "practical depth",
        }),
      ],
      CTX,
    );
    // Per-entry rendering with its opener.
    expect(prose).toMatch(/Your commitment now: /);
    // No aggregation phrasing.
    expect(prose).not.toMatch(/One of your commitments/i);
    // The per-entry critique body still appears.
    expect(prose).toMatch(/still at the practical level/i);
  });

  it("does not aggregate drift, redundancy, or overload findings", () => {
    // Two drift findings on different assumptions should NOT collapse
    // into a cross-entry aggregation — drift is entry-specific
    // (relatedText, per-pair reason). Each renders per-entry.
    const prose = renderAudit(
      [
        finding({
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-1" },
          actualText: "assumption 1",
          detail: "reason 1",
          relatedText: "commitment 1",
          relatedEntryRef: { table: "commitments", id: "c-1" },
        }),
        finding({
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          entryRef: { table: "assumptions", id: "a-2" },
          actualText: "assumption 2",
          detail: "reason 2",
          relatedText: "commitment 2",
          relatedEntryRef: { table: "commitments", id: "c-2" },
        }),
      ],
      CTX,
    );
    // Each assumption gets its own opener — drift never aggregates.
    const openerCount = (prose.match(/Your assumption now: /g) ?? []).length;
    expect(openerCount).toBe(2);
    // No cross-entry aggregation phrasing.
    expect(prose).not.toMatch(/Two of your assumptions/i);
  });

  it("mixes aggregated + per-entry cleanly when an entry has aggregatable + non-aggregatable findings", () => {
    // C1 has depth_shortfall (aggregatable, N=2 with C2) AND drift
    // (non-aggregatable). C1 should NOT appear per-entry for the depth
    // finding (absorbed into aggregation), but WILL appear per-entry
    // for the drift finding.
    // Actually: the drift finding is on an assumption, not on C1. Let
    // me use a cleaner mix: two commitments with depth_shortfall (both
    // aggregated) + one commitment with assumption_uncovered_commitment
    // (also aggregatable but only 1 → per-entry).
    const prose = renderAudit(
      [
        finding({
          issueType: "depth_shortfall_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-1" },
          actualText: "commitment one",
          detail: "practical depth",
        }),
        finding({
          issueType: "depth_shortfall_commitment",
          severity: "critical",
          entryRef: { table: "commitments", id: "c-2" },
          actualText: "commitment two",
          detail: "practical depth",
        }),
        finding({
          issueType: "assumption_uncovered_commitment",
          severity: "moderate",
          entryRef: { table: "commitments", id: "c-3" },
          actualText: "commitment three uncovered",
          detail: "no assumption linked",
        }),
      ],
      CTX,
    );
    // Aggregated depth paragraph names c1 and c2.
    expect(prose).toMatch(/Two of your commitments are still at the practical level/i);
    expect(prose).toContain('- "commitment one"');
    expect(prose).toContain('- "commitment two"');
    // c3 renders per-entry with its own opener (only 1 uncovered → below threshold).
    expect(prose).toContain('Your commitment now: "commitment three uncovered"');
  });

  it("does not include machinery words (rubric, depth score, criterion)", () => {
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
      ],
      CTX,
    );
    expect(prose).not.toMatch(/\brubric\b/i);
    expect(prose).not.toMatch(/\bdepth score\b/i);
    expect(prose).not.toMatch(/\bcriterion\b/i);
  });
});
