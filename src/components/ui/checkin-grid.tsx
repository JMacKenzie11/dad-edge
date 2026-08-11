"use client";

import { useState } from "react";
import { PILLARS, type PillarCode } from "@/lib/pillars";
import { PillarToggle } from "./pillar-toggle";

export type CheckinValues = Partial<Record<PillarCode, 0 | 1 | null>>;

/**
 * Mobile-first daily check-in grid.
 * Eight large tap targets, one thumb, optimistic UI.
 * Under-15-second target: no confirms, three-state cycle, live count.
 */
export function CheckinGrid({
  initial,
  onCommit,
}: {
  initial?: CheckinValues;
  onCommit?: (values: CheckinValues) => void;
}) {
  const [values, setValues] = useState<CheckinValues>(initial ?? {});
  const count = PILLARS.reduce((n, p) => n + (values[p.code] === 1 ? 1 : 0), 0);

  const update = (code: PillarCode, v: 0 | 1 | null) => {
    const next = { ...values, [code]: v };
    setValues(next);
    onCommit?.(next);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)]">
          TODAY
        </p>
        <p className="font-heading text-3xl text-[color:var(--color-accent)]">
          {count}
          <span className="text-lg text-[color:var(--color-text-muted)]">/8</span>
        </p>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {PILLARS.map((p) => (
          <PillarToggle
            key={p.code}
            code={p.code}
            value={values[p.code] ?? null}
            onChange={(v) => update(p.code, v)}
          />
        ))}
      </div>
    </div>
  );
}
