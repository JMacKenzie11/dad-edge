"use client";

import { useEffect, useState, useTransition } from "react";
import { PILLARS, type PillarCode } from "@/lib/pillars";
import { PillarToggle } from "@/components/ui/pillar-toggle";
import { setCheckin } from "./actions";

type Values = Partial<Record<PillarCode, 0 | 1 | null>>;

export function CheckinBoard({
  date,
  initial,
  readOnly,
  actionValue,
  countLabel,
}: {
  date: string;
  initial: Values;
  readOnly: boolean;
  /** Derived A2 value for `date`. null = no mission was due that day. */
  actionValue: 0 | 1 | null;
  /** Small-caps label above the pillar-count number. "TODAY" today,
   *  the day-of-week (e.g. "MON") when viewing a past day. */
  countLabel: string;
}) {
  const [values, setValues] = useState<Values>(initial);
  const [, startTransition] = useTransition();

  // /today reuses this component across date navigation
  // (search-param nav doesn't unmount). Re-sync state whenever the
  // viewed date changes so pillar checks reflect the new day's rows.
  // Keyed on `date` (not `initial`, which is a fresh object per render).
  useEffect(() => {
    setValues(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
  // Daily count excludes A (Action) — Action is scored separately via
  // completed missions, not the daily-pillar total.
  const count = PILLARS.reduce((n, p) => {
    if (p.code === "A2") return n;
    return n + (values[p.code] === 1 ? 1 : 0);
  }, 0);

  const update = (code: PillarCode, v: 0 | 1 | null) => {
    if (readOnly || code === "A2") return;
    const prev = values[code] ?? null;
    setValues({ ...values, [code]: v }); // optimistic
    startTransition(async () => {
      const result = await setCheckin({ date, pillar_code: code, value: v });
      if (!result.ok) {
        setValues((current) => ({ ...current, [code]: prev }));
      }
    });
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)]">
          {countLabel}
        </p>
        <p className="font-heading text-4xl text-[color:var(--color-accent)]">
          {count}
          <span className="text-lg text-[color:var(--color-text-muted)]">/7</span>
        </p>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {PILLARS.map((p) => (
          <PillarToggle
            key={p.code}
            code={p.code}
            value={p.code === "A2" ? actionValue : (values[p.code] ?? null)}
            onChange={(v) => update(p.code, v)}
            disabled={readOnly || p.code === "A2"}
            derived={p.code === "A2"}
          />
        ))}
      </div>
      <p className="text-[10px] text-[color:var(--color-text-muted)] mt-2">
        Action (A) is tracked from your missions. Each completed mission
        counts as one Action point for the week.
      </p>
    </div>
  );
}
