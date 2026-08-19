"use client";

import { useState, useTransition } from "react";
import type { ItcAssumption } from "@/lib/itc/maps";
import { selectAssumptionForTesting } from "../actions";

/**
 * Assumption picker for the prioritize stage. Renders one row per
 * assumption; the coach's pre-selected pick (server-side, via
 * deliverPrioritizeRecommendationAfterAdvance → setAssumptionSelected)
 * is highlighted on arrival. Clicking a different row overrides via
 * selectAssumptionForTesting, which flips the selection atomically
 * (one-at-a-time enforcement in maps.ts).
 *
 * The coach's prose recommendation renders separately as a stage_note
 * above this picker — this component is JUST the selection UI. The
 * two together form the prioritize section.
 */
export function PrioritizePicker({
  mapId,
  assumptions,
}: {
  mapId: string;
  assumptions: ItcAssumption[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimisticPick, setOptimisticPick] = useState<string | null>(null);

  const selectedId =
    optimisticPick ??
    assumptions.find((a) => a.selected_for_testing)?.id ??
    null;

  function pick(assumptionId: string) {
    if (pending) return;
    if (selectedId === assumptionId) return;
    setError(null);
    setOptimisticPick(assumptionId);
    const fd = new FormData();
    fd.set("map_id", mapId);
    fd.set("assumption_id", assumptionId);
    startTransition(async () => {
      const res = await selectAssumptionForTesting(fd);
      if (!res.ok) {
        setOptimisticPick(null);
        setError(res.reason ?? "Could not select.");
      }
    });
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs uppercase tracking-widest text-[color:var(--color-text-muted)]/80">
        Pick the assumption to test first
      </p>
      <ul className="space-y-2">
        {assumptions.map((a, i) => {
          const isSelected = a.id === selectedId;
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => pick(a.id)}
                disabled={pending}
                className={
                  "w-full text-left rounded-md border px-4 py-3 transition-colors disabled:opacity-60 " +
                  (isSelected
                    ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/[0.12]"
                    : "border-[color:var(--color-border)] bg-black/20 hover:border-[color:var(--color-text-muted)] hover:bg-black/30")
                }
              >
                <div className="flex items-start gap-3">
                  <span
                    className={
                      "mt-0.5 shrink-0 rounded-full border w-5 h-5 flex items-center justify-center text-[10px] " +
                      (isSelected
                        ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
                        : "border-[color:var(--color-border)] text-[color:var(--color-text-muted)]")
                    }
                  >
                    {isSelected ? "✓" : i + 1}
                  </span>
                  <div className="flex-1 space-y-1">
                    <div className="text-sm leading-relaxed">{a.text}</div>
                    {isSelected ? (
                      <div className="text-[11px] uppercase tracking-widest text-[color:var(--color-primary)]/80">
                        Selected for testing
                      </div>
                    ) : null}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="text-sm text-[color:var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}
