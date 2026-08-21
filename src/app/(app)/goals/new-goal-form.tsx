"use client";

import { useState, useTransition } from "react";
import { PILLARS, type PillarCode } from "@/lib/pillars";
import { Button } from "@/components/ui/button";
import { createGoal } from "./actions";

export function NewGoalForm({
  currentQuarterStart,
  userSlotsRemaining,
}: {
  currentQuarterStart: string;
  /** How many user-authored goal slots remain this quarter. 0 → form
   *  is disabled with an explanatory line; the third slot is reserved
   *  for an ITC map goal per the split-cap trigger. */
  userSlotsRemaining: number;
}) {
  const [pillar, setPillar] = useState<PillarCode>("V");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const noSlots = userSlotsRemaining <= 0;

  const submit = () => {
    if (noSlots) return;
    setError(null);
    start(async () => {
      const res = await createGoal({
        focus_area: pillar,
        description,
        quarter_start: currentQuarterStart,
      });
      if (res.ok) setDescription("");
      else setError(res.error ?? "Something went wrong.");
    });
  };

  return (
    <form
      action={submit}
      className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] space-y-3"
    >
      <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
        NEW GOAL — Q START {currentQuarterStart}
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
      <textarea
        rows={2}
        placeholder="Deadlift 350 by end of quarter."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={noSlots}
        className="w-full p-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm disabled:opacity-50"
      />
      {noSlots ? (
        <p className="text-xs text-[color:var(--color-text-muted)]">
          You have 2 active goals this quarter, which is the cap for goals
          you write yourself. If you build an ITC map, its goal will fill a
          third slot reserved for that. Close or complete a goal above to
          open a slot for a new one.
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
