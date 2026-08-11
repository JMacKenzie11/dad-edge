import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { PillarCode } from "@/lib/pillars";
import { canTransitionTo, hasGoalStem, stageIndex, type ItcStage } from "./stage";

export type ItcMap = {
  id: string;
  participant_id: string;
  pillar_code: PillarCode;
  status: "in_progress" | "complete";
  current_stage: ItcStage;
  improvement_goal: string | null;
  created_at: string;
  updated_at: string;
};

export type ItcBehavior = {
  id: string;
  map_id: string;
  sort_order: number;
  text: string;
  source: "user" | "suggested";
  selected: boolean;
  created_at: string;
};

export const MAX_SELECTED_BEHAVIORS = 5;

export type ItcWorry = {
  id: string;
  map_id: string;
  behavior_id: string;
  text: string;
  created_at: string;
};

export type ItcMessage = {
  id: string;
  map_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

export async function findInProgressMap(participantId: string): Promise<ItcMap | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_maps")
    .select("*")
    .eq("participant_id", participantId)
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`findInProgressMap: ${error.message}`);
  return (data as ItcMap | null) ?? null;
}

export async function listAllMaps(): Promise<ItcMap[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_maps")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listAllMaps: ${error.message}`);
  return (data ?? []) as ItcMap[];
}

export async function getMapById(mapId: string): Promise<ItcMap | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_maps")
    .select("*")
    .eq("id", mapId)
    .maybeSingle();
  if (error) throw new Error(`getMapById: ${error.message}`);
  return (data as ItcMap | null) ?? null;
}

export async function getMapForParticipant(
  mapId: string,
  participantId: string,
): Promise<ItcMap | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_maps")
    .select("*")
    .eq("id", mapId)
    .eq("participant_id", participantId)
    .maybeSingle();
  if (error) throw new Error(`getMapForParticipant: ${error.message}`);
  return (data as ItcMap | null) ?? null;
}

export async function deleteMap(mapId: string, participantId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_maps")
    .delete()
    .eq("id", mapId)
    .eq("participant_id", participantId);
  if (error) throw new Error(`deleteMap: ${error.message}`);
}

export async function createMap(
  participantId: string,
  pillarCode: PillarCode,
): Promise<ItcMap> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_maps")
    .insert({ participant_id: participantId, pillar_code: pillarCode })
    .select("*")
    .single();
  if (error || !data) throw new Error(`createMap: ${error?.message ?? "no row"}`);
  return data as ItcMap;
}

/**
 * Save/replace the improvement goal. Enforces the stem — DB has no CHECK for
 * this so the app is the source of truth. Rejects with a caller-friendly
 * message the UI can render.
 */
export async function saveImprovementGoal(mapId: string, text: string): Promise<void> {
  if (!hasGoalStem(text)) {
    throw new Error(`Goal must begin with "I'm committed to getting better at".`);
  }
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_maps")
    .update({ improvement_goal: text.trim() })
    .eq("id", mapId);
  if (error) throw new Error(`saveImprovementGoal: ${error.message}`);
}

export async function listBehaviors(mapId: string): Promise<ItcBehavior[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_behaviors")
    .select("*")
    .eq("map_id", mapId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listBehaviors: ${error.message}`);
  return (data ?? []) as ItcBehavior[];
}

export async function addBehavior(
  mapId: string,
  text: string,
  source: "user" | "suggested",
): Promise<ItcBehavior> {
  const trimmed = text.trim();
  if (trimmed.length < 3) throw new Error("Behavior is too short.");
  const supabase = createSupabaseServiceClient();
  const existing = await listBehaviors(mapId);
  const sortOrder = existing.length;
  const { data, error } = await supabase
    .from("itc_behaviors")
    .insert({ map_id: mapId, text: trimmed, source, sort_order: sortOrder })
    .select("*")
    .single();
  if (error || !data) throw new Error(`addBehavior: ${error?.message ?? "no row"}`);
  return data as ItcBehavior;
}

export async function setBehaviorSelected(
  id: string,
  mapId: string,
  selected: boolean,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_behaviors")
    .update({ selected })
    .eq("id", id)
    .eq("map_id", mapId);
  if (error) throw new Error(`setBehaviorSelected: ${error.message}`);
}

/**
 * Bulk-set selection state to match `keepIds` — everything in the list
 * becomes selected, everything else parked. Used by the coach's
 * prune_behaviors action to accept a chosen keep-set atomically.
 */
export async function pruneBehaviors(
  mapId: string,
  keepIds: string[],
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const all = await listBehaviors(mapId);
  const updates = all.map((b) =>
    supabase
      .from("itc_behaviors")
      .update({ selected: keepIds.includes(b.id) })
      .eq("id", b.id)
      .eq("map_id", mapId),
  );
  const results = await Promise.all(updates);
  const failure = results.find((r) => r.error);
  if (failure?.error) throw new Error(`pruneBehaviors: ${failure.error.message}`);
}

export async function deleteBehavior(id: string, mapId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_behaviors")
    .delete()
    .eq("id", id)
    .eq("map_id", mapId);
  if (error) throw new Error(`deleteBehavior: ${error.message}`);
}

export async function listWorries(mapId: string): Promise<ItcWorry[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_worries")
    .select("*")
    .eq("map_id", mapId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listWorries: ${error.message}`);
  return (data ?? []) as ItcWorry[];
}

export async function listMessages(mapId: string): Promise<ItcMessage[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_messages")
    .select("*")
    .eq("map_id", mapId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listMessages: ${error.message}`);
  return (data ?? []) as ItcMessage[];
}

export async function appendMessage(
  mapId: string,
  role: "user" | "assistant" | "system",
  content: string,
): Promise<ItcMessage> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_messages")
    .insert({ map_id: mapId, role, content })
    .select("*")
    .single();
  if (error || !data) throw new Error(`appendMessage: ${error?.message ?? "no row"}`);
  return data as ItcMessage;
}

export async function advanceStage(mapId: string, from: ItcStage, to: ItcStage): Promise<void> {
  if (!canTransitionTo(from, to)) {
    throw new Error(`Illegal stage transition ${from} → ${to}.`);
  }

  // Data-integrity gates on forward transitions. Backward transitions are
  // always allowed (revisiting to hone) and skip these checks.
  const isForward = stageIndex(to) > stageIndex(from);
  if (isForward) {
    if (to === "worries") {
      const behaviors = await listBehaviors(mapId);
      const selectedCount = behaviors.filter((b) => b.selected).length;
      if (selectedCount < 1) {
        throw new Error("Add at least one behavior before moving to worries.");
      }
      if (selectedCount > MAX_SELECTED_BEHAVIORS) {
        throw new Error(
          `Prune to ${MAX_SELECTED_BEHAVIORS} behaviors before moving to worries. Currently selected: ${selectedCount}.`,
        );
      }
    }
    if (to === "commitments") {
      const [behaviors, worries] = await Promise.all([
        listBehaviors(mapId),
        listWorries(mapId),
      ]);
      const selected = behaviors.filter((b) => b.selected);
      const worriesByBehavior = new Set(worries.map((w) => w.behavior_id));
      const missing = selected.filter((b) => !worriesByBehavior.has(b.id));
      if (missing.length > 0) {
        throw new Error(
          `Every selected behavior needs a worry before moving to commitments. Missing ${missing.length}: ${missing.map((b) => `"${b.text}"`).join(", ")}`,
        );
      }
    }
  }

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_maps")
    .update({ current_stage: to })
    .eq("id", mapId)
    .eq("current_stage", from);
  if (error) throw new Error(`advanceStage: ${error.message}`);
}
