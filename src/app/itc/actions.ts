"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import {
  generateCoachChat,
  generateCoachReaction,
  generateSuggestions,
  scrubReply,
  type ReactionInput,
  type ReactionOutput,
} from "@/lib/itc/coach";
import {
  addAssumption,
  addBehavior as insertBehaviorRow,
  advanceStage,
  appendMessage,
  clearAssumptionLinks,
  createMap,
  deleteAssumption,
  deleteBehavior,
  deleteMap,
  getActiveTest,
  getMapById,
  getMapForParticipant,
  linkAssumptionToCommitments,
  listAssumptionLinks,
  listAssumptions,
  listBehaviors,
  listCommitments,
  listMapsForParticipant,
  listMessages,
  listTestResults,
  listTests,
  listWorries,
  saveImprovementGoal,
  updateAssumptionDepth,
  updateAssumptionText,
  updateBehaviorText,
  updateCommitmentDepth,
  updateWorryDepth,
  upsertCommitmentForWorry,
  upsertWorryForBehavior,
} from "@/lib/itc/maps";
import {
  scoreAssumptionDepth,
  scoreCommitmentDepth,
  scoreWorryDepth,
} from "@/lib/itc/rubric";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import {
  GOAL_STEM,
  ITC_STAGES,
  STAGE_LABELS,
  hasGoalStem,
  type ItcStage,
} from "@/lib/itc/stage";
import { TurnEventLog } from "@/lib/itc/turn-events";

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * revalidatePath throws when called outside a Next.js request context
 * (test harness, cron, etc.). Never let a revalidation failure
 * shadow a successful write.
 */
function safeRevalidate(path: string): void {
  try {
    revalidatePath(path);
  } catch {
    // no-op
  }
}

/**
 * Await the coach reaction inline so it lands in the database before
 * the server action returns. The client's auto-revalidate after a
 * form submit refetches messages + gets the reaction in the same
 * round trip.
 *
 * We originally used Next.js `after()` to defer this behind the
 * response, avoiding UI latency. But async landing meant the client
 * never re-rendered to see the reaction — it was in the DB, invisible
 * to the browser until a manual refresh. Reliability of the coach
 * reply beats the ~2-3s of extra latency on Add clicks.
 *
 * If the reaction itself throws, we swallow. The entry already
 * landed — a coach-service outage is not a form failure.
 */
