"use client";

/**
 * Progress-bar-per-pillar view. Replaces the uniform-blue grouped bar
 * chart on /dashboard with:
 *   - one horizontal row per choose-able pillar (7 total; A2 is
 *     derived from missions and lives on the mission card, not here)
 *   - pillar's own brand color for the fill — leverages the visual
 *     vocabulary the user already knows from /today
 *   - denominator = days elapsed in the quarter so the numbers are
 *     honest early in the quarter ("23/45", not "23/91" while
 *     you're only halfway through)
 *   - last-quarter tick overlay (small vertical line) at the
 *     equivalent percentage when history exists, so the comparison
 *     is fair regardless of how far along each quarter is
 *
 * Reads as a scannable ranked list: strongest pillar has the fullest
 * bar, weakest is instantly visible.
 */
export function PillarProgressChart({
  rows,
  hasLastQuarter,
}: {
  rows: Array<{
    code: string;
    label: string;
    colorVar: string;
    /** Check-ins this quarter so far. */
    count: number;
    /** Days elapsed in this quarter (denominator). */
    max: number;
    /** Same-pillar count for the full prior quarter (or null). */
    lastCount: number | null;
    /** Total days in the prior quarter (for percentage math). */
    lastMax: number;
  }>;
  hasLastQuarter: boolean;
}) {
  // Sort strongest → weakest by percentage. Ties keep declared pillar
  // order so BRAVEMAN reading is stable across renders.
  const ordered = [...rows].sort((a, b) => {
    const ap = a.max ? a.count / a.max : 0;
    const bp = b.max ? b.count / b.max : 0;
    if (ap === bp) return 0;
    return bp - ap;
  });

  return (
    <ul className="space-y-3">
      {ordered.map((r) => (
        <ProgressRow key={r.code} row={r} hasLastQuarter={hasLastQuarter} />
      ))}
    </ul>
  );
}

function ProgressRow({
  row,
  hasLastQuarter,
}: {
  row: {
    code: string;
    label: string;
    colorVar: string;
    count: number;
    max: number;
    lastCount: number | null;
    lastMax: number;
  };
  hasLastQuarter: boolean;
}) {
  const pct = row.max > 0 ? Math.min(100, (row.count / row.max) * 100) : 0;
  const lastPct =
    row.lastCount !== null && row.lastMax > 0
      ? Math.min(100, (row.lastCount / row.lastMax) * 100)
      : null;

  const delta =
    lastPct !== null ? Math.round(pct - lastPct) : null;

  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-sm shrink-0"
            style={{ background: row.colorVar }}
          />
          <span className="font-heading text-[11px] tracking-widest text-[color:var(--color-text)]">
            {row.label.toUpperCase()}
          </span>
        </div>
        <div className="flex items-baseline gap-2 shrink-0">
          <span className="text-sm text-[color:var(--color-text)]">
            <span className="font-heading">{row.count}</span>
            <span className="text-[color:var(--color-text-muted)]"> / {row.max}</span>
          </span>
          {delta !== null ? (
            <span
              className="text-[10px] font-heading tracking-widest"
              style={{
                color:
                  delta > 0
                    ? "var(--color-success)"
                    : delta < 0
                      ? "var(--color-warning)"
                      : "var(--color-text-muted)",
              }}
              title={`${lastPct?.toFixed(0)}% last quarter`}
            >
              {delta > 0 ? "+" : ""}
              {delta}%
            </span>
          ) : null}
        </div>
      </div>

      {/* Track + fill + optional last-quarter tick. Track is a
          low-contrast rail so the filled color pops as the primary
          signal. */}
      <div
        className="relative h-2 rounded-full overflow-hidden bg-[color:var(--color-surface-2)] border border-[color:var(--color-border)]"
        aria-label={`${row.label}: ${row.count} of ${row.max} days`}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct}%`, background: row.colorVar }}
        />
        {hasLastQuarter && lastPct !== null ? (
          <span
            aria-hidden
            title={`Last quarter: ${lastPct.toFixed(0)}%`}
            className="absolute top-0 bottom-0 w-px bg-[color:var(--color-text-muted)]"
            style={{ left: `${lastPct}%` }}
          />
        ) : null}
      </div>
    </li>
  );
}
