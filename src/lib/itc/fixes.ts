/**
 * Findings → coach text + verified rewrite, on every surface.
 *
 * The criteria module says what's off (Finding[]). The drafters know
 * how to write a sentence that clears the bar. This module joins the
 * two and persists the result onto the row, so the box under an
 * entry, the end-of-column review and the hone banner all read the
 * same three things:
 *
 *   rubric_reason  — the depth rubric's raw one-line reason
 *   sharpen_text   — the rendered "what's off" lines (render.ts)
 *   suggested_fix  — a rewrite that passed the same checks
 *
 * Three entry points:
 *   - coachTextFor{Worry,Commitment,Assumption}: save-time. Row-level
 *     findings only, no LLM judges.
 *   - coachTextForSelectedAssumption: prioritize. The one assumption
 *     he picked to test gets the enactable judge (Vol 1 p 18: the
 *     threshold for testing is higher than for honing) and, if its
 *     "if" isn't his move, a rewrite anchored to one of his behaviors.
 *   - attachFixes: after a column review or hone waterfall. Takes the
 *     findings, drafts a rewrite per entry that lacks one, writes the
 *     result onto the rows (so the boxes match the banner), and
 *     returns the enriched findings for the renderer.
 *
 * Rewrites are only ever attached when they cleared verification. A
 * finding without a rewrite still renders; the coachee does that one
 * himself.
 */

import type { PillarCode } from "@/lib/pillars";
import {
  draftAssumptionsFromCommitments,
  draftCommitmentForWorry,
  draftWorryForBehavior,
  reviseAssumption,
  scrubBannedCoachWords,
  scrubReplyLight,
} from "./coach";
import { checkAssumptionEnactable } from "./criteria/assumptions";
import { findingLine, prioritizeEntries, renderRowSharpen } from "./criteria/render";
import {
  rowFindingsForAssumption,
  rowFindingsForCommitment,
  rowFindingsForWorry,
} from "./criteria/row-sharpen";
import { DEPTH_THRESHOLD, type Finding, type IssueType } from "./criteria/types";
import {
  listAssumptionDrafts,
  saveAssumptionDrafts,
  updateRowCoachText,
  type CoachTextTable,
  type ItcAssumption,
  type ItcAssumptionCommitment,
  type ItcBehavior,
  type ItcCommitment,
  type ItcWorry,
  type RowCoachText,
} from "./maps";

// ---------------------------------------------------------------------------
// Save-time: one row
// ---------------------------------------------------------------------------

/**
 * The depth rubric's reason is the one LLM-authored sentence the
 * coachee reads on a row. It goes through the same scrubs as any
 * coach reply (dashes, claim-of-action phrases, banned words) before
 * it's stored, so every surface shows the scrubbed text.
 */
function rubricReasonFor(score: number, reason: string): string | null {
  if (score >= DEPTH_THRESHOLD) return null;
  const scrubbed = scrubBannedCoachWords(scrubReplyLight(reason)).trim();
  return scrubbed.length > 0 ? scrubbed : null;
}

function problemsOf(findings: Finding[]): string[] {
  return Array.from(new Set(findings.map(findingLine)));
}

export async function coachTextForWorry(input: {
  goalText: string;
  pillar: PillarCode;
  behavior: ItcBehavior;
  worry: ItcWorry;
  score: number;
  depthReason: string;
}): Promise<RowCoachText> {
  const rubricReason = rubricReasonFor(input.score, input.depthReason);
  const worry: ItcWorry = {
    ...input.worry,
    depth_score: input.score,
    rubric_reason: rubricReason,
    suggested_fix: null,
  };
  const findings = await rowFindingsForWorry({
    worry,
    behaviors: [input.behavior],
  });
  if (findings.length === 0) {
    return { rubricReason, sharpenText: null, suggestedFix: null };
  }
  const suggestedFix = await draftWorryForBehavior({
    goalText: input.goalText,
    behaviorText: input.behavior.text,
    pillar: input.pillar,
    revise: { currentText: worry.text, problems: problemsOf(findings) },
  }).catch(() => null);
  return {
    rubricReason,
    sharpenText: renderRowSharpen(findings),
    suggestedFix,
  };
}