async function awaitReactionOrSwallow(
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.warn(
      "[itc] coach reaction failed: %s",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export type ActionResult = { ok: true } | { ok: false; reason: string };

async function requireParticipantAndMap(mapId: string) {
  const participant = await requireItcParticipant();
  const map = await getMapForParticipant(mapId, participant.id);
  if (!map) return { ok: false as const, reason: "Map not found." };
  return { ok: true as const, participant, map };
}

/**
 * Fetch the full map-state input the coach needs for a reaction /
 * chat / suggestions generation. Kept as a helper so every entry
 * point ships the same context shape.
 */
async function loadCoachContext(mapId: string) {
  const map = await getMapById(mapId);
  if (!map) throw new Error("map not found");
  const [
    history,
    behaviors,
    worries,
    commitments,
    assumptions,
    links,
    tests,
    testResults,
  ] = await Promise.all([
    listMessages(map.id),
    listBehaviors(map.id),
    listWorries(map.id),
    listCommitments(map.id),
    listAssumptions(map.id),
    listAssumptionLinks(map.id),
    listTests(map.id),
    listTestResults(map.id),
  ]);
  const linksByAssumption = new Map<string, string[]>();
  for (const l of links) {
    const arr = linksByAssumption.get(l.assumption_id) ?? [];
    arr.push(l.commitment_id);
    linksByAssumption.set(l.assumption_id, arr);
  }
  return {
    map,
    history: history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    context: {
      pillar: map.pillar_code,
      stage: map.current_stage,
      improvementGoal: map.improvement_goal,
      behaviors,
      worries: worries.map((w) => ({
        behavior_id: w.behavior_id,
        text: w.text,
        depth_score: w.depth_score,
      })),
      commitments: commitments.map((c) => ({
        id: c.id,
        worry_id: c.worry_id,
        text: c.text,
        depth_score: c.depth_score,
      })),
      assumptions: assumptions.map((a) => ({
        id: a.id,
        text: a.text,
        depth_score: a.depth_score,
        selected_for_testing: a.selected_for_testing,
        linked_commitment_ids: linksByAssumption.get(a.id) ?? [],
      })),
      walkthroughDelivered: map.walkthrough_delivered,
      tests: tests.map((t) => ({
        id: t.id,
        assumption_id: t.assumption_id,
        test_type: t.test_type,
        assumption_says: t.assumption_says,
        behavior_change: t.behavior_change,
        data_to_collect: t.data_to_collect,
        in_order_to_find_out: t.in_order_to_find_out,
        target_date: t.target_date,
        status: t.status,
      })),
      testResults: testResults.map((r) => ({
        test_id: r.test_id,
        ran_on: r.ran_on,
        what_i_did: r.what_i_did,
        data_collected: r.data_collected,
        what_it_says_about_assumption: r.what_it_says_about_assumption,
        assumption_verdict: r.assumption_verdict,
        next_step: r.next_step,
      })),
      mapStatus: map.status,
    },
  };
}

/**
 * Fire-and-forget async coach reaction to a just-added entry. Runs
 * after the server action's response is sent back to the client via
 * next/server's `after()` primitive, so the form submit is fast and
 * the coach reply appears on the next revalidation.
 *
 * The reply is written to itc_messages as an assistant message.
 * Refinement + suggestions chips are persisted as structured JSON in
 * a separate metadata column (added by migration) OR — for MVP —
 * embedded in the message content as a fenced JSON footer the client
 * strips out. We use a dedicated table for reaction metadata.
 */
async function fireCoachReaction(
  mapId: string,
  justAdded: ReactionInput["justAdded"],
  anchor: { table: string; id: string },
): Promise<void> {
  const events = new TurnEventLog(mapId, 0);
  try {
    const { context, history } = await loadCoachContext(mapId);
    // Recent chat context for the reaction should include the
    // existing thread messages on this entry PLUS any dock messages,
    // so the coach can pick up mid-conversation. Simpler: use the
    // last ~6 messages regardless of surface, in time order.
    const recentChat = history.slice(-6);
    const reaction = await generateCoachReaction({
      ...context,
      recentChat,
      justAdded,
    });
    if (!reaction.reply.trim()) return;
    const stored = await persistReaction(
      mapId,
      context.stage,
      reaction,
      "entry_thread",
      anchor,
    );
    events.record(
      "coach_reaction_sent",
      {
        entry_kind: justAdded.kind,
        entry_text: justAdded.text,
        has_refinement: Boolean(reaction.refinement),
        suggestion_count: reaction.suggestions?.length ?? 0,
        message_id: stored,
        anchor_table: anchor.table,
        anchor_id: anchor.id,
      },
      { durationMs: reaction.durationMs, stage: context.stage },
    );
    await events.flush();
    safeRevalidate(`/itc/${mapId}`);
  } catch (err) {
    console.warn(
      "[itc] fireCoachReaction failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    events.record("error", {
      where: "fireCoachReaction",
      message: err instanceof Error ? err.message : String(err),
    });
    try {
      await events.flush();
    } catch {
      // non-fatal
    }
  }
}

/**
 * Store a coach reaction as an assistant message. Refinement +
 * suggestions land in the message content as an inline JSON footer
 * the client parses out. Format:
 *
 *   <prose>
 *   ```coach-chips
 *   {"refinement":"...","suggestions":["..","..",".."]}
 *   ```
 *
 * The chat renderer splits on the fenced block and renders the prose
 * as text + chips as tap-to-fill buttons. Falls back cleanly when
 * the footer is absent.
 */
async function persistReaction(
  mapId: string,
  stage: ItcStage,
  reaction: ReactionOutput,
  surface: "entry_thread" | "stage_note" | "dock" | "focus",
  anchor: { table: string; id: string } | null,
): Promise<string> {
  const parts: string[] = [reaction.reply];
  if (reaction.refinement || (reaction.suggestions && reaction.suggestions.length > 0)) {
    const chipPayload = {
      refinement: reaction.refinement,
      suggestions: reaction.suggestions,
    };
    parts.push(
      "```coach-chips",
      JSON.stringify(chipPayload),
      "```",
    );
  }
  const msg = await appendMessage(
    mapId,
    "assistant",
    parts.join("\n\n"),
    stage,
    {
      surface,
      entryRefTable: anchor?.table,
      entryRefId: anchor?.id,
    },
  );
  return msg.id;
}

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

  const existingMaps = await listMapsForParticipant(participant.id);
  const samePillarInProgress = existingMaps.find(
    (m) =>
      m.status === "in_progress" &&
      m.pillar_code === parsed.data.pillar_code,
  );
  if (samePillarInProgress) redirect(`/itc/${samePillarInProgress.id}`);

  const map = await createMap(participant.id, parsed.data.pillar_code as PillarCode);
  const pillar = PILLAR_BY_CODE[map.pillar_code];
  await appendMessage(
    map.id,
    "assistant",
    `You've picked ${pillar.label}. Column 1 is one goal that starts "${GOAL_STEM}...". Type it into the goal input above, or ask the coach anything about what you want to work on.`,
    "goal",
    {
      surface: "stage_note",
      entryRefTable: "itc_maps",
      entryRefId: map.id,
    },
  );
  redirect(`/itc/${map.id}`);
}

const resetMapSchema = z.object({ map_id: z.string().uuid() });

