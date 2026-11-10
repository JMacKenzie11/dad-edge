import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DraftAnswer } from "@/lib/survey/progress";
import { TakeSurveyForm } from "./take-survey-form";

export const dynamic = "force-dynamic";

export default async function TakeSurveyPage() {
  const { user, readOnly } = await requireAccess();
  if (readOnly) redirect("/me/survey");
  const supabase = await createSupabaseServerClient();

  const { data: set } = await supabase
    .from("survey_question_sets")
    .select("id, version, questions:survey_questions(id, sort_order, text)")
    .eq("version", "v1")
    .maybeSingle();

  if (!set) {
    return (
      <div className="max-w-2xl mx-auto">
        <p>Survey questions have not been seeded.</p>
      </div>
    );
  }

  // His survey in progress, if any: the page reopens it with every saved answer.
  const { data: draft } = await supabase
    .from("partner_surveys")
    .select("id, context_note, responses:partner_survey_responses(question_id, score, note)")
    .eq("user_id", user.id)
    .is("completed_at", null)
    .maybeSingle();
  const saved = (draft?.responses ?? []) as DraftAnswer[];

  const questions = (set.questions as { id: string; sort_order: number; text: string }[]).sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          THE SIT-DOWN
        </p>
        <h1 className="font-heading text-3xl">Ask her.</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-2 max-w-md">
          Fifteen questions. She answers, you write her words down. Notes matter more than the score.
        </p>
        <p className="text-xs text-[color:var(--color-text-muted)] mt-2 max-w-md">
          Every answer saves as you go. Stop any time and come back to finish.
        </p>
      </header>

      <TakeSurveyForm
        questions={questions}
        initialAnswers={saved}
        initialContext={(draft?.context_note as string | null) ?? ""}
        hasDraft={!!draft}
      />
    </div>
  );
}
