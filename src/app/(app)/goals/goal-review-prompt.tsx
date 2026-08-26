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
 * Quarter-end retrospective prompt. Two-part reflection: "what
 * actually happened" (the concrete story) and "what did you learn"
 * (the extracted lesson) — treated as separate because the learning
 * is a different thing from the story. Verdict (Yes/Partially/No)
 * sits at the bottom because the verdict is a scoring output; the
 * story is the input.
 *
 * Non-blocking: "Not now" hides the prompt for the current render
 * only. No persisted dismissed flag — the prompt reappears on next
 * visit until the coachee actually answers. Design intent: nudge,
 * not gate.
 *
 * ITC-sourced needs_review goals render a lightweight variant
 * pointing back to the ITC map instead of the retrospective fields
 * (the ITC map's own done-stage flow is the real close-out).
 */
export function GoalReviewPrompt({ goal }: { goal: ReviewableGoal }) {
  const p = PILLAR_BY_CODE[goal.focus_area];
  const [whatHappened, setWhatHappened] = useState("");
  const [whatLearned, setWhatLearned] = useState("");
  const [answer, setAnswer] = useState<"yes" | "partially" | "no" | null>(null);
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
        what_happened: whatHappened || undefined,
        what_learned: whatLearned || undefined,
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
          QUARTER WRAP-UP · {p.label.toUpperCase()}
        </p>
      </div>
      <p className="text-sm leading-relaxed">
        {isItc
          ? "This goal came from an improvement map that's still open. Close out the map to finish the quarter clean."
          : `Time to close this out. "${goal.desired_end_state}"`}
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
          <PromptField
            label="What actually happened"
            hint="The concrete story of the quarter. Not the verdict yet."
            value={whatHappened}
            onChange={setWhatHappened}
            placeholder="e.g. Started strong, missed three weeks in a row when the project blew up, got back on it the last month."
            rows={3}
          />
          <PromptField
            label="What you learned"
            hint="One thing you'd tell yourself at the start of the next quarter."
            value={whatLearned}
            onChange={setWhatLearned}
            placeholder="e.g. Two workouts a week is what I can actually hold when work is busy, not four."
            rows={3}
          />
          <div>
            <p className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)] mb-2">
              Did you hit it?
            </p>
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
                label="Partway"
              />
              <AnswerButton
                value="no"
                current={answer}
                onSelect={setAnswer}
                label="No"
              />
            </div>
          </div>
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
              {pending ? "Saving…" : "Save wrap-up"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PromptField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  rows,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rows: number;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]">
        {label}
      </span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full p-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
      />
      <span className="block text-[11px] text-[color:var(--color-text-muted)]/70 italic">
        {hint}
      </span>
    </label>
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
