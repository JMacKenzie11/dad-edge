"use client";

import Link from "next/link";
import { DOMAIN_PILLARS, PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { DOMAIN_SLOTS_PER_WEEK, GOAL_MISSIONS_PER_WEEK } from "@/lib/missions/rules";
import { MissionSlot } from "./mission-slot";
import type { WeekMission, ActiveGoal } from "./page";

/**
 * "plan" is the normal week: every domain shows its two slots and
 * every goal has an add action. "catch-up" is last week during the
 * grace period: only the missions he already set, so he can close them
 * out. No empty slots, because grace is for finishing what you
 * committed to, not for backdating new commitments onto a week that's
 * already been lived.
 */
export type PlannerMode = "plan" | "catch-up";

/**
 * Weekly view (2026-10-15 restructure), three groups:
 *
 *   1. By domain: Bond, Raise, Amplify, Vitality, Enjoyment, two slots
 *      each, for missions with no goal.
 *   2. Goal missions: grouped under each open goal, with one shared
 *      counter for the five weekly goal-mission slots.
 *   3. Earlier missions: no-goal missions made before the restructure.
 *      The old planner stamped them all Bond without asking, so they
 *      don't sit in the Bond row or count against its slots. Only shows
 *      for weeks that have them.
 *
 * The page sorts missions into these groups (page.tsx); this component
 * only lays them out. The weekly-cap trigger is what actually enforces
 * the counts shown here.
 */
export function WeeklyPlanner({
  communityId,
  weekDates,
  weekLabel,
  goals,
  domainMissions,
  goalMissions,
  closedGoalMissions,
  earlierMissions,
  carriedForwardIds,
  todayISO,
  quarterCountdown,
  mode = "plan",
  readOnly,
}: {
  communityId: string | null;
  weekDates: string[];
  /** "this week", "next week" or "last week", for the counters. */
  weekLabel: string;
  goals: ActiveGoal[];
  domainMissions: WeekMission[];
  /** Missions under one of `goals`. */
  goalMissions: WeekMission[];
  /** Missions under a goal that has since closed. Shown so they can
   *  still be completed; they count toward the goal-mission total. */
  closedGoalMissions: WeekMission[];
  earlierMissions: WeekMission[];
  /** Mission IDs that already have a carry-forward child, so → NEXT
   *  WEEK is disabled on rows that have already been carried. */
  carriedForwardIds: Set<string>;
  /** Today in the member's own timezone (yyyy-MM-dd). */
  todayISO: string;
  /** "Q4 ends in 78 days." */
  quarterCountdown: string;
  mode?: PlannerMode;
  readOnly: boolean;
}) {
  const catchUp = mode === "catch-up";
  const goalCount = goalMissions.length + closedGoalMissions.length;
  const goalSlotsOpen = goalCount < GOAL_MISSIONS_PER_WEEK;
  const shared = { weekDates, communityId, carriedForwardIds, todayISO, mode, readOnly };

  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="by-domain">
        <div>
          <h2 id="by-domain" className="font-heading text-lg">
            {weekLabel[0].toUpperCase() + weekLabel.slice(1)} by domain
          </h2>
          <p className="text-sm text-[color:var(--color-text-muted)]">
            Two missions in each domain, no goal needed.
          </p>
        </div>
        <div className="space-y-3">
          {DOMAIN_PILLARS.map((p) => {
            const missions = domainMissions.filter((m) => m.pillar_code === p.code);
            if (catchUp && missions.length === 0) return null;
            // Never fewer than two rows; more only if a week somehow
            // holds more (the trigger stops that for new missions).
            const slots: Array<WeekMission | null> = catchUp
              ? missions
              : Array.from({ length: Math.max(DOMAIN_SLOTS_PER_WEEK, missions.length) }, (_, i) => missions[i] ?? null);
            return (
              <GroupCard
                key={p.code}
                accent={p.colorVar}
                title={p.label.toUpperCase()}
                meta={`${Math.min(missions.length, DOMAIN_SLOTS_PER_WEEK)} of ${DOMAIN_SLOTS_PER_WEEK}`}
              >
                {slots.map((slot, i) => (
                  <MissionSlot
                    key={slot?.id ?? `empty-${p.code}-${i}`}
                    {...shared}
                    mission={slot}
                    slotIndex={i}
                    goalId={null}
                    pillarCode={p.code as PillarCode}
                    addLabel={`+ ADD A ${p.label.toUpperCase()} MISSION`}
                    carriedForward={slot ? carriedForwardIds.has(slot.id) : false}
                  />
                ))}
              </GroupCard>
            );
          })}
          {catchUp && domainMissions.length === 0 ? (
            <p className="text-sm text-[color:var(--color-text-muted)]">No domain missions last week.</p>
          ) : null}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="goal-missions">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="goal-missions" className="font-heading text-lg">
              Goal missions
            </h2>
            <p
              className="text-sm"
              style={{ color: goalCount > GOAL_MISSIONS_PER_WEEK ? "var(--color-warning)" : "var(--color-text-muted)" }}
            >
              {goalCount} of {GOAL_MISSIONS_PER_WEEK} goal missions {weekLabel}
              {goalCount > GOAL_MISSIONS_PER_WEEK ? ". They were set before the five-mission limit, so they stay." : "."}
            </p>
          </div>
          <Link href="/goals" className="font-heading text-xs tracking-widest text-[color:var(--color-primary)] hover:underline">
            YOUR GOALS →
          </Link>
        </div>

        {goals.length === 0 && closedGoalMissions.length === 0 ? (
          <div className="p-5 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
            <p className="text-sm text-[color:var(--color-text-muted)]">
              You don&apos;t have a goal this quarter. Missions under a goal show up here once you set one.
            </p>
            <Link
              href="/goals"
              className="inline-flex mt-3 h-10 px-4 items-center rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest"
            >
              SET A GOAL
            </Link>
          </div>
        ) : null}

        {goals.map((g, gi) => {
          const p = PILLAR_BY_CODE[g.focus_area];
          const missions = goalMissions.filter((m) => m.quarterly_goal_id === g.id);
          if (catchUp && missions.length === 0) return null;
          return (
            <GroupCard
              key={g.id}
              accent={p.colorVar}
              title={`GOAL ${gi + 1} · ${p.label.toUpperCase()}`}
              meta={quarterCountdown}
              subtitle={g.desired_end_state}
              badge={g.source === "itc" ? "From your ITC map" : null}
            >
              {missions.map((m, i) => (
                <MissionSlot
                  key={m.id}
                  {...shared}
                  mission={m}
                  slotIndex={i}
                  goalId={g.id}
                  pillarCode={g.focus_area}
                  carriedForward={carriedForwardIds.has(m.id)}
                />
              ))}
              {!catchUp && goalSlotsOpen ? (
                <MissionSlot
                  key={`add-${g.id}-${missions.length}`}
                  {...shared}
                  mission={null}
                  slotIndex={missions.length}
                  goalId={g.id}
                  pillarCode={g.focus_area}
                  addLabel="+ ADD A GOAL MISSION"
                  carriedForward={false}
                />
              ) : null}
              {!catchUp && !goalSlotsOpen ? (
                <li className="px-4 py-3 text-[11px] text-[color:var(--color-text-muted)] bg-[color:var(--color-bg)]">
                  All five goal missions are set {weekLabel}.
                </li>
              ) : null}
            </GroupCard>
          );
        })}

        {closedGoalMissions.length > 0 ? (
          <GroupCard accent="var(--color-border)" title="CLOSED GOALS" meta={`${closedGoalMissions.length}`}
            subtitle="Missions under a goal you've since closed. You can still complete them.">
            {closedGoalMissions.map((m, i) => (
              <MissionSlot
                key={m.id}
                {...shared}
                mission={m}
                slotIndex={i}
                goalId={m.quarterly_goal_id}
                pillarCode={m.pillar_code}
                allowCarry={false}
                carriedForward={carriedForwardIds.has(m.id)}
              />
            ))}
          </GroupCard>
        ) : null}
      </section>

      {earlierMissions.length > 0 ? (
        <section className="space-y-3" aria-labelledby="earlier-missions">
          <div>
            <h2 id="earlier-missions" className="font-heading text-lg">
              Earlier missions
            </h2>
            <p className="text-sm text-[color:var(--color-text-muted)]">
              You set these before missions were sorted by domain. They count toward your week as before. To repeat one next week, add it under the domain it belongs to.
            </p>
          </div>
          <GroupCard accent="var(--color-text-muted)" title="SET BEFORE THE CHANGE" meta={`${earlierMissions.length}`}>
            {earlierMissions.map((m, i) => (
              <MissionSlot
                key={m.id}
                {...shared}
                mission={m}
                slotIndex={i}
                goalId={null}
                pillarCode={m.pillar_code}
                allowCarry={false}
                carriedForward={carriedForwardIds.has(m.id)}
              />
            ))}
          </GroupCard>
        </section>
      ) : null}
    </div>
  );
}

