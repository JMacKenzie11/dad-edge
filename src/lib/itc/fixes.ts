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
  reviseAssumption,
  reviseBehavior,
  scrubBannedCoachWords,
  scrubReplyLight,
} from "./coach";
import { checkAssumptionEnactable } from "./criteria/assumptions";
import { findingLine, prioritizeEntries, renderRowSharpen } from "./criteria/render";
import {
  rowFindingsForAssumption,
  rowFindingsForBehavior,
  rowFindingsForCommitment,
  rowFindingsForWorry,
} from "./criteria/row-sharpen";
import { DEPTH_THRESHOLD, type Finding, type IssueType } from "./criteria/types";
import {
  listAssumptionDrafts,
  listAssumptions,
  listBehaviors,
  listCommitments,
  listWorries,
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

export async function coachTextForBehavior(input: {
  /** Everything else on this map, from loadMapTexts. Required so the
   *  rewrite this path offers is held to the same people-check the
   *  hone path applies. */
  mapTexts: string[];
  goalText: string;
  behavior: ItcBehavior;
  score: number;
  depthReason: string;
}): Promise<RowCoachText> {
  const rubricReason = rubricReasonFor(input.score, input.depthReason);
  const behavior: ItcBehavior = {
    ...input.behavior,
    depth_score: input.score,
    rubric_reason: rubricReason,
    suggested_fix: null,
  };
  const findings = await rowFindingsForBehavior({ behavior });
  if (findings.length === 0) {
    return { rubricReason, sharpenText: null, suggestedFix: null };
  }
  const suggestedFix = await reviseBehavior({
    mapTexts: input.mapTexts,
    goalText: input.goalText,
    currentText: behavior.text,
    problems: problemsOf(findings),
  }).catch(() => null);
  return {
    rubricReason,
    sharpenText: renderRowSharpen(findings),
    suggestedFix,
  };
}

export async function coachTextForWorry(input: {
  /** Everything else on this map, from loadMapTexts. Required so the
   *  rewrite this path offers is held to the same people-check the
   *  hone path applies. */
  mapTexts: string[];
  goalText: string;
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
  // See the note on reviseWorry below: no rewrite for Column 3.
  return {
    rubricReason,
    sharpenText: renderRowSharpen(findings),
    suggestedFix: null,
  };
}

export async function coachTextForCommitment(input: {
  /** Everything else on this map, from loadMapTexts. Required so the
   *  rewrite this path offers is held to the same people-check the
   *  hone path applies. */
  mapTexts: string[];
  goalText: string;
  behaviorText: string;
  worry: ItcWorry;
  commitment: ItcCommitment;
  score: number;
  depthReason: string;
  mirrorsWorryIdentity: boolean | null;
}): Promise<RowCoachText> {
  const rubricReason = rubricReasonFor(input.score, input.depthReason);
  // The waterfall, applied to the row and not just the hone banner.
  // A competing commitment is a mirror of its worry, and a worry that
  // still needs work produces a commitment that needs work: the
  // coachee would be asked to fix a sentence that gets rewritten the
  // moment he fixes the worry above it (saveWorry re-derives it).
  // Stay quiet here and let the worry's own box do the coaching.
  // Same rationale as runHoneWaterfall stopping at the first broken
  // column (Kegan/Lahey Vol 1 p 4).
  if (
    input.worry.depth_score !== null &&
    input.worry.depth_score < DEPTH_THRESHOLD
  ) {
    return { rubricReason, sharpenText: null, suggestedFix: null };
  }
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
    mapTexts: input.mapTexts,
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
  /** Everything else on this map, from loadMapTexts. Required so the
   *  rewrite this path offers is held to the same people-check the
   *  hone path applies. */
  mapTexts: string[];
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
    mapTexts: input.mapTexts,
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
  /** Everything else on this map, from loadMapTexts. Required so the
   *  rewrite this path offers is held to the same people-check the
   *  hone path applies. */
  mapTexts: string[];
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
      mapTexts: input.mapTexts,
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
  behaviors: "itc_behaviors",
  worries: "itc_worries",
  commitments: "itc_commitments",
  assumptions: "itc_assumptions",
};

/** Types whose fix is on the row at save time. If a group has only
 *  these and the row already carries a rewrite, reuse it. */
const ROW_LEVEL_TYPES: ReadonlySet<IssueType> = new Set<IssueType>([
  "depth_shortfall_behavior",
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
  } else if (ref.table === "behaviors") {
    fix = await reviseBehaviorEntry(findings, ctx);
  } else if (ref.table === "worries") {
    // No rewrite for Column 3, on either surface. Offering one here
    // and not on the row is the coach-contradicts-itself split this
    // codebase keeps closing.
    fix = null;
  } else if (ref.table === "commitments") {
    fix = await reviseCommitment(findings, ctx);
  } else if (ref.table === "assumptions") {
    fix = await reviseAssumptionEntry(findings, ctx);
  }
  // goal: the check supplies its own fix (bundled goal split).
  // Nothing to draft, nothing to persist.

  const table = TABLE_FOR[ref.table];
  if (ctx.persist && table) {
    await updateRowCoachText(table, ref.id, {
      sharpenText: renderRowSharpen(findings),
      suggestedFix: fix,
    });
  }
  return findings.map((f) => ({ ...f, suggestedFix: fix ?? f.suggestedFix }));
}

async function reviseBehaviorEntry(findings: Finding[], ctx: FixContext): Promise<string | null> {
  const behavior = ctx.behaviors.find((b) => b.id === findings[0].entryRef.id);
  if (!behavior) return null;
  return reviseBehavior({
    mapTexts: mapTextsOf(ctx),
    goalText: ctx.goalText,
    currentText: behavior.text,
    problems: problemsOf(findings),
  }).catch(() => null);
}

/**
 * Column 3 rewrites: the coach says what is missing, the man writes
 * the sentence.
 *
 * The system used to author the whole worry here, counter-move and
 * fear together, and the fear is the half it cannot get right. It
 * offered "if I told the client the honest, limited outcome, I'd be
 * the guy selling confidence he doesn't actually have" against a
 * behavior of over-promising: selling confidence he doesn't have IS
 * over-promising, so the sentence reads "if I stopped overselling I'd
 * be an overseller". Backwards.
 *
 * The check that exists to catch that (scoreWorryDepth criterion 4,
 * "does this worry explain the behavior as self-protection") was
 * measured on six fresh cases and got four, missing only in the
 * permissive direction. Pulling the question out into its own
 * isolated judge scored zero of four, and the main model failed it
 * identically to the utility model, so the difficulty is in the
 * question rather than the model. To answer "does this habit protect
 * him from this fear or cause it" you have to know what is true
 * inside one particular man's head, and both readings are
 * constructible from the text every time.
 *
 * That is the same wall that made fresh drafts openings-only: the
 * counter-move is mechanical and the server is right about it every
 * time; the fear is his. This was the last path still authoring it.
 * Detecting bad fears kept leaking; not generating them does not.
 *
 * The row still gets sharpenText, which names precisely what is
 * missing. CoachFixBox renders the lines alone when there is no
 * rewrite (it has always handled a null fix).
 */

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
    mapTexts: mapTextsOf(ctx),
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
    mapTexts: mapTextsOf(ctx),
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

/**
 * Everything the coachee has written on this map, for the drafters'
 * people check. The save-time callers live in actions.ts and hold
 * only the row they are saving, so they load it here.
 *
 * Deliberately the same list as mapTextsOf below, and deliberately
 * adjacent to it: these are the two definitions of "the map's text",
 * and when they drifted apart the same judge ran on two different
 * evidence sets depending on which surface called it.
 */
export async function loadMapTexts(
  mapId: string,
  goalText: string,
): Promise<string[]> {
  const [behaviors, worries, commitments, assumptions] = await Promise.all([
    listBehaviors(mapId),
    listWorries(mapId),
    listCommitments(mapId),
    listAssumptions(mapId),
  ]);
  return [
    goalText,
    ...behaviors.map((b) => b.text),
    ...worries.map((w) => w.text),
    ...commitments.map((c) => c.text),
    ...assumptions.map((a) => a.text),
  ];
}

function mapTextsOf(ctx: FixContext): string[] {
  return [
    ctx.goalText,
    ...ctx.behaviors.map((b) => b.text),
    ...ctx.worries.map((w) => w.text),
    ...ctx.commitments.map((c) => c.text),
    ...ctx.assumptions.map((a) => a.text),
  ];
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
