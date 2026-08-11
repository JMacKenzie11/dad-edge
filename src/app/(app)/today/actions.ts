"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const PillarCodeSchema = z.enum(["B", "R", "A", "V", "E", "M", "A2", "N"]);
const InputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pillar_code: PillarCodeSchema,
  value: z.union([z.literal(0), z.literal(1), z.null()]),
});

export async function setCheckin(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };

  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input." };
  const { date, pillar_code, value } = parsed.data;

  if (pillar_code === "A2") {
    return {
      ok: false,
      error: "Action is derived from mission completion — not check-in-able.",
    };
  }

  const supabase = await createSupabaseServerClient();

  if (value === null) {
    const { error } = await supabase
      .from("daily_checkins")
      .delete()
      .eq("user_id", user.id)
      .eq("date", date)
      .eq("pillar_code", pillar_code);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/today");
    return { ok: true };
  }

  const { error } = await supabase
    .from("daily_checkins")
    .upsert(
      {
        user_id: user.id,
        date,
        pillar_code,
        value,
        edited_at: new Date().toISOString(),
      },
      { onConflict: "user_id,date,pillar_code" },
    );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/today");
  return { ok: true };
}

const ReflectionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  wins: z.string().max(2000).nullable(),
  learnings: z.string().max(2000).nullable(),
});

/**
 * Autosaved from the Today page. Two optional free-text fields per day —
 * coach context, not community-visible. Empty strings are stored as NULL so
 * the coach's context builder can cleanly skip empty days.
 */
export async function saveReflection(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };
  const parsed = ReflectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input." };

  const wins = parsed.data.wins?.trim() || null;
  const learnings = parsed.data.learnings?.trim() || null;
  const supabase = await createSupabaseServerClient();

  if (!wins && !learnings) {
    const { error } = await supabase
      .from("daily_reflections")
      .delete()
      .eq("user_id", user.id)
      .eq("date", parsed.data.date);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { error } = await supabase.from("daily_reflections").upsert(
    {
      user_id: user.id,
      date: parsed.data.date,
      wins,
      learnings,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,date" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
