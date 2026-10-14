import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, format, parseISO } from "date-fns";
import { computeWeekSlots, MISSION_STRUCTURE_MILESTONE, type SlotMission, type WeekSlots } from "./rules";

/** When the restructure shipped. Null only before the migration runs. */
export async function loadMissionCutover(client: SupabaseClient): Promise<string | null> {
  const { data } = await client
    .from("app_milestones")
    .select("at")
    .eq("key", MISSION_STRUCTURE_MILESTONE)
    .maybeSingle();
  return (data as { at: string } | null)?.at ?? null;
}

/** Slot usage for each given week, counted the way the trigger counts. */
export async function loadWeekSlots(
  client: SupabaseClient,
  userId: string,
  weekStarts: string[],
): Promise<WeekSlots[]> {
  if (weekStarts.length === 0) return [];
  const sorted = [...weekStarts].sort();
  const from = sorted[0];
  const to = format(addDays(parseISO(sorted[sorted.length - 1]), 6), "yyyy-MM-dd");
  const [cutover, { data }] = await Promise.all([
    loadMissionCutover(client),
    client
      .from("missions")
      .select("pillar_code, quarterly_goal_id, target_date, status, created_at")
      .eq("user_id", userId)
      .gte("target_date", from)
      .lte("target_date", to),
  ]);
  const rows = (data ?? []) as SlotMission[];
  return weekStarts.map((w) => computeWeekSlots(rows, w, cutover));
}
