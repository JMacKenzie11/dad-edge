"use client";

import { useState, useTransition } from "react";
import { CHOOSABLE_PILLARS, type PillarCode } from "@/lib/pillars";
import { Button } from "@/components/ui/button";
import { createMission } from "./actions";

type Goal = { id: string; description: string; focus_area: PillarCode; quarter_start: string };

export function NewMissionForm({
  communityId,
  goals,
  disabled,
}: {
  communityId: string;
  goals: Goal[];
  disabled?: boolean;
}) {
  const [pillar, setPillar] = useState<PillarCode>("B");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState<string>(defaultDate());
  const [goalId, setGoalId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await createMission({
        community_id: communityId,
        pillar_code: pillar,
        description,
        target_date: targetDate,
        quarterly_goal_id: goalId || null,
      });
      if (res.ok) {
        setDescription("");
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <form
      action={submit}
      className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] space-y-3"
    >
      <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
        NEW MISSION
      </p>
      <div className="flex flex-wrap gap-2">
        {CHOOSABLE_PILLARS.map((p) => (
          <button
            type="button"
            key={p.code}
            onClick={() => setPillar(p.code)}
            className="h-8 px-3 rounded-[var(--radius-chip)] text-[10px] font-heading tracking-widest border"
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
        placeholder="Take Sarah on a date night."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full p-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
      />
      <div className="grid grid-cols-2 gap-3">
        <input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className="h-11 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
        />
        <select
          value={goalId}
          onChange={(e) => setGoalId(e.target.value)}
          className="h-11 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
        >
          <option value="">No quarterly goal</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.focus_area} · {g.description.slice(0, 40)}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p className="text-xs text-[color:var(--color-danger)]" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || disabled}>
          {disabled ? "Weekly cap reached" : pending ? "Locking…" : "Lock it in"}
        </Button>
      </div>
    </form>
  );
}

function defaultDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
