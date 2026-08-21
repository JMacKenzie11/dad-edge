import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import { leaderboardComposite } from "@/lib/scoring/composite";
import { CardEmpty, DashboardCard } from "./card-shell";
import { CompositeTrendChart } from "./composite-trend-chart";

/**
 * Card 3.2 — weekly composite score across the user's full check-in
 * history, with quarterly goal windows overlaid as pillar-colored
 * bands. Requires ≥2 weeks of data to draw a meaningful line; below
 * that shows an intentional empty state.
 */
export async function CompositeTrendCard({ userId }: { userId: string }) {
  const supabase = await createSupabaseServerClient();

  // Fetch all check-ins + all missions + all goals. We don't scope by
  // date because "his full history" is the spec — the card is a lookback.
  const [{ data: checkins }, { data: missions }, { data: goals }] = await Promise.all([
    supabase
      .from("daily_checkins")
      .select("date, value")
      .eq("user_id", userId),
    supabase
      .from("missions")
      .select("target_date, status, completed_late")
      .eq("user_id", userId),
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
  const missionRows = (missions ?? []) as Array<{
    target_date: string;
    status: string;
    completed_late: boolean;
  }>;

  // Bucket check-ins + missions by Monday-anchored ISO week.
  const weekBuckets = new Map<
    string,
    { dailyTotal: number; completed: number; missed: number }
  >();
  for (const r of checkinRows) {
    const week = mondayIsoUTC(r.date);
    const b = weekBuckets.get(week) ?? { dailyTotal: 0, completed: 0, missed: 0 };
    if (r.value === 1) b.dailyTotal += 1;
    weekBuckets.set(week, b);
  }
  for (const m of missionRows) {
    const week = mondayIsoUTC(m.target_date);
    const b = weekBuckets.get(week) ?? { dailyTotal: 0, completed: 0, missed: 0 };
    if (m.status === "completed") b.completed += 1;
    else if (m.status === "missed") b.missed += 1;
    weekBuckets.set(week, b);
  }

  const weeks = [...weekBuckets.keys()].sort();
  if (weeks.length < 2) {
    return (
      <CardEmpty
        title="Composite score trend"
        message="Once you have two full weeks of check-ins, your weekly composite will chart here alongside the goals you had running each week."
      />
    );
  }

  const data = weeks.map((week) => {
    const b = weekBuckets.get(week)!;
    const rate =
      b.completed + b.missed > 0
        ? b.completed / (b.completed + b.missed)
        : 0;
    return {
      week: week.slice(5), // MM-DD for compact axis
      composite: leaderboardComposite(b.dailyTotal, rate),
    };
  });

  // Build goal bands. Each goal's window is its quarter_start to
  // start_of_next_quarter (or the last week we have data for,
  // whichever is earlier). Skip goals whose quarter starts after
  // the last week of data.
  const lastWeekIso = weeks[weeks.length - 1];
  const firstWeekIso = weeks[0];
  const goalBands = ((goals ?? []) as Array<{
    focus_area: PillarCode;
    quarter_start: string;
  }>)
    .map((g) => {
      const quarterStartWeek = mondayIsoUTC(g.quarter_start);
      const quarterEndIso = shiftQuarterStart(g.quarter_start, 1);
      const quarterEndWeek = mondayIsoUTC(quarterEndIso);
      // Clamp to available data range.
      const startWeek =
        quarterStartWeek < firstWeekIso ? firstWeekIso : quarterStartWeek;
      const endWeek =
        quarterEndWeek > lastWeekIso ? lastWeekIso : quarterEndWeek;
      if (startWeek > lastWeekIso || endWeek < firstWeekIso) return null;
      return {
        startWeek: startWeek.slice(5),
        endWeek: endWeek.slice(5),
        pillar: g.focus_area,
        label: PILLAR_BY_CODE[g.focus_area].label,
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  return (
    <DashboardCard
      title="Composite score trend"
      subtitle="Weekly composite (70% habits, 30% missions). Colored bands mark the quarters where a goal was running."
    >
      <CompositeTrendChart data={data} goalBands={goalBands} />
    </DashboardCard>
  );
}

/** Monday of the week containing the given ISO date (UTC). */
function mondayIsoUTC(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 Sun, 1 Mon, ..., 6 Sat
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
