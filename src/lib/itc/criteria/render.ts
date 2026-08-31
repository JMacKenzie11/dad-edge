/**
 * Deterministic renderer for criteria findings.
 *
 * One entry point — `renderFindings(findings, context)` — powers both
 * the hone audit banner and the end-of-column construction review. The
 * mode in the context tunes the opening sentence (hone vs. column
 * review); the per-entry rendering is identical so the coachee sees
 * the same coach voice in both flows.
 *
 * Structure: per-column entry-centric. Sections walk the map top-down
 * (goal → worries → competing commitments → Big Assumptions). Within
 * each section, one paragraph per problematic entry, quoting the entry
 * verbatim + all fixes for that entry inline.
 *
 * Language: plain English. Coachee-facing terminology, not coach
 * jargon.
 */

import type { EntryRef, Finding, IssueType } from "./types";

export type RenderContext = {
  /** Pillar label ("Amplify", "Bond", …). Used in the opening. */
  pillarLabel: string;
  /** Improvement goal text. Presence controls one empty-state phrasing. */
  goalText: string;
  /** hone = whole-map audit banner. column_review = end-of-column
   *  feedback surfaced inline while the coachee is still building. */
  mode: "hone" | "column_review";
  /** For column_review mode: which column is being reviewed. Tunes
   *  the opening sentence ("Two things worth sharpening on your
   *  worries before you move on"). Optional for hone mode. */
  columnLabel?: string;
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function renderFindings(
  findings: Finding[],
  context: RenderContext,
): string {
  if (findings.length === 0) {
    return renderEmptyState(context);
  }

  const opening = renderOpening(findings, context);

  const sections: string[] = [];
  for (const col of COLUMNS) {
    const columnFindings = findings.filter((f) => col.matches(f));
    if (columnFindings.length === 0) continue;
    sections.push(renderColumnSection(col, columnFindings));
  }

  return [opening, ...sections].join("\n\n");
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function renderEmptyState(context: RenderContext): string {
  if (context.mode === "column_review") {
    const label = context.columnLabel ?? "This column";
    return `${label} holds up. Nothing on it needs sharpening — carry on.`;
  }
  const holds =
    context.goalText.trim().length > 0
      ? `Your ${context.pillarLabel} map holds up`
      : "Your map holds up";
  return `${holds}. Nothing on it needs sharpening right now. When something on the map changes, run the audit again and I'll re-check.`;
}

// ---------------------------------------------------------------------------
// Opening — varies by mode + severity distribution
// ---------------------------------------------------------------------------

function renderOpening(findings: Finding[], context: RenderContext): string {
  const criticals = findings.filter((f) => f.severity === "critical").length;
  const moderates = findings.filter((f) => f.severity === "moderate").length;
  const observations = findings.filter(
    (f) => f.severity === "observation",
  ).length;
  const total = findings.length;

  if (context.mode === "column_review") {
    const label = context.columnLabel ?? "this column";
    if (criticals > 0) {
      const critWord =
        criticals === 1 ? "one critical thing" : `${criticals} critical things`;
      return `${critWord} to sharpen on ${label.toLowerCase()} before you move on.`;
    }
    if (moderates > 0 && observations === 0) {
      const modWord = moderates === 1 ? "One thing" : `${moderates} things`;
      return `${modWord} worth sharpening on ${label.toLowerCase()} before you move on.`;
    }
    if (moderates > 0 && observations > 0) {
      return `${moderates} moderate issue${moderates === 1 ? "" : "s"} and ${observations} smaller observation${observations === 1 ? "" : "s"} on ${label.toLowerCase()} worth a look.`;
    }
    const obsWord = total === 1 ? "One small thing" : `${total} small things`;
    return `${obsWord} worth noting on ${label.toLowerCase()}.`;
  }

  // mode === "hone"
  if (criticals > 0) {
    const critWord =
      criticals === 1 ? "one critical issue" : `${criticals} critical issues`;
    return `Your ${context.pillarLabel} map has ${critWord} to fix before this hone pass is worth much else. Working down the map.`;
  }

  if (moderates > 0 && observations === 0) {
    const modWord = moderates === 1 ? "one thing" : `${moderates} things`;
    return `Your ${context.pillarLabel} map holds up structurally. ${modWord} worth sharpening before you keep going.`;
  }

  if (moderates > 0 && observations > 0) {
    return `Your ${context.pillarLabel} map holds up structurally, with ${moderates} moderate issue${moderates === 1 ? "" : "s"} to sharpen and ${observations} smaller observation${observations === 1 ? "" : "s"} to consider.`;
  }

  const obsWord = total === 1 ? "one small thing" : `${total} small things`;
  return `Your ${context.pillarLabel} map is in good shape. ${obsWord} worth noting.`;
}

// ---------------------------------------------------------------------------
// Column definitions — top-down map walk
// ---------------------------------------------------------------------------

type Column = {
  header: string;
  matches: (f: Finding) => boolean;
};

const COLUMNS: readonly Column[] = [
  {
    header: "Your goal",
    matches: (f) =>
      f.entryRef.table === "goal" || f.entryRef.table === "map",
  },
  {
    header: "Your behaviors",
    matches: (f) => f.entryRef.table === "behaviors",
  },
  {
    header: "Your worries",
    matches: (f) => f.entryRef.table === "worries",
  },
  {
    header: "Your competing commitments",
    matches: (f) => f.entryRef.table === "commitments",
  },
  {
    header: "Your Big Assumptions",
    matches: (f) => f.entryRef.table === "assumptions",
  },
];

// ---------------------------------------------------------------------------
// Column section: header + per-entry paragraphs
// ---------------------------------------------------------------------------

function renderColumnSection(column: Column, findings: Finding[]): string {
  const groups = groupByEntry(findings);
  const paragraphs = groups.map((g) => renderEntryParagraph(g.findings));
  return [`${column.header}:`, ...paragraphs].join("\n\n");
}

interface EntryGroup {
  key: string;
  findings: Finding[];
}

function entryKey(ref: EntryRef): string {
  return `${ref.table}:${ref.id}`;
}

function groupByEntry(findings: Finding[]): EntryGroup[] {
  const byKey = new Map<string, Finding[]>();
  const order: string[] = [];
  for (const f of findings) {
    const key = entryKey(f.entryRef);
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(f);
  }
  return order.map((key) => ({ key, findings: byKey.get(key)! }));
}

// ---------------------------------------------------------------------------
// Per-entry paragraph: quote + fix(es)
// ---------------------------------------------------------------------------

function renderEntryParagraph(findings: Finding[]): string {
  const first = findings[0];
  const quote = `"${first.actualText}"`;
  const clauses = collectClauses(findings);

  if (clauses.length === 0) return quote;

  if (clauses.length === 1) {
    return `${quote}\n${clauses[0]}`;
  }

  const count = countWordCapitalized(clauses.length);
  const enumerated = clauses
    .map((c, i) => `(${String.fromCharCode(97 + i)}) ${c}`)
    .join(" ");
  return `${quote}\n${count} things to fix. ${enumerated}`;
}

function collectClauses(findings: Finding[]): string[] {
  const clauses: string[] = [];

  const generic = findings
    .filter((f) => CRITIQUE_SPECS[f.issueType])
    .sort(
      (a, b) =>
        (GENERIC_ORDER[a.issueType] ?? 99) -
        (GENERIC_ORDER[b.issueType] ?? 99),
    );
  for (const f of generic) {
    clauses.push(CRITIQUE_SPECS[f.issueType]!);
  }

  const drifts = findings.filter(
    (f) => f.issueType === "assumption_commitment_drift",
  );
  if (drifts.length === 1) clauses.push(renderDriftClause(drifts[0]));
  else if (drifts.length >= 2) clauses.push(renderMergedDriftClause(drifts));

  const overload = findings.find((f) => f.issueType === "assumption_overload");
  if (overload) clauses.push(renderOverloadClause(overload));

  const redundancies = findings.filter(
    (f) => f.issueType === "worry_redundancy",
  );
  if (redundancies.length === 1)
    clauses.push(renderRedundancyClause(redundancies[0]));
  else if (redundancies.length >= 2)
    clauses.push(renderMergedRedundancyClause(redundancies));

  return clauses;
}

// ---------------------------------------------------------------------------
// Critique specs — plain-language fix-inline sentences
// ---------------------------------------------------------------------------

const CRITIQUE_SPECS: Partial<Record<IssueType, string>> = {
  depth_shortfall_behavior:
    "Push it to observable depth — name a specific move you make that works against your goal, phrased as something you actually do (not what you wish you did).",
  depth_shortfall_worry:
    "Push it to identity depth — name who you'd be if the opposite behavior happened, not just what would happen.",
  depth_shortfall_commitment:
    "Push it to identity depth — name the identity you're protecting and what a friend on your shoulder would see you take the hit on.",
  depth_shortfall_assumption:
    'Push the "then" half to identity depth — who you\'d be, not just what would happen next.',
  interior_witness_worry:
    'Flip to outside witness — instead of what you\'d have to see, know, or feel, name what SHE would see, know, or say out loud.',
  interior_witness_commitment:
    'Rewrite as "never being the [specific role] who [specific action]" instead of "avoiding the feeling that…" — name the identity plus the observable action.',
  commitment_doesnt_mirror_worry:
    "Rewrite so it names the exact identity or outcome the paired worry fears. Same nouns, same specificity, wrapped in \"I'm also committed to never...\" — the commitment is supposed to be the worry rewritten as a vow.",
  vague_assumption_then_clause:
    'Name the identity plainly in the "then" half — write out what that guy actually is, not "the guy I\'m terrified of".',
  assumption_uncovered_commitment:
    "Draft a Big Assumption for this commitment — an if-then belief that names the scenario the commitment protects against and the identity it fears.",
  bundled_goal:
    "Split this into two improvements — pick one for this map, save the other for later.",
};

const GENERIC_ORDER: Partial<Record<IssueType, number>> = {
  bundled_goal: 0,
  commitment_doesnt_mirror_worry: 1,
  interior_witness_worry: 2,
  interior_witness_commitment: 3,
  vague_assumption_then_clause: 4,
  depth_shortfall_behavior: 5,
  depth_shortfall_worry: 6,
  depth_shortfall_commitment: 7,
  depth_shortfall_assumption: 8,
  assumption_uncovered_commitment: 9,
};

// ---------------------------------------------------------------------------
// Non-aggregatable clauses (LLM-detail bearing)
// ---------------------------------------------------------------------------

function renderDriftClause(f: Finding): string {
  const scenario = f.assumptionScenario ?? "a different scenario";
  const identity = f.commitmentIdentity ?? "a different identity";
  const relatedQuote = f.relatedText ? ` ("${f.relatedText}")` : "";
  return `Sharpen the "if" half — the assumption is about ${scenario}, but the paired commitment${relatedQuote} protects ${identity}. Either match that scenario or name a missing commitment that pairs cleanly with the current assumption.`;
}

function renderMergedDriftClause(findings: Finding[]): string {
  const first = findings[0];
  const scenario = first.assumptionScenario ?? "a different scenario";
  const identities = findings
    .map((f) => f.commitmentIdentity)
    .filter((s): s is string => Boolean(s));
  const identityList =
    identities.length > 0 ? joinList(identities) : "different identities";
  const commitmentQuotes = findings
    .map((f) => (f.relatedText ? `"${f.relatedText}"` : null))
    .filter((s): s is string => s !== null);
  const quotesList =
    commitmentQuotes.length > 0 ? ` (${joinList(commitmentQuotes)})` : "";
  const count = pluralCountPhrase(findings.length);
  return `Sharpen the "if" half — the assumption is about ${scenario}, but the ${count} paired commitments${quotesList} protect ${identityList}. Either match those scenarios or name missing commitments.`;
}

function renderOverloadClause(f: Finding): string {
  const reason = stripDetailPrefix(f.detail);
  return `Carrying more weight than one belief can hold — ${reason} Draft additional Big Assumptions so each commitment has one pointed at its own specific concern.`;
}

function renderRedundancyClause(f: Finding): string {
  const related = f.relatedText ? `"${f.relatedText}"` : "another worry";
  const reason = stripDetailPrefix(f.detail);
  return `Duplicates the worry ${related} — ${reason} Push this worry into a distinct identity concern or drop it so the map isn't carrying the same fear twice.`;
}

function renderMergedRedundancyClause(findings: Finding[]): string {
  const worryQuotes = findings
    .map((f) => (f.relatedText ? `"${f.relatedText}"` : null))
    .filter((s): s is string => s !== null);
  const quotesList =
    worryQuotes.length > 0 ? ` (${joinList(worryQuotes)})` : "";
  const count = pluralCountPhrase(findings.length);
  return `Duplicates ${count} worries${quotesList} — same identity concern in different forms. Push this worry into a distinct identity concern or drop it.`;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const CARDINALS_LC = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
] as const;

function countWordCapitalized(n: number): string {
  const word = CARDINALS_LC[n - 1];
  if (!word) return `${n}`;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function pluralCountPhrase(n: number): string {
  if (n === 2) return "both";
  const word = CARDINALS_LC[n - 1];
  return word ? `all ${word}` : `all ${n}`;
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function stripDetailPrefix(detail: string): string {
  const stripped = detail
    .replace(
      /^Assumption is carrying multiple distinct identity concerns\.\s*/i,
      "",
    )
    .replace(
      /^Assumption is linked to commitments that name distinct identity concerns\.\s*[^.]*\.\s*/i,
      "",
    )
    .replace(
      /^Assumption's if-clause and its linked commitment name different concerns\.\s*/i,
      "",
    )
    .replace(
      /^Worry duplicates the identity concern in a commitment on the map\.\s*/i,
      "",
    )
    .replace(
      /^Worry duplicates a concern already carried by one of the competing commitments\.\s*[^.]*\.\s*/i,
      "",
    )
    .trim();
  return stripped.length > 0 ? stripped : detail;
}

// Exhaustiveness check for IssueType — TS surfaces new types here.
const _EXHAUSTIVENESS: readonly IssueType[] = [
  "bundled_goal",
  "depth_shortfall_behavior",
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
void _EXHAUSTIVENESS;
