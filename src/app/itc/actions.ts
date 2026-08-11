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
  findInProgressMap,
  getMapForParticipant,
  listBehaviors,
  listMessages,
  saveImprovementGoal,
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

  let reply;
  try {
    reply = await runItcCoachTurn({
      pillar: map.pillar_code,
      stage: map.current_stage,
      improvementGoal: map.improvement_goal,
      behaviors,
      history: priorHistory,
      userMessage: parsed.data.text,
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

  revalidatePath(`/itc/${map.id}`);
  return { ok: true };
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
    case "advance_stage": {
      await advanceStage(mapId, currentStage, action.to);
      return;
    }
  }
}

const acceptGoalSchema = z.object({
  map_id: z.string().uuid(),
  text: z.string().min(1).max(1000),
});

export async function acceptGoal(formData: FormData): Promise<SendMessageResult> {
  const participant = await requireItcParticipant();
  const parsed = acceptGoalSchema.safeParse({
    map_id: formData.get("map_id"),
    text: formData.get("text"),
  });
  if (!parsed.success) return { ok: false, reason: "Invalid goal." };
  if (!hasGoalStem(parsed.data.text)) {
    return { ok: false, reason: `Goal must begin with "${GOAL_STEM}".` };
  }

  const map = await getMapForParticipant(parsed.data.map_id, participant.id);
  if (!map) return { ok: false, reason: "Map not found." };
  if (map.current_stage !== "goal") {
    return { ok: false, reason: "Goal is already locked." };
  }

  await saveImprovementGoal(map.id, parsed.data.text);
  await advanceStage(map.id, "goal", "behaviors");
  await appendMessage(
    map.id,
    "assistant",
    `Locked. Now — column 2 is about what you actually do (or fail to do) that works against that goal. Concrete behaviors, not feelings. What's the first one that comes to mind?`,
  );
  revalidatePath(`/itc/${map.id}`);
  return { ok: true };
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
