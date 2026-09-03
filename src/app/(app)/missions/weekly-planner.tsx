"use client";

import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { MissionSlot } from "./mission-slot";
import type { WeekMission, ActiveGoal } from "./page";

const SLOTS_PER_BUCKET = 5;

type Bucket = {
  key: string;
  headerLabel: string;
  subtitle: string | null;
  pillarCode: PillarCode;
  goalId: string | null;
  goalDescription: string | null;
  accentColor: string;
};

export function WeeklyPlanner({
  communityId,
  weekMonday: _weekMonday,
  weekDates,
  activeGoals,
  missions,
  carriedForwardIds,
  readOnly,
}: {
  communityId: string | null;
  weekMonday: string;
  weekDates: string[];
  activeGoals: ActiveGoal[];
  missions: WeekMission[];
  /** Set of mission IDs that already have a carry-forward child loaded
   *  in the wider load window. Used to disable → NEXT WEEK on rows
   *  that have already been carried, so guys don't spawn duplicates. */
  carriedForwardIds: Set<string>;
  readOnly: boolean;
}) {
  const buckets: Bucket[] = [
    ...activeGoals.map((g, i) => {
      const p = PILLAR_BY_CODE[g.focus_area];
      return {
        key: `goal-${g.id}`,
        headerLabel: `GOAL ${i + 1} · ${p.label.toUpperCase()}`,
        subtitle: g.desired_end_state,
        pillarCode: g.focus_area,
        goalId: g.id,
        goalDescription: g.desired_end_state,
        accentColor: p.colorVar,
      };
    }),
    {
      key: "unattached",
      headerLabel: "BRAVE MAN MISSIONS",
      subtitle: "Missions not tied to a quarterly goal.",
      pillarCode: "B" as PillarCode,
      goalId: null,
      goalDescription: null,
      accentColor: "var(--color-warning)",
    },
  ];

  return (
    <div className="space-y-4">
      {buckets.map((b) => {
        const bucketMissions = missions.filter((m) =>
          b.goalId ? m.quarterly_goal_id === b.goalId : m.quarterly_goal_id === null,
        );
        return (
          <BucketSection
            key={b.key}
            bucket={b}
            missions={bucketMissions}
            carriedForwardIds={carriedForwardIds}
            readOnly={readOnly}
            weekDates={weekDates}
            communityId={communityId}
          />
        );
      })}
    </div>
  );
}

function BucketSection({
  bucket,
  missions,
  carriedForwardIds,
  readOnly,
  weekDates,
  communityId,
}: {
  bucket: Bucket;
  missions: WeekMission[];
  carriedForwardIds: Set<string>;
  readOnly: boolean;
  weekDates: string[];
  communityId: string | null;
}) {
  const filled = missions.length;
  const slots: Array<WeekMission | null> = Array.from({ length: SLOTS_PER_BUCKET }, (_, i) =>
    missions[i] ?? null,
  );
  const slotPillar = bucket.goalId ? bucket.pillarCode : "B";

  return (
    <section className="rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] overflow-hidden">
      <header
        className="px-5 py-4 border-b border-[color:var(--color-border)]"
        style={{ borderLeft: `3px solid ${bucket.accentColor}` }}
      >
        <p
          className="text-[10px] font-heading tracking-widest"
          style={{ color: bucket.accentColor }}
        >
          {bucket.headerLabel} · {filled}/{SLOTS_PER_BUCKET}
        </p>
        {bucket.subtitle ? (
          <p className="text-sm mt-1 text-[color:var(--color-text-muted)]">{bucket.subtitle}</p>
        ) : null}
      </header>
      {/* Column headers only from `sm` up. Below that each row stacks
          (mission-slot.tsx), so labels sitting in a single line above
          them would name columns that are no longer side by side, and
          the header's own 436px of fixed widths is what squeezed the
          mission text to one word per line on a phone. */}
      <div className="hidden sm:flex px-4 py-2 border-b border-[color:var(--color-border)] bg-[color:var(--color-bg)] items-center gap-3 text-[9px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
        <span className="flex-1">MISSION</span>
        <span className="shrink-0 w-[152px] text-center">DAY YOU&rsquo;LL DO IT</span>
        <span className="shrink-0 w-[92px] text-center">COACH</span>
        <span className="shrink-0 w-[192px]" aria-hidden="true" />
      </div>
      <ul className="divide-y divide-[color:var(--color-border)]">
        {slots.map((slot, i) => (
          <MissionSlot
            key={slot?.id ?? `empty-${bucket.key}-${i}`}
            mission={slot}
            weekDates={weekDates}
            slotIndex={i}
            communityId={communityId}
            goalId={bucket.goalId}
            goalDescription={bucket.goalDescription}
            pillarCode={slotPillar}
            carriedForward={slot ? carriedForwardIds.has(slot.id) : false}
            readOnly={readOnly}
          />
        ))}
      </ul>
    </section>
  );
}
