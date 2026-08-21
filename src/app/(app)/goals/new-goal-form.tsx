"use client";

import { useState, useTransition } from "react";
import { PILLARS, type PillarCode } from "@/lib/pillars";
import { Button } from "@/components/ui/button";
import { createGoal } from "./actions";

/**
 * Create form for a user-authored quarterly goal. Two fields: start
 * line (current_state) and finish line (desired_end_state). Quarter
 * is server-computed; the user never picks a quarter — the calendar
 * quarter containing "now" is authoritative. If the finish line is
 * specific enough, the signal is baked into it, so no separate
 * "how you'll know" field.
 */
export function NewGoalForm({
  userSlotsRemaining,
}: {
  /** How many user-authored goal slots remain this quarter. 0 disables
   *  the form with an explanatory line. Third slot is reserved for an
   *  ITC map goal per the split-cap trigger. */
  userSlotsRemaining: number;
}) {
  const [pillar, setPillar] = useState<PillarCode>("V");
  const [currentState, setCurrentState] = useState("");
  const [desiredEndState, setDesiredEndState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const noSlots = userSlotsRemaining <= 0;

  const submit = () => {
    if (noSlots) return;
    setError(null);
    start(async () => {
      const res = await createGoal({
        focus_area: pillar,
        current_state: currentState,
        desired_end_state: desiredEndState,
      });
      if (res.ok) {
        setCurrentState("");
        setDesiredEndState("");
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    });
  };

  return (
    <form
      action={submit}
      className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] space-y-3"
    >
      <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
        NEW GOAL
      </p>
      <div className="flex flex-wrap gap-2">
        {PILLARS.map((p) => (
          <button
            type="button"
            key={p.code}
            onClick={() => setPillar(p.code)}
            disabled={noSlots}
            className="h-8 px-3 rounded-[var(--radius-chip)] text-[10px] font-heading tracking-widest border disabled:opacity-50"
            style={{
              background: pillar === p.code ? p.colorVar : "transparent",
              borderColor: pillar === p.code ? p.colorVar : "var(--color-border)",
              color: pillar === p.code ? "black" : "var(--color-text-muted)",
            }}
          >
            {p.label.toUpperCase()}
          </button>
        ))}
      </div>

      <FormField
        label="Where you are now"
        hint="The start line. Where things stand today, not where you wish they were."
        value={currentState}
        onChange={setCurrentState}
        placeholder="I'm hitting the gym 2 days a week when I mean to hit 4."
        rows={2}
        disabled={noSlots}
      />

      <FormField
        label="Where you want to be"
        hint="The finish line. Write it specific enough that you'll know when you've hit it."
        value={desiredEndState}
        onChange={setDesiredEndState}
        placeholder="Deadlift 350 by end of quarter."
        rows={2}
        disabled={noSlots}
      />

      {noSlots ? (
        <p className="text-xs text-[color:var(--color-text-muted)]">
          You already have 2 goals this quarter, which is the cap. Close
          or complete one above to free up a slot. The third slot is held
          for an ITC map goal if you build one.
        </p>
      ) : null}
      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || noSlots}>
          {pending ? "Setting…" : "Set the goal"}
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
  placeholder,
  rows,
  disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows: number;
  disabled: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]">
        {label}
      </span>
      <textarea
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full p-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm disabled:opacity-50"
      />
      <span className="block text-[11px] text-[color:var(--color-text-muted)]/70 italic">
        {hint}
      </span>
    </label>
  );
}
