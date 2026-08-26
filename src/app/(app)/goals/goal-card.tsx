"use client";

import Link from "next/link";
import { useTransition } from "react";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { closeGoal } from "./actions";

type Goal = {
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

export function GoalCard({ goal, readOnly }: { goal: Goal; readOnly: boolean }) {
  const p = PILLAR_BY_CODE[goal.focus_area];
  const [pending, start] = useTransition();
  // ITC-sourced goals are owned by the map. Editing / closing them here
  // would drift the goal's status from the map's status; the ITC
  // cascade paths are the only legitimate way to close a source='itc'
  // goal. (In practice source='itc' goals appear in the Adaptive Goal
  // section, not here — this branch is a defensive fallback.)
  const itcSourced = goal.source === "itc";
  const active = goal.status === "active" || goal.status === "needs_review";
  const showActions = !readOnly && !itcSourced && active;
  const missionRate =
    goal.total_missions > 0
      ? `${goal.completed_missions} of ${goal.total_missions} missions completed`
      : "No missions yet";

  return (
    <div className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
      <div className="flex items-start gap-3">
        <span
          className="mt-1 inline-block h-8 w-1.5 rounded-full"
          style={{ background: p.colorVar }}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] flex items-center gap-2 flex-wrap">
            <span>{p.label.toUpperCase()} · Q START {goal.quarter_start}</span>
            {itcSourced ? (
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest border border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary)]/15 text-[color:var(--color-primary)]"
                title="This goal comes from your improvement map. Edit it there."
              >
                From your improvement map
              </span>
            ) : null}
            {goal.status === "needs_review" ? (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest border border-[color:var(--color-warning)]/60 bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)]">
                Review this
              </span>
            ) : null}
          </p>
          <p className="text-sm mt-2 leading-relaxed">{goal.desired_end_state}</p>
          {goal.current_state ? (
            <p className="text-xs text-[color:var(--color-text-muted)] mt-1 italic">
              Starting from: {goal.current_state}
            </p>
          ) : null}
          <p className="text-[11px] text-[color:var(--color-text-muted)] mt-2">
            {missionRate}
          </p>
          {(goal.status === "abandoned" || goal.status === "completed") &&
          (goal.retrospective_what_learned || goal.retrospective_what_happened) ? (
            <p className="text-xs text-[color:var(--color-text-muted)] mt-2 italic">
              {goal.retrospective_what_learned || goal.retrospective_what_happened}
            </p>
          ) : null}
          {!itcSourced ? (
            <Link
              href={`/goals/${goal.id}`}
              className="inline-block text-xs text-[color:var(--color-primary)] mt-2 hover:underline"
            >
              Open →
            </Link>
          ) : null}
        </div>
        {showActions ? (
          <div className="flex flex-col gap-1">
            <button
              className="h-8 px-3 rounded-md text-[10px] font-heading tracking-widest bg-[color:var(--color-success)] text-black disabled:opacity-50"
              onClick={() =>
                start(async () => {
                  await closeGoal(goal.id, "completed");
                })
              }
              disabled={pending}
            >
              DONE
            </button>
            <button
              className="h-8 px-3 rounded-md text-[10px] font-heading tracking-widest border border-[color:var(--color-border)] text-[color:var(--color-text-muted)] disabled:opacity-50"
              onClick={() =>
                start(async () => {
                  await closeGoal(goal.id, "abandoned");
                })
              }
              disabled={pending}
            >
              DROP
            </button>
          </div>
        ) : goal.status === "completed" || goal.status === "abandoned" ? (
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            {goal.status.toUpperCase()}
          </span>
        ) : null}
      </div>
    </div>
  );
}
