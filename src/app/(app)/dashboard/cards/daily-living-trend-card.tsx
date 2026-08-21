import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { CardEmpty, DashboardCard } from "./card-shell";
import { DailyLivingTrendChart } from "./daily-living-trend-chart";

/**
 * Card 3.2a — weekly Daily Living check-in count over the user's
 * full history. Companion to the mission completion trend card
 * (3.2b). Split from the earlier composite card so each metric
 * reads on its own axis instead of being flattened into a single
 * 70/30 blend. Requires ≥2 weeks of data to draw a line.
 */
export async function DailyLivingTrendCard({ userId }: { userId: string }) {
  const supabase = await createSupabaseServerClient();

  const [{ data: checkins }, { data: goals }] = await Promise.all([
    supabase
      .from("daily_checkins")
      .select("date, value")
      .eq("user_id", userId)
      .eq("value", 1),
    supabase
      .from("quarterly_goals")
      .select("focus_area, quarter_start")
      .eq("user_id", userId)
      .order("quarter_start", { ascending: true }),
  ]);

  const checkinRows = (checkins ?? []) as Array<{
    date: string;
    value: 0 | 1;
  }>;

  const weekBuckets = new Map<string, number>();
  for (const r of checkinRows) {
    const week = mondayIsoUTC(r.date);
    weekBuckets.set(week, (weekBuckets.get(week) ?? 0) + 1);
  }

  const weeks = [...weekBuckets.keys()].sort();
  if (weeks.length < 2) {
    return (
      <CardEmpty
        title="Daily Living trend"
        message="Once you have two full weeks of check-ins, your weekly total will chart here alongside the goal periods you had running."
      />
    );
  }

  const data = weeks.map((w) => ({
    week: w.slice(5),
    total: weekBuckets.get(w) ?? 0,
  }));

  const firstWeekIso = weeks[0];
  const lastWeekIso = weeks[weeks.length - 1];
  const goalBands = ((goals ?? []) as Array<{
    focus_area: PillarCode;
    quarter_start: string;
  }>)
    .map((g) => {
      const startWeek = mondayIsoUTC(g.quarter_start);
      const endWeek = mondayIsoUTC(shiftQuarterStart(g.quarter_start, 1));
      const clampedStart = startWeek < firstWeekIso ? firstWeekIso : startWeek;
      const clampedEnd = endWeek > lastWeekIso ? lastWeekIso : endWeek;
      if (clampedStart > lastWeekIso || clampedEnd < firstWeekIso) return null;
      return {
        startWeek: clampedStart.slice(5),
        endWeek: clampedEnd.slice(5),
        pillar: g.focus_area,
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  const bandLegend = dedupePillars(goalBands.map((b) => b.pillar));

  return (
    <DashboardCard
      title="Daily Living trend"
      subtitle="Weekly check-ins out of 56. Shaded bands mark the quarters where a goal was running."
    >
      <DailyLivingTrendChart data={data} goalBands={goalBands} />
      {bandLegend.length > 0 ? (
        <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-[color:var(--color-text-muted)]">
          {bandLegend.map((code) => (
            <span key={code} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-4 rounded-sm"
                style={{ background: PILLAR_BY_CODE[code].colorVar, opacity: 0.6 }}
                aria-hidden
              />
              {PILLAR_BY_CODE[code].label}
            </span>
          ))}
        </div>
      ) : null}
    </DashboardCard>
  );
}

function mondayIsoUTC(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay();
  const daysFromMonday = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  return d.toISOString().slice(0, 10);
}

function shiftQuarterStart(startIso: string, delta: number): string {
  const [y, m] = startIso.split("-").map(Number);
  const monthIdx = m - 1 + delta * 3;
  const yearOffset = Math.floor(monthIdx / 12);
  const wrappedMonth = ((monthIdx % 12) + 12) % 12;
  return `${y + yearOffset}-${String(wrappedMonth + 1).padStart(2, "0")}-01`;
}

function dedupePillars(codes: PillarCode[]): PillarCode[] {
  return [...new Set(codes)];
}
