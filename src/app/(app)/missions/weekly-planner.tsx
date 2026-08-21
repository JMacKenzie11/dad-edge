"use client";

import { useTransition } from "react";
import { format } from "date-fns";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { MissionComposer } from "./mission-composer";
import { completeMission, rolloverMission } from "./actions";
import type { WeekMission, ActiveGoal } from "./page";

type Bucket = {
  key: string;
  label: string;
  subtitle: string | null;
  pillarCode: PillarCode | null;
  goalId: string | null;
  goalDescription: string | null;
  accentColor: string;
};

export function WeeklyPlanner({
  communityId,
  weekMonday,
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
        label: `GOAL ${i + 1} · ${p.label.toUpperCase()}`,
        subtitle: g.desired_end_state,
        pillarCode: g.focus_area,
        goalId: g.id,
        goalDescription: g.desired_end_state,
        accentColor: p.colorVar,
      };
    }),
    {
      key: "other",
      label: "OTHER",
      subtitle: "Missions not tied to a quarterly goal.",
      pillarCode: null,
      goalId: null,
      goalDescription: null,
      accentColor: "var(--color-border)",
    },
  ];

  return (
    <div className="space-y-4">
      {buckets.map((b) => {
        const bucketMissions = missions.filter((m) =>
          b.goalId ? m.quarterly_goal_id === b.goalId : m.quarterly_goal_id === null,
        );
        const remaining = Math.max(0, 5 - bucketMissions.length);
        return (
          <BucketSection
            key={b.key}
            bucket={b}
            missions={bucketMissions}
            remaining={remaining}
            readOnly={readOnly}
            weekMonday={weekMonday}
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
  remaining,
  readOnly,
  weekMonday: _weekMonday,
  weekDates,
  communityId,
}: {
  bucket: Bucket;
  missions: WeekMission[];
  remaining: number;
  readOnly: boolean;
  weekMonday: string;
  weekDates: string[];
  communityId: string | null;
}) {
  // Composer is always visible until the bucket is full. After each save the
  // key changes (missions.length grows), forcing a remount = clean state.
  const canCompose =
    !readOnly && remaining > 0 && (bucket.pillarCode !== null || Boolean(communityId));

  return (
    <section className="rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] overflow-hidden">
      <header
        className="px-5 py-4 border-b border-[color:var(--color-border)]"
        style={{ borderLeft: `3px solid ${bucket.accentColor}` }}
      >
        <p
          className="text-[10px] font-heading tracking-widest"
          style={{ color: bucket.pillarCode ? bucket.accentColor : "var(--color-text-muted)" }}
        >
          {bucket.label} · {missions.length}/5
        </p>
        {bucket.subtitle ? <p className="text-sm mt-1">{bucket.subtitle}</p> : null}
      </header>

      <ul className="divide-y divide-[color:var(--color-border)]">
        {missions.map((m) => (
          <MissionRow key={m.id} mission={m} readOnly={readOnly} />
        ))}
        {canCompose ? (
          <li className="p-4 bg-[color:var(--color-bg)]">
            <MissionComposer
              key={`composer-${missions.length}`}
              communityId={communityId}
              goalId={bucket.goalId}
              goalDescription={bucket.goalDescription}
              fixedPillar={bucket.pillarCode}
              weekDates={weekDates}
            />
          </li>
        ) : missions.length === 0 && !canCompose ? (
          <li className="px-5 py-4 text-xs text-[color:var(--color-text-muted)]">
            {readOnly ? "Read-only account." : "You need to be in a community to add missions."}
          </li>
        ) : null}
        {!canCompose && remaining === 0 ? (
          <li className="px-5 py-3 text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] text-center">
            BUCKET FULL FOR THIS WEEK
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function MissionRow({
  mission,
  readOnly,
}: {
  mission: WeekMission;
  readOnly: boolean;
}) {
  const [pending, start] = useTransition();
  const p = PILLAR_BY_CODE[mission.pillar_code];
  const isDone = mission.status === "completed";
  const isMissed = mission.status === "missed";

  const doComplete = () => start(async () => { await completeMission(mission.id); });
  const doRollover = () =>
    start(async () => {
      const d = new Date(`${mission.target_date}T00:00:00`);
      d.setDate(d.getDate() + 7);
      await rolloverMission({
        mission_id: mission.id,
        new_target_date: d.toISOString().slice(0, 10),
      });
    });

  return (
    <li className="px-5 py-3 flex items-start gap-3">
      <span
        className="mt-1.5 h-2 w-2 rounded-full shrink-0"
        style={{ background: p.colorVar }}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <p
          className={
            isDone
              ? "text-sm line-through text-[color:var(--color-text-muted)]"
              : "text-sm"
          }
        >
          {mission.description}
        </p>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mt-1">
          {format(new Date(`${mission.target_date}T00:00:00`), "EEE MMM d").toUpperCase()}
          {isDone
            ? mission.completed_late
              ? " · DONE (LATE)"
              : " · DONE"
            : isMissed
              ? " · MISSED"
              : ""}
        </p>
      </div>
      {!readOnly && !isDone ? (
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={doComplete}
            disabled={pending}
            className="h-7 px-3 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-[10px] tracking-widest disabled:opacity-40"
          >
            DONE
          </button>
          {isMissed ? (
            <button
              onClick={doRollover}
              disabled={pending}
              className="h-7 px-3 rounded-md border border-[color:var(--color-border)] font-heading text-[10px] tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)] hover:border-[color:var(--color-primary)] disabled:opacity-40"
            >
              ROLL
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
