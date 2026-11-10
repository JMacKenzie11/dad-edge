import Link from "next/link";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { format } from "date-fns";
import { answeredCount, type DraftAnswer } from "@/lib/survey/progress";

export const dynamic = "force-dynamic";

type SurveyRow = {
  id: string;
  taken_at: string;
  context_note: string | null;
  responses: { question_id: string; score: number; note: string | null }[];
};

export default async function SurveyIndex() {
  const { user } = await requireAccess();
  const supabase = await createSupabaseServerClient();

  const { data: surveys } = await supabase
    .from("partner_surveys")
    .select(
      "id, taken_at, context_note, responses:partner_survey_responses(question_id, score, note)",
    )
    .eq("user_id", user.id)
    .not("completed_at", "is", null)
    .order("taken_at", { ascending: false });

  const rows = (surveys ?? []) as SurveyRow[];

  // His survey in progress, if any. It isn't in the history until he finishes it.
  const { data: draft } = await supabase
    .from("partner_surveys")
    .select(
      "id, question_set_id, responses:partner_survey_responses(question_id, score, note), questions:survey_question_sets(survey_questions(id))",
    )
    .eq("user_id", user.id)
    .is("completed_at", null)
    .maybeSingle();
  const draftQuestionIds = draft
    ? (
        (Array.isArray(draft.questions) ? draft.questions[0] : draft.questions) as
          | { survey_questions: { id: string }[] }
          | null
      )?.survey_questions.map((q) => q.id) ?? []
    : [];
  const draftDone = draft ? answeredCount(draftQuestionIds, (draft.responses ?? []) as DraftAnswer[]) : 0;
  const latest = rows[0];
  const prior = rows[1];

  const compositeOf = (r: SurveyRow) =>
    r.responses.reduce((n, x) => n + x.score, 0) / Math.max(1, r.responses.length);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          PARTNER CONNECTION SURVEY
        </p>
        <h1 className="font-heading text-3xl">The sit-down</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-2 max-w-md">
          Ask her the questions. Write down her words. Only you see this.
        </p>
      </header>

      {draft ? (
        <Link
          href="/me/survey/take"
          className="block p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-accent)]"
        >
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            IN PROGRESS
          </p>
          <p className="font-heading text-lg mt-1">Pick up where you left off</p>
          <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
            {draftDone} of {draftQuestionIds.length} answered.
          </p>
        </Link>
      ) : (
        <Link href="/me/survey/take" className="inline-block">
          <Button>Start a survey</Button>
        </Link>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No surveys yet." body="The sit-down is itself the intervention." />
      ) : (
        <section>
          <h2 className="font-heading text-lg text-[color:var(--color-accent)] mb-3">History</h2>
          <div className="space-y-3">
            {rows.map((r) => (
              <Link
                key={r.id}
                href={`/me/survey/${r.id}`}
                className="block p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] hover:border-[color:var(--color-accent)]"
              >
                <div className="flex items-baseline justify-between">
                  <p className="font-heading text-sm">
                    {format(new Date(r.taken_at), "PPP")}
                  </p>
                  <p className="font-heading text-2xl text-[color:var(--color-accent)]">
                    {compositeOf(r).toFixed(2)}
                  </p>
                </div>
                {r.context_note ? (
                  <p className="text-xs text-[color:var(--color-text-muted)] mt-1">{r.context_note}</p>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      )}

      {latest && prior ? (
        <section>
          <h2 className="font-heading text-lg text-[color:var(--color-accent)] mb-3">Delta</h2>
          <p className="text-sm text-[color:var(--color-text-muted)] mb-3">
            Composite {compositeOf(latest).toFixed(2)} vs {compositeOf(prior).toFixed(2)} last time —{" "}
            <span
              style={{
                color:
                  compositeOf(latest) > compositeOf(prior)
                    ? "var(--color-success)"
                    : compositeOf(latest) < compositeOf(prior)
                      ? "var(--color-danger)"
                      : "var(--color-text-muted)",
              }}
            >
              {(compositeOf(latest) - compositeOf(prior)).toFixed(2)}
            </span>
          </p>
        </section>
      ) : null}
    </div>
  );
}
