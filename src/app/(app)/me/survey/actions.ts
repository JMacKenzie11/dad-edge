"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { finishBlocker } from "@/lib/survey/progress";

/**
 * The Partner Connection Survey saves every answer as he gives it. A survey
 * in progress is a partner_surveys row with completed_at = null; there is at
 * most one per member (partner_surveys_one_draft_per_user). It counts nowhere
 * (history, delta, dashboard, coach) until finishSurvey() stamps it.
 */

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Result = { ok: boolean; error?: string };

const CURRENT_SET_VERSION = "v1";

async function findDraft(supabase: Supabase, userId: string) {
  const { data } = await supabase
    .from("partner_surveys")
    .select("id, question_set_id")
    .eq("user_id", userId)
    .is("completed_at", null)
    .maybeSingle();
  return data as { id: string; question_set_id: string } | null;
}

/** The member's survey in progress, started on his first answer. */
async function getOrCreateDraft(
  supabase: Supabase,
  userId: string,
): Promise<{ id: string; question_set_id: string } | { error: string }> {
  const existing = await findDraft(supabase, userId);
  if (existing) return existing;

  const { data: set } = await supabase
    .from("survey_question_sets")
    .select("id")
    .eq("version", CURRENT_SET_VERSION)
    .maybeSingle();
  if (!set) return { error: "Survey questions have not been seeded." };

  const { data, error } = await supabase
    .from("partner_surveys")
    .insert({ user_id: userId, question_set_id: set.id, completed_at: null })
    .select("id, question_set_id")
    .single();
  if (data) return data as { id: string; question_set_id: string };
  // Two first answers raced; the other one created the draft.
  if (error?.code === "23505") {
    const raced = await findDraft(supabase, userId);
    if (raced) return raced;
  }
  return { error: "Couldn't save. Try again." };
}

const AnswerSchema = z.object({
  question_id: z.string().uuid(),
  score: z.number().int().min(1).max(5).nullable(),
  note: z.string().max(2000),
});

/** Save one question's score and note. Sent whole, so the latest save wins. */
export async function saveSurveyAnswer(input: unknown): Promise<Result> {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };
  const parsed = AnswerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't save that answer." };
  const { question_id, score } = parsed.data;
  const note = parsed.data.note.trim() ? parsed.data.note : null;

  const supabase = await createSupabaseServerClient();
  const draft = await getOrCreateDraft(supabase, user.id);
  if ("error" in draft) return { ok: false, error: draft.error };

  const { data: question } = await supabase
    .from("survey_questions")
    .select("id")
    .eq("id", question_id)
    .eq("question_set_id", draft.question_set_id)
    .maybeSingle();
  if (!question) return { ok: false, error: "That question isn't in this survey." };

  if (score === null && note === null) {
    const { error } = await supabase
      .from("partner_survey_responses")
      .delete()
      .eq("survey_id", draft.id)
      .eq("question_id", question_id);
    return error ? { ok: false, error: "Couldn't save. Try again." } : { ok: true };
  }

  const { error } = await supabase
    .from("partner_survey_responses")
    .upsert({ survey_id: draft.id, question_id, score, note }, { onConflict: "survey_id,question_id" });
  return error ? { ok: false, error: "Couldn't save. Try again." } : { ok: true };
}

export async function saveSurveyContext(input: unknown): Promise<Result> {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };
  const parsed = z.string().max(500).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Keep the context under 500 characters." };

  const supabase = await createSupabaseServerClient();
  const draft = await getOrCreateDraft(supabase, user.id);
  if ("error" in draft) return { ok: false, error: draft.error };
  const { error } = await supabase
    .from("partner_surveys")
    .update({ context_note: parsed.data.trim() || null })
    .eq("id", draft.id)
    .is("completed_at", null);
  return error ? { ok: false, error: "Couldn't save. Try again." } : { ok: true };
}

/** Finish the survey in progress. Checks what's saved, not what the page holds. */
export async function finishSurvey(): Promise<Result> {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };
  const supabase = await createSupabaseServerClient();
  const draft = await findDraft(supabase, user.id);
  if (!draft) return { ok: false, error: "Nothing saved yet. Answer the questions first." };

  const [{ data: questions }, { data: responses }] = await Promise.all([
    supabase.from("survey_questions").select("id").eq("question_set_id", draft.question_set_id),
    supabase
      .from("partner_survey_responses")
      .select("question_id, score, note")
      .eq("survey_id", draft.id),
  ]);
  const blocker = finishBlocker(
    ((questions ?? []) as { id: string }[]).map((q) => q.id),
    (responses ?? []) as { question_id: string; score: number | null; note: string | null }[],
  );
  if (blocker) return { ok: false, error: blocker };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("partner_surveys")
    .update({ completed_at: now, taken_at: now })
    .eq("id", draft.id)
    .is("completed_at", null);
  if (error) return { ok: false, error: "Couldn't finish. Try again." };
  redirect(`/me/survey/${draft.id}`);
}

/** Throw away the survey in progress and every answer in it. */
export async function discardSurvey(): Promise<Result> {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return { ok: false, error: "Read-only account." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("partner_surveys")
    .delete()
    .eq("user_id", user.id)
    .is("completed_at", null);
  if (error) return { ok: false, error: "Couldn't discard. Try again." };
  redirect("/me/survey");
}
