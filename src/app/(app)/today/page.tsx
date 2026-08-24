import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PILLARS, type PillarCode } from "@/lib/pillars";
import {
  DAILY_PILLARS_WEEKLY_MAX,
  dailyLivingWeekTotal,
  localDate,
  localMonday,
  missionScore,
  weekDates,
} from "@/lib/scoring/week";
import { deriveA2ForDate } from "@/lib/scoring/action";
import { CheckinBoard } from "./checkin-board";
import { ReflectionPanel } from "./reflection-panel";
import { StreakChip } from "@/components/ui/streak-chip";
import { GoalReviewPrompt } from "@/app/(app)/goals/goal-review-prompt";
import { GoalMidpointPrompt } from "@/app/(app)/goals/goal-midpoint-prompt";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const { user, readOnly } = await requireAccess();
  const supabase = await createSupabaseServerClient();

  const today = localDate(new Date(), user.timezone);
  const monday = localMonday(new Date(), user.timezone);
  const week = weekDates(monday);

  const [
    { data: rows },
    { data: missions },
    { data: reflection },
    { data: reviewGoals },
    { data: midpointGoals },
  ] = await Promise.all([
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
    supabase
      .from("quarterly_goals")
      .select("id, desired_end_state, focus_area")
      .eq("user_id", user.id)
      .eq("status", "active")
      .eq("source", "user")
      .is("midpoint_check_answer", null)
      .not("midpoint_check_at", "is", null)
      .lte("midpoint_check_at", today),
  ]);
  const todayReflection = (reflection ?? { wins: "", learnings: "" }) as {
    wins: string | null;
    learnings: string | null;
  };

  const missionRows = (missions ?? []) as { target_date: string; status: string }[];
  const rowsSafe = (rows ?? []) as { date: string; pillar_code: PillarCode; value: 0 | 1 }[];

  // Daily total counts the 7 manually-checkable pillars only.
  // Action is scored via completed missions (see missionScore below).
  const weekTotal = dailyLivingWeekTotal(rowsSafe);
  const missions_ = missionScore(missionRows, week);
  const combinedTotal = weekTotal + missions_.completed;
  const combinedMax = DAILY_PILLARS_WEEKLY_MAX + missions_.planned;
  // Today's derived Action value drives the disabled tile visual only.
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
  const midpointGoalsSafe = ((midpointGoals ?? []) as Array<{
    id: string;
    desired_end_state: string;
    focus_area: PillarCode;
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

      {midpointGoalsSafe.map((g) => (
        <GoalMidpointPrompt key={`midpoint-${g.id}`} goal={g} />
      ))}

      <section className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
              THIS WEEK
            </p>
            <div className="grid grid-cols-3 gap-4 mt-1">
              <div>
                <p className="font-heading text-3xl leading-none">
                  {weekTotal}
                  <span className="text-sm text-[color:var(--color-text-muted)]">
                    /{DAILY_PILLARS_WEEKLY_MAX}
                  </span>
                </p>
                <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mt-1">
                  DAILY
                </p>
              </div>
              <div>
                <p className="font-heading text-3xl leading-none">
                  {missions_.completed}
                  <span className="text-sm text-[color:var(--color-text-muted)]">
                    /{missions_.planned}
                  </span>
                </p>
                <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mt-1">
                  MISSIONS
                </p>
              </div>
              <div>
                <p className="font-heading text-3xl leading-none text-[color:var(--color-accent)]">
                  {combinedTotal}
                  <span className="text-sm text-[color:var(--color-text-muted)]">
                    /{combinedMax}
                  </span>
                </p>
                <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mt-1">
                  TOTAL
                </p>
              </div>
            </div>
          </div>
          <StreakChip days={computeEngagementStreak(rowsSafe, today)} label="days" />
        </div>
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
