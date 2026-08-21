"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { updateGoal } from "../actions";

/**
 * Inline edit form for a user-authored goal. Fields mirror the create
 * form (current_state / desired_end_state); pillar and quarter are
 * immutable once set (changing either → new goal).
 */
export function EditGoalForm({
  goal,
}: {
  goal: {
    id: string;
    current_state: string;
    desired_end_state: string;
  };
}) {
  const [currentState, setCurrentState] = useState(goal.current_state);
  const [desiredEndState, setDesiredEndState] = useState(goal.desired_end_state);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    setError(null);
    setMessage(null);
    start(async () => {
      const res = await updateGoal({
        goal_id: goal.id,
        current_state: currentState,
        desired_end_state: desiredEndState,
      });
      if (res.ok) setMessage("Saved.");
      else setError(res.error ?? "Something went wrong.");
    });
  };

  return (
    <form
      action={submit}
      className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] space-y-3"
    >
      <FormField
        label="Where you are now"
        hint="The start line. Where things stand today, not where you wish they were."
        value={currentState}
        onChange={setCurrentState}
        rows={2}
      />
      <FormField
        label="Where you want to be"
        hint="The finish line. Write it specific enough that you'll know when you've hit it."
        value={desiredEndState}
        onChange={setDesiredEndState}
        rows={2}
      />
      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
      {message ? (
        <p className="text-xs text-[color:var(--color-text-muted)]">{message}</p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function FormField({
  label,
  hint,
  value,
  onChange,
  rows,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
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
        className="w-full p-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
      />
      <span className="block text-[11px] text-[color:var(--color-text-muted)]/70 italic">
        {hint}
      </span>
    </label>
  );
}
