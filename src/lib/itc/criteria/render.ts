/**
 * Deterministic renderer for criteria findings.
 *
 * Three entry points, one voice:
 *   - renderFindings(findings, context): the hone banner and the
 *     end-of-column review. Quote + what's off + the sharper version.
 *   - renderRowSharpen(findings): the box under one entry. Same
 *     lines, minus the quote (the entry is right there).
 *   - findingLine(finding): the single "what's off" sentence. Both
 *     of the above build from it, and the drafters feed it back to
 *     the LLM as rewrite instructions.
 *
 * Budget: the hone banner shows ONE entry (the guide: "think first
 * about what MOST needs to be sharpened", Vol 1 p 5). The column
 * review shows up to three. Anything past the budget is counted, not
 * printed; every affected row carries its own box, so nothing is
 * hidden, just not repeated.
 *
 * No LLM in this file. Coach voice per docs/coach-voice-and-tone.md:
 * second person, contractions, plain nouns, no interface words, no
 * machinery words, say it once.
 */

import type { EntryRef, Finding, IssueType, Severity } from "./types";
import { SEVERITY_ORDER } from "./types";

export type RenderMode = "hone" | "column_review";

export type RenderContext = {
  /** Pillar label ("Amplify", "Bond", …). Used in the opening. */
  pillarLabel: string;
  /** Improvement goal text. Presence controls one empty-state phrasing. */
  goalText: string;
  /** hone = whole-map audit banner. column_review = end-of-column
   *  feedback surfaced inline while the coachee is still building. */
  mode: RenderMode;
  /** For column_review mode: which column is being reviewed. */
  columnLabel?: string;
  /** Max entries to print. Defaults per mode (hone 1, column_review
   *  3). Pass Infinity to print everything (admin preview). */
  limit?: number;
};

export const DEFAULT_LIMIT: Record<RenderMode, number> = {
  hone: 1,
  column_review: 3,
};

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export function renderFindings(
  findings: Finding[],
  context: RenderContext,
): string {
  if (findings.length === 0) {
    return renderEmptyState(context);
  }

  const groups = prioritizeEntries(findings);
  const limit = context.limit ?? DEFAULT_LIMIT[context.mode];
  const shown = groups.slice(0, Math.max(1, limit));
  const hidden = groups.length - shown.length;

  const opening = renderOpening(groups, context);
  const paragraphs = shown.map((g) => renderEntryParagraph(g));
  const trailer = hidden > 0 ? renderTrailer(hidden) : null;

  return [opening, ...paragraphs, ...(trailer ? [trailer] : [])].join("\n\n");
}

/**
 * The row box. One line per finding, then the sharper version if
 * there is one. Returns null when the entry is clean.
 */
export function renderRowSharpen(findings: Finding[]): string | null {
  if (findings.length === 0) return null;
  const lines = uniqueLines(findings.map(findingLine));
  return lines.join(" ");
}

/**
 * The single "what's off" sentence for a finding. Static advice for
 * most types; built from structured fields for the dynamic ones.
 */
