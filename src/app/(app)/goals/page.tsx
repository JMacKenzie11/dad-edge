import Link from "next/link";
import { currentUserHasItcAccess, requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NewGoalForm } from "./new-goal-form";
import { GoalCard } from "./goal-card";
import { GoalReviewPrompt } from "./goal-review-prompt";
import { GoalMidpointPrompt } from "./goal-midpoint-prompt";
import { EmptyState } from "@/components/ui/empty-state";
import { QuarterCountdown } from "@/components/ui/quarter-countdown";
import { getCurrentQuarter } from "@/lib/scoring/quarters";
import type { PillarCode } from "@/lib/pillars";
import { PILLAR_BY_CODE } from "@/lib/pillars";

export const dynamic = "force-dynamic";

export type Goal = {
  id: string;
  focus_area: PillarCode;
  quarter_start: string;
  status: "active" | "completed" | "abandoned" | "needs_review";
  source: "user" | "itc";
  current_state: string | null;
  desired_end_state: string;
  midpoint_check_at: string | null;
  midpoint_check_answer: string | null;
  retrospective_what_happened: string | null;
  retrospective_what_learned: string | null;
  completed_missions: number;
  total_missions: number;
};

/** Cap on user-authored active goals per quarter. Mirrors the DB
 *  trigger's split cap (see 20260826000001_goal_source_and_split_cap). */
const USER_GOAL_SLOTS = 2;

