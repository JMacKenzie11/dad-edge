"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { runItcCoachTurn, type CoachAction } from "@/lib/itc/coach";
import {
  addBehavior,
  advanceStage,
  appendMessage,
  createMap,
  deleteBehavior,
  deleteMap,
  findInProgressMap,
  getMapById,
  getMapForParticipant,
  listBehaviors,
  listMessages,
  pruneBehaviors,
  saveImprovementGoal,
  setBehaviorSelected,
} from "@/lib/itc/maps";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import { GOAL_STEM, hasGoalStem, type ItcStage } from "@/lib/itc/stage";

const startMapSchema = z.object({
  pillar_code: z.enum(["B", "R", "A", "V", "E", "M", "N"]),
});

export async function startMap(formData: FormData): Promise<void> {
  const participant = await requireItcParticipant();
  const parsed = startMapSchema.safeParse({
    pillar_code: formData.get("pillar_code"),
  });
  if (!parsed.success) redirect("/itc?error=pillar");

  const existing = await findInProgressMap(participant.id);
  if (existing) redirect(`/itc/${existing.id}`);

  const map = await createMap(participant.id, parsed.data.pillar_code as PillarCode);
  const pillar = PILLAR_BY_CODE[map.pillar_code];
  await appendMessage(
    map.id,
    "assistant",
    `Alright. You've picked ${pillar.label} as the pillar. Before we go anywhere else — the map begins with one goal that starts "${GOAL_STEM}...". Do you already have that goal, or want help getting to it?`,
  );
  redirect(`/itc/${map.id}`);
}

const resetMapSchema = z.object({
  map_id: z.string().uuid(),
});

export async function resetMap(formData: FormData): Promise<void> {
  const participant = await requireItcParticipant();
  const parsed = resetMapSchema.safeParse({ map_id: formData.get("map_id") });
  if (!parsed.success) redirect("/itc");

  const map = await getMapForParticipant(parsed.data.map_id, participant.id);
  if (!map) redirect("/itc");

  await deleteMap(map.id, participant.id);
  redirect("/itc");
}

const messageSchema = z.object({
  map_id: z.string().uuid(),
  text: z.string().min(1).max(4000),
});

export type SendMessageResult = {
  ok: boolean;
  reason?: string;
};

