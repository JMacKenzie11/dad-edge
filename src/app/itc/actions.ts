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
  addBehavior as insertBehaviorRow,
  advanceStage,
  appendMessage,
  createMap,
  deleteBehavior,
  deleteMap,
  getActiveTest,
  getMapById,
  getMapForParticipant,
  listAssumptionLinks,
  listAssumptions,
  listBehaviors,
  listCommitments,
  listMapsForParticipant,
  listMessages,
  listMessagesForStage,
  listTestResults,
  listTests,
  listWorries,
  saveImprovementGoal,
  updateBehaviorText,
} from "@/lib/itc/maps";
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
      })),
      commitments: commitments.map((c) => ({
        id: c.id,
        worry_id: c.worry_id,
        text: c.text,
      })),
      assumptions: assumptions.map((a) => ({
        id: a.id,
        text: a.text,
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
const threadReplySchema = z.object({
  map_id: z.string().uuid(),
  entry_ref_table: z.enum([
    "itc_maps",
    "itc_behaviors",
    "itc_worries",
    "itc_commitments",
    "itc_assumptions",
    "itc_tests",
  ]),
  entry_ref_id: z.string().uuid(),
  entry_text: z.string().max(1000),
  entry_kind: z.enum(["goal", "behavior", "worry", "commitment", "assumption"]),
  text: z.string().min(1).max(4000),
});

export async function postThreadReply(formData: FormData): Promise<ActionResult> {
  const parsed = threadReplySchema.safeParse({
    map_id: formData.get("map_id"),
    entry_ref_table: formData.get("entry_ref_table"),
    entry_ref_id: formData.get("entry_ref_id"),
    entry_text: formData.get("entry_text"),
    entry_kind: formData.get("entry_kind"),
    text: formData.get("text"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid reply input." };
  const loaded = await requireParticipantAndMap(parsed.data.map_id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  await appendMessage(
    loaded.map.id,
    "user",
    parsed.data.text,
    loaded.map.current_stage,
    {
      surface: "entry_thread",
      entryRefTable: parsed.data.entry_ref_table,
      entryRefId: parsed.data.entry_ref_id,
    },
  );
  const events = new TurnEventLog(loaded.map.id, 0);
  events.record(
    "thread_reply",
    {
      entry_kind: parsed.data.entry_kind,
      entry_id: parsed.data.entry_ref_id,
    },
    { stage: loaded.map.current_stage },
  );
  await events.flush();

  // Reuse the reaction pipeline — pass the entry as `justAdded` so
  // the coach's prompt is anchored to that specific entry.
  await awaitReactionOrSwallow(() =>
    fireCoachReaction(
      loaded.map.id,
      {
        kind: parsed.data.entry_kind,
        text: parsed.data.entry_text,
      },
      { table: parsed.data.entry_ref_table, id: parsed.data.entry_ref_id },
    ),
  );
  safeRevalidate(`/itc/${loaded.map.id}`);
  return { ok: true };
}

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
  const withStem = hasGoalStem(parsed.data.text)
    ? parsed.data.text
    : `${GOAL_STEM} ${parsed.data.text.trim()}`;
  try {
    await saveImprovementGoal(loaded.map.id, withStem);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not save goal.",
    };
  }
  const events = new TurnEventLog(loaded.map.id, 0);
  events.record("entry_added", { kind: "goal", text: withStem }, {
    stage: loaded.map.current_stage,
  });
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
    { kind: "behavior", text: parsed.data.text.trim() },
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
  await seedStageIntroIfNeeded(loaded.map.id, target, loaded.map.improvement_goal);
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
      if (selected.length === 0) {
        return {
          from,
          to,
          label,
          enabled: false,
          reason: "Add at least one behavior first.",
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
          reason: `${missing.length} worr${missing.length === 1 ? "y" : "ies"} still need a commitment.`,
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
          reason: `${uncovered.length} commitment${uncovered.length === 1 ? "" : "s"} still need an assumption.`,
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

/**
 * Seed a canned coach intro message when the map first lands on a
 * stage that has no assistant messages yet. Runs once per stage per
 * map — revisits skip because messages already exist for that stage.
 * References the coachee's goal by exact text when known.
 */
async function seedStageIntroIfNeeded(
  mapId: string,
  stage: ItcStage,
  goalText: string | null,
): Promise<void> {
  const existing = await listMessagesForStage(mapId, stage);
  if (
    existing.some((m) => m.role === "assistant" && m.surface === "stage_note")
  ) {
    return;
  }
  const intro = STAGE_INTROS[stage]?.(goalText);
  if (!intro) return;
  try {
    await appendMessage(mapId, "assistant", intro, stage, {
      surface: "stage_note",
      entryRefTable: "itc_maps",
      entryRefId: mapId,
    });
  } catch (err) {
    console.warn(
      "[itc] seedStageIntroIfNeeded(%s) failed: %s",
      stage,
      err instanceof Error ? err.message : String(err),
    );
  }
}

const STAGE_INTROS: Partial<Record<ItcStage, (goal: string | null) => string>> = {
  behaviors: (goal) =>
    `Column 2 is what you actually do, or fail to do, in the moment that works against ${
      goal ? `"${goal}"` : "your goal"
    }. Not why. Not what you should do instead. Just the specific behavior. What's the first one that comes to mind?`,
  worries: (_goal) =>
    `Column 3 is the worry box. For each behavior on Column 2, we name the fear underneath. If you stopped doing that behavior (or started the opposite), what part of you is afraid of what would happen next? Which behavior do you want to start on?`,
  commitments: (_goal) =>
    `Column 4 is what you're SECRETLY committed to. Every worry in Column 3 points at a hidden commitment you're keeping. Ready to work through them?`,
  assumptions: (_goal) =>
    `Column 5 is the Big Assumptions underneath the hidden commitments. What do you assume would happen if you broke a competing commitment? Ready?`,
  review: (_goal) =>
    `Before we test anything, take a beat and look at the whole map. What jumps out? Anything you'd sharpen or reword?`,
  immune_system: (_goal) =>
    `Now the walkthrough. I'm going to show you how the columns interlock, how the behaviors, the worries, the hidden commitments, and the Big Assumptions all protect the same thing. Ready?`,
  prioritize: (_goal) =>
    `You've mapped the whole immune system. Now: which Big Assumption do you want to test first? The best one to start on is usually the one that, if it turned out not to hold, would loosen the most of the system.`,
  test_design: (_goal) =>
    `Design a test for the assumption you picked. Four fields: what the assumption says, what you'll do differently, what data you'll collect, what you'll find out.`,
  test_running: (_goal) =>
    `Test is designed. Go run it. Come back with what you observed.`,
  results: (_goal) =>
    `You ran the test. Tell me what you did, what you observed, and what you make of it.`,
  done: (_goal) =>
    `Your map stays here. Come back anytime you want to design another test, revisit an assumption, or work on a different pillar.`,
};