export default async function GoalsPage() {
  const { user, readOnly } = await requireAccess();
  const supabase = await createSupabaseServerClient();
  const service = createSupabaseServiceClient();
  const q = getCurrentQuarter();

  const { data } = await supabase
    .from("quarterly_goals")
    .select(
      "id, focus_area, quarter_start, status, source, current_state, desired_end_state, midpoint_check_at, midpoint_check_answer, retrospective_what_happened, retrospective_what_learned",
    )
    .eq("user_id", user.id)
    .order("quarter_start", { ascending: false });

  const raw = (data ?? []) as Omit<Goal, "completed_missions" | "total_missions">[];

  // Fetch mission counts per goal (one query, aggregate client-side).
  const goalIds = raw.map((g) => g.id);
  const { data: missionRows } = goalIds.length
    ? await supabase
        .from("missions")
        .select("quarterly_goal_id, status")
        .in("quarterly_goal_id", goalIds)
        .eq("user_id", user.id)
    : { data: [] };
  const missionCountsByGoal = new Map<string, { completed: number; total: number }>();
  for (const m of (missionRows ?? []) as Array<{ quarterly_goal_id: string; status: string }>) {
    const bucket = missionCountsByGoal.get(m.quarterly_goal_id) ?? {
      completed: 0,
      total: 0,
    };
    // Exclude rolled_over from total, matching mission scoring elsewhere.
    if (m.status === "rolled_over") continue;
    bucket.total += 1;
    if (m.status === "completed") bucket.completed += 1;
    missionCountsByGoal.set(m.quarterly_goal_id, bucket);
  }

  const rows: Goal[] = raw.map((g) => ({
    ...g,
    completed_missions: missionCountsByGoal.get(g.id)?.completed ?? 0,
    total_missions: missionCountsByGoal.get(g.id)?.total ?? 0,
  }));

  const active = rows.filter(
    (g) => g.status === "active" || g.status === "needs_review",
  );
  const closed = rows.filter(
    (g) => g.status === "completed" || g.status === "abandoned",
  );
  const activeUserGoalsThisQuarter = active.filter(
    (g) => g.source === "user" && g.quarter_start === q.startIso,
  ).length;
  const userSlotsRemaining = Math.max(
    0,
    USER_GOAL_SLOTS - activeUserGoalsThisQuarter,
  );

  const activeUserGoals = active.filter((g) => g.source === "user");
  const activeItcGoal = active.find((g) => g.source === "itc") ?? null;

  // Adaptive-goal section only exists for users with ITC access. Users
  // without it never see the header / empty-state / card at all — no
  // reason to advertise a feature they can't reach.
  const hasItcAccess = await currentUserHasItcAccess();

  // Look up the ITC map + stage for the adaptive section. Two paths:
  //
  //   1. Preferred: the quarterly_goals row (source='itc') has a
  //      linked itc_maps row (itc_maps.quarterly_goal_id = goal.id).
  //      This is the path new maps take via syncItcGoalToTracker.
  //
  //   2. Fallback: look up any in-progress map for the user's linked
  //      participant, regardless of quarterly_goal_id. This surfaces
  //      migrated maps that never went through syncItcGoalToTracker
  //      (goal saved pre-user-link, or sync failed silently). Without
  //      this, an active /itc map would be invisible on /goals.
  //
  // Service client used because itc_maps is not RLS-scoped to the
  // tracker user id.
  let adaptive: {
    mapId: string;
    stage: string;
    pillarCode: PillarCode;
    goalText: string;
    behaviorCount: number;
    testCount: number;
  } | null = null;
  if (hasItcAccess) {
    type ItcRow = {
      id: string;
      current_stage: string;
      pillar_code: PillarCode;
      improvement_goal: string | null;
    };
    let itcRow: ItcRow | null = null;

    if (activeItcGoal) {
      const { data } = await service
        .from("itc_maps")
        .select("id, current_stage, pillar_code, improvement_goal")
        .eq("quarterly_goal_id", activeItcGoal.id)
        .maybeSingle();
      itcRow = (data as ItcRow | null) ?? null;
    }

    if (!itcRow) {
      const { data: participant } = await service
        .from("itc_participants")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      const participantId = (participant as { id: string } | null)?.id ?? null;
      if (participantId) {
        const { data } = await service
          .from("itc_maps")
          .select("id, current_stage, pillar_code, improvement_goal")
          .eq("participant_id", participantId)
          .eq("status", "in_progress")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        itcRow = (data as ItcRow | null) ?? null;
      }
    }

    if (itcRow) {
      const [{ count: behaviorCount }, { count: testCount }] = await Promise.all([
        service
          .from("itc_behaviors")
          .select("id", { count: "exact", head: true })
          .eq("map_id", itcRow.id),
        service
          .from("itc_tests")
          .select("id", { count: "exact", head: true })
          .eq("map_id", itcRow.id),
      ]);
      adaptive = {
        mapId: itcRow.id,
        stage: itcRow.current_stage,
        pillarCode: itcRow.pillar_code,
        goalText:
          itcRow.improvement_goal ??
          activeItcGoal?.desired_end_state ??
          "Goal not yet locked",
        behaviorCount: behaviorCount ?? 0,
        testCount: testCount ?? 0,
      };
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          THIS QUARTER
        </p>
        <h1 className="font-heading text-3xl">Quarterly goals</h1>
        <QuarterCountdown className="text-sm text-[color:var(--color-text-muted)] mt-1" />
      </header>

      {!readOnly ? (
        <NewGoalForm userSlotsRemaining={userSlotsRemaining} />
      ) : null}

      {active
        .filter((g) => g.status === "needs_review")
        .map((g) => (
          <GoalReviewPrompt
            key={`review-${g.id}`}
            goal={{
              id: g.id,
              desired_end_state: g.desired_end_state,
              focus_area: g.focus_area,
              quarter_start: g.quarter_start,
              source: g.source,
            }}
          />
        ))}

      {active
        .filter(
          (g) =>
            g.status === "active" &&
            g.source === "user" &&
            g.midpoint_check_at !== null &&
            g.midpoint_check_answer === null &&
            g.midpoint_check_at <= todayIso(),
        )
        .map((g) => (
          <GoalMidpointPrompt
            key={`midpoint-${g.id}`}
            goal={{
              id: g.id,
              desired_end_state: g.desired_end_state,
              focus_area: g.focus_area,
            }}
          />
        ))}

      <section>
        <h2 className="font-heading text-lg text-[color:var(--color-accent)] mb-3">
          Goals
        </h2>
        {activeUserGoals.length === 0 ? (
          <EmptyState title="Nothing on the horizon." body="Pick one pillar. Write one goal." />
        ) : (
          <div className="space-y-3">
            {activeUserGoals.map((g) => (
              <GoalCard key={g.id} goal={g} readOnly={readOnly} />
            ))}
          </div>
        )}
      </section>

      {hasItcAccess ? (
        <section>
          <h2 className="font-heading text-lg text-[color:var(--color-accent)] mb-3">
            Improvement goal
          </h2>
          {adaptive ? (
            <AdaptiveGoalCard adaptive={adaptive} />
          ) : (
            <NoImprovementMapCard />
          )}
        </section>
      ) : null}

      {closed.length > 0 ? (
        <section>
          <h2 className="font-heading text-lg text-[color:var(--color-text-muted)] mb-3">
            Past goals
          </h2>
          <div className="space-y-3">
            {closed.map((g) => (
              <GoalCard key={g.id} goal={g} readOnly />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Empty state for the Improvement Goal section when the user has
 * ITC access but no map yet. Real CTA, not the italic dead-end
 * sentence it replaces — a coachee who reads "if you build one, its
 * goal shows up here" has no way to actually go build one from this
 * page, which is exactly the wayfinding gap that made ITC feel
 * disconnected from the rest of the app.
 */
function NoImprovementMapCard() {
  return (
    <div className="p-5 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
      <p className="font-heading text-base">Start an improvement map</p>
      <p className="text-sm text-[color:var(--color-text-muted)] mt-1 leading-relaxed">
        A 4-column ITC map. The change you want, the behaviors in the
        way, the hidden commitments underneath, and a test to run this
        week. Coach-guided; ~20 minutes to draft.
      </p>
      <Link
        href="/itc"
        className="inline-flex items-center mt-4 h-10 px-4 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest uppercase hover:bg-[color:var(--color-primary)]/90 cursor-pointer transition"
      >
        START AN IMPROVEMENT MAP
      </Link>
    </div>
  );
}

/**
 * Adaptive Goal (ITC map) card. Lean by design: does NOT display the
 * goal text (source of truth is the ITC map itself). Shows current
 * stage, behavior + test counts, and a link into the map.
 */
function AdaptiveGoalCard({
  adaptive,
}: {
  adaptive: {
    mapId: string;
    stage: string;
    pillarCode: PillarCode;
    goalText: string;
    behaviorCount: number;
    testCount: number;
  };
}) {
  const p = PILLAR_BY_CODE[adaptive.pillarCode];
  const stageLabel = adaptive.stage
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <Link
      href={`/itc/${adaptive.mapId}`}
      className="block p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] hover:border-[color:var(--color-primary)] transition-colors"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-1 inline-block h-8 w-1.5 rounded-full"
          style={{ background: p.colorVar }}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] flex items-center gap-2 flex-wrap">
            <span>{p.label.toUpperCase()} · IMPROVEMENT MAP</span>
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest border border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary)]/15 text-[color:var(--color-primary)]">
              {stageLabel}
            </span>
          </p>
          <p className="text-sm mt-2 leading-relaxed">{adaptive.goalText}</p>
          <p className="text-[11px] text-[color:var(--color-text-muted)] mt-2">
            {adaptive.behaviorCount} behavior{adaptive.behaviorCount === 1 ? "" : "s"} mapped ·{" "}
            {adaptive.testCount} test{adaptive.testCount === 1 ? "" : "s"} designed
          </p>
          <p className="text-xs text-[color:var(--color-primary)] mt-2">
            Open the map →
          </p>
        </div>
      </div>
    </Link>
  );
}
