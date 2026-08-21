"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentQuarter } from "@/lib/scoring/quarters";

const PillarCodeSchema = z.enum(["B", "R", "A", "V", "E", "M", "A2", "N"]);

const CreateSchema = z.object({
  focus_area: PillarCodeSchema,
  current_state: z.string().min(4).max(500),
  desired_end_state: z.string().min(4).max(500),
  how_youll_know: z.string().max(500).optional(),
});

export async function createGoal(input: unknown) {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input." };

  // Quarter is server-computed; client never picks a quarter.
  const q = getCurrentQuarter();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("quarterly_goals").insert({
    user_id: user.id,
    focus_area: parsed.data.focus_area,
    current_state: parsed.data.current_state.trim(),
    desired_end_state: parsed.data.desired_end_state.trim(),
    how_youll_know: parsed.data.how_youll_know?.trim() || null,
    quarter_start: q.startIso,
    source: "user",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/goals");
  return { ok: true };
}

const UpdateSchema = z.object({
  goal_id: z.string().uuid(),
  current_state: z.string().min(4).max(500),
  desired_end_state: z.string().min(4).max(500),
  how_youll_know: z.string().max(500).optional(),
});

/**
 * Edit a user-authored goal in place. ITC-sourced goals reject —
 * editing those happens in the ITC tool. Quarter and focus_area
 * are immutable once set (change either → new goal).
 */
export async function updateGoal(input: unknown) {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input." };
  const supabase = await createSupabaseServerClient();
  const { data: goal, error: lookupErr } = await supabase
    .from("quarterly_goals")
    .select("source")
    .eq("id", parsed.data.goal_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupErr) return { ok: false, error: lookupErr.message };
  if (!goal) return { ok: false, error: "Goal not found." };
  if (goal.source === "itc") {
    return {
      ok: false,
      error: "This goal is managed by your ITC map. Edit it in the ITC tool.",
    };
  }
  const { error } = await supabase
    .from("quarterly_goals")
    .update({
      current_state: parsed.data.current_state.trim(),
      desired_end_state: parsed.data.desired_end_state.trim(),
      how_youll_know: parsed.data.how_youll_know?.trim() || null,
    })
    .eq("id", parsed.data.goal_id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/goals");
  revalidatePath(`/goals/${parsed.data.goal_id}`);
  return { ok: true };
}


export async function closeGoal(goalId: string, status: "completed" | "abandoned") {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };
  const supabase = await createSupabaseServerClient();
  // ITC-sourced goals are owned by the ITC map. Closing them from
  // /goals would drift the goal's status from the map's status; the
  // ITC cascade paths (cascadeItcMapClear, ITC-side abandon) are the
  // only legitimate way to close a source='itc' goal.
  const { data: goal, error: lookupErr } = await supabase
    .from("quarterly_goals")
    .select("source")
    .eq("id", goalId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupErr) return { ok: false, error: lookupErr.message };
  if (!goal) return { ok: false, error: "Goal not found." };
  if (goal.source === "itc") {
    return {
      ok: false,
      error: "This goal is managed by your ITC map. Close it in the ITC tool.",
    };
  }
  const { error } = await supabase
    .from("quarterly_goals")
    .update({ status })
    .eq("id", goalId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/goals");
  return { ok: true };
}
