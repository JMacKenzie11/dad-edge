"use client";

import { useState, useTransition } from "react";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { submitMidpointCheck } from "./actions";

export type MidpointGoal = {
  id: string;
  desired_end_state: string;
  focus_area: PillarCode;
};

/**
 * Midpoint check-in prompt. Fires once per goal, halfway between goal
 * creation and quarter end. One freeform field ("where are you at
 * with this?") — deliberately not a number or a slider because
 * quarterly goals are heterogeneous. The prompt disappears once the
 * coachee writes an answer; dismissing without answering brings it
 * back on next visit (same nudge-not-gate pattern as the retrospective).
 *
 * ITC-sourced goals never see this prompt (their ITC map has its own
 * stage cadence); enforced at goal-create time via
 * computeMidpointCheckAt leaving midpoint_check_at null for ITC.
 */
export function GoalMidpointPrompt({ goal }: { goal: MidpointGoal }) {
  const p = PILLAR_BY_CODE[goal.focus_area];
  const [answer, setAnswer] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (dismissed) return null;

  const submit = () => {
    if (!answer.trim()) return;
    setError(null);
    start(async () => {
      const res = await submitMidpointCheck({
        goal_id: goal.id,
        answer,
      });
      if (res.ok) setDismissed(true);
      else setError(res.error ?? "Something went wrong.");
    });
  };

  return (
    <div className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border-2 border-[color:var(--color-primary)]/50 space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: p.colorVar }}
          aria-hidden
        />
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-primary)]">
          MIDPOINT CHECK · {p.label.toUpperCase()}
        </p>
      </div>
      <p className="text-sm leading-relaxed">
        You're halfway through the quarter on this one: &ldquo;{goal.desired_end_state}&rdquo;
      </p>
      <label className="block space-y-1">
        <span className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]">
          Where are you at with it?
        </span>
        <textarea
          rows={3}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Two or three sentences. What's actually happening. Not what you meant to do."
          className="w-full p-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
        />
      </label>
      {error ? (
        <p className="text-xs text-[color:var(--color-danger)]">{error}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="h-9 px-3 rounded-md text-xs font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-white"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!answer.trim() || pending}
          className="h-9 px-3 rounded-md text-xs font-heading tracking-widest bg-[color:var(--color-primary)] text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save check-in"}
        </button>
      </div>
    </div>
  );
}
