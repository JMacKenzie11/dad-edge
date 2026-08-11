"use client";

import { useState } from "react";
import { PILLARS, type PillarCode } from "@/lib/pillars";
import { PillarToggle } from "@/components/ui/pillar-toggle";
import { saveFirstCheckin } from "../actions";

export function FirstCheckinForm({ date, error }: { date: string; error?: string }) {
  const [values, setValues] = useState<Partial<Record<PillarCode, 0 | 1 | null>>>({});
  const count = PILLARS.reduce((n, p) => n + (values[p.code] === 1 ? 1 : 0), 0);

  return (
    <form action={saveFirstCheckin} className="space-y-4">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="values" value={JSON.stringify(values)} />
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)]">
          {date}
        </p>
        <p className="font-heading text-3xl text-[color:var(--color-accent)]">
          {count}
          <span className="text-lg text-[color:var(--color-text-muted)]">/8</span>
        </p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {PILLARS.map((p) => (
          <PillarToggle
            key={p.code}
            code={p.code}
            value={values[p.code] ?? null}
            onChange={(v) => setValues({ ...values, [p.code]: v })}
          />
        ))}
      </div>
      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
      <button
        type="submit"
        className="w-full h-12 rounded-md font-heading bg-[color:var(--color-primary)] text-white"
      >
        Log day one
      </button>
    </form>
  );
}
