import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardCard } from "./card-shell";
import { SurveyDeltaChart } from "./survey-delta-chart";

/**
 * Card 3.3 — Partner Connection Survey delta. Three states:
 *   Never taken → quiet prompt linking to /me/survey/take
 *   Taken once → single-score readout with invitation to take again
 *   Taken 2+ times → chart + prominent delta callout
 */
export async function SurveyDeltaCard({ userId }: { userId: string }) {
  const supabase = await createSupabaseServerClient();
  const { data: surveys } = await supabase
    .from("partner_surveys")
    .select("id, taken_at, responses:partner_survey_responses(score)")
    .eq("user_id", userId)
    .order("taken_at", { ascending: true });

  const rows = (surveys ?? []) as Array<{
    id: string;
    taken_at: string;
    responses: Array<{ score: number }>;
  }>;

  if (rows.length === 0) {
    return (
      <DashboardCard title="Partner Connection Survey">
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Take the survey with your partner to get a baseline you can compare
          against later.{" "}
          <Link
            href="/me/survey/take"
            className="text-[color:var(--color-primary)] hover:underline"
          >
            Take the survey →
          </Link>
        </p>
      </DashboardCard>
    );
  }

  const compositeOf = (r: (typeof rows)[number]) =>
    r.responses.reduce((n, x) => n + x.score, 0) / Math.max(1, r.responses.length);

  if (rows.length === 1) {
    return (
      <DashboardCard
        title="Partner Connection Survey"
        subtitle="Baseline captured. Take it again to see change over time."
      >
        <div className="flex items-baseline gap-3">
          <p className="font-heading text-4xl">{compositeOf(rows[0]).toFixed(2)}</p>
          <p className="text-xs text-[color:var(--color-text-muted)]">
            out of 5 · taken {rows[0].taken_at.slice(0, 10)}
          </p>
        </div>
        <Link
          href="/me/survey/take"
          className="inline-block mt-3 text-xs text-[color:var(--color-primary)] hover:underline"
        >
          Take it again →
        </Link>
      </DashboardCard>
    );
  }

  const latest = rows[rows.length - 1];
  const prior = rows[rows.length - 2];
  const latestScore = compositeOf(latest);
  const priorScore = compositeOf(prior);
  const delta = latestScore - priorScore;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  const deltaColor =
    delta > 0
      ? "text-emerald-400"
      : delta < 0
        ? "text-[color:var(--color-danger)]"
        : "text-[color:var(--color-text-muted)]";

  const data = rows.map((r) => ({
    taken: r.taken_at.slice(0, 10),
    composite: Number(compositeOf(r).toFixed(2)),
  }));

  return (
    <DashboardCard
      title="Partner Connection Survey"
      subtitle={`${rows.length} surveys on record.`}
    >
      <div className="flex items-baseline gap-3 mb-2">
        <p className={`font-heading text-3xl ${deltaColor}`}>
          {arrow} {delta > 0 ? "+" : ""}
          {delta.toFixed(2)}
        </p>
        <p className="text-xs text-[color:var(--color-text-muted)]">
          since your last survey ({latestScore.toFixed(2)} vs {priorScore.toFixed(2)})
        </p>
      </div>
      <SurveyDeltaChart data={data} />
    </DashboardCard>
  );
}
