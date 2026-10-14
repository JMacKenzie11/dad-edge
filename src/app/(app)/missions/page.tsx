import Link from "next/link";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getEditWindow, weekDates } from "@/lib/scoring/week";
import { daysUntilQuarterEnd, getCurrentQuarter } from "@/lib/scoring/quarters";
import { QuarterCountdown } from "@/components/ui/quarter-countdown";
import { isEarlierUnattached, relativeWeek } from "@/lib/missions/rules";
import { loadMissionCutover } from "@/lib/missions/slots";
import { WeeklyPlanner } from "./weekly-planner";
import { WeekNavigator } from "./week-navigator";
import { resolveMissionWeek } from "./week-nav";
import type { PillarCode } from "@/lib/pillars";
import { redirect } from "next/navigation";
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
  created_at: string;
};

export type ActiveGoal = {
  id: string;
  desired_end_state: string;
  focus_area: PillarCode;
  quarter_start: string;
  source: "user" | "itc";
};

/** Shift a yyyy-MM-dd Monday by whole weeks. */
function shiftWeek(monday: string, weeks: number): string {
  return format(addDays(new Date(`${monday}T00:00:00`), weeks * 7), "yyyy-MM-dd");
}

export default async function MissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
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

  // One source of truth for "how far back can this man still go" —
  // shared with /today so the two surfaces never disagree about
  // whether last week is open.
  const editWindow = await getEditWindow(user.id);
  const thisMonday = editWindow.thisMonday;
  const lastMonday = editWindow.lastMonday;
  const nextMonday = shiftWeek(thisMonday, 1);
  const todayISO = editWindow.today;
  const thisWeekEnd = weekDates(thisMonday)[6];
  // Sunday planning: on the last day of the week, next week opens up
  // so guys can front-load Monday.
  const isSunday = todayISO === thisWeekEnd;

  // Which weeks the arrows can reach. Back only while the community
  // grace period is still open; forward only on a Sunday.
  const canGoBack = editWindow.lastWeekOpen;
  const canGoForward = isSunday;

  // Resolve ?week=. Anything out of range or malformed drops back to
  // the canonical /missions, so a stale bookmark pointing at a
  // since-locked week still lands somewhere useful.
  const params = await searchParams;
  const resolved = resolveMissionWeek({
    requested: params.week,
    thisMonday,
    lastMonday,
    nextMonday,
    canGoBack,
    canGoForward,
  });
  if ("redirect" in resolved) redirect("/missions");
  const { viewMonday, isLastWeek, isNextWeek, prevMonday } = resolved;
  const nextWeekMonday = resolved.nextMonday;
  const week = weekDates(viewMonday);
  const weekEnd = week[6];

  const q = getCurrentQuarter();

  // Load the viewed week plus the one after it. The trailing week is
  // never rendered — it's there so a mission that's already been
  // carried forward can disable its own → NEXT WEEK button.
  const loadEnd = weekDates(shiftWeek(viewMonday, 1))[6];

  // Goals that can still take missions: active, or in their quarter-end
  // review week (the trigger accepts both). No cap on how many.
  const [{ data: goals }, { data: missions }, cutover] = await Promise.all([
    supabase
      .from("quarterly_goals")
      .select("id, desired_end_state, focus_area, quarter_start, source")
      .eq("user_id", user.id)
      .in("status", ["active", "needs_review"])
      .order("created_at"),
    supabase
      .from("missions")
      .select(
        "id, description, pillar_code, target_date, target_dates, status, completed_late, quarterly_goal_id, quality_score, rolled_over_from_mission_id, created_at",
      )
      .eq("user_id", user.id)
      .gte("target_date", viewMonday)
      .lte("target_date", loadEnd)
      .neq("status", "rolled_over")
      // Insertion order — newest at the bottom. Ordering by
      // target_date reshuffled the grid every time a coachee added a
      // mission or changed a day; scanning "what did I just enter?"
      // became a hunt.
      .order("created_at", { ascending: true }),
    loadMissionCutover(supabase),
  ]);

  const activeGoals = (goals ?? []) as ActiveGoal[];
  const allMissions = (missions ?? []) as WeekMission[];
  const weekMissions = allMissions.filter((m) => m.target_date <= weekEnd);
  // Abandoned missions (an ITC test he dropped) don't count and don't show.
  const shown = weekMissions.filter((m) => (m.status as string) !== "abandoned");
  const openGoalIds = new Set(activeGoals.map((g) => g.id));
  const earlierMissions = shown.filter((m) => isEarlierUnattached(m, cutover));
  const domainMissions = shown.filter((m) => !m.quarterly_goal_id && !isEarlierUnattached(m, cutover));
  const goalMissions = shown.filter((m) => m.quarterly_goal_id && openGoalIds.has(m.quarterly_goal_id));
  const closedGoalMissions = shown.filter((m) => m.quarterly_goal_id && !openGoalIds.has(m.quarterly_goal_id));
  const daysLeft = daysUntilQuarterEnd();
  const quarterCountdown = `${q.label} ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
  const carriedForwardIds = new Set(
    allMissions
      .map((m) => m.rolled_over_from_mission_id)
      .filter((id): id is string => id != null),
  );

  // Last week is catch-up: the missions he already set, so he can
  // close out anything he finished over the weekend. No empty slots —
  // grace is for finishing what you committed to, not for backdating
  // new commitments onto a week that's already been lived.
  const mode = isLastWeek ? "catch-up" : "plan";

  // The week locks ON lastWeekLocksOn, so the last day he can still
  // touch it is the day before.
  const lastWeekOpenThrough = format(
    addDays(new Date(`${editWindow.lastWeekLocksOn}T00:00:00`), -1),
    "EEE MMM d",
  ).toUpperCase();

  const note = isLastWeek
    ? `LAST WEEK · OPEN THROUGH ${lastWeekOpenThrough}`
    : isNextWeek
      ? "NEXT WEEK · PLAN IT BEFORE IT STARTS"
      : null;

  const hrefFor = (monday: string) =>
    monday === thisMonday ? "/missions" : `/missions?week=${monday}`;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            {q.label}
          </p>
          <h1 className="font-heading text-3xl">Missions</h1>
          <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
            Up to two missions in each domain every week, plus five under your goals.
          </p>
          <QuarterCountdown className="text-sm text-[color:var(--color-text-muted)] mt-1" />
        </div>
      </header>

      <WeekNavigator
        monday={viewMonday}
        sunday={weekEnd}
        prevHref={prevMonday ? hrefFor(prevMonday) : null}
        nextHref={nextWeekMonday ? hrefFor(nextWeekMonday) : null}
        note={note}
      />

      {/* On the current week, say out loud that last week is still
          reachable. The enabled arrow is the affordance, but a man
          who's just lost a weekend of logging shouldn't have to
          discover it. */}
      {canGoBack && !isLastWeek ? (
        <p className="text-[11px] text-[color:var(--color-text-muted)] text-center">
          Last week is open through {lastWeekOpenThrough.toLowerCase()} —{" "}
          <Link
            href={hrefFor(lastMonday)}
            className="text-[color:var(--color-primary)] hover:underline"
          >
            go back to close anything out
          </Link>
          .
        </p>
      ) : null}

      {isSunday && !isNextWeek && !isLastWeek ? (
        <p className="text-[11px] text-[color:var(--color-text-muted)] text-center">
          It&rsquo;s Sunday —{" "}
          <Link
            href={hrefFor(nextMonday)}
            className="text-[color:var(--color-primary)] hover:underline"
          >
            plan next week
          </Link>{" "}
          before it hits.
        </p>
      ) : null}

      {isLastWeek && weekMissions.length === 0 ? (
        <div className="p-6 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-center">
          <p className="text-sm text-[color:var(--color-text-muted)]">
            No missions set last week. Nothing to close out.
          </p>
        </div>
      ) : (
        <WeeklyPlanner
          communityId={communityId}
          weekDates={week}
          weekLabel={relativeWeek(viewMonday, todayISO)}
          goals={activeGoals}
          domainMissions={domainMissions}
          goalMissions={goalMissions}
          closedGoalMissions={closedGoalMissions}
          earlierMissions={earlierMissions}
          quarterCountdown={quarterCountdown}
          carriedForwardIds={carriedForwardIds}
          todayISO={todayISO}
          mode={mode}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
