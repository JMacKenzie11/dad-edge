"use client";

import { useState, useTransition } from "react";
import { PILLARS, type PillarCode } from "@/lib/pillars";
import { PillarToggle } from "@/components/ui/pillar-toggle";
import { setCheckin } from "./actions";

type Values = Partial<Record<PillarCode, 0 | 1 | null>>;

export function CheckinBoard({
  date,
  initial,
  readOnly,
  actionValue,
}: {
  date: string;
  initial: Values;
  readOnly: boolean;
  /** Derived A2 value for `date`. null = no mission was due that day. */
  actionValue: 0 | 1 | null;
}) {
  const [values, setValues] = useState<Values>(initial);
  const [, startTransition] = useTransition();
  const count = PILLARS.reduce((n, p) => {
    const v = p.code === "A2" ? actionValue : values[p.code];
    return n + (v === 1 ? 1 : 0);
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
          TODAY
        </p>
        <p className="font-heading text-4xl text-[color:var(--color-accent)]">
          {count}
          <span className="text-lg text-[color:var(--color-text-muted)]">/8</span>
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
        Action (A) is auto — it flips to 1 when a mission dated today is marked done.
      </p>
    </div>
  );
}