function GroupCard({
  accent,
  title,
  meta,
  subtitle,
  badge,
  children,
}: {
  accent: string;
  title: string;
  meta: string;
  subtitle?: string | null;
  badge?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] overflow-hidden">
      <header className="px-5 py-3 border-b border-[color:var(--color-border)]" style={{ borderLeft: `3px solid ${accent}` }}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-[11px] font-heading tracking-widest" style={{ color: accent }}>
            {title}
          </p>
          {badge ? (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-heading tracking-widest border border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary)]/15 text-[color:var(--color-primary)]">
              {badge.toUpperCase()}
            </span>
          ) : null}
          <span className="ml-auto text-[11px] text-[color:var(--color-text-muted)]">{meta}</span>
        </div>
        {subtitle ? <p className="text-sm mt-1 text-[color:var(--color-text)]">{subtitle}</p> : null}
      </header>
      {/* Column headers only from `sm` up. Below that each row stacks
          (mission-slot.tsx), so labels in one line above them would
          name columns that are no longer side by side. */}
      <div className="hidden sm:flex px-4 py-1.5 border-b border-[color:var(--color-border)] bg-[color:var(--color-bg)] items-center gap-3 text-[9px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
        <span className="flex-1">MISSION</span>
        <span className="shrink-0 w-[152px] text-center">DAY YOU&rsquo;LL DO IT</span>
        <span className="shrink-0 w-[92px] text-center">COACH</span>
        <span className="shrink-0 w-[192px]" aria-hidden="true" />
      </div>
      <ul className="divide-y divide-[color:var(--color-border)]">{children}</ul>
    </section>
  );
}
