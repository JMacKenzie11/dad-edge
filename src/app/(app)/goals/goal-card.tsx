"use client";

import { useTransition } from "react";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { closeGoal } from "./actions";

type Goal = {
  id: string;
  description: string;
  focus_area: PillarCode;
  quarter_start: string;
  status: "active" | "completed" | "abandoned";
};

export function GoalCard({ goal, readOnly }: { goal: Goal; readOnly: boolean }) {
  const p = PILLAR_BY_CODE[goal.focus_area];
  const [pending, start] = useTransition();

  return (
    <div className="flex items-start gap-3 p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
      <span
        className="mt-1 inline-block h-8 w-1.5 rounded-full"
        style={{ background: p.colorVar }}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          {p.label.toUpperCase()} · Q START {goal.quarter_start}
        </p>
        <p className="text-sm mt-1">{goal.description}</p>
      </div>
      {!readOnly && goal.status === "active" ? (
        <div className="flex flex-col gap-1">
          <button
            className="h-8 px-3 rounded-md text-[10px] font-heading tracking-widest bg-[color:var(--color-success)] text-black"
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
            className="h-8 px-3 rounded-md text-[10px] font-heading tracking-widest border border-[color:var(--color-border)] text-[color:var(--color-text-muted)]"
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
      ) : goal.status !== "active" ? (
        <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          {goal.status.toUpperCase()}
        </span>
      ) : null}
    </div>
  );
}
