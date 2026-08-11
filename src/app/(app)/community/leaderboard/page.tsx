import Link from "next/link";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LeaderboardRow } from "@/components/ui/leaderboard-row";
import { EmptyState } from "@/components/ui/empty-state";
import { assembleWeekly } from "@/lib/scoring/leaderboard";
import { engagementStreaksByUser } from "@/lib/scoring/streaks";
import { localDate, localMonday, weekDates } from "@/lib/scoring/week";
import type { PillarCode } from "@/lib/pillars";
import { format, subDays } from "date-fns";

export const dynamic = "force-dynamic";

type Tab = "weekly" | "monthly" | "streaks";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: Tab }>;
}) {
  const { user } = await requireAccess();
  const params = await searchParams;
  const tab: Tab = params.tab ?? "weekly";
  const supabase = await createSupabaseServerClient();

  const { data: myMembership } = await supabase
    .from("memberships")
    .select("community_id, communities:community_id(name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!myMembership) {
    return <EmptyState title="No community yet." />;
  }
  const communityId = myMembership.community_id as string;
  const communityName = (() => {
    const c = (myMembership.communities as unknown) as
      | { name: string }
      | { name: string }[]
      | null;
    if (!c) return "";
    return Array.isArray(c) ? c[0]?.name ?? "" : c.name;
  })();

  const { data: roster } = await supabase
    .from("memberships")
    .select("user_id, users:user_id(first_name, last_name)")
    .eq("community_id", communityId)
    .eq("status", "active");

  const users = (roster ?? []).map((r) => {
    const raw = (r.users as unknown) as
      | { first_name: string | null; last_name: string | null }
      | { first_name: string | null; last_name: string | null }[]
      | null;
    const u = Array.isArray(raw) ? raw[0] ?? null : raw;
    return { id: r.user_id as string, first_name: u?.first_name ?? null, last_name: u?.last_name ?? null };
  });
  const memberIds = users.map((u) => u.id);

  const today = localDate(new Date(), user.timezone);
  const monday = localMonday(new Date(), user.timezone);
  const week = weekDates(monday);
  const priorMonday = format(subDays(new Date(`${monday}T00:00:00`), 7), "yyyy-MM-dd");
  const priorWeek = weekDates(priorMonday);
  const streakWindowStart = format(subDays(new Date(`${today}T00:00:00`), 60), "yyyy-MM-dd");

  // Pull once, filter in memory.
  const { data: checkins } = await supabase
    .from("daily_checkins")
    .select("user_id, date, pillar_code, value")
    .in("user_id", memberIds)
    .gte("date", streakWindowStart);
  const { data: missions } = await supabase
    .from("missions")
    .select("user_id, target_date, status")
    .in("user_id", memberIds)
    .gte("target_date", priorMonday);

  const checkinsAll = (checkins ?? []) as {
    user_id: string;
    date: string;
    pillar_code: PillarCode;
    value: 0 | 1;
  }[];
  const missionsAll = (missions ?? []) as {
    user_id: string;
    target_date: string;
    status: "planned" | "completed" | "missed" | "rolled_over";
  }[];

  const streaks = engagementStreaksByUser(checkinsAll, today);

  const priorEntries = assembleWeekly({
    users,
    checkins: checkinsAll,
    missions: missionsAll,
    weekDates: priorWeek,
    priorWeekComposites: {},
    engagementStreaks: {},
  });
  const priorComposite: Record<string, number> = {};
  for (const e of priorEntries) priorComposite[e.user_id] = e.composite;

  let entries;
  if (tab === "monthly") {
    // Last 28 days
    const monthDates: string[] = [];
    for (let i = 0; i < 28; i++) {
      monthDates.push(format(subDays(new Date(`${today}T00:00:00`), i), "yyyy-MM-dd"));
    }
    entries = assembleWeekly({
      users,
      checkins: checkinsAll,
      missions: missionsAll,
      weekDates: monthDates,
      priorWeekComposites: {},
      engagementStreaks: streaks,
    });
  } else if (tab === "streaks") {
    entries = users
      .map((u) => ({
        user_id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        daily_total: 0,
        mission_completed: 0,
        mission_missed: 0,
        mission_rate: 0,
        composite: streaks[u.id] ?? 0,
        streak_days: streaks[u.id] ?? 0,
        delta_vs_prior: 0,
      }))
      .sort((a, b) => b.streak_days - a.streak_days);
  } else {
    entries = assembleWeekly({
      users,
      checkins: checkinsAll,
      missions: missionsAll,
      weekDates: week,
      priorWeekComposites: priorComposite,
      engagementStreaks: streaks,
    });
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          {communityName.toUpperCase()}
        </p>
        <h1 className="font-heading text-3xl">Leaderboard</h1>
      </header>

      <nav className="flex gap-1 border-b border-[color:var(--color-border)]">
        {(["weekly", "monthly", "streaks"] as Tab[]).map((t) => {
          const active = tab === t;
          return (
            <Link
              key={t}
              href={`/community/leaderboard?tab=${t}`}
              className="h-10 px-4 flex items-center font-heading text-xs tracking-widest border-b-2"
              style={{
                color: active ? "var(--color-accent)" : "var(--color-text-muted)",
                borderBottomColor: active ? "var(--color-accent)" : "transparent",
              }}
            >
              {t.toUpperCase()}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2">
        {entries.length === 0 ? (
          <EmptyState title="Empty leaderboard." />
        ) : (
          entries.map((e, i) => (
            <LeaderboardRow
              key={e.user_id}
              rank={i + 1}
              name={[e.first_name, e.last_name].filter(Boolean).join(" ") || "Unnamed"}
              dailyTotal={e.daily_total}
              missionRate={e.mission_rate}
              composite={e.composite}
              streakDays={e.streak_days}
              delta={tab === "weekly" ? e.delta_vs_prior : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