export async function sendCoachMessage(formData: FormData): Promise<SendMessageResult> {
  const participant = await requireItcParticipant();
  const parsed = messageSchema.safeParse({
    map_id: formData.get("map_id"),
    text: formData.get("text"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid message." };

  const map = await getMapForParticipant(parsed.data.map_id, participant.id);
  if (!map) return { ok: false, reason: "Map not found." };

  await appendMessage(map.id, "user", parsed.data.text);

  const [history, behaviors] = await Promise.all([
    listMessages(map.id),
    listBehaviors(map.id),
  ]);

  const priorHistory = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const priorAssistantContent = [...priorHistory]
    .reverse()
    .find((m) => m.role === "assistant")?.content ?? null;

  let reply;
  try {
    reply = await runItcCoachTurnWithGuards({
      pillar: map.pillar_code,
      stage: map.current_stage,
      improvementGoal: map.improvement_goal,
      behaviors,
      history: priorHistory,
      userMessage: parsed.data.text,
      priorAssistantContent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Coach unavailable.";
    await appendMessage(
      map.id,
      "system",
      `[coach error] ${message} (model=${process.env.ITC_COACH_MODEL || "claude-sonnet-5"})`,
    );
    return { ok: false, reason: `Coach: ${message}` };
  }

  await appendMessage(map.id, "assistant", reply.reply);

  if (reply.action) {
    try {
      await applyCoachAction(map.id, map.current_stage, reply.action);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendMessage(map.id, "system", `[action rejected] ${message}`);
    }
  }

  // Backstop for a coach that proposes a goal in text but forgets to emit
  // propose_goal. Observed in a real session: coach honed a goal, user
  // said "yes", coach advanced — but improvement_goal stayed null so
  // column 1 showed "Not yet set." Scan this turn's reply and the prior
  // assistant message for a GOAL_STEM sentence; if we find one and the DB
  // is empty, save it. Idempotent: propose_goal already firing above
  // means improvement_goal is set and this no-ops.
  const currentGoal = await refreshImprovementGoal(map.id);
  if (map.current_stage === "goal" && !currentGoal) {
    const extracted =
      extractGoalSentence(reply.reply) ??
      (priorAssistantContent ? extractGoalSentence(priorAssistantContent) : null);
    if (extracted) {
      try {
        await saveImprovementGoal(map.id, extracted);
      } catch {
        // ignore — malformed extraction; coach will re-propose
      }
    }
  }

  // Safety net: if the coachee affirmed a proposed goal and the coach
  // forgot to emit advance_stage, advance for them. Re-read the goal in
  // case the extractor above just saved it in this same turn.
  const goalNow = await refreshImprovementGoal(map.id);
  if (
    map.current_stage === "goal" &&
    goalNow &&
    reply.action?.type !== "advance_stage" &&
    looksAffirmative(parsed.data.text)
  ) {
    try {
      await advanceStage(map.id, "goal", "behaviors");
    } catch {
      // ignore — already advanced or race
    }
  }

  revalidatePath(`/itc/${map.id}`);
  return { ok: true };
}

async function refreshImprovementGoal(mapId: string): Promise<string | null> {
  const m = await getMapById(mapId);
  return m?.improvement_goal ?? null;
}

// Pull the first "I'm committed to getting better at ..." sentence out of a
// coach reply so we can save the goal even when the model skips propose_goal.
// Captures from the stem to the first period that's followed by a quote,
// whitespace, or end-of-string — this avoids getting tripped by the
// apostrophe inside "I'm" itself.
function extractGoalSentence(text: string): string | null {
  const stemIdx = text.toLowerCase().indexOf(GOAL_STEM.toLowerCase());
  if (stemIdx === -1) return null;
  const tail = text.slice(stemIdx);
  const match = tail.match(/^([^\n]*?\.)(?=["'”’\s]|$)/);
  if (!match) return null;
  const cleaned = match[1].trim();
  return cleaned.length > GOAL_STEM.length + 2 ? cleaned : null;
}

// Guard around the coach call: filters out empty replies and consecutive
// duplicates (both were seen in a real session). On dedupe collision we
// give the coach ONE regen with a nudge to say something different.
async function runItcCoachTurnWithGuards(
  input: Parameters<typeof runItcCoachTurn>[0] & { priorAssistantContent: string | null },
) {
  const { priorAssistantContent, ...coachInput } = input;
  const first = await runItcCoachTurn(coachInput);
  const isEmpty = first.reply.trim().length === 0;
  const isDupe =
    priorAssistantContent !== null &&
    first.reply.trim() === priorAssistantContent.trim();
  if (!isEmpty && !isDupe) return first;

  const nudge = isEmpty
    ? "Your previous attempt returned empty. Produce a real reply this time."
    : "Your previous attempt duplicated the last assistant message verbatim. Say something different that moves the work forward.";
  const regenerated = await runItcCoachTurn({
    ...coachInput,
    history: [
      ...coachInput.history,
      { role: "assistant", content: first.reply || "(empty)" },
      { role: "user", content: `[system nudge] ${nudge}` },
    ],
  });
  // If the regen still fails, take it anyway — the plain-text fallback
  // inside runItcCoachTurn guarantees a non-empty reply.
  return regenerated;
}

// Very permissive affirmation detector — the only cost of a false positive
// is auto-advancing to behaviors, which the coachee can still walk back.
function looksAffirmative(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?,]+$/g, "");
  if (t.length === 0 || t.length > 60) return false;
  const affirmations = [
    "y", "ya", "ye", "yes", "yeah", "yep", "yup", "yessir",
    "ok", "okay", "kk", "k",
    "sure", "sounds good", "sounds great", "good", "great", "perfect",
    "lock it in", "lock it", "locked", "lock",
    "do it", "let's do it", "lets do it", "let's go", "lets go",
    "agreed", "agree", "confirm", "confirmed",
    "yes please", "yes lock it", "yes lock it in",
    "that works", "works for me", "fine", "sounds right",
    "👍", "✅", "yes 👍",
  ];
  return affirmations.includes(t);
}

async function applyCoachAction(
  mapId: string,
  currentStage: ItcStage,
  action: CoachAction,
): Promise<void> {
  switch (action.type) {
    case "propose_goal": {
      if (currentStage !== "goal") return; // silent no-op if out of order
      if (!hasGoalStem(action.text)) {
        throw new Error(`Coach proposed a goal without the required stem.`);
      }
      await saveImprovementGoal(mapId, action.text);
      return;
    }
    case "propose_behavior": {
      if (currentStage !== "behaviors") return;
      await addBehavior(mapId, action.text, "suggested");
      return;
    }
    case "suggest_behaviors": {
      // Suggestions are surfaced in the reply text; do not persist as
      // behaviors until the user picks one via acceptSuggestedBehavior.
      return;
    }
    case "prune_behaviors": {
      if (currentStage !== "behaviors") return;
      const all = await listBehaviors(mapId);
      // keep_indices are 1-based positions into the same order the coach
      // saw in its context block, which is the same order listBehaviors
      // returns (sort_order asc, created_at asc).
      const keepIds: string[] = [];
      for (const idx of action.keep_indices) {
        const b = all[idx - 1];
        if (b) keepIds.push(b.id);
      }
      if (keepIds.length === 0) {
        throw new Error(`Prune must keep at least one behavior.`);
      }
      await pruneBehaviors(mapId, keepIds);
      return;
    }
    case "advance_stage": {
      await advanceStage(mapId, currentStage, action.to);
      return;
    }
  }
}

const acceptBehaviorSchema = z.object({
  map_id: z.string().uuid(),
  text: z.string().min(1).max(500),
});

export async function acceptBehavior(formData: FormData): Promise<SendMessageResult> {
  const participant = await requireItcParticipant();
  const parsed = acceptBehaviorSchema.safeParse({
    map_id: formData.get("map_id"),
    text: formData.get("text"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid behavior." };

  const map = await getMapForParticipant(parsed.data.map_id, participant.id);
  if (!map) return { ok: false, reason: "Map not found." };
  if (map.current_stage !== "behaviors") {
    return { ok: false, reason: "Not on the behaviors stage." };
  }

  await addBehavior(map.id, parsed.data.text, "user");
  revalidatePath(`/itc/${map.id}`);
  return { ok: true };
}

const deleteBehaviorSchema = z.object({
  map_id: z.string().uuid(),
  behavior_id: z.string().uuid(),
});

export async function removeBehavior(formData: FormData): Promise<SendMessageResult> {
  const participant = await requireItcParticipant();
  const parsed = deleteBehaviorSchema.safeParse({
    map_id: formData.get("map_id"),
    behavior_id: formData.get("behavior_id"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid delete." };
  const map = await getMapForParticipant(parsed.data.map_id, participant.id);
  if (!map) return { ok: false, reason: "Map not found." };

  await deleteBehavior(parsed.data.behavior_id, map.id);
  revalidatePath(`/itc/${map.id}`);
  return { ok: true };
}

const toggleSelectedSchema = z.object({
  map_id: z.string().uuid(),
  behavior_id: z.string().uuid(),
  selected: z.boolean(),
});

export async function toggleBehaviorSelected(
  formData: FormData,
): Promise<SendMessageResult> {
  const participant = await requireItcParticipant();
  const parsed = toggleSelectedSchema.safeParse({
    map_id: formData.get("map_id"),
    behavior_id: formData.get("behavior_id"),
    selected: formData.get("selected") === "true",
  });
  if (!parsed.success) return { ok: false, reason: "Invalid toggle." };
  const map = await getMapForParticipant(parsed.data.map_id, participant.id);
  if (!map) return { ok: false, reason: "Map not found." };
  await setBehaviorSelected(parsed.data.behavior_id, map.id, parsed.data.selected);
  revalidatePath(`/itc/${map.id}`);
  return { ok: true };
}

const advanceSchema = z.object({
  map_id: z.string().uuid(),
  to: z.enum([
    "goal",
    "behaviors",
    "worries",
    "commitments",
    "assumptions",
    "review",
    "prioritize",
    "test_design",
    "test_running",
    "results",
    "done",
  ]),
});

export async function advanceMapStage(formData: FormData): Promise<SendMessageResult> {
  const participant = await requireItcParticipant();
  const parsed = advanceSchema.safeParse({
    map_id: formData.get("map_id"),
    to: formData.get("to"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid stage." };

  const map = await getMapForParticipant(parsed.data.map_id, participant.id);
  if (!map) return { ok: false, reason: "Map not found." };

  const target = parsed.data.to as ItcStage;

  // Gate: cannot enter behaviors without a goal.
  if (target === "behaviors" && !map.improvement_goal) {
    return { ok: false, reason: "Save the goal first." };
  }
  // Gate: cannot leave behaviors without at least one behavior.
  if (map.current_stage === "behaviors" && target !== "behaviors") {
    const bs = await listBehaviors(map.id);
    if (bs.length === 0) return { ok: false, reason: "Add at least one behavior first." };
  }

  await advanceStage(map.id, map.current_stage, target);
  revalidatePath(`/itc/${map.id}`);
  return { ok: true };
}
