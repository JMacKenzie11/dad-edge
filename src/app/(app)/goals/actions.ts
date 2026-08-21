"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const PillarCodeSchema = z.enum(["B", "R", "A", "V", "E", "M", "A2", "N"]);

const CreateSchema = z.object({
  focus_area: PillarCodeSchema,
  description: z.string().min(4).max(280),
  quarter_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function createGoal(input: unknown) {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("quarterly_goals").insert({
    user_id: user.id,
    focus_area: parsed.data.focus_area,
    description: parsed.data.description.trim(),
    quarter_start: parsed.data.quarter_start,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/goals");
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
