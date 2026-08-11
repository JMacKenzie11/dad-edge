"use client";

import { useState } from "react";
import { CHOOSABLE_PILLARS, type PillarCode } from "@/lib/pillars";
import { saveFirstGoal } from "../actions";

const SUGGESTIONS: Record<Exclude<PillarCode, "A2">, string> = {
  B: "Weekly date night with my wife, every week this quarter.",
  R: "Read to the kids every night for 60 straight nights.",
  A: "Add $10K in monthly recurring revenue by quarter end.",
  V: "Deadlift 350 by the last week of the quarter.",
  E: "Pick one hobby and finish one project by quarter end.",
  M: "Run a sub-25 5K by the last week of the quarter.",
  N: "Meet one new person in my industry every week this quarter.",
};

export function GoalForm({ initialError }: { initialError?: string }) {
  const [pillar, setPillar] = useState<PillarCode>(CHOOSABLE_PILLARS[0].code);
  const [description, setDescription] = useState("");

  return (
    <form action={saveFirstGoal} className="space-y-4">
      <div>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mb-2">
          PILLAR
        </p>
        <div className="grid grid-cols-4 gap-2">
          {CHOOSABLE_PILLARS.map((p) => {
            const selected = p.code === pillar;
            return (
              <label
                key={p.code}
                className={`flex flex-col items-center py-2 rounded-md border cursor-pointer transition-colors ${
                  selected
                    ? "border-[color:var(--color-accent)] bg-[color:var(--color-surface)] ring-2 ring-[color:var(--color-accent)]"
                    : "border-[color:var(--color-border)]"
                }`}
              >
                <input
                  type="radio"
                  name="focus_area"
                  value={p.code}
                  checked={selected}
                  onChange={() => setPillar(p.code)}
                  className="sr-only"
                />
                <span
                  className="h-8 w-8 rounded-md flex items-center justify-center font-heading text-sm"
                  style={{ background: p.colorVar, color: "black" }}
                >
                  {p.code}
                </span>
                <span
                  className={`text-[10px] font-heading tracking-widest mt-1 ${
                    selected
                      ? "text-[color:var(--color-text)]"
                      : "text-[color:var(--color-text-muted)]"
                  }`}
                >
                  {p.short.toUpperCase()}
                </span>
              </label>
            );
          })}
        </div>
      </div>
      <textarea
        name="description"
        rows={3}
        required
        minLength={4}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full p-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
        placeholder={SUGGESTIONS[pillar as Exclude<PillarCode, "A2">]}
      />
      {initialError ? (
        <p className="text-xs text-[color:var(--color-danger)]">{initialError}</p>
      ) : null}
      <button
        type="submit"
        className="w-full h-12 rounded-md font-heading bg-[color:var(--color-primary)] text-white"
      >
        Set the goal
      </button>
    </form>
  );
}
