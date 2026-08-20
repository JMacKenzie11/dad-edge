"use client";

import { useState, useTransition } from "react";
import type {
  ItcAssumption,
  ItcAssumptionVerdict,
  ItcTest,
  ItcTestResult,
} from "@/lib/itc/maps";
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
  tests,
  results,
}: {
  mapId: string;
  assumptions: ItcAssumption[];
  /** All tests on the map. Used to show test-history badges per
   *  assumption on repeat visits (C-ε.6). Abandoned tests are
   *  excluded from the count. */
  tests: ItcTest[];
  /** All test results on the map. Used to summarize the most recent
   *  verdict per assumption. */
  results: ItcTestResult[];
}) {
  // Build per-assumption test history: count of non-abandoned tests
  // and the most recent verdict recorded.
  const historyByAssumption = new Map<
    string,
    {
      testCount: number;
      lastVerdict: ItcAssumptionVerdict | null;
    }
  >();
  const testsByAssumption = new Map<string, ItcTest[]>();
  for (const t of tests) {
    if (t.status === "abandoned") continue;
    const arr = testsByAssumption.get(t.assumption_id) ?? [];
    arr.push(t);
    testsByAssumption.set(t.assumption_id, arr);
  }
  for (const [assumptionId, ts] of testsByAssumption.entries()) {
    const testIds = new Set(ts.map((t) => t.id));
    const relevantResults = results.filter((r) => testIds.has(r.test_id));
    // Latest result first (results already sorted by created_at ascending
    // in listTestResults; we reverse to newest-first).
    const sorted = relevantResults
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    historyByAssumption.set(assumptionId, {
      testCount: ts.length,
      lastVerdict: sorted[0]?.assumption_verdict ?? null,
    });
  }

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
                    {(() => {
                      const h = historyByAssumption.get(a.id);
                      if (!h || h.testCount === 0) return null;
                      const verdictLabel = h.lastVerdict
                        ? VERDICT_LABEL[h.lastVerdict]
                        : "no result recorded yet";
                      return (
                        <div className="text-[11px] uppercase tracking-widest text-[color:var(--color-text-muted)]/80">
                          Tested {h.testCount}×
                          {h.lastVerdict
                            ? ` · Last verdict: ${verdictLabel}`
                            : null}
                        </div>
                      );
                    })()}
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

const VERDICT_LABEL: Record<ItcAssumptionVerdict, string> = {
  held: "Held",
  partially_challenged: "Partially challenged",
  challenged: "Challenged",
};
