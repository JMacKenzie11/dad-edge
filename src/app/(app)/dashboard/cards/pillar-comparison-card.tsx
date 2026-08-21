import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PILLARS, type PillarCode } from "@/lib/pillars";
import { getCurrentQuarter } from "@/lib/scoring/quarters";
import { CardEmpty, DashboardCard } from "./card-shell";
import { PillarComparisonChart } from "./pillar-comparison-chart";

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
        message="Once you have a few weeks of check-ins, you'll see how each pillar is trending compared to last quarter."
      />
    );
  }

  // Use the full pillar name on the axis so the chart is legible
  // without the reader knowing the BRAVEMAN codes.
  const data = PILLARS.map((p) => ({
    pillar: p.label,
    thisQuarter: thisCounts.get(p.code) ?? 0,
    lastQuarter: lastCounts.get(p.code) ?? 0,
  }));

  return (
    <DashboardCard
      title="Pillars this quarter vs last"
      subtitle={
        hasLastQuarter
          ? `${q.label} check-ins vs the quarter before.`
          : `${q.label} check-ins. Last quarter shows once you have history to compare against.`
      }
    >
      <PillarComparisonChart data={data} hasLastQuarter={hasLastQuarter} />
    </DashboardCard>
  );
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
