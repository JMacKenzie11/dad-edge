import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PILLARS, type PillarCode } from "@/lib/pillars";
import { getCurrentQuarter } from "@/lib/scoring/quarters";
import { CardEmpty, DashboardCard } from "./card-shell";
import { PillarProgressChart } from "./pillar-progress-chart";

/**
 * Card 3.1 — pillar comparison. Server-side fetches per-pillar
 * check-in counts for this quarter and last quarter, hands to the
 * client chart component. Empty state when the user has no
 * prior-quarter data: show this quarter only with a note.
 */
export async function PillarComparisonCard({ userId }: { userId: string }) {
  const supabase = await createSupabaseServerClient();
  const q = getCurrentQuarter();
  const lastQuarterStart = shiftQuarterStart(q.startIso, -1);
  const lastQuarterEnd = shiftDay(q.startIso, -1);

  const { data: rows } = await supabase
    .from("daily_checkins")
    .select("date, pillar_code, value")
    .eq("user_id", userId)
    .gte("date", lastQuarterStart)
    .lte("date", q.endIso)
    .eq("value", 1);

  const safeRows = (rows ?? []) as Array<{
    date: string;
    pillar_code: PillarCode;
    value: 0 | 1;
  }>;

  const thisCounts = new Map<PillarCode, number>();
  const lastCounts = new Map<PillarCode, number>();
  let hasLastQuarter = false;
  for (const r of safeRows) {
    const target = r.date >= q.startIso ? thisCounts : lastCounts;
    target.set(r.pillar_code, (target.get(r.pillar_code) ?? 0) + 1);
    if (r.date < q.startIso) hasLastQuarter = true;
  }

  const hasThisQuarter = safeRows.some((r) => r.date >= q.startIso);
  if (!hasThisQuarter && !hasLastQuarter) {
    return (
      <CardEmpty
        title="Pillars this quarter vs last"
        message="A few weeks of check-ins from now, this shows how each pillar compares to last quarter."
      />
    );
  }

  // Days elapsed in this quarter so far — denominator for the "you
  // could have checked in this many times" bar. Cap at the full
  // quarter length so post-quarter views don't show >100%. If we're
  // on day 1, force min=1 to avoid a divide-by-zero on the fill %.
  const today = new Date().toISOString().slice(0, 10);
  const daysElapsed = Math.max(1, daysBetweenInclusive(q.startIso, today > q.endIso ? q.endIso : today));
  const lastQuarterDays = daysBetweenInclusive(lastQuarterStart, lastQuarterEnd);

  // A2 (Action) is derived from mission completion — it lives on the
  // mission card, not here, so we drop it. Otherwise it renders as
  // an empty slot which reads as a bug.
  const pillarRows = PILLARS.filter((p) => p.code !== "A2").map((p) => ({
    code: p.code,
    label: p.label,
    colorVar: p.colorVar,
    count: thisCounts.get(p.code) ?? 0,
    max: daysElapsed,
    lastCount: hasLastQuarter ? (lastCounts.get(p.code) ?? 0) : null,
    lastMax: lastQuarterDays,
  }));

  return (
    <DashboardCard
      title="Pillar consistency this quarter"
      subtitle={
        hasLastQuarter
          ? `Filled bar = check-ins so far this quarter. Tick mark shows where you were at end of last quarter.`
          : `Filled bar = check-ins so far this quarter (out of ${daysElapsed} days elapsed). Comparison to last quarter shows here once you have history.`
      }
    >
      <PillarProgressChart rows={pillarRows} hasLastQuarter={hasLastQuarter} />
    </DashboardCard>
  );
}

/** Inclusive day count between two ISO dates. Both endpoints count. */
function daysBetweenInclusive(startIso: string, endIso: string): number {
  const a = new Date(`${startIso}T00:00:00Z`).getTime();
  const b = new Date(`${endIso}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function shiftQuarterStart(startIso: string, delta: number): string {
  const [y, m] = startIso.split("-").map(Number);
  const monthIdx = m - 1 + delta * 3;
  const yearOffset = Math.floor(monthIdx / 12);
  const wrappedMonth = ((monthIdx % 12) + 12) % 12;
  return `${y + yearOffset}-${String(wrappedMonth + 1).padStart(2, "0")}-01`;
}

function shiftDay(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
