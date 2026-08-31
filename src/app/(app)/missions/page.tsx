import Link from "next/link";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { localMonday, localDate, weekDates } from "@/lib/scoring/week";
import { getCurrentQuarter } from "@/lib/scoring/quarters";
import { QuarterCountdown } from "@/components/ui/quarter-countdown";
import { WeeklyPlanner } from "./weekly-planner";
import type { PillarCode } from "@/lib/pillars";
import { format, addDays } from "date-fns";

export const dynamic = "force-dynamic";

export type WeekMission = {
  id: string;
  description: string;
  pillar_code: PillarCode;
  target_date: string;
  /** All days this mission is scheduled for. Always ≥ 1. Sorted
   *  ascending. target_date is the last entry (deadline). */
  target_dates: string[];
  status: "planned" | "completed" | "missed" | "rolled_over";
  completed_late: boolean;
  quarterly_goal_id: string | null;
  /** Last coach-quality score persisted on save (0-10). Null on legacy
   *  rows that predate the field or on rows that never reached the
   *  minimum length for scoring. Displayed on completed missions as
   *  a static read-only pill. */
  quality_score: number | null;
  /** Set on carry-forward / rollover children — points at the source
   *  mission ID. Loaded so the source row can detect it's already been
   *  carried forward and disable the → NEXT WEEK button. */
  rolled_over_from_mission_id: string | null;
};

export type ActiveGoal = {
  id: string;
  desired_end_state: string;
  focus_area: PillarCode;
  quarter_start: string;
};

export default async function MissionsPage() {
  const { user, readOnly } = await requireAccess();
  const supabase = await createSupabaseServerClient();

  const { data: membership } = await supabase
    .from("memberships")
    .select("community_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  const communityId = (membership as { community_id: string } | null)?.community_id ?? null;

  const monday = localMonday(new Date(), user.timezone);
  const week = weekDates(monday);
  const weekEnd = week[6];

  // Sunday planning: once it's Sunday (last day of this week), also render
  // next week so guys can front-load Monday. Independent of that: we
  // always LOAD through next week — the extra rows let us detect
  // carry-forward children of this-week missions and disable the
  // → NEXT WEEK button on a mission that's already been carried.
  const todayISO = localDate(new Date(), user.timezone);
  const isSunday = todayISO === weekEnd;
  const nextMonday = format(addDays(new Date(`${monday}T00:00:00`), 7), "yyyy-MM-dd");
  const nextWeek = weekDates(nextMonday);
  const rangeEnd = nextWeek[6];

  const q = getCurrentQuarter();

  const [{ data: goals }, { data: missions }] = await Promise.all([
    supabase
      .from("quarterly_goals")
      .select("id, desired_end_state, focus_area, quarter_start")
      .eq("user_id", user.id)
      .eq("status", "active")
      .eq("quarter_start", q.startIso)
      .order("created_at"),
    supabase
      .from("missions")
      .select(
        "id, description, pillar_code, target_date, target_dates, status, completed_late, quarterly_goal_id, quality_score, rolled_over_from_mission_id",
      )
      .eq("user_id", user.id)
      .gte("target_date", monday)
      .lte("target_date", rangeEnd)
      .neq("status", "rolled_over")
      // Insertion order — newest at the bottom. Ordering by
      // target_date reshuffled the grid every time a coachee added a
      // mission or changed a day; scanning "what did I just enter?"
      // became a hunt.
      .order("created_at", { ascending: true }),
  ]);

  const activeGoals = ((goals ?? []) as ActiveGoal[]).slice(0, 2);
  const allMissions = (missions ?? []) as WeekMission[];
  const thisWeekMissions = allMissions.filter((m) => m.target_date <= weekEnd);
  const nextWeekMissions = allMissions.filter((m) => m.target_date >= nextMonday);
  const carriedForwardIds = new Set(
    allMissions
      .map((m) => m.rolled_over_from_mission_id)
      .filter((id): id is string => id != null),
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            WEEK OF {format(new Date(`${monday}T00:00:00`), "MMM d")} · {q.label}
          </p>
          <h1 className="font-heading text-3xl">Missions</h1>
          <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
            5 per goal, 5 unattached, max 15 per week.
          </p>
          <QuarterCountdown className="text-sm text-[color:var(--color-text-muted)] mt-1" />
        </div>
        <Link
          href="/goals"
          className="h-10 px-4 rounded-md border border-[color:var(--color-border)] hover:border-[color:var(--color-primary)] flex items-center font-heading text-xs tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)]"
        >
          MANAGE GOALS
        </Link>
      </header>

      {activeGoals.length === 0 ? (
        <div className="p-6 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-center">
          <p className="font-heading text-lg mb-2">No quarterly goal set.</p>
          <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
            Missions serve goals. Set one first — or set an unattached mission below.
          </p>
          <Link
            href="/goals"
            className="inline-flex h-10 px-4 items-center rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest"
          >
            SET A GOAL
          </Link>
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-xs font-heading tracking-widest text-[color:var(--color-primary)]">
          THIS WEEK · {format(new Date(`${monday}T00:00:00`), "MMM d")}–
          {format(new Date(`${weekEnd}T00:00:00`), "MMM d")}
        </h2>
        <WeeklyPlanner
          communityId={communityId}
          weekMonday={monday}
          weekDates={week}
          activeGoals={activeGoals}
          missions={thisWeekMissions}
          carriedForwardIds={carriedForwardIds}
          readOnly={readOnly}
        />
      </section>

      {isSunday ? (
        <section className="space-y-3">
          <h2 className="text-xs font-heading tracking-widest text-[color:var(--color-primary)]">
            NEXT WEEK · {format(new Date(`${nextMonday}T00:00:00`), "MMM d")}–
            {format(new Date(`${nextWeek[6]}T00:00:00`), "MMM d")}
          </h2>
          <p className="text-[11px] text-[color:var(--color-text-muted)]">
            Front-load Monday. It's Sunday — plan the week before it hits.
          </p>
          <WeeklyPlanner
            communityId={communityId}
            weekMonday={nextMonday}
            weekDates={nextWeek}
            activeGoals={activeGoals}
            missions={nextWeekMissions}
            carriedForwardIds={carriedForwardIds}
            readOnly={readOnly}
          />
        </section>
      ) : null}
    </div>
  );
}