export async function coachTextForCommitment(input: {
  goalText: string;
  behaviorText: string;
  worry: ItcWorry;
  commitment: ItcCommitment;
  score: number;
  depthReason: string;
  mirrorsWorryIdentity: boolean | null;
}): Promise<RowCoachText> {
  const rubricReason = rubricReasonFor(input.score, input.depthReason);
  const commitment: ItcCommitment = {
    ...input.commitment,
    depth_score: input.score,
    rubric_reason: rubricReason,
    mirrors_worry_identity: input.mirrorsWorryIdentity,
    suggested_fix: null,
  };
  const findings = await rowFindingsForCommitment({
    commitment,
    worry: input.worry,
  });
  if (findings.length === 0) {
    return { rubricReason, sharpenText: null, suggestedFix: null };
  }
  const suggestedFix = await draftCommitmentForWorry({
    goalText: input.goalText,
    behaviorText: input.behaviorText,
    worryText: input.worry.text,
    revise: { currentText: commitment.text, problems: problemsOf(findings) },
  }).catch(() => null);
  return {
    rubricReason,
    sharpenText: renderRowSharpen(findings),
    suggestedFix,
  };
}

export async function coachTextForAssumption(input: {
  goalText: string;
  assumption: ItcAssumption;
  linkedCommitments: Array<{ text: string; worry_text: string }>;
  behaviors: ItcBehavior[];
  score: number;
  depthReason: string;
}): Promise<RowCoachText> {
  const rubricReason = rubricReasonFor(input.score, input.depthReason);
  const assumption: ItcAssumption = {
    ...input.assumption,
    depth_score: input.score,
    rubric_reason: rubricReason,
    suggested_fix: null,
  };
  const findings = await rowFindingsForAssumption({ assumption });
  if (findings.length === 0) {
    return { rubricReason, sharpenText: null, suggestedFix: null };
  }
  const suggestedFix = await reviseAssumption({
    goalText: input.goalText,
    currentText: assumption.text,
    linkedCommitments: input.linkedCommitments,
    behaviors: input.behaviors.filter((b) => b.selected).map((b) => b.text),
    problems: problemsOf(findings),
    requireEnactable: false,
  }).catch(() => null);
  return {
    rubricReason,
    sharpenText: renderRowSharpen(findings),
    suggestedFix,
  };
}

/**
 * Prioritize: the assumption he picked to test must have an "if" he
 * can go do (Vol 1 p 18, Checkpoint 2). Row-level findings plus the
 * enactable judge on this one row; a rewrite anchored to one of his
 * behaviors when the "if" isn't his move. Writes the result onto the
 * row so the box shows it before he designs the test. Never throws;
 * a judge failure leaves the row as it was.
 */