export async function resetMap(formData: FormData): Promise<void> {
  const participant = await requireItcParticipant();
  const parsed = resetMapSchema.safeParse({ map_id: formData.get("map_id") });
  if (!parsed.success) redirect("/itc");
  const map = await getMapForParticipant(parsed.data.map_id, participant.id);
  if (!map) redirect("/itc");
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

/**
 * The coach dock: an "Ask the coach" drawer for open questions not
 * tied to any specific map entry. User message + coach reply both
 * persist with surface="dock" so they render in the drawer only,
 * never in the main canvas. Nothing said here writes state.
 */
export async function sendDockMessage(formData: FormData): Promise<ActionResult> {
  const participant = await requireItcParticipant();
  const parsed = chatSchema.safeParse({
    map_id: formData.get("map_id"),
    text: formData.get("text"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid message." };
  const map = await getMapForParticipant(parsed.data.map_id, participant.id);
  if (!map) return { ok: false, reason: "Map not found." };

  await appendMessage(map.id, "user", parsed.data.text, map.current_stage, {
    surface: "dock",
  });

  const events = new TurnEventLog(map.id, 0);
  events.record(
    "dock_message",
    { direction: "user", text: parsed.data.text },
    { stage: map.current_stage },
  );
  try {
    const { context, history } = await loadCoachContext(map.id);
    // Coach chat sees the full transcript so it can answer with
    // awareness of both dock and thread activity.
    const priorHistory = history.slice(0, -1);
    const chat = await generateCoachChat({
      ...context,
      history: priorHistory,
      userMessage: parsed.data.text,
    });
    if (chat.reply.trim().length > 0) {
      await appendMessage(map.id, "assistant", chat.reply, map.current_stage, {
        surface: "dock",
      });
      events.record(
        "dock_message",
        { direction: "coach", text: chat.reply },
        { durationMs: chat.durationMs, stage: map.current_stage },
      );
    }
    events.record(
      "llm_attempt",
      { kind: "dock", outcome: chat.reply.trim().length > 0 ? "ok" : "empty" },
      { durationMs: chat.durationMs, stage: map.current_stage },
    );
    await events.flush();
  } catch (err) {
    console.warn(
      "[itc sendDockMessage] coach failure: %s",
      err instanceof Error ? err.message : String(err),
    );
    events.record("error", {
      where: "sendDockMessage",
      message: err instanceof Error ? err.message : String(err),
    });
    await events.flush();
  }

  safeRevalidate(`/itc/${map.id}`);
  return { ok: true };
}

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

/**
 * Detect goal-framing prefixes the user might type INSTEAD of the
 * required `GOAL_STEM`. Prepending the stem to any of these produces
 * a mashup ("I'm committed to getting better at I want to get better
 * at X"). When one of these fires, saveGoal rejects with a clear
 * error asking the user to keep the stem intact.
 */
function hasCompetingGoalFraming(text: string): boolean {
  const openers = [
    /^i\s*(?:'|')?m\s+committed/i, // "I'm committed" (any suffix but the stem)
    /^i\s+want\s+to\b/i,
    /^i\s*(?:'|')?d\s+like\s+to\b/i,
    /^i\s+would\s+like\s+to\b/i,
    /^my\s+goal\b/i,
    /^my\s+commitment\b/i,
    /^i\s+need\s+to\b/i,
    /^i\s+will\b/i,
    /^i\s+plan\s+to\b/i,
    /^help\s+me\b/i,
  ];
  return openers.some((re) => re.test(text));
}

export async function saveGoal(formData: FormData): Promise<ActionResult> {
  const parsed = saveGoalSchema.safeParse({
    map_id: formData.get("map_id"),
    text: formData.get("text"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid goal input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
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
    },
    { stage: loaded.map.current_stage },
  );
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
  try {
    await updateBehaviorText(target.id, loaded.map.id, parsed.data.text);
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
      stage_at_edit: loaded.map.current_stage,
    },
    { stage: loaded.map.current_stage },
  );
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
    await updateWorryDepth(row.id, score);
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
    await updateCommitmentDepth(row.id, score);
    events.record(
      "rubric_scored",
      {
        kind: "commitment",
        entry_id: row.id,
        score,
        attempts: row.attempts,
        is_self_protective: scored.is_self_protective,
        is_first_person: scored.is_first_person,
        is_not_productivity_platitude: scored.is_not_productivity_platitude,
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

  let row: Awaited<ReturnType<typeof addAssumption>>["row"];
  let isEdit: boolean;
  try {
    if (parsed.data.assumption_id) {
      row = await updateAssumptionText(
        parsed.data.assumption_id,
        loaded.map.id,
        parsed.data.text,
      );
      isEdit = true;
    } else {
      const result = await addAssumption(loaded.map.id, parsed.data.text);
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
    await updateAssumptionDepth(row.id, score);
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
  await events.flush();
  safeRevalidate(`/itc/${loaded.map.id}`);
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
 * Depth-gate rule: a worry (or assumption) passes when the rubric
 * score is 3/3, OR when the score is 2/3 and the coachee has made
 * at least two attempts at this entry. The two-attempts-at-depth-2
 * escape hatch prevents locking a man out when a rubric edge case
 * disagrees with what's obviously a real fear.
 */
function worryPassesDepth(
  depthScore: number | null,
  attempts: number,
): boolean {
  if (depthScore === null) return false;
  if (depthScore >= 3) return true;
  if (depthScore === 2 && attempts >= 2) return true;
  return false;
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
  const label = `Continue to ${STAGE_LABELS[to]}`;

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