export function findingLine(f: Finding): string {
  switch (f.issueType) {
    case "assumption_doesnt_underwrite":
      return renderUnderwriteLine(f);
    case "bundled_goal":
      // The goal check carries its own split in suggestedFix; the
      // line is the static advice.
      return f.detail;
    default:
      return f.detail;
  }
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function renderEmptyState(context: RenderContext): string {
  if (context.mode === "column_review") {
    // Phrased so grammatical number never matters: the labels are a
    // mix of singular ("Your goal") and plural ("Your worries"), and
    // the old wording produced "Your worries holds up."
    return `Nothing to work on in ${columnPhrase(context.columnLabel)} before you move on.`;
  }
  const holds =
    context.goalText.trim().length > 0
      ? `Your ${context.pillarLabel} map holds up`
      : "Your map holds up";
  return `${holds}. Nothing on it needs work right now. When something on the map changes, I'll look again.`;
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

/**
 * The count is every entry the audit is about to show or mark, so
 * it always agrees with the paragraphs plus the trailer. Entries
 * that block the gate (critical) come first in the ordering, and
 * the opening says to start there. Voice: appreciative, plain.
 * "Holds up" / "is close", never "broken".
 */
function renderOpening(groups: EntryGroup[], context: RenderContext): string {
  const criticals = groups.filter((g) => g.severity === "critical").length;
  const total = groups.length;
  const things = total === 1 ? "One thing" : `${countWord(total)} things`;
  const startFirst =
    criticals === 0
      ? ""
      : criticals === 1
        ? " Start with the first one; the map under it moves once it's finished."
        : ` Start with the first ${countWordLower(criticals)}; the map under them moves once they're finished.`;

  if (context.mode === "column_review") {
    return `${things} to work on in ${columnPhrase(context.columnLabel)} before you move on.${startFirst}`;
  }

  // mode === "hone"
  const map = `Your ${context.pillarLabel} map`;
  const standing = criticals > 0 ? `${map} is close.` : `${map} holds up.`;
  return `${standing} ${things} to work on before you pick what to test.${startFirst}`;
}

/** "Your worries" / "Your goal" → "your worries" / "your goal", and a
 *  sane fallback. One place, so every column sentence reads the same. */
function columnPhrase(columnLabel: string | undefined): string {
  if (!columnLabel) return "this column";
  const bare = columnLabel.replace(/^your\s+/i, "").trim();
  return bare.length > 0 ? `your ${bare.toLowerCase()}` : "this column";
}

function renderTrailer(hidden: number): string {
  return hidden === 1
    ? "One more after this. It's marked on the map."
    : `${countWord(hidden)} more after this. They're marked on the map.`;
}

// ---------------------------------------------------------------------------
// Per-entry paragraph: quote + line(s) + sharper version
// ---------------------------------------------------------------------------

interface EntryGroup {
  key: string;
  ref: EntryRef;
  severity: Severity;
  findings: Finding[];
}

function renderEntryParagraph(group: EntryGroup): string {
  const first = group.findings[0];
  const quote = `"${first.actualText}"`;
  const lines = uniqueLines(group.findings.map(findingLine));
  const fix = group.findings.find((f) => f.suggestedFix?.trim())?.suggestedFix;
  const out = [quote, lines.join(" ")];
  if (fix) out.push(renderFixLine(group, fix.trim()));
  return out.join("\n");
}

function renderFixLine(group: EntryGroup, fix: string): string {
  const types = new Set(group.findings.map((f) => f.issueType));
  if (types.has("assumption_uncovered_commitment")) {
    return `A Big Assumption that would hold it up: "${fix}". It's waiting with your Big Assumptions.`;
  }
  if (types.has("bundled_goal")) {
    return fix;
  }
  return `Sharper: "${fix}"`;
}

function renderUnderwriteLine(f: Finding): string {
  const positions = f.unfitCommitmentPositions ?? [];
  if (positions.length === 0) return f.detail;
  const list = joinList(positions.map((p) => `#${p}`));
  const those = positions.length === 1 ? "that vow" : "those vows";
  return `Believing this doesn't make ${list} feel necessary. Drop ${list} from it, or rewrite the "if" so doing it would break ${those} too.`;
}

// ---------------------------------------------------------------------------
// Grouping + priority
// ---------------------------------------------------------------------------

/** Column order for the top-down walk (goal → behaviors → worries →
 *  commitments → assumptions). Coverage findings point at a
 *  commitment but belong to the assumptions column. */
const COLUMN_RANK: Record<EntryRef["table"], number> = {
  goal: 0,
  map: 0,
  behaviors: 1,
  worries: 2,
  commitments: 3,
  assumptions: 4,
  tests: 5,
};

const TYPE_RANK: Partial<Record<IssueType, number>> = {
  bundled_goal: 0,
  commitment_doesnt_mirror_worry: 1,
  interior_witness_worry: 2,
  interior_witness_commitment: 3,
  vague_assumption_then_clause: 4,
  depth_shortfall_behavior: 5,
  depth_shortfall_worry: 6,
  depth_shortfall_commitment: 7,
  depth_shortfall_assumption: 8,
  assumption_not_enactable: 9,
  assumption_doesnt_underwrite: 10,
  assumption_uncovered_commitment: 11,
};

function columnRank(f: Finding): number {
  if (f.issueType === "assumption_uncovered_commitment") return COLUMN_RANK.assumptions;
  return COLUMN_RANK[f.entryRef.table];
}

function entryKey(ref: EntryRef): string {
  return `${ref.table}:${ref.id}`;
}

/**
 * Group findings by entry, then order the groups: broken before
 * fixable, then top of the map before bottom, then in the order the
 * findings arrived (map order from the check functions). Within a
 * group, findings sort by type so the lines read in a stable order.
 */
export function prioritizeEntries(findings: Finding[]): EntryGroup[] {
  const byKey = new Map<string, EntryGroup>();
  const order: string[] = [];
  findings.forEach((f) => {
    const key = entryKey(f.entryRef);
    let g = byKey.get(key);
    if (!g) {
      g = { key, ref: f.entryRef, severity: f.severity, findings: [] };
      byKey.set(key, g);
      order.push(key);
    }
    g.findings.push(f);
    if (SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[g.severity]) {
      g.severity = f.severity;
    }
  });
  const groups = order.map((k) => byKey.get(k)!);
  for (const g of groups) {
    g.findings.sort(
      (a, b) => (TYPE_RANK[a.issueType] ?? 99) - (TYPE_RANK[b.issueType] ?? 99),
    );
  }
  const arrival = new Map(order.map((k, i) => [k, i]));
  return groups.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    const col = columnRank(a.findings[0]) - columnRank(b.findings[0]);
    if (col !== 0) return col;
    return (arrival.get(a.key) ?? 0) - (arrival.get(b.key) ?? 0);
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const CARDINALS = [
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

function countWordLower(n: number): string {
  return CARDINALS[n - 1] ?? `${n}`;
}

function countWord(n: number): string {
  return capitalize(countWordLower(n));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
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
  "assumption_doesnt_underwrite",
  "assumption_not_enactable",
  "assumption_uncovered_commitment",
  "test_coverage_gap",
  "test_grip_through_data",
];
void _EXHAUSTIVENESS;
