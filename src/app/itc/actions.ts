"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  awaitReactionOrSwallow,
  fireCoachReaction,
  loadCoachContext,
  persistReaction,
  requireParticipantAndMap,
  safeRevalidate,
  type ActionResult,
} from "@/lib/itc/action-helpers";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import {
  draftAssumptionsFromCommitments,
  draftCommitmentForWorry,
  draftTestForAssumption,
  draftWorryForBehavior,
  generateCoachReaction,
  generateImmuneSystemWalkthrough,
  generateMapCloseSummary,
  generateSuggestions,
  recommendAssumptionToTest,
  reviewTestDesign,
  reviewTestResult,
  reviseTestFromReview,
  scrubReply,
  WORRY_IDENTITY_SHAPES,
  type ReactionInput,
  type ReactionOutput,
  type SmartReview,
} from "@/lib/itc/coach";
import {
  addAssumption,
  addBehavior as insertBehaviorRow,
  advanceStage,
  appendMessage,
  clearAssumptionLinks,
  createMap,
  deleteAssumption,
  deleteAssumptionDraft,
  deleteBehavior,
  deleteMap,
  getActiveTest,
  getMapById,
  getMapForParticipant,
  linkAssumptionToCommitments,
  listAssumptionDrafts,
  listAssumptionLinks,
  listAssumptions,
  listBehaviors,
  listCommitments,
  listMapsForParticipant,
  listMessages,
  listTestResults,
  listTests,
  clearSelectedAssumption,
  listWorries,
  markTestAbandoned,
  clearAssumptionDraftsForMap,
  clearCommitmentDraftsForMap,
  clearWorryDraftsForMap,
  deleteStageNoteMessages,
  markWalkthroughDelivered,
  markWalkthroughNotDelivered,
  recordTestResult,
  saveAssumptionDrafts,
  saveImprovementGoal,
  saveTestDraft,
  setAssumptionSelected,
  setBehaviorWorryDraft,
  updateTest,
  updateTestResult,
  setWorryCommitmentDraft,
  updateAssumptionDepth,
  updateAssumptionText,
  updateBehaviorDepth,
  updateBehaviorText,
  updateCommitmentDepth,
  updateWorryDepth,
  upsertCommitmentForWorry,
  upsertWorryForBehavior,
} from "@/lib/itc/maps";
import {
  scoreAssumptionDepth,
  scoreBehaviorDepth,
  scoreCommitmentDepth,
  scoreWorryDepth,
} from "@/lib/itc/rubric";
import { hasCompetingGoalFraming, worryPassesDepth } from "@/lib/itc/rules";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import {
  abandonMissionForItcTest,
  cascadeItcMapClear,
  checkMissionCapForItcTest,
  createMissionForItcTest,
  markMissionCompletedForItcTest,
  syncItcGoalToTracker,
} from "@/lib/itc/tracker-link";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  ASSUMPTION_STEM,
  GOAL_STEM,
  ITC_STAGES,
  STAGE_LABELS,
  ensureStem,
  hasGoalStem,
  type ItcStage,
} from "@/lib/itc/stage";
import { TurnEventLog } from "@/lib/itc/turn-events";

// Re-export ActionResult so client code + tests that import from
// `@/app/itc/actions` don't break. The type moved to action-helpers.ts
// as part of extracting shared helpers out of this file.
export type { ActionResult };

// -------------------------------------------------------------------------
// Map lifecycle
// -------------------------------------------------------------------------

const startMapSchema = z.object({
  pillar_code: z.enum(["B", "R", "A", "V", "E", "M", "N"]),
});

export async function startMap(formData: FormData): Promise<void> {
  const participant = await requireItcParticipant();
  const parsed = startMapSchema.safeParse({
    pillar_code: formData.get("pillar_code"),
  });
  if (!parsed.success) redirect("/itc?error=pillar");

  // One active map per participant, globally (product decision 2026-08-28).
  // If any in-progress map exists — same pillar or otherwise — redirect
  // there instead of creating a new one. The DB-level unique partial index
  // (migration 20260828000001) is the backstop; this guard just makes the
  // UX friendly rather than surfacing a raw DB error.
  const existingMaps = await listMapsForParticipant(participant.id);
  const anyInProgress = existingMaps.find((m) => m.status === "in_progress");
  if (anyInProgress) redirect(`/itc/${anyInProgress.id}`);

  const map = await createMap(participant.id, parsed.data.pillar_code as PillarCode);
  // No persisted goal intro — the client renders STAGE_INTROS.goal live
  // with the current pillar_code so it stays correct after a pillar swap.
  redirect(`/itc/${map.id}`);
}

const resetMapSchema = z.object({ map_id: z.string().uuid() });

const switchMapPillarSchema = z.object({
  map_id: z.string().uuid(),
  pillar_code: z.enum(["B", "R", "A", "V", "E", "M", "N"]),
});

/**
 * Swap the current map's pillar in place. Triggered from the coach's
 * pillar-mismatch reaction when it populates suggested_pillar and the
 * client renders the "Switch to [Pillar]" action button.
 *
 * All child rows (behaviors, worries, commitments, assumptions, tests,
 * messages) keep their FKs to this map — nothing else changes. The
 * coachee still needs to reword the goal to fit the new pillar (the
 * coach will react to the next save).
 *
 * Conflict guard: if the coachee already has an in-progress map on
 * the target pillar, block with a friendly reason. Multiple in-
 * progress maps per (participant, pillar) would confuse the /itc
 * landing page's "resume this pillar's map" logic.
 */
