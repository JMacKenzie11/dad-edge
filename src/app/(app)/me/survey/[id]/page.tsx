import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

type Response = { question_id: string; score: number; note: string | null };

export default async function SurveyDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requireAccess();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: survey } = await supabase
    .from("partner_surveys")
    .select("id, taken_at, context_note, question_set_id, responses:partner_survey_responses(question_id, score, note)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!survey) notFound();

  const { data: questions } = await supabase
    .from("survey_questions")
    .select("id, sort_order, text")
    .eq("question_set_id", survey.question_set_id);

  const qById = new Map(
    (questions ?? []).map((q) => [q.id as string, q as { sort_order: number; text: string }]),
  );
  const responses = ((survey.responses ?? []) as Response[]).sort((a, b) => {
    const oa = qById.get(a.question_id)?.sort_order ?? 0;
    const ob = qById.get(b.question_id)?.sort_order ?? 0;
    return oa - ob;
  });

  const { data: allSurveys } = await supabase
    .from("partner_surveys")
    .select("id, taken_at, responses:partner_survey_responses(question_id, score)")
    .eq("user_id", user.id)
    .order("taken_at", { ascending: false });

  const priorScores = new Map<string, number>();
  const currentTakenAt = survey.taken_at as string;
  const prior = ((allSurveys ?? []) as Array<{
    id: string;
    taken_at: string;
    responses: { question_id: string; score: number }[];
  }>).find((s) => s.taken_at < currentTakenAt);
  if (prior) {
    for (const r of prior.responses) priorScores.set(r.question_id, r.score);
  }

  const composite = responses.reduce((n, r) => n + r.score, 0) / Math.max(1, responses.length);

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          SURVEY · {format(new Date(currentTakenAt), "PPP")}
        </p>
        <h1 className="font-heading text-3xl">Composite {composite.toFixed(2)}</h1>
        {survey.context_note ? (
          <p className="text-sm text-[color:var(--color-text-muted)] mt-1">{survey.context_note as string}</p>
        ) : null}
      </header>

      <ol className="space-y-3">
        {responses.map((r, i) => {
          const q = qById.get(r.question_id);
          const priorScore = priorScores.get(r.question_id);
          const delta = priorScore !== undefined ? r.score - priorScore : null;
          return (
            <li key={r.question_id} className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
              <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
                Q{i + 1}
              </p>
              <p className="text-sm mt-1">{q?.text}</p>
              <div className="flex items-baseline gap-3 mt-2">
                <p className="font-heading text-2xl text-[color:var(--color-accent)]">{r.score}</p>
                {delta !== null ? (
                  <p
                    className="text-xs font-heading"
                    style={{
                      color:
                        delta > 0
                          ? "var(--color-success)"
                          : delta < 0
                            ? "var(--color-danger)"
                            : "var(--color-text-muted)",
                    }}
                  >
                    {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} {Math.abs(delta)} vs prior
                  </p>
                ) : null}
              </div>
              {r.note ? (
                <p className="text-sm text-[color:var(--color-text-muted)] mt-2 italic">&ldquo;{r.note}&rdquo;</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
