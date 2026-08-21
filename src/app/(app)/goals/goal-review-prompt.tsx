"use client";

import { useState, useTransition } from "react";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { submitGoalReview } from "./actions";

export type ReviewableGoal = {
  id: string;
  desired_end_state: string;
  focus_area: PillarCode;
  quarter_start: string;
  source: "user" | "itc";
};

/**
 * Dismissible quarter-end review prompt. Rendered wherever an active
 * `needs_review` goal exists (currently /today and /goals). Presents
 * three options that map to completed / completed / abandoned plus
 * an optional reflection.
 *
 * Non-blocking: "Not now" hides the prompt for the current render
 * only. No persisted dismissed-flag — the prompt reappears on next
 * visit until the coachee actually answers, which is the design
 * intent (nudge, don't gate).
 *
 * ITC-sourced needs_review goals render a lightweight variant
 * pointing back to the ITC map instead of the yes/partially/no
 * buttons (the ITC map's own done-stage flow is the real close-out).
 */
export function GoalReviewPrompt({ goal }: { goal: ReviewableGoal }) {
  const p = PILLAR_BY_CODE[goal.focus_area];
  const [answer, setAnswer] = useState<"yes" | "partially" | "no" | null>(null);
  const [reflection, setReflection] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (dismissed) return null;

  const isItc = goal.source === "itc";

  const submit = () => {
    if (!answer || isItc) return;
    setError(null);
    start(async () => {
      const res = await submitGoalReview({
        goal_id: goal.id,
        answer,
        reflection: reflection || undefined,
      });
      if (res.ok) setDismissed(true);
      else setError(res.error ?? "Something went wrong.");
    });
  };

  return (
    <div className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border-2 border-[color:var(--color-warning)]/60 space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: p.colorVar }}
          aria-hidden
        />
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-warning)]">
          QUARTER ENDED · {p.label.toUpperCase()}
        </p>
      </div>
      <p className="text-sm">
        {isItc
          ? "This goal came from an ITC map that's still open. Close out the map to finish the quarter cleanly."
          : `Did you hit it? "${goal.desired_end_state}"`}
      </p>
      {isItc ? (
        <div className="flex gap-2">
          <a
            href="/itc"
            className="h-9 px-3 rounded-md text-xs font-heading tracking-widest bg-[color:var(--color-primary)] text-white flex items-center"
          >
            OPEN THE MAP
          </a>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="h-9 px-3 rounded-md text-xs font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-white"
          >
            Not now
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <AnswerButton
              value="yes"
              current={answer}
              onSelect={setAnswer}
              label="Yes"
            />
            <AnswerButton
              value="partially"
              current={answer}
              onSelect={setAnswer}
              label="Partially"
            />
            <AnswerButton
              value="no"
              current={answer}
              onSelect={setAnswer}
              label="No"
            />
          </div>
          {answer ? (
            <textarea
              rows={2}
              value={reflection}
              onChange={(e) => setReflection(e.target.value)}
              placeholder="One line on what you learned this quarter (optional)."
              className="w-full p-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
            />
          ) : null}
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
              disabled={!answer || pending}
              className="h-9 px-3 rounded-md text-xs font-heading tracking-widest bg-[color:var(--color-primary)] text-white disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save review"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AnswerButton({
  value,
  current,
  onSelect,
  label,
}: {
  value: "yes" | "partially" | "no";
  current: "yes" | "partially" | "no" | null;
  onSelect: (v: "yes" | "partially" | "no") => void;
  label: string;
}) {
  const selected = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`h-9 px-4 rounded-md text-xs font-heading tracking-widest border ${
        selected
          ? "bg-[color:var(--color-primary)] text-white border-[color:var(--color-primary)]"
          : "border-[color:var(--color-border)] text-[color:var(--color-text-muted)] hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
