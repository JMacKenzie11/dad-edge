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
  readOnly,
}: {
  communityId: string | null;
  weekMonday: string;
  weekDates: string[];
  activeGoals: ActiveGoal[];
  missions: WeekMission[];
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
      headerLabel: "UNATTACHED",
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
  readOnly,
  weekDates,
  communityId,
}: {
  bucket: Bucket;
  missions: WeekMission[];
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
            readOnly={readOnly}
          />
        ))}
      </ul>
    </section>
  );
}