export async function coachTextForSelectedAssumption(input: {
  goalText: string;
  assumption: ItcAssumption;
  linkedCommitments: Array<{ text: string; worry_text: string }>;
  behaviors: ItcBehavior[];
}): Promise<void> {
  try {
    const [rowFindings, enactable] = await Promise.all([
      rowFindingsForAssumption({ assumption: input.assumption }),
      checkAssumptionEnactable({
        assumptions: [input.assumption],
        behaviors: input.behaviors,
      }),
    ]);
    const findings = [...rowFindings, ...enactable];
    if (findings.length === 0) {
      // Clean, including enactable. Clear anything a prior audit left.
      await updateRowCoachText("itc_assumptions", input.assumption.id, {
        sharpenText: null,
        suggestedFix: null,
      });
      return;
    }
    const suggestedFix = await reviseAssumption({
      goalText: input.goalText,
      currentText: input.assumption.text,
      linkedCommitments: input.linkedCommitments,
      behaviors: input.behaviors.filter((b) => b.selected).map((b) => b.text),
      problems: problemsOf(findings),
      requireEnactable: enactable.length > 0,
    }).catch(() => null);
    await updateRowCoachText("itc_assumptions", input.assumption.id, {
      sharpenText: renderRowSharpen(findings),
      suggestedFix,
    });
  } catch (err) {
    console.warn(
      "[itc fixes] coachTextForSelectedAssumption failed (%s): %s",
      input.assumption.id,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ---------------------------------------------------------------------------
// Audit-time: a whole finding set
// ---------------------------------------------------------------------------

export type FixContext = {
  mapId: string;
  goalText: string;
  pillar: PillarCode;
  behaviors: ItcBehavior[];
  worries: ItcWorry[];
  commitments: ItcCommitment[];
  assumptions: ItcAssumption[];
  assumptionLinks: ItcAssumptionCommitment[];
  /** Write sharpen_text + suggested_fix onto the rows (and coverage
   *  drafts into itc_assumption_drafts). False for the admin preview. */
  persist: boolean;
};

const TABLE_FOR: Partial<Record<Finding["entryRef"]["table"], CoachTextTable>> = {
  worries: "itc_worries",
  commitments: "itc_commitments",
  assumptions: "itc_assumptions",
};

/** Types whose fix is on the row at save time. If a group has only
 *  these and the row already carries a rewrite, reuse it. */
const ROW_LEVEL_TYPES: ReadonlySet<IssueType> = new Set<IssueType>([
  "depth_shortfall_worry",
  "depth_shortfall_commitment",
  "depth_shortfall_assumption",
  "interior_witness_worry",
  "interior_witness_commitment",
  "commitment_doesnt_mirror_worry",
  "vague_assumption_then_clause",
  "assumption_not_enactable",
]);

export async function attachFixes(
  findings: Finding[],
  ctx: FixContext,
): Promise<Finding[]> {
  if (findings.length === 0) return findings;
  const groups = prioritizeEntries(findings);
  const enriched = await Promise.all(
    groups.map(async (group) => {
      try {
        return await fixEntry(group.findings, ctx);
      } catch (err) {
        console.warn(
          "[itc fixes] attachFixes failed (%s:%s): %s",
          group.ref.table,
          group.ref.id,
          err instanceof Error ? err.message : String(err),
        );
        return group.findings;
      }
    }),
  );
  return enriched.flat();
}

async function fixEntry(
  findings: Finding[],
  ctx: FixContext,
): Promise<Finding[]> {
  const ref = findings[0].entryRef;
  const types = new Set(findings.map((f) => f.issueType));

  // A commitment with no assumption under it: the fix is a draft
  // assumption, not a rewrite of the commitment.
  if (types.has("assumption_uncovered_commitment")) {
    return fixCoverage(findings, ctx);
  }

  let fix: string | null = null;
  const stored = findings.find((f) => f.suggestedFix?.trim())?.suggestedFix ?? null;
  const allRowLevel = [...types].every((t) => ROW_LEVEL_TYPES.has(t));
  if (stored && allRowLevel) {
    fix = stored;
  } else if (ref.table === "worries") {
    fix = await reviseWorry(findings, ctx);
  } else if (ref.table === "commitments") {
    fix = await reviseCommitment(findings, ctx);
  } else if (ref.table === "assumptions") {
    fix = await reviseAssumptionEntry(findings, ctx);
  }
  // goal / behaviors: the check supplies its own fix (bundled goal
  // split) or none. Nothing to draft, nothing to persist.

  const table = TABLE_FOR[ref.table];
  if (ctx.persist && table) {
    await updateRowCoachText(table, ref.id, {
      sharpenText: renderRowSharpen(findings),
      suggestedFix: fix,
    });
  }
  return findings.map((f) => ({ ...f, suggestedFix: fix ?? f.suggestedFix }));
}

async function reviseWorry(findings: Finding[], ctx: FixContext): Promise<string | null> {
  const worry = ctx.worries.find((w) => w.id === findings[0].entryRef.id);
  if (!worry) return null;
  const behavior = ctx.behaviors.find((b) => b.id === worry.behavior_id);
  if (!behavior) return null;
  return draftWorryForBehavior({
    goalText: ctx.goalText,
    behaviorText: behavior.text,
    pillar: ctx.pillar,
    revise: { currentText: worry.text, problems: problemsOf(findings) },
  }).catch(() => null);
}

async function reviseCommitment(findings: Finding[], ctx: FixContext): Promise<string | null> {
  const commitment = ctx.commitments.find((c) => c.id === findings[0].entryRef.id);
  if (!commitment) return null;
  const worry = ctx.worries.find((w) => w.id === commitment.worry_id);
  if (!worry) return null;
  const behavior = ctx.behaviors.find((b) => b.id === worry.behavior_id);
  return draftCommitmentForWorry({
    goalText: ctx.goalText,
    behaviorText: behavior?.text ?? "",
    worryText: worry.text,
    revise: { currentText: commitment.text, problems: problemsOf(findings) },
  }).catch(() => null);
}

async function reviseAssumptionEntry(findings: Finding[], ctx: FixContext): Promise<string | null> {
  const assumption = ctx.assumptions.find((a) => a.id === findings[0].entryRef.id);
  if (!assumption) return null;
  // Underwrite is a link problem. A rewrite can't fix "drop #2 from
  // it", so when that's the only thing off, don't offer one.
  const types = new Set(findings.map((f) => f.issueType));
  if (types.size === 1 && types.has("assumption_doesnt_underwrite")) return null;
  const linked = linkedCommitmentsFor(assumption.id, ctx);
  return reviseAssumption({
    goalText: ctx.goalText,
    currentText: assumption.text,
    linkedCommitments: linked,
    behaviors: ctx.behaviors.filter((b) => b.selected).map((b) => b.text),
    problems: problemsOf(
      findings.filter((f) => f.issueType !== "assumption_doesnt_underwrite"),
    ),
    requireEnactable: types.has("assumption_not_enactable"),
  }).catch(() => null);
}

function linkedCommitmentsFor(
  assumptionId: string,
  ctx: FixContext,
): Array<{ text: string; worry_text: string }> {
  const worryById = new Map(ctx.worries.map((w) => [w.id, w]));
  return ctx.assumptionLinks
    .filter((l) => l.assumption_id === assumptionId)
    .map((l) => ctx.commitments.find((c) => c.id === l.commitment_id))
    .filter((c): c is ItcCommitment => Boolean(c))
    .map((c) => ({
      text: c.text,
      worry_text: worryById.get(c.worry_id)?.text ?? "",
    }));
}

/**
 * Coverage: draft ONE Big Assumption for the uncovered commitment,
 * put it on the draft card (itc_assumption_drafts) so the coachee can
 * take it with one tap, and carry its text in suggestedFix so the
 * banner can quote it. The commitment row gets the line, not the
 * rewrite (the rewrite isn't a commitment).
 */
async function fixCoverage(findings: Finding[], ctx: FixContext): Promise<Finding[]> {
  const commitment = ctx.commitments.find((c) => c.id === findings[0].entryRef.id);
  if (!commitment) return findings;
  const worry = ctx.worries.find((w) => w.id === commitment.worry_id);

  let draftText: string | null = null;
  if (ctx.persist) {
    const existing = await listAssumptionDrafts(ctx.mapId);
    const already = existing.find((d) => d.commitment_ids.includes(commitment.id));
    if (already) draftText = already.text;
  }
  if (!draftText) {
    const drafts = await draftAssumptionsFromCommitments({
      goalText: ctx.goalText,
      commitments: [{ text: commitment.text, worry_text: worry?.text ?? "" }],
    }).catch(() => []);
    draftText = drafts[0]?.text ?? null;
    if (draftText && ctx.persist) {
      await saveAssumptionDrafts(ctx.mapId, [
        { text: draftText, commitment_ids: [commitment.id] },
      ]);
    }
  }

  if (ctx.persist) {
    await updateRowCoachText("itc_commitments", commitment.id, {
      sharpenText: renderRowSharpen(findings),
      suggestedFix: null,
    });
  }
  return findings.map((f) => ({ ...f, suggestedFix: draftText ?? undefined }));
}
