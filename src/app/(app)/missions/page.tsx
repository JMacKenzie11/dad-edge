import Link from "next/link";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { localMonday, localDate, weekDates } from "@/lib/scoring/week";
import { WeeklyPlanner } from "./weekly-planner";
import type { PillarCode } from "@/lib/pillars";
import { format, addDays } from "date-fns";

export const dynamic = "force-dynamic";

export type WeekMission = {
  id: string;
  description: string;
  pillar_code: PillarCode;
  target_date: string;
  status: "planned" | "completed" | "missed" | "rolled_over";
  completed_late: boolean;
  quarterly_goal_id: string | null;
};

export type ActiveGoal = {
  id: string;
  description: string;
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

  // Sunday planning: once it's Sunday (last day of this week), also load next
  // week so guys can front-load Monday.
  const todayISO = localDate(new Date(), user.timezone);
  const isSunday = todayISO === weekEnd;
  const nextMonday = format(addDays(new Date(`${monday}T00:00:00`), 7), "yyyy-MM-dd");
  const nextWeek = weekDates(nextMonday);
  const rangeEnd = isSunday ? nextWeek[6] : weekEnd;

  const now = new Date();
  const qStart = format(
    new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1),
    "yyyy-MM-dd",
  );

  const [{ data: goals }, { data: missions }] = await Promise.all([
    supabase
      .from("quarterly_goals")
      .select("id, description, focus_area, quarter_start")
      .eq("user_id", user.id)
      .eq("status", "active")
      .eq("quarter_start", qStart)
      .order("created_at"),
    supabase
      .from("missions")
      .select(
        "id, description, pillar_code, target_date, status, completed_late, quarterly_goal_id",
      )
      .eq("user_id", user.id)
      .gte("target_date", monday)
      .lte("target_date", rangeEnd)
      .neq("status", "rolled_over")
      .order("target_date", { ascending: true }),
  ]);

  const activeGoals = ((goals ?? []) as ActiveGoal[]).slice(0, 2);
  const allMissions = (missions ?? []) as WeekMission[];
  const thisWeekMissions = allMissions.filter((m) => m.target_date <= weekEnd);
  const nextWeekMissions = allMissions.filter((m) => m.target_date >= nextMonday);

  // Quarter deadline for the header.
  const qEnd = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0);
  const daysToQEnd = Math.max(
    0,
    Math.ceil((qEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            WEEK OF {format(new Date(`${monday}T00:00:00`), "MMM d")} · Q{Math.floor(now.getMonth() / 3) + 1}
          </p>
          <h1 className="font-heading text-3xl">Missions</h1>
          <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
            5 per goal, 5 unattached — max 15 per week. Quarter ends in {daysToQEnd} day
            {daysToQEnd === 1 ? "" : "s"}.
          </p>
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
            readOnly={readOnly}
          />
        </section>
      ) : null}
    </div>
  );
}
