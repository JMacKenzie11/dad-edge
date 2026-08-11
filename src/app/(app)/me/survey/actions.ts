"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SubmitSchema = z.object({
  question_set_id: z.string().uuid(),
  context_note: z.string().nullable(),
  responses: z
    .array(
      z.object({
        question_id: z.string().uuid(),
        score: z.number().int().min(1).max(5),
        note: z.string().min(1).max(2000),
      }),
    )
    .min(1),
});

export async function submitSurvey(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };
  const parsed = SubmitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Complete every question with a note." };

  const supabase = await createSupabaseServerClient();
  const { data: inserted, error } = await supabase
    .from("partner_surveys")
    .insert({
      user_id: user.id,
      question_set_id: parsed.data.question_set_id,
      context_note: parsed.data.context_note,
    })
    .select("id")
    .single();
  if (error || !inserted) return { ok: false, error: error?.message ?? "Failed." };

  const rows = parsed.data.responses.map((r) => ({
    survey_id: inserted.id,
    question_id: r.question_id,
    score: r.score,
    note: r.note,
  }));
  const { error: err2 } = await supabase.from("partner_survey_responses").insert(rows);
  if (err2) return { ok: false, error: err2.message };
  redirect(`/me/survey/${inserted.id}`);
}
