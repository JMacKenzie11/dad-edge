import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PILLARS, type PillarCode } from "@/lib/pillars";
import {
  DAILY_PILLARS_WEEKLY_MAX,
  dailyLivingWeekTotal,
  getEarliestEditableDate,
  localDate,
  localMonday,
  missionScore,
  weekDates,
} from "@/lib/scoring/week";
import { deriveA2ForDate } from "@/lib/scoring/action";
import { CheckinBoard } from "./checkin-board";
import { ReflectionPanel } from "./reflection-panel";
import { DateNavigator } from "./date-navigator";
import { StreakChip } from "@/components/ui/streak-chip";
import { GoalReviewPrompt } from "@/app/(app)/goals/goal-review-prompt";
import { GoalMidpointPrompt } from "@/app/(app)/goals/goal-midpoint-prompt";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { user, readOnly } = await requireAccess();
  const supabase = await createSupabaseServerClient();

  const now = new Date();
  const today = localDate(now, user.timezone);
  const params = await searchParams;
  const requestedDate = params.date;
  const earliest = await getEarliestEditableDate(user.id, now);

  // Validate the ?date= param. Anything out-of-range or malformed
  // silently redirects to the canonical /today so a stale bookmark
  // (pointing at a since-locked day) still works.
  let date = today;
  if (requestedDate && DATE_PARAM_RE.test(requestedDate)) {
    if (requestedDate === today) {
      // Canonicalize — no ?date= for today itself.
      redirect("/today");
    }
    if (requestedDate >= earliest && requestedDate < today) {
      date = requestedDate;
    } else {
      redirect("/today");
    }
  } else if (requestedDate !== undefined) {
    redirect("/today");
  }

  const monday = localMonday(new Date(`${date}T12:00:00Z`), user.timezone);
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
      .eq("date", date)
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
  const dateReflection = (reflection ?? { wins: "", learnings: "" }) as {
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
  // Derived Action value for the day being viewed — drives the
  // disabled tile visual only.
  const actionForDate = deriveA2ForDate(missionRows, date);
  const isToday = date === today;

  const initial: Partial<Record<PillarCode, 0 | 1 | null>> = {};
  for (const p of PILLARS) initial[p.code] = null;
  for (const r of rowsSafe) {
    if (r.date === date && r.pillar_code !== "A2") {
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
      <header className="space-y-3">
        <DateNavigator date={date} today={today} earliest={earliest} />
        <h1 className="font-heading text-3xl">
          {isToday ? "Log today" : format(new Date(`${date}T00:00:00`), "MMM d")}
        </h1>
        <p className="text-sm text-[color:var(--color-text-muted)]">
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
          <StreakChip days={computeEngagementStreak(rowsSafe, date)} label="days" />
        </div>
      </section>

      {/* key={date} forces a remount when the user pages through days
          — otherwise useState(initial) inside these components would
          hold onto the first-mounted day's values because Next.js
          doesn't unmount the segment on a search-param-only nav. */}
      <CheckinBoard
        key={date}
        date={date}
        initial={initial}
        readOnly={readOnly}
        actionValue={actionForDate}
      />

      <ReflectionPanel
        key={date}
        date={date}
        initialWins={dateReflection.wins ?? ""}
        initialLearnings={dateReflection.learnings ?? ""}
        readOnly={readOnly}
      />
    </div>
  );
}

function computeEngagementStreak(
  rows: { date: string; value: number }[],
  endDate: string,
): number {
  // Engagement streak: consecutive prior days ending on endDate with
  // at least one row (any value). When viewing a past day the streak
  // reflects that day's state, not today's — matches the rest of the
  // page's "as of this date" framing.
  const byDate = new Set(rows.map((r) => r.date));
  let streak = 0;
  const cursor = new Date(`${endDate}T00:00:00`);
  while (true) {
    const key = format(cursor, "yyyy-MM-dd");
    if (byDate.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }
  return streak;
}
