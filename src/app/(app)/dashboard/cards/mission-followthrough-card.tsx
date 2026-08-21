import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CardEmpty, DashboardCard } from "./card-shell";
import { MissionFollowThroughChart } from "./mission-followthrough-chart";

/**
 * Card 3.4 — weekly mission follow-through. Two stacked series so
 * the on-time vs completed-late distinction is visible (matches how
 * the scoring layer already treats completed_late per §6). Missed +
 * abandoned + rolled_over excluded from the numerator so the rate
 * is "of the missions I set for the week, what fraction did I
 * actually deliver."
 */
export async function MissionFollowThroughCard({ userId }: { userId: string }) {
  const supabase = await createSupabaseServerClient();
  const { data: missions } = await supabase
    .from("missions")
    .select("target_date, status, completed_late")
    .eq("user_id", userId);

  const rows = (missions ?? []) as Array<{
    target_date: string;
    status: string;
    completed_late: boolean;
  }>;

  const buckets = new Map<
    string,
    { completedOnTime: number; completedLate: number; missed: number }
  >();
  for (const m of rows) {
    if (m.status === "rolled_over" || m.status === "abandoned") continue;
    const week = mondayIsoUTC(m.target_date);
    const b = buckets.get(week) ?? {
      completedOnTime: 0,
      completedLate: 0,
      missed: 0,
    };
    if (m.status === "completed") {
      if (m.completed_late) b.completedLate += 1;
      else b.completedOnTime += 1;
    } else if (m.status === "missed") {
      b.missed += 1;
    }
    buckets.set(week, b);
  }

  const weeks = [...buckets.keys()].sort();
  if (weeks.length < 2) {
    return (
      <CardEmpty
        title="Mission completion trend"
        message="Once you have two full weeks with completed or missed missions, your on-time vs late rate will chart here."
      />
    );
  }

  const data = weeks.map((w) => {
    const b = buckets.get(w)!;
    const total = b.completedOnTime + b.completedLate + b.missed;
    const onTime = total > 0 ? Math.round((b.completedOnTime / total) * 100) : 0;
    const late = total > 0 ? Math.round((b.completedLate / total) * 100) : 0;
    return { week: w.slice(5), onTime, late };
  });

  return (
    <DashboardCard
      title="Mission completion trend"
      subtitle="Weekly completion rate as a percentage. On-time and completed-late shown separately so you can see how much was finished the week you set it vs after."
    >
      <MissionFollowThroughChart data={data} />
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
