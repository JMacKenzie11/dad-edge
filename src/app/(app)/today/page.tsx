import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PILLARS, type PillarCode } from "@/lib/pillars";
import { localDate, localMonday, weekDates, dailyLivingWeekTotal } from "@/lib/scoring/week";
import { deriveA2ForDate, applyDerivedA2 } from "@/lib/scoring/action";
import { CheckinBoard } from "./checkin-board";
import { ReflectionPanel } from "./reflection-panel";
import { StreakChip } from "@/components/ui/streak-chip";
import { GoalReviewPrompt } from "@/app/(app)/goals/goal-review-prompt";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const { user, readOnly } = await requireAccess();
  const supabase = await createSupabaseServerClient();

  const today = localDate(new Date(), user.timezone);
  const monday = localMonday(new Date(), user.timezone);
  const week = weekDates(monday);

  const [{ data: rows }, { data: missions }, { data: reflection }, { data: reviewGoals }] =
    await Promise.all([
      supabase
        .from("daily_checkins")
        .select("date, pillar_code, value")
        .eq("user_id", user.id)
        .in("date", week),
      supabase
        .from("missions")
        .select("target_date, status")
        .eq("user_id", user.id)
        .in("target_date", week),
      supabase
        .from("daily_reflections")
        .select("wins, learnings")
        .eq("user_id", user.id)
        .eq("date", today)
        .maybeSingle(),
      supabase
        .from("quarterly_goals")
        .select("id, desired_end_state, focus_area, quarter_start, source")
        .eq("user_id", user.id)
        .eq("status", "needs_review"),
    ]);
  const todayReflection = (reflection ?? { wins: "", learnings: "" }) as {
    wins: string | null;
    learnings: string | null;
  };

  const missionRows = (missions ?? []) as { target_date: string; status: string }[];
  const rowsSafe = (rows ?? []) as { date: string; pillar_code: PillarCode; value: 0 | 1 }[];

  // A2 is derived — swap any stored A2 rows for computed ones before scoring.
  const effectiveRows = applyDerivedA2(
    rowsSafe,
    missionRows,
    week,
    (date, value) => ({ date, pillar_code: "A2" as PillarCode, value }),
  );
  const weekTotal = dailyLivingWeekTotal(effectiveRows);
  const actionToday = deriveA2ForDate(missionRows, today);

  const initial: Partial<Record<PillarCode, 0 | 1 | null>> = {};
  for (const p of PILLARS) initial[p.code] = null;
  for (const r of rowsSafe) {
    if (r.date === today && r.pillar_code !== "A2") {
      initial[r.pillar_code as PillarCode] = r.value as 0 | 1;
    }
  }

  const reviewableGoals = ((reviewGoals ?? []) as Array<{
    id: string;
    desired_end_state: string;
    focus_area: PillarCode;
    quarter_start: string;
    source: "user" | "itc";
  }>);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          {format(new Date(`${today}T00:00:00`), "EEEE").toUpperCase()} · {today}
        </p>
        <h1 className="font-heading text-3xl">Log today</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
          Tap to mark done. Tap again to undo.
        </p>
      </header>

      {reviewableGoals.map((g) => (
        <GoalReviewPrompt key={`review-${g.id}`} goal={g} />
      ))}

      <section className="flex items-center justify-between p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
        <div>
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            THIS WEEK
          </p>
          <p className="font-heading text-3xl">
            {weekTotal}
            <span className="text-sm text-[color:var(--color-text-muted)]">/56</span>
          </p>
        </div>
        <StreakChip days={computeEngagementStreak(rowsSafe, today)} label="days" />
      </section>

      <CheckinBoard
        date={today}
        initial={initial}
        readOnly={readOnly}
        actionValue={actionToday}
      />

      <ReflectionPanel
        date={today}
        initialWins={todayReflection.wins ?? ""}
        initialLearnings={todayReflection.learnings ?? ""}
        readOnly={readOnly}
      />
    </div>
  );
}

function computeEngagementStreak(
  rows: { date: string; value: number }[],
  today: string,
): number {
  // Engagement streak: consecutive prior days ending today with at least one row (any value).
  const byDate = new Set(rows.map((r) => r.date));
  let streak = 0;
  const cursor = new Date(`${today}T00:00:00`);
  while (true) {
    const key = format(cursor, "yyyy-MM-dd");
    if (byDate.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }
  return streak;
}