export async function switchMapPillar(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = switchMapPillarSchema.safeParse({
    map_id: formData.get("map_id"),
    pillar_code: formData.get("pillar_code"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  if (loaded.map.pillar_code === parsed.data.pillar_code) {
    return { ok: true }; // no-op
  }
  const target = PILLAR_BY_CODE[parsed.data.pillar_code as PillarCode];
  // Conflict check.
  const allMaps = await listMapsForParticipant(loaded.participant.id);
  const conflict = allMaps.find(
    (m) =>
      m.id !== loaded.map.id &&
      m.status === "in_progress" &&
      m.pillar_code === parsed.data.pillar_code,
  );
  if (conflict) {
    return {
      ok: false,
      reason: `You already have a ${target.label} map in progress. Finish or clear that one first, or reword this goal to fit ${PILLAR_BY_CODE[loaded.map.pillar_code].label}.`,
    };
  }
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from("itc_maps")
      .update({ pillar_code: parsed.data.pillar_code })
      .eq("id", loaded.map.id);
    if (error) throw new Error(error.message);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not switch pillar.",
    };
  }
  // System message so the coach's next turn sees the switch in
  // context and reacts appropriately to the newly-mismatched goal.
  await appendMessage(
    loaded.map.id,
    "system",
    `[coachee switched map pillar: ${loaded.map.pillar_code} → ${parsed.data.pillar_code}. Goal still needs to be reworded to fit the new pillar.]`,
    loaded.map.current_stage,
  );
  // Re-run the coach against the existing goal in the new pillar
  // context. Without this, the goal text is unchanged so saveGoal
  // won't fire (client-side dedup on unchanged text), and the coach
  // never gets a chance to say "still not an ITC-shaped goal for
  // [new pillar]". Only fires if there's a goal to react to.
  if (loaded.map.improvement_goal) {
    // Re-read the map so context reflects the new pillar_code.
    const refreshed = await getMapById(loaded.map.id);
    if (refreshed) {
      await awaitReactionOrSwallow(() =>
        fireCoachReaction(
          refreshed.id,
          { kind: "goal", text: refreshed.improvement_goal ?? "" },
          { table: "itc_maps", id: refreshed.id },
        ),
      );
    }
  }
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

export async function resetMap(formData: FormData): Promise<void> {
  const participant = await requireItcParticipant();
  const parsed = resetMapSchema.safeParse({ map_id: formData.get("map_id") });
  if (!parsed.success) redirect("/itc");
  const map = await getMapForParticipant(parsed.data.map_id, participant.id);
  if (!map) redirect("/itc");
  // Cascade to the tracker BEFORE deleting the map (so the linked
  // goal + planned mission ids can still be read from itc_maps /
  // itc_tests). Abandons the linked quarterly_goal and any linked
  // 'planned' mission; leaves completed/missed/rolled_over missions
  // alone so the man's real history stays intact.
  await cascadeItcMapClear(map.id);
  await deleteMap(map.id, participant.id);
  redirect("/itc");
}

// -------------------------------------------------------------------------
// Chat: pure conversation. Never mutates state.
// -------------------------------------------------------------------------

const chatSchema = z.object({
  map_id: z.string().uuid(),
  text: z.string().min(1).max(4000),
});

// sendDockMessage + the "Ask the coach" dock were removed 2026-08-24.
// The global Help widget (src/components/help/help-widget.tsx) replaces
// the dock's visual slot on ITC pages. No free-form Q&A anywhere in
// the app. dock_message enum value stays in turn-event history for
// audit of prior dock exchanges; nothing writes new ones.

/**
 * Reply within an entry's thread. The user's reply lands anchored
 * to the entry; the coach's response fires from the reaction
 * pipeline with the entry pinned in context so back-and-forth about
 * an entry happens on the entry.
 */
// -------------------------------------------------------------------------
// Goal (Column 1)
// -------------------------------------------------------------------------

const saveGoalSchema = z.object({
  map_id: z.string().uuid(),
  text: z.string().min(1).max(500),
});

export async function saveGoal(formData: FormData): Promise<ActionResult> {
  const parsed = saveGoalSchema.safeParse({
    map_id: formData.get("map_id"),
    text: formData.get("text"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid goal input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  // Dev-only test-seed escape hatch. Typing one of the recognized
  // goals (e.g., "I'm committed to getting better at test" or
  // "test design" or "test results") wipes the map's current state
  // and seeds the fixture through the target stage. See TEST_SEED_MARKERS
  // for the menu.
  const seedTarget = isTestSeedGoal(parsed.data.text);
  if (seedTarget) {
    const res = await seedTestMap(loaded.map.id, seedTarget);
    if (!res.ok) return res;
    safeRevalidate(`/itc/${loaded.map.id}`);
    return { ok: true };
  }

  // Reject if the text carries any other goal-framing prefix ("I want",
  // "My goal", etc.) — blindly prepending the stem in those cases
  // produces mashups like "I'm committed to getting better at I want to
  // get better at X". Ask the user to keep the stem and phrase after it.
  const rawTrimmed = parsed.data.text.trim();
  if (!hasGoalStem(rawTrimmed) && hasCompetingGoalFraming(rawTrimmed)) {
    return {
      ok: false,
      reason: `Keep "${GOAL_STEM}" at the start and write the rest after it.`,
    };
  }
  const withStem = hasGoalStem(rawTrimmed)
    ? rawTrimmed
    : `${GOAL_STEM} ${rawTrimmed}`;
  const priorGoal = loaded.map.improvement_goal;
  const isEdit = Boolean(priorGoal && priorGoal.trim() !== withStem.trim());
  try {
    await saveImprovementGoal(loaded.map.id, withStem);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not save goal.",
    };
  }
  // Mirror to the tracker as a quarterly_goal. Fire-and-forget:
  // failures are logged inside syncItcGoalToTracker and don't block
  // the ITC save. The ITC map is the source of truth for ITC UX;
  // the tracker is a downstream mirror.
  await syncItcGoalToTracker({
    participantId: loaded.participant.id,
    mapId: loaded.map.id,
    pillarCode: loaded.map.pillar_code,
    goalText: withStem,
  });
  const events = new TurnEventLog(loaded.map.id, 0);
  if (isEdit) {
    events.record(
      "entry_edited",
      {
        kind: "goal",
        prior_text: priorGoal,
        text: withStem,
        stage_at_edit: loaded.map.current_stage,
      },
      { stage: loaded.map.current_stage },
    );
  } else {
    events.record(
      "entry_added",
      { kind: "goal", text: withStem },
      { stage: loaded.map.current_stage },
    );
  }
  await events.flush();
  // Goal has no separate entry row — it's a column on itc_maps.
  // Anchor the coach reaction to the map itself so the entry thread
  // renders in the goal section.
  await awaitReactionOrSwallow(() =>
    fireCoachReaction(
      loaded.map.id,
      { kind: "goal", text: withStem },
      { table: "itc_maps", id: loaded.map.id },
    ),
  );
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

// -------------------------------------------------------------------------
// Behaviors (Column 2)
// -------------------------------------------------------------------------

const behaviorAddSchema = z.object({
  map_id: z.string().uuid(),
  text: z.string().min(3).max(400),
});

export async function addBehavior(formData: FormData): Promise<ActionResult> {
  const parsed = behaviorAddSchema.safeParse({
    map_id: formData.get("map_id"),
    text: formData.get("text"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid behavior input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  const existing = await listBehaviors(loaded.map.id);
  const selected = existing.filter((b) => b.selected);
  if (selected.length >= 5) {
    return {
      ok: false,
      reason:
        "The map already has 5 behaviors. Refine or remove one before adding another.",
    };
  }
  let behaviorId: string;
  try {
    const result = await insertBehaviorRow(
      loaded.map.id,
      parsed.data.text,
      "user",
    );
    if (result.deduped) {
      return {
        ok: false,
        reason:
          "That behavior is already on the map. Refine an existing one if the phrasing is sharper.",
      };
    }
    behaviorId = result.row.id;
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not add behavior.",
    };
  }
  const events = new TurnEventLog(loaded.map.id, 0);
  events.record(
    "entry_added",
    {
      kind: "behavior",
      text: parsed.data.text.trim(),
      entry_id: behaviorId,
      attempts: 1,
    },
    { stage: loaded.map.current_stage },
  );

  // Rubric — deterministic pipeline step, same shape as saveWorry.
  // Score persists even if the coach reaction later fails; the
  // Continue-to-Worries gate reads directly from depth_score/attempts.
  let score = 0;
  try {
    const scored = await scoreBehaviorDepth({
      goalText: loaded.map.improvement_goal ?? "",
      behaviorText: parsed.data.text.trim(),
    });
    score = scored.score;
    await updateBehaviorDepth(behaviorId, score, scored.reason);
    events.record(
      "rubric_scored",
      {
        kind: "behavior",
        entry_id: behaviorId,
        score,
        attempts: 1,
        is_concrete_observable: scored.is_concrete_observable,
        works_against_goal: scored.works_against_goal,
        is_first_person_action_not_aspiration:
          scored.is_first_person_action_not_aspiration,
        reason: scored.reason,
      },
      { stage: loaded.map.current_stage },
    );
  } catch (err) {
    console.warn(
      "[itc] addBehavior rubric failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    events.record(
      "error",
      { where: "addBehavior.rubric", message: err instanceof Error ? err.message : String(err) },
      { stage: loaded.map.current_stage },
    );
  }
  await events.flush();

  await awaitReactionOrSwallow(() =>
    fireCoachReaction(
      loaded.map.id,
      { kind: "behavior", text: parsed.data.text.trim() },
      { table: "itc_behaviors", id: behaviorId },
    ),
  );
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

const behaviorUpdateSchema = z.object({
  map_id: z.string().uuid(),
  behavior_id: z.string().uuid(),
  text: z.string().min(3).max(400),
});

export async function updateBehavior(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = behaviorUpdateSchema.safeParse({
    map_id: formData.get("map_id"),
    behavior_id: formData.get("behavior_id"),
    text: formData.get("text"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid edit input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  const existing = await listBehaviors(loaded.map.id);
  const target = existing.find((b) => b.id === parsed.data.behavior_id);
  if (!target) return { ok: false, reason: "Behavior not on this map." };
  const priorText = target.text;
  let updated: Awaited<ReturnType<typeof updateBehaviorText>>;
  try {
    updated = await updateBehaviorText(target.id, loaded.map.id, parsed.data.text);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not save.",
    };
  }
  const events = new TurnEventLog(loaded.map.id, 0);
  events.record(
    "entry_edited",
    {
      kind: "behavior",
      entry_id: target.id,
      prior_text: priorText,
      text: parsed.data.text.trim(),
      attempts: updated.attempts,
      stage_at_edit: loaded.map.current_stage,
    },
    { stage: loaded.map.current_stage },
  );

  // Rubric — same pipeline step as addBehavior. Re-scores against the
  // new text; the Continue gate reads the fresh depth_score/attempts.
  let score = 0;
  try {
    const scored = await scoreBehaviorDepth({
      goalText: loaded.map.improvement_goal ?? "",
      behaviorText: updated.text,
    });
    score = scored.score;
    await updateBehaviorDepth(updated.id, score, scored.reason);
    events.record(
      "rubric_scored",
      {
        kind: "behavior",
        entry_id: updated.id,
        score,
        attempts: updated.attempts,
        is_concrete_observable: scored.is_concrete_observable,
        works_against_goal: scored.works_against_goal,
        is_first_person_action_not_aspiration:
          scored.is_first_person_action_not_aspiration,
        reason: scored.reason,
      },
      { stage: loaded.map.current_stage },
    );
  } catch (err) {
    console.warn(
      "[itc] updateBehavior rubric failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    events.record(
      "error",
      { where: "updateBehavior.rubric", message: err instanceof Error ? err.message : String(err) },
      { stage: loaded.map.current_stage },
    );
  }
  await events.flush();

  await awaitReactionOrSwallow(() =>
    fireCoachReaction(
      loaded.map.id,
      { kind: "behavior", text: parsed.data.text.trim() },
      { table: "itc_behaviors", id: target.id },
    ),
  );
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

const behaviorRemoveSchema = z.object({
  map_id: z.string().uuid(),
  behavior_id: z.string().uuid(),
});

export async function removeBehavior(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = behaviorRemoveSchema.safeParse({
    map_id: formData.get("map_id"),
    behavior_id: formData.get("behavior_id"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid remove input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  const existing = await listBehaviors(loaded.map.id);
  const target = existing.find((b) => b.id === parsed.data.behavior_id);
  if (!target) return { ok: false, reason: "Behavior not on this map." };
  try {
    await deleteBehavior(target.id, loaded.map.id);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not remove.",
    };
  }
  const events = new TurnEventLog(loaded.map.id, 0);
  events.record(
    "entry_edited",
    { kind: "behavior", text: target.text, removed: true },
    { stage: loaded.map.current_stage },
  );
  await events.flush();
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

// -------------------------------------------------------------------------
// Worries (Column 3) — depth-stage excavation loop
// -------------------------------------------------------------------------

const worrySaveSchema = z.object({
  map_id: z.string().uuid(),
  behavior_id: z.string().uuid(),
  text: z.string().min(3).max(400),
});

/**
 * Save-or-edit the worry paired to a behavior. Pipeline:
 *   1. upsert the worry row (attempts++)
 *   2. run scoreWorryDepth (server rubric) and persist the score
 *   3. fire coach reaction with depth+attempts as prompt inputs
 *
 * Steps 2-3 are the excavation loop: shallow scores prompt the coach
 * to ask an excavation question and invite a rewrite. The rubric
 * result is metadata (server-written), not map content (user-written).
 */
export async function saveWorry(formData: FormData): Promise<ActionResult> {
  const parsed = worrySaveSchema.safeParse({
    map_id: formData.get("map_id"),
    behavior_id: formData.get("behavior_id"),
    text: formData.get("text"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid worry input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  // Behavior must exist on the map and be selected.
  const behaviors = await listBehaviors(loaded.map.id);
  const behavior = behaviors.find(
    (b) => b.id === parsed.data.behavior_id && b.selected,
  );
  if (!behavior) {
    return { ok: false, reason: "That behavior is not on the map." };
  }

  let row: Awaited<ReturnType<typeof upsertWorryForBehavior>>["row"];
  let isEdit: boolean;
  try {
    const result = await upsertWorryForBehavior(
      loaded.map.id,
      behavior.id,
      parsed.data.text,
    );
    row = result.row;
    isEdit = result.isEdit;
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not save worry.",
    };
  }

  const events = new TurnEventLog(loaded.map.id, 0);
  events.record(
    isEdit ? "entry_edited" : "entry_added",
    {
      kind: "worry",
      entry_id: row.id,
      behavior_id: behavior.id,
      text: row.text,
      attempts: row.attempts,
      ...(isEdit ? { stage_at_edit: loaded.map.current_stage } : {}),
    },
    { stage: loaded.map.current_stage },
  );

  // Rubric — deterministic pipeline step. Score persists even if the
  // coach reaction later fails; the Continue gate reads directly from
  // depth_score/attempts.
  let score = 0;
  try {
    const scored = await scoreWorryDepth({
      goalText: loaded.map.improvement_goal ?? "",
      behaviorText: behavior.text,
      worryText: row.text,
    });
    score = scored.score;
    // Persist reason too — surfaced by the "Needs more depth" UI so
    // the coachee sees WHAT to sharpen instead of just that something
    // is off. Only shown on shallow rows; passing rows get null from
    // the UI's perspective (badge doesn't render).
    await updateWorryDepth(row.id, score, scored.reason);
    events.record(
      "rubric_scored",
      {
        kind: "worry",
        entry_id: row.id,
        score,
        attempts: row.attempts,
        is_fear: scored.is_fear,
        is_first_person_felt: scored.is_first_person_felt,
        touches_identity: scored.touches_identity,
        reason: scored.reason,
      },
      { stage: loaded.map.current_stage },
    );
  } catch (err) {
    console.warn(
      "[itc] saveWorry rubric failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    events.record(
      "error",
      { where: "saveWorry.rubric", message: err instanceof Error ? err.message : String(err) },
      { stage: loaded.map.current_stage },
    );
  }
  await events.flush();

  await awaitReactionOrSwallow(() =>
    fireCoachReaction(
      loaded.map.id,
      {
        kind: "worry",
        text: row.text,
        pairedText: behavior.text,
        depthScore: score,
        attempts: row.attempts,
      },
      { table: "itc_worries", id: row.id },
    ),
  );
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

// -------------------------------------------------------------------------
// Commitments (Column 4) — depth-stage excavation loop
// -------------------------------------------------------------------------

const commitmentSaveSchema = z.object({
  map_id: z.string().uuid(),
  worry_id: z.string().uuid(),
  text: z.string().min(3).max(400),
});

/**
 * Save-or-edit the commitment paired to a worry. Same shape as
 * saveWorry: upsert → rubric → persist score → coach reaction.
 * The rubric (scoreCommitmentDepth) pushes back on noble-sounding
 * "productivity blog" commitments and requires self-protective
 * first-person phrasing that would sound strange said out loud.
 */
export async function saveCommitment(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = commitmentSaveSchema.safeParse({
    map_id: formData.get("map_id"),
    worry_id: formData.get("worry_id"),
    text: formData.get("text"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid commitment input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  // Worry must exist on the map.
  const worries = await listWorries(loaded.map.id);
  const worry = worries.find((w) => w.id === parsed.data.worry_id);
  if (!worry) {
    return { ok: false, reason: "That worry is not on the map." };
  }

  let row: Awaited<ReturnType<typeof upsertCommitmentForWorry>>["row"];
  let isEdit: boolean;
  try {
    const result = await upsertCommitmentForWorry(
      loaded.map.id,
      worry.id,
      parsed.data.text,
    );
    row = result.row;
    isEdit = result.isEdit;
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not save commitment.",
    };
  }

  const events = new TurnEventLog(loaded.map.id, 0);
  events.record(
    isEdit ? "entry_edited" : "entry_added",
    {
      kind: "commitment",
      entry_id: row.id,
      worry_id: worry.id,
      text: row.text,
      attempts: row.attempts,
      ...(isEdit ? { stage_at_edit: loaded.map.current_stage } : {}),
    },
    { stage: loaded.map.current_stage },
  );

  let score = 0;
  try {
    const scored = await scoreCommitmentDepth({
      goalText: loaded.map.improvement_goal ?? "",
      worryText: worry.text,
      commitmentText: row.text,
    });
    score = scored.score;
    // Persist reason too — surfaced by the "Needs more depth" UI.
    await updateCommitmentDepth(row.id, score, scored.reason);
    events.record(
      "rubric_scored",
      {
        kind: "commitment",
        entry_id: row.id,
        score,
        attempts: row.attempts,
        is_first_person_never_vow: scored.is_first_person_never_vow,
        mirrors_worry_identity: scored.mirrors_worry_identity,
        is_specific_not_generic: scored.is_specific_not_generic,
        reason: scored.reason,
      },
      { stage: loaded.map.current_stage },
    );
  } catch (err) {
    console.warn(
      "[itc] saveCommitment rubric failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    events.record(
      "error",
      {
        where: "saveCommitment.rubric",
        message: err instanceof Error ? err.message : String(err),
      },
      { stage: loaded.map.current_stage },
    );
  }
  await events.flush();

  await awaitReactionOrSwallow(() =>
    fireCoachReaction(
      loaded.map.id,
      {
        kind: "commitment",
        text: row.text,
        pairedText: worry.text,
        depthScore: score,
        attempts: row.attempts,
      },
      { table: "itc_commitments", id: row.id },
    ),
  );
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

// -------------------------------------------------------------------------
// Assumptions (Column 5) — depth-stage excavation loop
// -------------------------------------------------------------------------

const assumptionSaveSchema = z.object({
  map_id: z.string().uuid(),
  assumption_id: z.string().uuid().optional(),
  text: z.string().min(3).max(400),
  commitment_ids: z.array(z.string().uuid()).default([]),
});

/**
 * Save-or-edit a Big Assumption. Different from worries/commitments
 * in one key way: pairing is many-to-many via itc_assumption_commitments.
 * A single assumption can underwrite multiple commitments (Kegan/Lahey:
 * several fears often share one root belief).
 *
 * Pipeline:
 *   1. upsert the assumption row (new or edit; attempts++ on edit)
 *   2. replace the assumption's commitment links with the payload set
 *   3. run scoreAssumptionDepth (server rubric) and persist the score
 *   4. fire coach reaction (kind=assumption); pairedText carries the
 *      linked commitment(s) so the coach can excavate against them
 */
export async function saveAssumption(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = assumptionSaveSchema.safeParse({
    map_id: formData.get("map_id"),
    assumption_id: formData.get("assumption_id") || undefined,
    text: formData.get("text"),
    commitment_ids: formData.getAll("commitment_ids").filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    ),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid assumption input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  // Every commitment_id must exist on this map.
  const allCommitments = await listCommitments(loaded.map.id);
  const commitmentsById = new Map(allCommitments.map((c) => [c.id, c]));
  for (const cid of parsed.data.commitment_ids) {
    if (!commitmentsById.has(cid)) {
      return { ok: false, reason: "One of those commitments isn't on the map." };
    }
  }

  // Auto-prepend the ITC "I assume that" stem so both user-typed and
  // draft-promoted assumptions land in canonical Kegan/Lahey form.
  // Unlike goals (where competing framing is a hard reject), assumptions
  // are more forgiving — the user might type "If I …" naturally and we
  // just add the "I assume that" prefix so it reads as a testable belief.
  const stemmed = ensureStem(parsed.data.text, ASSUMPTION_STEM);

  let row: Awaited<ReturnType<typeof addAssumption>>["row"];
  let isEdit: boolean;
  try {
    if (parsed.data.assumption_id) {
      row = await updateAssumptionText(
        parsed.data.assumption_id,
        loaded.map.id,
        stemmed,
      );
      isEdit = true;
    } else {
      const result = await addAssumption(loaded.map.id, stemmed);
      if (result.deduped) {
        return {
          ok: false,
          reason:
            "That assumption is already on the map. Edit the existing one instead.",
        };
      }
      row = result.row;
      isEdit = false;
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not save assumption.",
    };
  }

  // Replace links atomically: clear then re-insert the payload set.
  try {
    await clearAssumptionLinks(row.id);
    if (parsed.data.commitment_ids.length > 0) {
      await linkAssumptionToCommitments(row.id, parsed.data.commitment_ids);
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not update links.",
    };
  }

  const events = new TurnEventLog(loaded.map.id, 0);
  events.record(
    isEdit ? "entry_edited" : "entry_added",
    {
      kind: "assumption",
      entry_id: row.id,
      text: row.text,
      attempts: row.attempts,
      commitment_ids: parsed.data.commitment_ids,
      ...(isEdit ? { stage_at_edit: loaded.map.current_stage } : {}),
    },
    { stage: loaded.map.current_stage },
  );

  let score = 0;
  try {
    const scored = await scoreAssumptionDepth({
      goalText: loaded.map.improvement_goal ?? "",
      assumptionText: row.text,
    });
    score = scored.score;
    // Persist reason too — surfaced by the "Needs more depth" UI.
    await updateAssumptionDepth(row.id, score, scored.reason);
    events.record(
      "rubric_scored",
      {
        kind: "assumption",
        entry_id: row.id,
        score,
        attempts: row.attempts,
        has_finished_then: scored.has_finished_then,
        is_first_person_felt: scored.is_first_person_felt,
        lands_in_identity_or_big_time_bad:
          scored.lands_in_identity_or_big_time_bad,
        reason: scored.reason,
      },
      { stage: loaded.map.current_stage },
    );
  } catch (err) {
    console.warn(
      "[itc] saveAssumption rubric failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    events.record(
      "error",
      {
        where: "saveAssumption.rubric",
        message: err instanceof Error ? err.message : String(err),
      },
      { stage: loaded.map.current_stage },
    );
  }
  await events.flush();

  // pairedText: the commitment(s) this assumption underwrites, joined
  // so the coach can excavate against them in prose.
  const linkedTexts = parsed.data.commitment_ids
    .map((cid) => commitmentsById.get(cid)?.text)
    .filter((t): t is string => Boolean(t));
  const pairedText = linkedTexts.length
    ? linkedTexts.map((t, i) => `${i + 1}. ${t}`).join(" / ")
    : undefined;

  await awaitReactionOrSwallow(() =>
    fireCoachReaction(
      loaded.map.id,
      {
        kind: "assumption",
        text: row.text,
        pairedText,
        depthScore: score,
        attempts: row.attempts,
      },
      { table: "itc_assumptions", id: row.id },
    ),
  );
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

const assumptionRemoveSchema = z.object({
  map_id: z.string().uuid(),
  assumption_id: z.string().uuid(),
});

export async function removeAssumption(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = assumptionRemoveSchema.safeParse({
    map_id: formData.get("map_id"),
    assumption_id: formData.get("assumption_id"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid remove input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  try {
    // Links cascade via FK on itc_assumption_commitments.
    await deleteAssumption(parsed.data.assumption_id, loaded.map.id);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not remove.",
    };
  }
  const events = new TurnEventLog(loaded.map.id, 0);
  events.record(
    "entry_edited",
    {
      kind: "assumption",
      entry_id: parsed.data.assumption_id,
      removed: true,
    },
    { stage: loaded.map.current_stage },
  );
  await events.flush();
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

const assumptionDraftDismissSchema = z.object({
  map_id: z.string().uuid(),
  draft_id: z.string().uuid(),
});

/**
 * Delete a coach-drafted Big Assumption without promoting it. Called
 * on the Column 5 "Dismiss" button and also after a successful
 * saveAssumption promotion (client fires save, then this) so the
 * draft card disappears once the assumption is real map state.
 * Idempotent — a missing draft is not an error.
 */
export async function dismissAssumptionDraft(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = assumptionDraftDismissSchema.safeParse({
    map_id: formData.get("map_id"),
    draft_id: formData.get("draft_id"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid dismiss input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  try {
    await deleteAssumptionDraft(parsed.data.draft_id, loaded.map.id);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not dismiss draft.",
    };
  }
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

// -------------------------------------------------------------------------
// Suggestions ("Give me ideas" button)
// -------------------------------------------------------------------------

const suggestionsSchema = z.object({
  map_id: z.string().uuid(),
  kind: z.enum(["goal", "behavior", "worry", "commitment", "assumption"]),
  context_text: z.string().max(1000).optional(),
});

export async function requestSuggestions(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = suggestionsSchema.safeParse({
    map_id: formData.get("map_id"),
    kind: formData.get("kind"),
    context_text: (formData.get("context_text") as string) || undefined,
  });
  if (!parsed.success)
    return { ok: false, reason: "Invalid suggestions request." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  const events = new TurnEventLog(loaded.map.id, 0);
  events.record(
    "suggestion_requested",
    { kind: parsed.data.kind, has_context: Boolean(parsed.data.context_text) },
    { stage: loaded.map.current_stage },
  );
  try {
    const { context } = await loadCoachContext(loaded.map.id);
    const result = await generateSuggestions({
      ...context,
      kind: parsed.data.kind,
      contextText: parsed.data.context_text,
    });
    if (result.suggestions.length > 0) {
      // Suggestions land as a section-level thread pinned under the
      // stage note. Anchor to the map row so it renders at the top
      // of the active section beside the stage-note framing.
      await persistReaction(
        loaded.map.id,
        context.stage,
        {
          reply: scrubReply(result.reply),
          suggestions: result.suggestions,
          durationMs: result.durationMs,
        },
        "stage_note",
        { table: "itc_maps", id: loaded.map.id },
      );
    }
    events.record(
      "llm_attempt",
      {
        kind: "suggestions",
        suggestions: result.suggestions.length,
      },
      { durationMs: result.durationMs, stage: context.stage },
    );
  } catch (err) {
    console.warn(
      "[itc requestSuggestions] failure: %s",
      err instanceof Error ? err.message : String(err),
    );
    events.record("error", {
      where: "requestSuggestions",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  await events.flush();
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

// -------------------------------------------------------------------------
// Stage transitions (the Continue button)
// -------------------------------------------------------------------------

const advanceSchema = z.object({
  map_id: z.string().uuid(),
  to: z.enum([
    "goal",
    "behaviors",
    "worries",
    "commitments",
    "assumptions",
    "review",
    "immune_system",
    "prioritize",
    "test_design",
    "test_running",
    "results",
    "done",
  ]),
});

export async function advanceToStage(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = advanceSchema.safeParse({
    map_id: formData.get("map_id"),
    to: formData.get("to"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid stage." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  const target = parsed.data.to as ItcStage;

  const gate = await computeAdvanceGate(loaded.map);
  if (!gate.enabled || gate.to !== target) {
    return {
      ok: false,
      reason: gate.reason ?? "Not ready to advance.",
    };
  }

  try {
    await advanceStage(loaded.map.id, loaded.map.current_stage, target);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not advance.",
    };
  }
  await appendMessage(
    loaded.map.id,
    "system",
    `[coachee advanced map via Continue: ${loaded.map.current_stage} → ${target}]`,
    target,
  );
  const events = new TurnEventLog(loaded.map.id, 0);
  events.record(
    "stage_advanced",
    { from: loaded.map.current_stage, to: target },
    { stage: target },
  );

  // On entry to the worries stage, generate a coach draft worry for
  // each selected behavior that doesn't already have a real paired
  // worry. Drafts are metadata: they only become real worry.text when
  // the user accepts via saveWorry. Column 3 is the depth gate of the
  // whole map, so the drafter's job is to pre-produce the "yuck" — a
  // starting worry the coachee can accept, edit, or replace, which
  // shows the identity-level shape a good worry needs.
  if (target === "worries") {
    await draftMissingWorriesAfterAdvance(loaded.map.id, events);
  }
  // On entry to the commitments stage, generate a coach draft for
  // each worry that doesn't already have one AND has no commitment
  // yet. Per ITC methodology, Column 4 derivation is coach work —
  // the coachee has already done the deep excavation at Column 3.
  // Drafts are metadata, not map content: they only become real
  // commitment.text when the user accepts via saveCommitment.
  if (target === "commitments") {
    await draftMissingCommitmentsAfterAdvance(loaded.map.id, events);
  }
  // On entry to the assumptions stage, cluster the commitments and
  // draft a small set of Big Assumptions with commitment coverage.
  // Same architectural class as commitment drafts: metadata only,
  // becomes map state via saveAssumption when the user acts.
  if (target === "assumptions") {
    await draftAssumptionsAfterAdvance(loaded.map.id, events);
  }
  // On entry to the immune-system stage, generate the three-movement
  // Kegan/Lahey walkthrough of the coachee's own map and persist it
  // as a stage-note message. Also flips walkthrough_delivered so the
  // Continue-to-Prioritize gate opens.
  if (target === "immune_system") {
    await deliverWalkthroughAfterAdvance(loaded.map.id, events);
  }
  // On entry to the prioritize stage, generate the coach's
  // Vol 2 p.268-anchored recommendation of which Big Assumption to
  // test first, persist the prose, and pre-select the recommended
  // assumption. Coachee can override by clicking a different one.
  if (target === "prioritize") {
    await deliverPrioritizeRecommendationAfterAdvance(loaded.map.id, events);
  }
  // On entry to test_design, pre-draft a Kegan-voice test for the
  // selected assumption. Coachee sees the draft in the form,
  // reviews / edits any field, and saves. Idempotent — skip if any
  // active (non-abandoned) test already exists for the selected
  // assumption on this map.
  if (target === "test_design") {
    await deliverTestDraftAfterAdvance(loaded.map.id, events);
  }
  // On entry to done, generate the Kegan-voice closing summary and
  // persist it as a stage_note. Idempotent — skip if a done stage_note
  // already exists.
  if (target === "done") {
    await deliverMapCloseSummaryAfterAdvance(loaded.map.id, events);
  }
  await events.flush();
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

/**
 * Populate itc_behaviors.coach_worry_draft for every selected behavior
 * that (a) has no real paired worry yet and (b) has no draft yet.
 * Runs on advance to the worries stage. One LLM call per behavior in
 * parallel so the Continue click doesn't block on N sequential
 * round-trips. Mirrors the Column 4 commitment-drafter pattern one
 * column upstream.
 */
async function draftMissingWorriesAfterAdvance(
  mapId: string,
  events: TurnEventLog,
): Promise<void> {
  const [map, behaviors, worries] = await Promise.all([
    getMapById(mapId),
    listBehaviors(mapId),
    listWorries(mapId),
  ]);
  if (!map) return;
  const behaviorsWithWorries = new Set(worries.map((w) => w.behavior_id));
  const selected = behaviors.filter((b) => b.selected);
  const needsDraft = selected.filter(
    (b) => !behaviorsWithWorries.has(b.id) && !b.coach_worry_draft,
  );
  if (needsDraft.length === 0) return;

  // Server-owned shape rotation. Each behavior's drafter call gets
  // a hard identity-shape constraint from WORRY_IDENTITY_SHAPES,
  // rotated by index. Guarantees the map's worry set varies across
  // Kegan-canonical shapes (role-noun, role-failure verb, seen-as,
  // self-label) instead of the LLM's default clustering on
  // "she'd see I've been the man who X" for every behavior.
  //
  // Rotation uses the behavior's ORDINAL POSITION on the map
  // (needsDraft is already ordered by sort_order via listBehaviors)
  // so re-drafts land on the same shape for the same behavior on
  // retry, keeping the pattern stable rather than churning shape
  // across regenerations.
  const drafted = await Promise.all(
    needsDraft.map(async (b, index) => {
      const identityShape =
        WORRY_IDENTITY_SHAPES[index % WORRY_IDENTITY_SHAPES.length];
      const draft = await draftWorryForBehavior({
        goalText: map.improvement_goal ?? "",
        behaviorText: b.text,
        pillar: map.pillar_code,
        identityShape,
      });
      return { behaviorId: b.id, draft };
    }),
  );

  await Promise.all(
    drafted
      .filter((d): d is { behaviorId: string; draft: string } => Boolean(d.draft))
      .map((d) => setBehaviorWorryDraft(d.behaviorId, d.draft)),
  );
  events.record(
    "coach_reaction_sent",
    {
      kind: "worry_drafts",
      behavior_count: needsDraft.length,
      drafted_count: drafted.filter((d) => d.draft).length,
    },
    { stage: "worries" },
  );
}

/**
 * Populate itc_worries.coach_commitment_draft for every worry on the
 * map that (a) has no commitment yet and (b) has no draft yet. Runs
 * on advance to the commitments stage. Each draft is one LLM call;
 * the whole set fires in parallel so the "Continue to Commitments"
 * click doesn't block on N sequential round-trips.
 */
async function draftMissingCommitmentsAfterAdvance(
  mapId: string,
  events: TurnEventLog,
): Promise<void> {
  const [map, worries, commitments] = await Promise.all([
    getMapById(mapId),
    listWorries(mapId),
    listCommitments(mapId),
  ]);
  if (!map) return;
  const worriesWithCommitments = new Set(commitments.map((c) => c.worry_id));
  const behaviorsById = new Map(
    (await listBehaviors(mapId)).map((b) => [b.id, b]),
  );

  const needsDraft = worries.filter(
    (w) => !worriesWithCommitments.has(w.id) && !w.coach_commitment_draft,
  );
  if (needsDraft.length === 0) return;

  const drafted = await Promise.all(
    needsDraft.map(async (w) => {
      const behavior = behaviorsById.get(w.behavior_id);
      if (!behavior) return { worryId: w.id, draft: null as string | null };
      const draft = await draftCommitmentForWorry({
        goalText: map.improvement_goal ?? "",
        behaviorText: behavior.text,
        worryText: w.text,
      });
      return { worryId: w.id, draft };
    }),
  );

  await Promise.all(
    drafted
      .filter((d): d is { worryId: string; draft: string } => Boolean(d.draft))
      .map((d) => setWorryCommitmentDraft(d.worryId, d.draft)),
  );
  events.record(
    "coach_reaction_sent",
    {
      kind: "commitment_drafts",
      worry_count: needsDraft.length,
      drafted_count: drafted.filter((d) => d.draft).length,
    },
    { stage: "commitments" },
  );
}

/**
 * On advance to assumptions, cluster the map's commitments and
 * persist a small set of coach-drafted Big Assumptions. Skips
 * cleanly if drafts already exist (idempotent — user coming back to
 * a resumed map shouldn't see the drafts multiply). Runs one LLM
 * call for the whole map (not per commitment) since clustering is
 * the whole point.
 */
async function draftAssumptionsAfterAdvance(
  mapId: string,
  events: TurnEventLog,
): Promise<void> {
  const [map, commitments, worries, existingDrafts, existingAssumptions] =
    await Promise.all([
      getMapById(mapId),
      listCommitments(mapId),
      listWorries(mapId),
      listAssumptionDrafts(mapId),
      listAssumptions(mapId),
    ]);
  if (!map) return;
  if (commitments.length === 0) return;
  // Don't re-draft if the user already has drafts pending review OR
  // has authored any of their own assumptions.
  if (existingDrafts.length > 0 || existingAssumptions.length > 0) return;

  const worryById = new Map(worries.map((w) => [w.id, w]));
  const orderedCommitments = commitments.map((c) => ({
    id: c.id,
    text: c.text,
    worry_text: worryById.get(c.worry_id)?.text ?? "(worry)",
  }));
  const drafts = await draftAssumptionsFromCommitments({
    goalText: map.improvement_goal ?? "",
    commitments: orderedCommitments.map((c) => ({
      text: c.text,
      worry_text: c.worry_text,
    })),
  });
  if (drafts.length === 0) return;
  const toPersist = drafts.map((d) => ({
    text: d.text,
    // Resolve 1-based indices → commitment_ids using the same
    // ordered list the prompt saw.
    commitment_ids: d.commitment_indices
      .map((n) => orderedCommitments[n - 1]?.id)
      .filter((v): v is string => Boolean(v)),
  }));
  await saveAssumptionDrafts(mapId, toPersist);
  events.record(
    "coach_reaction_sent",
    {
      kind: "assumption_drafts",
      commitment_count: commitments.length,
      drafted_count: toPersist.length,
    },
    { stage: "assumptions" },
  );
}

const regenerateDraftsSchema = z.object({
  map_id: z.string().uuid(),
});

/**
 * Client-triggered regenerate for the coach's Column 4 commitment
 * drafts. Wipes every draft on worries that don't have a real
 * commitment yet, then re-fires the drafter against the current
 * worry text. Real commitments (already accepted) are untouched.
 *
 * Why this exists: coachee lands on Column 4, sees the drafts,
 * goes back to Column 3 and sharpens a worry. The corresponding
 * draft is still based on the old worry text. This lets them
 * regenerate without hand-editing.
 */
export async function regenerateCommitmentDrafts(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = regenerateDraftsSchema.safeParse({
    map_id: formData.get("map_id"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  try {
    await clearCommitmentDraftsForMap(loaded.map.id);
    const events = new TurnEventLog(loaded.map.id, 0);
    await draftMissingCommitmentsAfterAdvance(loaded.map.id, events);
    await events.flush();
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not regenerate.",
    };
  }
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

/**
 * Client-triggered regenerate for the coach's Column 3 worry drafts.
 * Wipes every draft on behaviors that don't have a real paired worry,
 * then re-fires the drafter against the current behavior text. Real
 * worries (already accepted) are untouched.
 *
 * Why this exists: coachee lands on Column 3, sees the drafts, goes
 * back to Column 2 and sharpens a behavior. The corresponding draft
 * is still based on the old behavior text. This lets them regenerate
 * without hand-editing.
 */
export async function regenerateWorryDrafts(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = regenerateDraftsSchema.safeParse({
    map_id: formData.get("map_id"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  try {
    await clearWorryDraftsForMap(loaded.map.id);
    const events = new TurnEventLog(loaded.map.id, 0);
    await draftMissingWorriesAfterAdvance(loaded.map.id, events);
    await events.flush();
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not regenerate.",
    };
  }
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

/**
 * Client-triggered regenerate for the coach's Column 5 assumption
 * drafts. Wipes every itc_assumption_drafts row and re-fires the
 * drafter against the current commitments. Real itc_assumptions
 * (already accepted) are untouched — the drafter's idempotency
 * guard on existingAssumptions.length > 0 needs to be bypassed for
 * this call, so we clear first (drafts) and rely on the same
 * guard: if the coachee has any accepted assumptions, we skip.
 * That mirrors the auto-run semantics.
 *
 * Actually — for regenerate we WANT to write fresh drafts even if
 * some accepted assumptions exist (the coachee might have accepted
 * two and want fresh drafts for the remaining commitments). Bypass
 * the guard via a direct re-implementation instead of calling the
 * hook.
 */
export async function regenerateAssumptionDrafts(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = regenerateDraftsSchema.safeParse({
    map_id: formData.get("map_id"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  try {
    await clearAssumptionDraftsForMap(loaded.map.id);
    // Re-run the drafter directly (not via draftAssumptionsAfterAdvance
    // which would short-circuit on existing assumptions).
    const [commitments, worries] = await Promise.all([
      listCommitments(loaded.map.id),
      listWorries(loaded.map.id),
    ]);
    if (commitments.length > 0) {
      const worryById = new Map(worries.map((w) => [w.id, w]));
      const orderedCommitments = commitments.map((c) => ({
        id: c.id,
        text: c.text,
        worry_text: worryById.get(c.worry_id)?.text ?? "(worry)",
      }));
      const drafts = await draftAssumptionsFromCommitments({
        goalText: loaded.map.improvement_goal ?? "",
        commitments: orderedCommitments.map((c) => ({
          text: c.text,
          worry_text: c.worry_text,
        })),
      });
      if (drafts.length > 0) {
        const toPersist = drafts.map((d) => ({
          text: d.text,
          commitment_ids: d.commitment_indices
            .map((n) => orderedCommitments[n - 1]?.id)
            .filter((v): v is string => Boolean(v)),
        }));
        await saveAssumptionDrafts(loaded.map.id, toPersist);
      }
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not regenerate.",
    };
  }
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

/**
 * On advance to the immune-system stage, generate the three-movement
 * Kegan/Lahey walkthrough of the coachee's own map, persist it as a
 * stage-note message, and flip walkthrough_delivered so the
 * Continue-to-Prioritize gate opens.
 *
 * Idempotent: no-op if walkthrough_delivered is already true (a
 * coachee re-advancing shouldn't re-generate the walkthrough).
 *
 * Also exported (via ensureWalkthroughDelivered) for stuck-user
 * recovery — anyone whose map is already at immune_system without a
 * delivered walkthrough (because they advanced before this hook
 * existed) will get the walkthrough on next page load via page.tsx.
 */
export async function deliverWalkthroughAfterAdvance(
  mapId: string,
  events: TurnEventLog,
): Promise<void> {
  const map = await getMapById(mapId);
  if (!map) return;
  if (map.walkthrough_delivered) return;
  const [behaviors, worries, commitments, assumptions, links] =
    await Promise.all([
      listBehaviors(mapId),
      listWorries(mapId),
      listCommitments(mapId),
      listAssumptions(mapId),
      listAssumptionLinks(mapId),
    ]);
  if (commitments.length === 0 || assumptions.length === 0) return;

  const behaviorById = new Map(behaviors.map((b) => [b.id, b]));
  const worryById = new Map(worries.map((w) => [w.id, w]));
  const commitmentsWithChain = commitments.map((c) => {
    const w = worryById.get(c.worry_id);
    const b = w ? behaviorById.get(w.behavior_id) : null;
    return {
      text: c.text,
      worryText: w?.text ?? "(missing worry)",
      behaviorText: b?.text ?? "(missing behavior)",
    };
  });

  // Resolve assumption→commitment links to 1-based indices matching
  // commitmentsWithChain order, so the prompt's "underwrites #N"
  // pointers line up with the same numbers the coachee sees on the
  // map panel.
  const commitmentIndexById = new Map(
    commitments.map((c, i) => [c.id, i + 1]),
  );
  const linksByAssumption = new Map<string, number[]>();
  for (const l of links) {
    const idx = commitmentIndexById.get(l.commitment_id);
    if (idx === undefined) continue;
    const arr = linksByAssumption.get(l.assumption_id) ?? [];
    arr.push(idx);
    linksByAssumption.set(l.assumption_id, arr);
  }
  const assumptionsWithCoverage = assumptions.map((a) => ({
    text: a.text,
    commitmentIndices: (linksByAssumption.get(a.id) ?? []).slice().sort(
      (x, y) => x - y,
    ),
  }));

  const selectedBehaviorTexts = behaviors
    .filter((b) => b.selected)
    .map((b) => b.text);

  const walkthrough = await generateImmuneSystemWalkthrough({
    goalText: map.improvement_goal ?? "",
    behaviors: selectedBehaviorTexts,
    commitmentsWithChain,
    assumptionsWithCoverage,
  });
  if (!walkthrough) {
    events.record(
      "error",
      {
        where: "deliverWalkthroughAfterAdvance",
        message: "LLM returned null; walkthrough_delivered stays false",
      },
      { stage: "immune_system" },
    );
    return;
  }

  await appendMessage(mapId, "assistant", walkthrough, "immune_system", {
    surface: "stage_note",
    entryRefTable: "itc_maps",
    entryRefId: mapId,
  });
  await markWalkthroughDelivered(mapId);
  events.record(
    "coach_reaction_sent",
    {
      kind: "immune_system_walkthrough",
      length: walkthrough.length,
      assumption_count: assumptions.length,
      commitment_count: commitments.length,
    },
    { stage: "immune_system" },
  );
}

/**
 * Idempotent server action for stuck-user recovery. Called from
 * page.tsx when the coachee lands on the immune_system stage with
 * walkthrough_delivered=false (e.g., they advanced before the
 * walkthrough pipeline existed). Wraps deliverWalkthroughAfterAdvance
 * with a fresh TurnEventLog so the event lineage is preserved.
 */
export async function ensureWalkthroughDelivered(
  mapId: string,
): Promise<{ ok: true; delivered: boolean } | { ok: false; reason: string }> {
  try {
    const map = await getMapById(mapId);
    if (!map) return { ok: false, reason: "Map not found." };
    if (map.walkthrough_delivered) return { ok: true, delivered: false };
    if (map.current_stage !== "immune_system") {
      return { ok: true, delivered: false };
    }
    const events = new TurnEventLog(mapId, 0);
    await deliverWalkthroughAfterAdvance(mapId, events);
    await events.flush();
    // Re-check — deliverWalkthroughAfterAdvance may have failed silently.
    const after = await getMapById(mapId);
    return { ok: true, delivered: Boolean(after?.walkthrough_delivered) };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not deliver.",
    };
  }
}

const regenerateWalkthroughSchema = z.object({
  map_id: z.string().uuid(),
});

/**
 * Client-triggered walkthrough regenerate. The walkthrough quotes
 * goal, behaviors, worries, commitments, and assumptions verbatim;
 * if the coachee edits any of those after the walkthrough was first
 * delivered, the persuasion is speaking to the pre-edit map. This
 * lets the coachee wipe the old walkthrough and get a fresh one
 * against current map state.
 *
 * Behavior:
 *   1. Delete every stage_note message tagged stage_at_creation=
 *      immune_system so the old walkthrough disappears.
 *   2. Reset walkthrough_delivered=false so the delivery hook doesn't
 *      short-circuit.
 *   3. Fire deliverWalkthroughAfterAdvance — writes a fresh stage_note
 *      and flips walkthrough_delivered back to true.
 */
export async function regenerateWalkthrough(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = regenerateWalkthroughSchema.safeParse({
    map_id: formData.get("map_id"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  try {
    await deleteStageNoteMessages({
      mapId: loaded.map.id,
      stage: "immune_system",
    });
    await markWalkthroughNotDelivered(loaded.map.id);
    const events = new TurnEventLog(loaded.map.id, 0);
    await deliverWalkthroughAfterAdvance(loaded.map.id, events);
    await events.flush();
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not regenerate.",
    };
  }
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

/**
 * On advance to the prioritize stage, ask the coach which Big
 * Assumption to test first (grounded in Vol 2 p.268 criteria), persist
 * the prose recommendation as a stage_note, and pre-select the
 * recommended assumption via setAssumptionSelected. The coachee can
 * override by clicking a different assumption in the UI — the
 * pre-selection is a starting point, not a verdict.
 *
 * Idempotent: no-op if any assumption is already selected_for_testing
 * (the coachee already made their pick, or a prior advance already
 * ran the recommendation).
 */
export async function deliverPrioritizeRecommendationAfterAdvance(
  mapId: string,
  events: TurnEventLog,
): Promise<void> {
  const [map, assumptions, links, commitments, tests, results] =
    await Promise.all([
      getMapById(mapId),
      listAssumptions(mapId),
      listAssumptionLinks(mapId),
      listCommitments(mapId),
      listTests(mapId),
      listTestResults(mapId),
    ]);
  if (!map) return;
  if (assumptions.length === 0) return;
  // Idempotent — don't re-recommend if the coachee already has a
  // selection on record.
  if (assumptions.some((a) => a.selected_for_testing)) return;

  const commitmentById = new Map(commitments.map((c) => [c.id, c]));
  const linksByAssumption = new Map<string, string[]>();
  for (const l of links) {
    const arr = linksByAssumption.get(l.assumption_id) ?? [];
    arr.push(l.commitment_id);
    linksByAssumption.set(l.assumption_id, arr);
  }
  // Build per-assumption test history for C-ε.6: which non-abandoned
  // tests exist per assumption + the verdict + coachee's own read on
  // each. Empty array on first visit; populated on repeat visits.
  const historyByAssumption = new Map<
    string,
    Array<{
      verdict: "held" | "partially_challenged" | "challenged" | null;
      whatItSaysAboutAssumption: string;
    }>
  >();
  for (const t of tests) {
    if (t.status === "abandoned") continue;
    const result = results.find((r) => r.test_id === t.id);
    const arr = historyByAssumption.get(t.assumption_id) ?? [];
    arr.push({
      verdict: result?.assumption_verdict ?? null,
      whatItSaysAboutAssumption: result?.what_it_says_about_assumption ?? "",
    });
    historyByAssumption.set(t.assumption_id, arr);
  }
  const assumptionsWithCoverage = assumptions.map((a) => ({
    text: a.text,
    commitmentTexts: (linksByAssumption.get(a.id) ?? [])
      .map((cid) => commitmentById.get(cid)?.text)
      .filter((t): t is string => Boolean(t)),
    testHistory: historyByAssumption.get(a.id) ?? [],
  }));

  const recommendation = await recommendAssumptionToTest({
    goalText: map.improvement_goal ?? "",
    assumptionsWithCoverage,
  });
  if (!recommendation) {
    events.record(
      "error",
      {
        where: "deliverPrioritizeRecommendationAfterAdvance",
        message: "LLM returned null; no pre-selection made",
      },
      { stage: "prioritize" },
    );
    return;
  }

  await appendMessage(mapId, "assistant", recommendation.prose, "prioritize", {
    surface: "stage_note",
    entryRefTable: "itc_maps",
    entryRefId: mapId,
  });
  // Pre-select the recommended assumption. pickedIndex is 1-based in
  // the same order as `assumptions` was passed to the helper.
  const picked = assumptions[recommendation.pickedIndex - 1];
  if (picked) {
    await setAssumptionSelected(picked.id, mapId);
  }
  events.record(
    "coach_reaction_sent",
    {
      kind: "prioritize_recommendation",
      picked_index: recommendation.pickedIndex,
      prose_length: recommendation.prose.length,
      assumption_count: assumptions.length,
    },
    { stage: "prioritize" },
  );
}

/**
 * Idempotent server action for stuck-user recovery. Called from
 * page.tsx when the coachee lands on the prioritize stage without a
 * pre-selected assumption (e.g., they advanced before this pipeline
 * existed). Same shape as ensureWalkthroughDelivered.
 */
export async function ensurePrioritizeRecommendationDelivered(
  mapId: string,
): Promise<{ ok: true; delivered: boolean } | { ok: false; reason: string }> {
  try {
    const map = await getMapById(mapId);
    if (!map) return { ok: false, reason: "Map not found." };
    if (map.current_stage !== "prioritize") {
      return { ok: true, delivered: false };
    }
    const assumptions = await listAssumptions(mapId);
    if (assumptions.some((a) => a.selected_for_testing)) {
      return { ok: true, delivered: false };
    }
    const events = new TurnEventLog(mapId, 0);
    await deliverPrioritizeRecommendationAfterAdvance(mapId, events);
    await events.flush();
    const afterAssumptions = await listAssumptions(mapId);
    return {
      ok: true,
      delivered: afterAssumptions.some((a) => a.selected_for_testing),
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not deliver.",
    };
  }
}

/**
 * Coachee-triggered override of the coach's pick. Called from the
 * prioritize section UI when the user clicks a different assumption
 * than the coach recommended. Clears any existing selection and sets
 * the new one — one-at-a-time enforcement is in setAssumptionSelected.
 */
const selectAssumptionSchema = z.object({
  map_id: z.string().uuid(),
  assumption_id: z.string().uuid(),
});
export async function selectAssumptionForTesting(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = selectAssumptionSchema.safeParse({
    map_id: formData.get("map_id"),
    assumption_id: formData.get("assumption_id"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid selection." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  try {
    await setAssumptionSelected(parsed.data.assumption_id, loaded.map.id);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not select.",
    };
  }
  const events = new TurnEventLog(loaded.map.id, 0);
  events.record(
    "entry_edited",
    {
      kind: "assumption",
      entry_id: parsed.data.assumption_id,
      selected_for_testing: true,
    },
    { stage: loaded.map.current_stage },
  );
  await events.flush();
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

// -------------------------------------------------------------------------
// Test design (Checkpoint C-ε.1)
// -------------------------------------------------------------------------

/**
 * On advance to test_design, pre-draft a Kegan-voice test for the
 * assumption the coachee selected for testing. Coachee sees the four
 * fields pre-populated in the test-design form and edits before
 * saving. Idempotent — skip if any non-abandoned test already exists
 * on this map (the coachee may have started designing before and is
 * now returning).
 */
async function deliverTestDraftAfterAdvance(
  mapId: string,
  events: TurnEventLog,
): Promise<void> {
  const [map, assumptions, tests, links, commitments, behaviors, worries] =
    await Promise.all([
      getMapById(mapId),
      listAssumptions(mapId),
      listTests(mapId),
      listAssumptionLinks(mapId),
      listCommitments(mapId),
      listBehaviors(mapId),
      listWorries(mapId),
    ]);
  if (!map) return;
  const selected = assumptions.find((a) => a.selected_for_testing);
  if (!selected) return;
  // Idempotent: skip only if there's an in-flight "designed" test.
  // "run" tests are complete (a result was saved) and shouldn't block
  // a fresh draft — that's precisely the results → new_test flow.
  // "abandoned" tests never block. Filter to selected assumption so
  // tests from an earlier assumption don't block a fresh draft when
  // the coachee's picked a different one via prioritize.
  const inFlightTest = tests.find(
    (t) => t.status === "designed" && t.assumption_id === selected.id,
  );
  if (inFlightTest) return;

  // Build "commitments this assumption underwrites" with their paired
  // behavior for the LLM's Vol 2 p 271 option-2 reasoning.
  const worryById = new Map(worries.map((w) => [w.id, w]));
  const behaviorById = new Map(behaviors.map((b) => [b.id, b]));
  const commitmentById = new Map(commitments.map((c) => [c.id, c]));
  const underwritten = links
    .filter((l) => l.assumption_id === selected.id)
    .map((l) => {
      const commitment = commitmentById.get(l.commitment_id);
      const worry = commitment ? worryById.get(commitment.worry_id) : null;
      const behavior = worry ? behaviorById.get(worry.behavior_id) : null;
      return commitment && behavior
        ? { text: commitment.text, behaviorText: behavior.text }
        : null;
    })
    .filter((x): x is { text: string; behaviorText: string } => Boolean(x));

  const draft = await draftTestForAssumption({
    goalText: map.improvement_goal ?? "",
    assumptionText: selected.text,
    underwrittenCommitments: underwritten,
    todayIso: new Date().toISOString().slice(0, 10),
  });
  if (!draft) {
    events.record(
      "error",
      {
        where: "deliverTestDraftAfterAdvance",
        message: "LLM returned null; coachee will fill the form from scratch",
      },
      { stage: "test_design" },
    );
    return;
  }

  const row = await saveTestDraft({
    mapId,
    assumptionId: selected.id,
    testType: draft.testType,
    assumptionSays: draft.assumptionSays,
    behaviorChange: draft.behaviorChange,
    dataToCollect: draft.dataToCollect,
    inOrderToFindOut: draft.inOrderToFindOut,
    targetDate: draft.targetDate,
  });
  events.record(
    "coach_reaction_sent",
    {
      kind: "test_draft",
      test_id: row.id,
      test_type: draft.testType,
    },
    { stage: "test_design" },
  );
}

export async function ensureTestDraftDelivered(
  mapId: string,
): Promise<{ ok: true; delivered: boolean } | { ok: false; reason: string }> {
  try {
    const map = await getMapById(mapId);
    if (!map) return { ok: false, reason: "Map not found." };
    if (map.current_stage !== "test_design") {
      return { ok: true, delivered: false };
    }
    const assumptions = await listAssumptions(mapId);
    if (!assumptions.some((a) => a.selected_for_testing)) {
      return { ok: true, delivered: false };
    }
    const tests = await listTests(mapId);
    if (tests.some((t) => t.status !== "abandoned")) {
      return { ok: true, delivered: false };
    }
    const events = new TurnEventLog(mapId, 0);
    await deliverTestDraftAfterAdvance(mapId, events);
    await events.flush();
    const afterTests = await listTests(mapId);
    return {
      ok: true,
      delivered: afterTests.some((t) => t.status !== "abandoned"),
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not deliver.",
    };
  }
}

const regenerateTestSchema = z.object({
  map_id: z.string().uuid(),
  /** The coachee's current test_type. Server derives the NEXT type
   *  from this + mode below — LLM never sees a "produce something
   *  different" instruction it might ignore. Variation is
   *  server-orchestrated. */
  test_type: z.enum([
    "data_mining",
    "observation",
    "thought_experiment",
    "behavioral",
  ]),
  mode: z.enum(["initial", "another", "safer"]),
});

/**
 * Type dispatch table for the two regeneration modes.
 *
 * "another" rotates through all four types in a fixed cycle, so
 * repeated clicks give the coachee a genuinely different SHAPE of
 * test each time (see the type descriptions in prompts/stages/
 * test-design.ts — each type is structurally distinct by construction).
 * The cycle wraps: after data_mining, we're back to behavioral.
 *
 * "safer" steps DOWN the safety ladder (behavioral > observation >
 * thought_experiment > data_mining). Data mining is the safest —
 * no new action required, purely retrospective. If the coachee is
 * already at data_mining, safer is a no-op (client hides the button).
 *
 * This replaces prompt-shaping instructions like "produce a materially
 * different test" that the LLM ignored. Variation is now guaranteed
 * by construction — server picks the type, LLM only writes the
 * fields for that type.
 */
const ANOTHER_ROTATION: Record<
  "behavioral" | "observation" | "thought_experiment" | "data_mining",
  "behavioral" | "observation" | "thought_experiment" | "data_mining"
> = {
  behavioral: "observation",
  observation: "thought_experiment",
  thought_experiment: "data_mining",
  data_mining: "behavioral",
};

const SAFER_LADDER: Record<
  "behavioral" | "observation" | "thought_experiment" | "data_mining",
  "behavioral" | "observation" | "thought_experiment" | "data_mining" | null
> = {
  behavioral: "observation",
  observation: "thought_experiment",
  thought_experiment: "data_mining",
  data_mining: null, // already safest
};

/**
 * On-demand test-draft regeneration. Called by the TestDesignForm
 * when the coachee:
 *   - changes the test_type dropdown (mode="initial" with new type)
 *   - clicks "Give me another draft" (mode="another")
 *   - clicks "Give me a safer version" (mode="safer")
 *
 * For "another" and "safer", the server rotates/steps the type
 * (see tables above) — client's `test_type` is treated as the
 * CURRENT type, not the target. LLM is called with the derived
 * target type and produces a test of that shape. Because each type
 * is a genuinely distinct shape (per the test-design prompt), the
 * result is guaranteed structurally different.
 *
 * Purely LLM call + return — does NOT touch the DB. Client updates
 * its local form state with the returned draft; user must Save to
 * persist. This means the coachee can freely regenerate until they
 * find a draft they want.
 */
export async function regenerateTestDraft(
  formData: FormData,
): Promise<
  | {
      ok: true;
      draft: {
        testType: "data_mining" | "observation" | "thought_experiment" | "behavioral";
        assumptionSays: string;
        behaviorChange: string;
        dataToCollect: string;
        inOrderToFindOut: string;
        targetDate: string;
      };
    }
  | { ok: false; reason: string }
> {
  const parsed = regenerateTestSchema.safeParse({
    map_id: formData.get("map_id"),
    test_type: formData.get("test_type"),
    mode: formData.get("mode"),
  });
  if (!parsed.success) {
    return { ok: false, reason: "Invalid regenerate input." };
  }

  // Derive the TARGET type server-side. LLM will be told to write a
  // test of the target type; no "produce something different"
  // instructions.
  let targetType: "behavioral" | "observation" | "thought_experiment" | "data_mining";
  if (parsed.data.mode === "initial") {
    targetType = parsed.data.test_type;
  } else if (parsed.data.mode === "another") {
    targetType = ANOTHER_ROTATION[parsed.data.test_type];
  } else {
    // safer
    const next = SAFER_LADDER[parsed.data.test_type];
    if (!next) {
      return {
        ok: false,
        reason:
          "This is already the safest kind of test — data mining looks only at what's already happened.",
      };
    }
    targetType = next;
  }

  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  const [assumptions, links, commitments, behaviors, worries] =
    await Promise.all([
      listAssumptions(loaded.map.id),
      listAssumptionLinks(loaded.map.id),
      listCommitments(loaded.map.id),
      listBehaviors(loaded.map.id),
      listWorries(loaded.map.id),
    ]);
  const selected = assumptions.find((a) => a.selected_for_testing);
  if (!selected) {
    return { ok: false, reason: "No assumption is selected for testing." };
  }

  const worryById = new Map(worries.map((w) => [w.id, w]));
  const behaviorById = new Map(behaviors.map((b) => [b.id, b]));
  const commitmentById = new Map(commitments.map((c) => [c.id, c]));
  const underwritten = links
    .filter((l) => l.assumption_id === selected.id)
    .map((l) => {
      const commitment = commitmentById.get(l.commitment_id);
      const worry = commitment ? worryById.get(commitment.worry_id) : null;
      const behavior = worry ? behaviorById.get(worry.behavior_id) : null;
      return commitment && behavior
        ? { text: commitment.text, behaviorText: behavior.text }
        : null;
    })
    .filter((x): x is { text: string; behaviorText: string } => Boolean(x));

  const draft = await draftTestForAssumption({
    goalText: loaded.map.improvement_goal ?? "",
    assumptionText: selected.text,
    underwrittenCommitments: underwritten,
    todayIso: new Date().toISOString().slice(0, 10),
    testType: targetType,
  });
  if (!draft) {
    return { ok: false, reason: "Could not generate a new draft." };
  }
  return { ok: true, draft };
}

const reviseTestFromCoachSchema = z.object({
  map_id: z.string().uuid(),
  test_type: z.enum([
    "data_mining",
    "observation",
    "thought_experiment",
    "behavioral",
  ]),
  /** The exact current form fields the coachee has in the UI. We
   *  pass them from the client rather than reading from DB because
   *  the coachee may have edited without saving before hitting the
   *  revise button. The LLM revises what's on screen, not a stale
   *  DB row. */
  assumption_says: z.string().min(3).max(1000),
  behavior_change: z.string().min(3).max(1000),
  data_to_collect: z.string().min(3).max(1000),
  in_order_to_find_out: z.string().min(3).max(1000),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The SMART review verdict that surfaced this fix path — serialized
   *  from the client's state (never persisted server-side). Server
   *  passes it to reviseTestFromReview so the LLM sees exactly which
   *  criteria failed + the one_thing_to_tighten sentence. */
  review_json: z.string().min(2),
});

/**
 * Client-triggered "Have the coach revise this" — the coachee saw a
 * needs_work SMART verdict and asked the coach to fix the test.
 *
 * Self-verify loop: after each revision we re-run reviewTestDesign on
 * the revised test. If ready, return. If needs_work, feed the new
 * review back into another revise pass. Cap at MAX_REVISE_ATTEMPTS
 * total attempts. Return the final draft + its verdict so the client
 * updates both form fields AND the SMART card in one round-trip.
 *
 * The retry loop backstops the model when its first pass fixes X but
 * breaks Y. Total LLM cost is the same as the coachee clicking
 * Revise+Run manually N times — but from their perspective it's one
 * click and one wait.
 *
 * Does NOT persist to the DB — the revised fields land in client
 * form state; the coachee reviews and then hits Run the Test to
 * commit + advance (or clicks Revise again if the final verdict
 * still needs work).
 */
const MAX_REVISE_ATTEMPTS = 3;

export async function reviseTestFromCoach(
  formData: FormData,
): Promise<
  | {
      ok: true;
      draft: {
        testType: "data_mining" | "observation" | "thought_experiment" | "behavioral";
        assumptionSays: string;
        behaviorChange: string;
        dataToCollect: string;
        inOrderToFindOut: string;
        targetDate: string;
      };
      /** SMART verdict of the FINAL revision (the one being returned).
       *  Client updates the SMART card from this so the coachee sees
       *  the new state without clicking Run the Test just to check.
       *  Null iff the review LLM failed on the final revision (rare;
       *  we still return the draft and the client shows no updated
       *  card). */
      review: SmartReview | null;
      /** How many revision attempts we actually ran. Useful for
       *  telemetry — a 3 means we hit the cap and returned the best
       *  attempt even though its final verdict may still be
       *  needs_work. */
      attempts: number;
    }
  | { ok: false; reason: string }
> {
  const parsed = reviseTestFromCoachSchema.safeParse({
    map_id: formData.get("map_id"),
    test_type: formData.get("test_type"),
    assumption_says: formData.get("assumption_says"),
    behavior_change: formData.get("behavior_change"),
    data_to_collect: formData.get("data_to_collect"),
    in_order_to_find_out: formData.get("in_order_to_find_out"),
    target_date: formData.get("target_date"),
    review_json: formData.get("review_json"),
  });
  if (!parsed.success) {
    return { ok: false, reason: "Invalid revise input." };
  }
  let review: SmartReview;
  try {
    review = JSON.parse(parsed.data.review_json) as SmartReview;
  } catch {
    return { ok: false, reason: "Could not parse review payload." };
  }
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  const [assumptions, links, commitments, behaviors, worries] =
    await Promise.all([
      listAssumptions(loaded.map.id),
      listAssumptionLinks(loaded.map.id),
      listCommitments(loaded.map.id),
      listBehaviors(loaded.map.id),
      listWorries(loaded.map.id),
    ]);
  const selected = assumptions.find((a) => a.selected_for_testing);
  if (!selected) {
    return { ok: false, reason: "No assumption is selected for testing." };
  }
  const worryById = new Map(worries.map((w) => [w.id, w]));
  const behaviorById = new Map(behaviors.map((b) => [b.id, b]));
  const commitmentById = new Map(commitments.map((c) => [c.id, c]));
  const underwritten = links
    .filter((l) => l.assumption_id === selected.id)
    .map((l) => {
      const commitment = commitmentById.get(l.commitment_id);
      const worry = commitment ? worryById.get(commitment.worry_id) : null;
      const behavior = worry ? behaviorById.get(worry.behavior_id) : null;
      return commitment && behavior
        ? { text: commitment.text, behaviorText: behavior.text }
        : null;
    })
    .filter((x): x is { text: string; behaviorText: string } => Boolean(x));

  // Self-verify loop. Each iteration: (1) revise from the latest
  // review, (2) re-review the revision. Exit on verdict=ready OR
  // review-LLM failure OR attempt cap. The `currentTest` fed into
  // each revise starts as the coachee's input and rolls forward with
  // each attempt so the LLM sees its previous work as the baseline.
  let currentTest = {
    testType: parsed.data.test_type,
    assumptionSays: parsed.data.assumption_says,
    behaviorChange: parsed.data.behavior_change,
    dataToCollect: parsed.data.data_to_collect,
    inOrderToFindOut: parsed.data.in_order_to_find_out,
    targetDate: parsed.data.target_date,
  };
  let currentReview: SmartReview = review;
  let latestDraft: {
    testType: "data_mining" | "observation" | "thought_experiment" | "behavioral";
    assumptionSays: string;
    behaviorChange: string;
    dataToCollect: string;
    inOrderToFindOut: string;
    targetDate: string;
  } | null = null;
  let latestVerdict: SmartReview | null = null;
  let attempts = 0;

  const todayIso = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < MAX_REVISE_ATTEMPTS; i++) {
    attempts = i + 1;
    const revised = await reviseTestFromReview({
      goalText: loaded.map.improvement_goal ?? "",
      assumptionText: selected.text,
      underwrittenCommitments: underwritten,
      todayIso,
      currentTest,
      review: currentReview,
    });
    if ("error" in revised) {
      // If we already have a valid revision from an earlier attempt,
      // return it (better than throwing away progress). Otherwise
      // surface the error.
      if (latestDraft) break;
      return {
        ok: false,
        reason: `Coach couldn't produce a revision: ${revised.error}`,
      };
    }
    latestDraft = revised;
    // Roll the baseline forward for the next iteration.
    currentTest = {
      testType: revised.testType,
      assumptionSays: revised.assumptionSays,
      behaviorChange: revised.behaviorChange,
      dataToCollect: revised.dataToCollect,
      inOrderToFindOut: revised.inOrderToFindOut,
      targetDate: revised.targetDate,
    };

    // Verify the revision. If the review LLM errors, we've still got
    // a valid revision — return it with a null verdict; the client
    // just doesn't update the SMART card and the coachee can re-run.
    const nextReview = await reviewTestDesign({
      goalText: loaded.map.improvement_goal ?? "",
      assumptionText: selected.text,
      test: {
        testType: revised.testType,
        assumptionSays: revised.assumptionSays,
        behaviorChange: revised.behaviorChange,
        dataToCollect: revised.dataToCollect,
        inOrderToFindOut: revised.inOrderToFindOut,
        targetDate: revised.targetDate,
      },
    });
    latestVerdict = nextReview;
    if (!nextReview) {
      // Review LLM failed on this attempt; return what we have.
      break;
    }
    if (nextReview.verdict === "ready") {
      break;
    }
    // Still needs_work — feed this fresh review into the next revise.
    currentReview = nextReview;
  }

  if (!latestDraft) {
    return { ok: false, reason: "Coach couldn't produce a revision." };
  }
  return {
    ok: true,
    draft: latestDraft,
    review: latestVerdict,
    attempts,
  };
}

const saveTestSchema = z.object({
  map_id: z.string().uuid(),
  test_id: z.string().uuid().optional(),
  assumption_id: z.string().uuid(),
  test_type: z.enum([
    "data_mining",
    "observation",
    "thought_experiment",
    "behavioral",
  ]),
  assumption_says: z.string().min(3).max(1000),
  behavior_change: z.string().min(3).max(1000),
  data_to_collect: z.string().min(3).max(1000),
  in_order_to_find_out: z.string().min(3).max(1000),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type RunTestResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** Structured SMART review from the coach, or null if the LLM
       *  failed. On null we fail-open and advance — the review is
       *  advisory, don't block on LLM outage. */
      review: SmartReview | null;
      /** Whether the map advanced to test_running. True on
       *  review.verdict === "ready" OR review === null (LLM failure). */
      advanced: boolean;
    };

/**
 * Save a test design AND, if the coach's SMART review says it's ready,
 * advance to test_running in one action. The single button ("Run the
 * Test") wires here.
 *
 * Flow:
 *   1. Persist the test (create if no test_id, update if given).
 *   2. Fire reviewTestDesign — returns structured SMART verdict.
 *   3. If verdict === "ready" (or the LLM failed — fail-open), advance
 *      to test_running.
 *   4. If verdict === "needs_work", return the structured review so
 *      the client renders the SMART card inline. Skip revalidate so
 *      client state (the review card + any further edits) survives.
 */
export async function runTest(
  formData: FormData,
): Promise<RunTestResult> {
  const parsed = saveTestSchema.safeParse({
    map_id: formData.get("map_id"),
    test_id: formData.get("test_id") || undefined,
    assumption_id: formData.get("assumption_id"),
    test_type: formData.get("test_type"),
    assumption_says: formData.get("assumption_says"),
    behavior_change: formData.get("behavior_change"),
    data_to_collect: formData.get("data_to_collect"),
    in_order_to_find_out: formData.get("in_order_to_find_out"),
    target_date: formData.get("target_date"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid test input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  let row;
  try {
    if (parsed.data.test_id) {
      row = await updateTest({
        testId: parsed.data.test_id,
        mapId: loaded.map.id,
        testType: parsed.data.test_type,
        assumptionSays: parsed.data.assumption_says,
        behaviorChange: parsed.data.behavior_change,
        dataToCollect: parsed.data.data_to_collect,
        inOrderToFindOut: parsed.data.in_order_to_find_out,
        targetDate: parsed.data.target_date,
      });
    } else {
      row = await saveTestDraft({
        mapId: loaded.map.id,
        assumptionId: parsed.data.assumption_id,
        testType: parsed.data.test_type,
        assumptionSays: parsed.data.assumption_says,
        behaviorChange: parsed.data.behavior_change,
        dataToCollect: parsed.data.data_to_collect,
        inOrderToFindOut: parsed.data.in_order_to_find_out,
        targetDate: parsed.data.target_date,
      });
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not save test.",
    };
  }

  const assumptions = await listAssumptions(loaded.map.id);
  const assumption = assumptions.find((a) => a.id === row.assumption_id);
  const events = new TurnEventLog(loaded.map.id, 0);
  events.record(
    parsed.data.test_id ? "entry_edited" : "entry_added",
    {
      kind: "test",
      entry_id: row.id,
      test_type: row.test_type,
    },
    { stage: loaded.map.current_stage },
  );

  // Fire the SMART review. Returned as structured data — the client
  // renders the visual card. NOT persisted as an entry_thread message:
  // the review is a per-attempt UX affordance, not durable map state.
  // If the coachee closes the tab and comes back, they hit Run the
  // Test again and get a fresh review of whatever the test looks like
  // then.
  let review: SmartReview | null = null;
  try {
    review = await reviewTestDesign({
      goalText: loaded.map.improvement_goal ?? "",
      assumptionText: assumption?.text ?? "",
      test: {
        testType: row.test_type,
        assumptionSays: row.assumption_says ?? "",
        behaviorChange: row.behavior_change ?? "",
        dataToCollect: row.data_to_collect ?? "",
        inOrderToFindOut: row.in_order_to_find_out ?? "",
        targetDate: row.target_date ?? "",
      },
    });
    if (review) {
      events.record(
        "coach_reaction_sent",
        {
          kind: "test_review",
          test_id: row.id,
          verdict: review.verdict,
        },
        { stage: loaded.map.current_stage },
      );
    }
  } catch (err) {
    console.warn(
      "[itc runTest] review failed: %s",
      err instanceof Error ? err.message : String(err),
    );
  }

  // Advance to test_running if the SMART review passed, OR if the LLM
  // failed (fail-open — don't block the coachee's workflow on an LLM
  // outage). On "needs_work" we stay put; the client renders the SMART
  // card from the returned review payload.
  const shouldAdvance = !review || review.verdict === "ready";
  let advanced = false;
  if (shouldAdvance) {
    // Mirror the test to the tracker as a planned mission BEFORE
    // advancing. If the coachee is at their weekly mission cap, block
    // the advance with a friendly reason — the test design stays
    // saved so they don't lose their work.
    const missionResult = await createMissionForItcTest({
      mapId: loaded.map.id,
      testId: row.id,
      participantId: loaded.participant.id,
      pillarCode: loaded.map.pillar_code,
      behaviorChange: row.behavior_change ?? "",
      targetDate: row.target_date ?? "",
    });
    if (!missionResult.ok) {
      // Cap-hit or link error. Do NOT advance; return the reason so
      // the client shows the error. Test row remains saved.
      await events.flush();
      return { ok: false, reason: missionResult.reason };
    }
    try {
      await advanceStage(loaded.map.id, "test_design", "test_running");
      await appendMessage(
        loaded.map.id,
        "system",
        `[coachee advanced map via Run the Test: test_design → test_running]`,
        "test_running",
      );
      events.record(
        "stage_advanced",
        { from: "test_design", to: "test_running" },
        { stage: "test_running" },
      );
      advanced = true;
    } catch (err) {
      console.warn(
        "[itc runTest] advance failed: %s",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  await events.flush();
  // Only revalidate when we advanced — the page needs to re-render
  // with the new stage. On needs_work we skip revalidate so the
  // client's local form state (any further edits + the returned
  // SMART card) survives until the next Run the Test.
  if (advanced) {
    safeRevalidate(`/itc/${loaded.map.id}`);
  }
  return { ok: true, review, advanced };
}

const abandonTestSchema = z.object({
  map_id: z.string().uuid(),
  test_id: z.string().uuid(),
});

/**
 * Escape hatch (C-ε.7). Called from the "Back to prioritize" affordance
 * on test_design / test_running when the coachee decides to test a
 * different assumption than the one they were designing for. Marks
 * the in-flight test as "abandoned" (history preserved) and reverts
 * the stage to prioritize.
 */
export async function abandonInFlightTest(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = abandonTestSchema.safeParse({
    map_id: formData.get("map_id"),
    test_id: formData.get("test_id"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid abandon input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  try {
    await markTestAbandoned(parsed.data.test_id, loaded.map.id);
    // Mirror to tracker: mark the linked mission 'abandoned' (only
    // if it was still 'planned' — completed / missed missions stay
    // as-is, real history).
    await abandonMissionForItcTest(parsed.data.test_id);
    // Revert stage back to prioritize. canTransitionTo allows
    // backward moves; advanceStage doesn't fire the recommendation
    // hook on a backward transition because deliverPrioritize... is
    // idempotent on existing selection.
    await advanceStage(loaded.map.id, loaded.map.current_stage, "prioritize");
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not abandon.",
    };
  }
  const events = new TurnEventLog(loaded.map.id, 0);
  events.record(
    "entry_edited",
    {
      kind: "test",
      entry_id: parsed.data.test_id,
      abandoned: true,
    },
    { stage: "prioritize" },
  );
  await events.flush();
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

// -------------------------------------------------------------------------
// Test results (Checkpoint C-ε.3 + C-ε.4 routing)
// -------------------------------------------------------------------------

const saveTestResultSchema = z.object({
  map_id: z.string().uuid(),
  test_id: z.string().uuid(),
  result_id: z.string().uuid().optional(),
  ran_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  what_i_did: z.string().min(3).max(2000),
  data_collected: z.string().min(3).max(2000),
  what_it_says_about_assumption: z.string().min(3).max(2000),
  assumption_verdict: z.enum(["held", "partially_challenged", "challenged"]),
  next_step: z.enum(["new_test", "new_assumption", "map_complete"]),
});

/**
 * Save the coachee's post-test debrief. Creates via recordTestResult
 * if no result_id, updates via updateTestResult if given. Fires the
 * reviewTestResult LLM helper after; Kegan-voice interpretation
 * lands as entry_thread on the result row.
 *
 * C-ε.4 routing: does NOT auto-advance the stage — the coachee sees
 * the coach's interpretation, then clicks Continue. The Continue
 * gate's target stage depends on next_step (see computeAdvanceGate).
 */
export async function saveTestResult(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = saveTestResultSchema.safeParse({
    map_id: formData.get("map_id"),
    test_id: formData.get("test_id"),
    result_id: formData.get("result_id") || undefined,
    ran_on: formData.get("ran_on"),
    what_i_did: formData.get("what_i_did"),
    data_collected: formData.get("data_collected"),
    what_it_says_about_assumption: formData.get("what_it_says_about_assumption"),
    assumption_verdict: formData.get("assumption_verdict"),
    next_step: formData.get("next_step"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid result input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  let row;
  try {
    if (parsed.data.result_id) {
      row = await updateTestResult({
        resultId: parsed.data.result_id,
        ranOn: parsed.data.ran_on,
        whatIDid: parsed.data.what_i_did,
        dataCollected: parsed.data.data_collected,
        whatItSaysAboutAssumption: parsed.data.what_it_says_about_assumption,
        assumptionVerdict: parsed.data.assumption_verdict,
        nextStep: parsed.data.next_step,
      });
    } else {
      row = await recordTestResult({
        testId: parsed.data.test_id,
        ranOn: parsed.data.ran_on,
        whatIDid: parsed.data.what_i_did,
        dataCollected: parsed.data.data_collected,
        whatItSaysAboutAssumption: parsed.data.what_it_says_about_assumption,
        assumptionVerdict: parsed.data.assumption_verdict,
        nextStep: parsed.data.next_step,
      });
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not save result.",
    };
  }

  const [tests, assumptions] = await Promise.all([
    listTests(loaded.map.id),
    listAssumptions(loaded.map.id),
  ]);
  const test = tests.find((t) => t.id === row.test_id);
  const assumption = test
    ? assumptions.find((a) => a.id === test.assumption_id)
    : undefined;

  const events = new TurnEventLog(loaded.map.id, 0);
  events.record(
    parsed.data.result_id ? "entry_edited" : "entry_added",
    {
      kind: "test_result",
      entry_id: row.id,
      verdict: row.assumption_verdict,
      next_step: row.next_step,
    },
    { stage: loaded.map.current_stage },
  );
  try {
    if (test && assumption) {
      const review = await reviewTestResult({
        goalText: loaded.map.improvement_goal ?? "",
        assumptionText: assumption.text,
        test: {
          behaviorChange: test.behavior_change ?? "",
          dataToCollect: test.data_to_collect ?? "",
          inOrderToFindOut: test.in_order_to_find_out ?? "",
        },
        result: {
          whatIDid: row.what_i_did ?? "",
          dataCollected: row.data_collected ?? "",
          whatItSaysAboutAssumption: row.what_it_says_about_assumption ?? "",
          verdict: row.assumption_verdict ?? "partially_challenged",
          nextStep: row.next_step ?? "new_test",
        },
      });
      if (review) {
        await appendMessage(
          loaded.map.id,
          "assistant",
          review.prose,
          loaded.map.current_stage,
          {
            surface: "entry_thread",
            entryRefTable: "itc_test_results",
            entryRefId: row.id,
          },
        );
        events.record(
          "coach_reaction_sent",
          {
            kind: "test_result_review",
            result_id: row.id,
          },
          { stage: loaded.map.current_stage },
        );
      }
    }
  } catch (err) {
    console.warn(
      "[itc saveTestResult] review failed: %s",
      err instanceof Error ? err.message : String(err),
    );
  }
  // Mirror to tracker: mark the linked mission 'completed'. Any
  // verdict counts — the mission was "run the test", not "reach a
  // specific outcome". Idempotent + no-op if the test has no linked
  // mission (ITC-only user without a community).
  await markMissionCompletedForItcTest({
    testId: row.test_id,
    ranOn: row.ran_on ?? new Date().toISOString().slice(0, 10),
  });
  await events.flush();
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

/**
 * C-ε.4 routing. After the coachee reviews their saved result, they
 * click Continue. This action reads the saved result's next_step and
 * routes the stage accordingly:
 *
 *   new_test         → advance back to test_design (clears the
 *                      abandoned/run test's active status by advancing;
 *                      coachee lands with a fresh test-draft on the
 *                      same assumption). Existing tests stay on the
 *                      map for history.
 *   new_assumption   → clear selected_for_testing on all assumptions
 *                      and revert to prioritize. The picker re-fires
 *                      with test-history badges (C-ε.6).
 *   map_complete     → advance to done.
 */
const advanceAfterResultsSchema = z.object({
  map_id: z.string().uuid(),
  result_id: z.string().uuid(),
});
export async function advanceAfterResults(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = advanceAfterResultsSchema.safeParse({
    map_id: formData.get("map_id"),
    result_id: formData.get("result_id"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid advance input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  const results = await listTestResults(loaded.map.id);
  const result = results.find((r) => r.id === parsed.data.result_id);
  if (!result) return { ok: false, reason: "Result not found." };
  const nextStep = result.next_step ?? "new_test";

  try {
    if (nextStep === "new_test") {
      // Backward transition (results → test_design). Can't use
      // advanceToStage — its gate check computes results → done as
      // the natural forward path, so requesting test_design as target
      // fails "gate.to !== target". Call advanceStage directly
      // (canTransitionTo allows backward moves) and fire the
      // test-draft delivery hook by hand.
      await advanceStage(loaded.map.id, loaded.map.current_stage, "test_design");
      const events = new TurnEventLog(loaded.map.id, 0);
      events.record(
        "stage_advanced",
        { from: loaded.map.current_stage, to: "test_design" },
        { stage: "test_design" },
      );
      await deliverTestDraftAfterAdvance(loaded.map.id, events);
      await events.flush();
    } else if (nextStep === "new_assumption") {
      // Clear the current selection so the prioritize picker re-fires
      // fresh. Revert stage. Coach recommendation runs again with
      // the just-completed test as history context (C-ε.6).
      await clearSelectedAssumption(loaded.map.id);
      await advanceStage(loaded.map.id, loaded.map.current_stage, "prioritize");
    } else if (nextStep === "map_complete") {
      // Advance to done. Skips test_running / results / done gates
      // because done accepts any prior stage as "from".
      const fd = new FormData();
      fd.set("map_id", loaded.map.id);
      fd.set("to", "done");
      const res = await advanceToStage(fd);
      if (!res.ok) return res;
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not advance.",
    };
  }
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

// -------------------------------------------------------------------------
// Done stage (Checkpoint C-ε.5)
// -------------------------------------------------------------------------

/**
 * Generate the Kegan-voice closing summary on advance to done.
 * Reads the full map + all non-abandoned tests + their results and
 * asks the LLM to reflect what was learned, what stays open, and
 * invite the coachee to come back. Persists as a stage_note anchored
 * to itc_maps with stage_at_creation=done. Idempotent — skip if a
 * done stage_note already exists.
 */
async function deliverMapCloseSummaryAfterAdvance(
  mapId: string,
  events: TurnEventLog,
): Promise<void> {
  const [map, assumptions, tests, results, existingNotes] =
    await Promise.all([
      getMapById(mapId),
      listAssumptions(mapId),
      listTests(mapId),
      listTestResults(mapId),
      listMessages(mapId),
    ]);
  if (!map) return;
  const already = existingNotes.some(
    (m) =>
      m.surface === "stage_note" &&
      m.stage_at_creation === "done" &&
      m.role === "assistant",
  );
  if (already) return;

  const historyByAssumption = new Map<
    string,
    Array<{
      whatIDid: string;
      dataCollected: string;
      whatItSaysAboutAssumption: string;
      verdict: "held" | "partially_challenged" | "challenged" | null;
    }>
  >();
  for (const t of tests) {
    if (t.status === "abandoned") continue;
    const result = results.find((r) => r.test_id === t.id);
    if (!result) continue;
    const arr = historyByAssumption.get(t.assumption_id) ?? [];
    arr.push({
      whatIDid: result.what_i_did ?? "",
      dataCollected: result.data_collected ?? "",
      whatItSaysAboutAssumption: result.what_it_says_about_assumption ?? "",
      verdict: result.assumption_verdict ?? null,
    });
    historyByAssumption.set(t.assumption_id, arr);
  }
  const assumptionsWithHistory = assumptions.map((a) => ({
    text: a.text,
    testHistory: historyByAssumption.get(a.id) ?? [],
  }));

  const prose = await generateMapCloseSummary({
    goalText: map.improvement_goal ?? "",
    assumptionsWithHistory,
  });
  if (!prose) {
    events.record(
      "error",
      {
        where: "deliverMapCloseSummaryAfterAdvance",
        message: "LLM returned null; no closing summary rendered",
      },
      { stage: "done" },
    );
    return;
  }
  await appendMessage(mapId, "assistant", prose, "done", {
    surface: "stage_note",
    entryRefTable: "itc_maps",
    entryRefId: mapId,
  });
  events.record(
    "coach_reaction_sent",
    {
      kind: "map_close_summary",
      length: prose.length,
      assumption_count: assumptions.length,
      tested_count: assumptionsWithHistory.filter(
        (a) => a.testHistory.length > 0,
      ).length,
    },
    { stage: "done" },
  );
}

export async function ensureMapCloseSummaryDelivered(
  mapId: string,
): Promise<{ ok: true; delivered: boolean } | { ok: false; reason: string }> {
  try {
    const map = await getMapById(mapId);
    if (!map) return { ok: false, reason: "Map not found." };
    if (map.current_stage !== "done") {
      return { ok: true, delivered: false };
    }
    const existingNotes = await listMessages(mapId);
    if (
      existingNotes.some(
        (m) =>
          m.surface === "stage_note" &&
          m.stage_at_creation === "done" &&
          m.role === "assistant",
      )
    ) {
      return { ok: true, delivered: false };
    }
    const events = new TurnEventLog(mapId, 0);
    await deliverMapCloseSummaryAfterAdvance(mapId, events);
    await events.flush();
    const after = await listMessages(mapId);
    return {
      ok: true,
      delivered: after.some(
        (m) =>
          m.surface === "stage_note" &&
          m.stage_at_creation === "done" &&
          m.role === "assistant",
      ),
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not deliver.",
    };
  }
}

/**
 * Menu of dev-only test-seed markers. Each seeds the map through a
 * different stage so testing / iterating on a specific downstream
 * stage doesn't require typing through the whole flow.
 *
 * Trigger: type the full stem + marker as the goal. E.g.,
 * "I'm committed to getting better at test design".
 *
 * Markers:
 * - `test worries` — seed behaviors only, land at worries stage.
 *   Fires the WORRY drafter live on advance so you can iterate on
 *   its prompt/schema and see current output rather than the fixture.
 * - `test commitments` — seed behaviors + worries, land at commitments
 *   stage. Fires the COMMITMENT drafter live on advance so you can
 *   iterate on it directly.
 * - `test` / `seed` / `demo` — land at assumptions (assumption
 *   drafter fires; worries + commitments are fixture text).
 * - `test walkthrough` — land at immune_system (walkthrough fires,
 *   ~15-25s wait)
 * - `test prioritize` — land at prioritize (walkthrough + coach's
 *   assumption-recommendation fire, ~25-40s wait)
 * - `test design` — land at test_design (walkthrough + recommendation
 *   + test-draft all fire, ~35-55s wait). This is "seed slow" — the
 *   full pre-test happy path in one go.
 * - `test results` — land at results with a saved test (all upstream
 *   + a canned test row on the pre-selected assumption). Skips the
 *   test-design edit step. ~35-55s wait.
 */
type SeedTarget =
  | "worries"
  | "commitments"
  | "assumptions"
  | "immune_system"
  | "prioritize"
  | "test_design"
  | "results";
const TEST_SEED_MARKERS: Record<string, SeedTarget> = {
  "test worries": "worries",
  "test commitments": "commitments",
  test: "assumptions",
  "test happy path": "assumptions",
  seed: "assumptions",
  demo: "assumptions",
  "test walkthrough": "immune_system",
  "test prioritize": "prioritize",
  "test design": "test_design",
  "test slow": "test_design",
  "test results": "results",
};
function isTestSeedGoal(text: string): SeedTarget | null {
  const stem = GOAL_STEM.toLowerCase();
  const normalized = text
    .trim()
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[.!?]+$/, "")
    .toLowerCase();
  for (const [marker, target] of Object.entries(TEST_SEED_MARKERS)) {
    if (normalized === `${stem} ${marker}`) return target;
  }
  return null;
}

/**
 * Dev-only fixture seeder. Wipes the map's current state and inserts
 * a canonical happy-path ITC map (goal + 3 behaviors + 3 deep worries
 * + 3 identity-level commitments), then advances to the assumptions
 * stage so the assumption drafter fires. Coachee lands ready to
 * review the drafts and click Continue to see the immune-system
 * walkthrough — the whole reveal sequence in two clicks instead of
 * fifteen minutes of typing.
 *
 * Destructive by design. Only reached via the isTestSeedGoal path;
 * a real coachee typing a real goal never touches this.
 */
async function seedTestMap(
  mapId: string,
  target: SeedTarget,
): Promise<ActionResult> {
  const supabase = createSupabaseServiceClient();

  // Wipe existing state. Delete children before parents where FK
  // cascades don't already handle it.
  const draftIds = (
    await supabase
      .from("itc_assumption_drafts")
      .select("id")
      .eq("map_id", mapId)
  ).data as Array<{ id: string }> | null;
  if (draftIds && draftIds.length > 0) {
    await supabase
      .from("itc_assumption_draft_commitments")
      .delete()
      .in("draft_id", draftIds.map((d) => d.id));
  }
  await supabase.from("itc_assumption_drafts").delete().eq("map_id", mapId);

  const assumptionIds = (
    await supabase.from("itc_assumptions").select("id").eq("map_id", mapId)
  ).data as Array<{ id: string }> | null;
  if (assumptionIds && assumptionIds.length > 0) {
    await supabase
      .from("itc_assumption_commitments")
      .delete()
      .in("assumption_id", assumptionIds.map((a) => a.id));
  }
  await supabase.from("itc_assumptions").delete().eq("map_id", mapId);
  // Wipe tests + results (cascade via test_id FK on results).
  const testIds = (
    await supabase.from("itc_tests").select("id").eq("map_id", mapId)
  ).data as Array<{ id: string }> | null;
  if (testIds && testIds.length > 0) {
    await supabase
      .from("itc_test_results")
      .delete()
      .in("test_id", testIds.map((t) => t.id));
  }
  await supabase.from("itc_tests").delete().eq("map_id", mapId);
  await supabase.from("itc_commitments").delete().eq("map_id", mapId);
  await supabase.from("itc_worries").delete().eq("map_id", mapId);
  await supabase.from("itc_behaviors").delete().eq("map_id", mapId);
  await supabase.from("itc_messages").delete().eq("map_id", mapId);

  // Reset map flags + goal + stage. Initial stage is chosen based on
  // the target so the subsequent advanceToStage calls are always
  // moving forward one column at a time and firing the right drafter
  // on entry. For "worries" target we land at behaviors and then
  // advance to worries. For "commitments" we land at worries and
  // advance to commitments. For every downstream target we land at
  // commitments (pre-existing behavior) and advance to assumptions.
  const seedGoal =
    "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.";
  const initialStage: ItcStage =
    target === "worries"
      ? "behaviors"
      : target === "commitments"
        ? "worries"
        : "commitments";
  const { error: mapErr } = await supabase
    .from("itc_maps")
    .update({
      improvement_goal: seedGoal,
      current_stage: initialStage,
      reveal_delivered: false,
      walkthrough_delivered: false,
    })
    .eq("id", mapId);
  if (mapErr) return { ok: false, reason: `seed map: ${mapErr.message}` };

  // Behaviors (in order).
  const behaviorTexts = [
    "I bring up things she did in the past instead of listening to her",
    "I lie to get myself out of the situation when she's right",
    "I shut down and walk out of the room",
  ];
  const { data: bs, error: bErr } = await supabase
    .from("itc_behaviors")
    .insert(
      behaviorTexts.map((text, i) => ({
        map_id: mapId,
        text,
        selected: true,
        source: "user",
        sort_order: i,
      })),
    )
    .select("id, sort_order");
  if (bErr || !bs) return { ok: false, reason: `seed behaviors: ${bErr?.message}` };
  const typedBs = bs as Array<{ id: string; sort_order: number }>;
  const sortedBehaviors = typedBs
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  // Early-exit for `test worries`: advance behaviors → worries so the
  // WORRY DRAFTER fires live against the current prompt/schema. Skips
  // the worry + commitment fixture entirely — the whole point of this
  // marker is to see what the current worry drafter actually produces.
  if (target === "worries") {
    const advW = new FormData();
    advW.set("map_id", mapId);
    advW.set("to", "worries");
    const advWRes = await advanceToStage(advW);
    if (!advWRes.ok) {
      return { ok: false, reason: `advance to worries: ${advWRes.reason ?? "unknown"}` };
    }
    return { ok: true };
  }

  // Worries — depth 3, attempts 1 (bypasses excavation-loop gate).
  // Fixture text is hand-authored to match what the current worry
  // drafter would produce: under 20 words, "I worry that if I..." stem,
  // identity-level landing (self-labeling or role/relational). Update
  // whenever the drafter's shape/length rules shift so test-mode
  // reflects the current production output.
  const worryTextsByBehavior = [
    "I worry that if I let her past rest, I'd have to see mine is the pattern.",
    "I worry that if I admitted I was wrong, she'd know I'm not enough for her.",
    "I worry that if I stayed and heard her out, I'd become the husband who hurts her.",
  ];
  const { data: ws, error: wErr } = await supabase
    .from("itc_worries")
    .insert(
      sortedBehaviors.map((b, i) => ({
        map_id: mapId,
        behavior_id: b.id,
        text: worryTextsByBehavior[i],
        depth_score: 3,
        attempts: 1,
      })),
    )
    .select("id, behavior_id");
  if (wErr || !ws) return { ok: false, reason: `seed worries: ${wErr?.message}` };
  const typedWs = ws as Array<{ id: string; behavior_id: string }>;

  // Early-exit for `test commitments`: advance worries → commitments so
  // the COMMITMENT DRAFTER fires live against the current prompt/schema.
  // Skips the commitment fixture entirely — the whole point of this
  // marker is to see what the current commitment drafter produces.
  if (target === "commitments") {
    const advC = new FormData();
    advC.set("map_id", mapId);
    advC.set("to", "commitments");
    const advCRes = await advanceToStage(advC);
    if (!advCRes.ok) {
      return { ok: false, reason: `advance to commitments: ${advCRes.reason ?? "unknown"}` };
    }
    return { ok: true };
  }

  // Commitments — active-mechanism form, depth 3, attempts 1.
  // Fixture text is hand-authored to match the current commitment
  // drafter's output shape: starts with "I'm also committed to",
  // under 20 words, active mechanism + protective purpose ("so I
  // never have to X"). Update whenever the drafter's shape/length
  // rules shift so test-mode reflects production output.
  const commitmentTextsByBehaviorIdx = [
    "I'm also committed to keeping her past on the table so mine never stands alone.",
    "I'm also committed to hiding how often I get it wrong so she never sees I'm not enough.",
    "I'm also committed to walking out before I lose it so I never find out I can handle it.",
  ];
  const worriesByBehaviorId = new Map(typedWs.map((w) => [w.behavior_id, w]));
  const { error: cErr } = await supabase.from("itc_commitments").insert(
    sortedBehaviors.map((b, i) => {
      const w = worriesByBehaviorId.get(b.id);
      return {
        map_id: mapId,
        worry_id: w?.id,
        text: commitmentTextsByBehaviorIdx[i],
        depth_score: 3,
        attempts: 1,
      };
    }),
  );
  if (cErr) return { ok: false, reason: `seed commitments: ${cErr.message}` };

  // First advance: to assumptions (fires assumption drafter).
  const advA = new FormData();
  advA.set("map_id", mapId);
  advA.set("to", "assumptions");
  const advARes = await advanceToStage(advA);
  if (!advARes.ok) {
    return { ok: false, reason: `advance to assumptions: ${advARes.reason ?? "unknown"}` };
  }
  if (target === "assumptions") return { ok: true };

  // For targets past assumptions we need real saved assumptions with
  // commitment coverage — the walkthrough / recommendation / test-draft
  // pipelines all read from itc_assumptions + links, not from the
  // draft table. Seed 2 canonical clustered assumptions directly.
  const seededCommitments = (
    await supabase.from("itc_commitments").select("id, worry_id").eq("map_id", mapId)
  ).data as Array<{ id: string; worry_id: string }> | null;
  const canonicalAssumptions = [
    {
      text: "I assume that if I stop protecting her from my failures, then she'd see the pattern and I'd be the husband I'm terrified I am.",
      // Covers commitments #1 (listening) and #2 (lying) — shared root.
      commitmentIndices: [0, 1],
    },
    {
      text: "I assume that if I stay in the room while she's angry, then I'd lose control and be the husband who hurts her.",
      // Covers commitment #3 (walking out).
      commitmentIndices: [2],
    },
  ];
  const seededAssumptionIds: string[] = [];
  for (let i = 0; i < canonicalAssumptions.length; i++) {
    const { data: aRow, error: aErr } = await supabase
      .from("itc_assumptions")
      .insert({
        map_id: mapId,
        text: canonicalAssumptions[i].text,
        depth_score: 3,
        attempts: 1,
        sort_order: i,
      })
      .select("id")
      .single();
    if (aErr || !aRow) {
      return { ok: false, reason: `seed assumption ${i}: ${aErr?.message}` };
    }
    seededAssumptionIds.push((aRow as { id: string }).id);
    for (const cIdx of canonicalAssumptions[i].commitmentIndices) {
      const commitment = seededCommitments?.[cIdx];
      if (!commitment) continue;
      const { error: lErr } = await supabase
        .from("itc_assumption_commitments")
        .insert({
          assumption_id: (aRow as { id: string }).id,
          commitment_id: commitment.id,
        });
      if (lErr) {
        return { ok: false, reason: `seed link ${i}: ${lErr.message}` };
      }
    }
  }
  // Wipe the assumption drafts the drafter just generated — they'd
  // duplicate the seeded canonical ones we just wrote.
  const wipeDraftIds = (
    await supabase
      .from("itc_assumption_drafts")
      .select("id")
      .eq("map_id", mapId)
  ).data as Array<{ id: string }> | null;
  if (wipeDraftIds && wipeDraftIds.length > 0) {
    await supabase
      .from("itc_assumption_draft_commitments")
      .delete()
      .in("draft_id", wipeDraftIds.map((d) => d.id));
    await supabase
      .from("itc_assumption_drafts")
      .delete()
      .eq("map_id", mapId);
  }

  // Advance to immune_system (fires walkthrough).
  const advI = new FormData();
  advI.set("map_id", mapId);
  advI.set("to", "immune_system");
  const advIRes = await advanceToStage(advI);
  if (!advIRes.ok) {
    return { ok: false, reason: `advance to immune_system: ${advIRes.reason ?? "unknown"}` };
  }
  if (target === "immune_system") return { ok: true };

  // Advance to prioritize (fires recommendation + pre-selects).
  const advP = new FormData();
  advP.set("map_id", mapId);
  advP.set("to", "prioritize");
  const advPRes = await advanceToStage(advP);
  if (!advPRes.ok) {
    return { ok: false, reason: `advance to prioritize: ${advPRes.reason ?? "unknown"}` };
  }
  if (target === "prioritize") return { ok: true };

  // Advance to test_design (fires test draft on selected assumption).
  const advTd = new FormData();
  advTd.set("map_id", mapId);
  advTd.set("to", "test_design");
  const advTdRes = await advanceToStage(advTd);
  if (!advTdRes.ok) {
    return { ok: false, reason: `advance to test_design: ${advTdRes.reason ?? "unknown"}` };
  }
  if (target === "test_design") return { ok: true };

  // Target === "results" — need a saved (run) test. The test-draft
  // hook above created one; just mark it as run so the results form
  // is the active surface, then advance through test_running.
  const activeTest = (
    await supabase
      .from("itc_tests")
      .select("id")
      .eq("map_id", mapId)
      .eq("status", "designed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ).data as { id: string } | null;
  if (activeTest) {
    await supabase
      .from("itc_tests")
      .update({ status: "run" })
      .eq("id", activeTest.id);
  }
  const advTr = new FormData();
  advTr.set("map_id", mapId);
  advTr.set("to", "test_running");
  const advTrRes = await advanceToStage(advTr);
  if (!advTrRes.ok) {
    return { ok: false, reason: `advance to test_running: ${advTrRes.reason ?? "unknown"}` };
  }
  const advR = new FormData();
  advR.set("map_id", mapId);
  advR.set("to", "results");
  const advRRes = await advanceToStage(advR);
  if (!advRRes.ok) {
    return { ok: false, reason: `advance to results: ${advRRes.reason ?? "unknown"}` };
  }
  return { ok: true };
}

/**
 * Which stage the Continue button targets, whether it's tappable,
 * and (if not) the reason. Server-side single source of truth.
 * Called on every render of the conversation.
 */
export type AdvanceGate = {
  from: ItcStage;
  to: ItcStage | null;
  label: string | null;
  enabled: boolean;
  reason: string | null;
};

export async function getAdvanceGate(mapId: string): Promise<AdvanceGate> {
  const participant = await requireItcParticipant();
  const map = await getMapForParticipant(mapId, participant.id);
  if (!map) {
    return {
      from: "goal",
      to: null,
      label: null,
      enabled: false,
      reason: "Map not found.",
    };
  }
  return computeAdvanceGate(map);
}

/**
 * Admin-only variant: fetches ANY map's advance gate without a
 * participant-match check. Used by /itc/admin/[mapId] so the
 * facilitator can see what's currently blocking the coachee.
 * Callers must have already verified isItcAdmin.
 */
export async function getAdvanceGateAdmin(
  mapId: string,
): Promise<AdvanceGate> {
  const map = await getMapById(mapId);
  if (!map) {
    return {
      from: "goal",
      to: null,
      label: null,
      enabled: false,
      reason: "Map not found.",
    };
  }
  return computeAdvanceGate(map);
}

async function computeAdvanceGate(
  map: Awaited<ReturnType<typeof getMapById>>,
): Promise<AdvanceGate> {
  if (!map) {
    return {
      from: "goal",
      to: null,
      label: null,
      enabled: false,
      reason: "Map not found.",
    };
  }
  const from = map.current_stage;
  if (from === "done") {
    return {
      from,
      to: null,
      label: null,
      enabled: false,
      reason: "Map complete.",
    };
  }
  const to: ItcStage =
    from === "assumptions"
      ? "immune_system"
      : (ITC_STAGES[ITC_STAGES.indexOf(from) + 1] as ItcStage);
  // Special-case button labels where the generic "Continue to ${label}"
  // reads confusingly or misses an emotional beat.
  const label =
    to === "immune_system"
      ? "Show Me What's Going On"
      : to === "test_running"
        ? "Go Run the Test"
        : to === "results"
          ? "Debrief the Test"
          : `Continue to ${STAGE_LABELS[to]}`;

  switch (from) {
    case "goal": {
      if (!map.improvement_goal) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: "Save the goal first.",
        };
      }
      if (!hasGoalStem(map.improvement_goal)) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: `Goal must begin with "${GOAL_STEM}".`,
        };
      }
      return { from, to, label, enabled: true, reason: null };
    }
    case "behaviors": {
      const bs = await listBehaviors(map.id);
      const selected = bs.filter((b) => b.selected);
      if (selected.length < 3) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: `Add ${3 - selected.length} more ${selected.length === 2 ? "behavior" : "behaviors"} — 3 to 5 total is what shows the pattern.`,
        };
      }
      if (selected.length > 5) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: `Consolidate to 5 or fewer behaviors first (${selected.length} on the map).`,
        };
      }
      // Depth gate: mirror of worries/commitments/assumptions — every
      // selected behavior passes at 3/3 or (2/3 AND attempts >= 2).
      // Same helper, same escape hatch. Before this, the behaviors
      // gate only checked count — coachees could bypass real coach
      // pushback on shallow entries by clicking Continue.
      const shallow = selected.filter(
        (b) => !worryPassesDepth(b.depth_score, b.attempts),
      );
      if (shallow.length > 0) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: `${shallow.length} behavior${shallow.length === 1 ? "" : "s"} ${shallow.length === 1 ? "needs" : "need"} more depth.`,
        };
      }
      return { from, to, label, enabled: true, reason: null };
    }
    case "worries": {
      const [bs, ws] = await Promise.all([
        listBehaviors(map.id),
        listWorries(map.id),
      ]);
      const selected = bs.filter((b) => b.selected);
      const withWorry = new Set(ws.map((w) => w.behavior_id));
      const missing = selected.filter((b) => !withWorry.has(b.id));
      if (missing.length > 0) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: `${missing.length} behavior${missing.length === 1 ? "" : "s"} still need a worry.`,
        };
      }
      // Depth gate: every worry passes at 3/3 OR at 2/3 with attempts >= 2.
      // Deterministic — reads rubric-written metadata, not coach prose.
      const shallow = ws.filter(
        (w) =>
          !worryPassesDepth(w.depth_score, w.attempts),
      );
      if (shallow.length > 0) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: `${shallow.length} worr${shallow.length === 1 ? "y needs" : "ies need"} more depth.`,
        };
      }
      return { from, to, label, enabled: true, reason: null };
    }
    case "commitments": {
      const [ws, cs] = await Promise.all([
        listWorries(map.id),
        listCommitments(map.id),
      ]);
      const covered = new Set(cs.map((c) => c.worry_id));
      const missing = ws.filter((w) => !covered.has(w.id));
      if (missing.length > 0) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: `${missing.length} worr${missing.length === 1 ? "y" : "ies"} still ${missing.length === 1 ? "needs" : "need"} a commitment.`,
        };
      }
      // Depth gate: mirror of worries — every commitment passes at
      // 3/3 or (2/3 AND attempts >= 2).
      const shallow = cs.filter(
        (c) => !worryPassesDepth(c.depth_score, c.attempts),
      );
      if (shallow.length > 0) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: `${shallow.length} commitment${shallow.length === 1 ? "" : "s"} ${shallow.length === 1 ? "needs" : "need"} more depth.`,
        };
      }
      return { from, to, label, enabled: true, reason: null };
    }
    case "assumptions": {
      const [assumptions, cs, links] = await Promise.all([
        listAssumptions(map.id),
        listCommitments(map.id),
        listAssumptionLinks(map.id),
      ]);
      if (assumptions.length === 0) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: "Add at least one Big Assumption first.",
        };
      }
      const covered = new Set(links.map((l) => l.commitment_id));
      const uncovered = cs.filter((c) => !covered.has(c.id));
      if (uncovered.length > 0) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: `${uncovered.length} commitment${uncovered.length === 1 ? "" : "s"} still ${uncovered.length === 1 ? "needs" : "need"} an assumption.`,
        };
      }
      // Depth gate: same rule as worries and commitments.
      const shallow = assumptions.filter(
        (a) => !worryPassesDepth(a.depth_score, a.attempts),
      );
      if (shallow.length > 0) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: `${shallow.length} assumption${shallow.length === 1 ? "" : "s"} ${shallow.length === 1 ? "needs" : "need"} more depth.`,
        };
      }
      return { from, to, label, enabled: true, reason: null };
    }
    case "review":
    case "immune_system": {
      if (from === "immune_system" && !map.walkthrough_delivered) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: "Deliver the walkthrough first.",
        };
      }
      return { from, to, label, enabled: true, reason: null };
    }
    case "prioritize": {
      const assumptions = await listAssumptions(map.id);
      const picked = assumptions.find((a) => a.selected_for_testing);
      if (!picked) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: "Pick an assumption to test first.",
        };
      }
      return { from, to, label, enabled: true, reason: null };
    }
    case "test_design": {
      const t = await getActiveTest(map.id);
      if (!t) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: "Save a test design first.",
        };
      }
      return { from, to, label, enabled: true, reason: null };
    }
    case "test_running": {
      return { from, to, label, enabled: true, reason: null };
    }
    case "results": {
      const t = await getActiveTest(map.id);
      const results = await listTestResults(map.id);
      const hasResult = results.some((r) => r.test_id === t?.id);
      if (!hasResult) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: "Record the results first.",
        };
      }
      return { from, to, label, enabled: true, reason: null };
    }
    default: {
      return { from, to, label, enabled: true, reason: null };
    }
  }
}

// Stage intros used to be persisted server-side via seedStageIntroIfNeeded,
// which baked the goal text into the message content. That produced
// stale-quote bugs when the goal was later edited. Intros are now
// client-side static text with live map-state interpolation — see
// STAGE_INTROS in src/lib/itc/stage-intros.ts and rendered by
// map-canvas.tsx.
