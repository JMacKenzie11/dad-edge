import Link from "next/link";
import { format } from "date-fns";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { PILLARS, PILLAR_BY_CODE, type PillarCode } from "@/lib/pillars";
import {
  computeCommunityStats,
  rankDeltas,
  type RawCheckin,
  type RawMission,
  type Member,
  type MemberStats,
} from "@/lib/scoring/community-stats";
import { LeaderboardCard, GridSection, type LeaderboardRow } from "./leaderboard-card";

export const dynamic = "force-dynamic";

const TOP_N = 3;

export default async function CommunityPage() {
  const { user } = await requireAccess();
  const supabase = await createSupabaseServerClient();

  const { data: membership } = await supabase
    .from("memberships")
    .select("community_id, communities:community_id(name, timezone)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return (
      <div className="max-w-2xl mx-auto">
        <EmptyState
          title="No community yet."
          body="Your leader will send you an invite. Sit tight."
        />
      </div>
    );
  }

  const communityId = membership.community_id as string;
  const communityRaw = membership.communities as
    | { name: string; timezone: string }
    | { name: string; timezone: string }[]
    | null;
  const community = Array.isArray(communityRaw) ? communityRaw[0] : communityRaw;
  const communityName = community?.name ?? "Brothers";
  const communityTz = community?.timezone ?? "America/Chicago";

  // Roster.
  const { data: roster } = await supabase
    .from("memberships")
    .select("user_id, status, role, users:user_id(first_name, last_name)")
    .eq("community_id", communityId)
    .eq("status", "active");

  const members: Member[] = ((roster ?? []) as {
    user_id: string;
    status: "active" | "inactive";
    role: "member" | "leader";
    users:
      | { first_name: string | null; last_name: string | null }
      | { first_name: string | null; last_name: string | null }[]
      | null;
  }[])
    .map((r) => {
      const u = Array.isArray(r.users) ? r.users[0] : r.users;
      const name =
        [u?.first_name, u?.last_name].filter(Boolean).join(" ") || "Unnamed brother";
      return { user_id: r.user_id, name, role: r.role, status: r.status };
    });
  const memberIds = members.map((m) => m.user_id);

  if (memberIds.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <EmptyState
          title="No active members yet."
          body="Invites pending — check back once your brothers sign in."
        />
      </div>
    );
  }

  // Compute the 4-week window bound to send to Supabase.
  const monday = todayMondayISO(communityTz);
  const fourWeekStart = shiftDate(monday, -21);
  const nextMonday = shiftDate(monday, 7);

  const [{ data: rawCheckins }, { data: rawMissions }] = await Promise.all([
    supabase
      .from("daily_checkins")
      .select("user_id, date, pillar_code, value")
      .in("user_id", memberIds)
      .gte("date", fourWeekStart)
      .lt("date", nextMonday),
    supabase
      .from("missions")
      .select("user_id, target_date, status, completed_late, quality_score")
      .in("user_id", memberIds)
      .gte("target_date", fourWeekStart)
      .lt("target_date", nextMonday),
  ]);

  const stats = computeCommunityStats({
    members,
    checkins: (rawCheckins ?? []) as RawCheckin[],
    missions: (rawMissions ?? []) as RawMission[],
    timezone: communityTz,
  });

  const meRow = stats.members.find((m) => m.userId === user.id);
  const isSelf = (id: string) => id === user.id;

  // ---- Leaderboards ----
  const weekDaily = sortDesc(stats.members, (m) => m.weekTotal);
  const weekDailyPrev = sortDesc(stats.members, (m) => m.weekTotalPrev);
  const weekDeltas = rankDeltas(weekDaily, weekDailyPrev);

  const weekMissionsRanked = [...stats.members].sort((a, b) => {
    if (b.weekMissionsCompleted !== a.weekMissionsCompleted) {
      return b.weekMissionsCompleted - a.weekMissionsCompleted;
    }
    return b.weekMissionsOnTimeRate - a.weekMissionsOnTimeRate;
  });

  const fourDaily = sortDesc(stats.members, (m) => m.fourWeekTotal);
  const fourMissions = [...stats.members].sort((a, b) => {
    if (b.fourWeekMissionsCompleted !== a.fourWeekMissionsCompleted) {
      return b.fourWeekMissionsCompleted - a.fourWeekMissionsCompleted;
    }
    return b.fourWeekMissionsOnTimeRate - a.fourWeekMissionsOnTimeRate;
  });

  const qualityRanked = stats.members
    .filter((m) => m.avgQualityScore !== null && m.qualityScoredCount >= 3)
    .sort((a, b) => (b.avgQualityScore ?? 0) - (a.avgQualityScore ?? 0));

  const engagementStreakRanked = sortDesc(stats.members, (m) => m.engagementStreak);

  // Rows.
  const weekDailyRows = topRows(weekDaily, isSelf, (m) => ({
    primary: `${m.weekTotal}/56`,
    secondary: `vs ${m.weekTotalPrev} last wk`,
    delta: weekDeltas[m.userId] ?? 0,
  }));

  const weekMissionsRows = topRows(weekMissionsRanked, isSelf, (m) => ({
    primary: `${m.weekMissionsCompleted}/${m.weekMissionsAttempted || m.weekMissionsCompleted}`,
    secondary: m.weekMissionsCompleted > 0
      ? `${Math.round(m.weekMissionsOnTimeRate * 100)}% on time`
      : "no missions yet",
  }));

  const fourDailyRows = topRows(fourDaily, isSelf, (m) => ({
    primary: `${m.fourWeekTotal}`,
    secondary: "over 28 days",
  }));

  const fourMissionsRows = topRows(fourMissions, isSelf, (m) => ({
    primary: `${m.fourWeekMissionsCompleted}`,
    secondary: `${Math.round(m.fourWeekMissionsOnTimeRate * 100)}% on time`,
  }));

  const qualityRows = topRows(qualityRanked, isSelf, (m) => ({
    primary: (m.avgQualityScore ?? 0).toFixed(1),
    secondary: `${m.qualityScoredCount} missions scored`,
  }));

  const streakRows = topRows(engagementStreakRanked, isSelf, (m) => ({
    primary: `${m.engagementStreak}d`,
    secondary: m.engagementStreak > 0 ? "consecutive days" : "none",
  }));

  return (
    <div className="max-w-6xl mx-auto space-y-10 py-2">
      <header className="flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            WEEK OF {format(new Date(`${stats.weekMonday}T00:00:00`), "MMM d")} · {members.length}{" "}
            BROTHERS
          </p>
          <h1 className="font-heading text-3xl">{communityName}</h1>
        </div>
        {meRow ? (
          <div className="text-right">
            <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
              YOU THIS WEEK
            </p>
            <p className="font-heading text-2xl">
              {meRow.weekTotal}
              <span className="text-sm text-[color:var(--color-text-muted)]">/56</span>
              <span className="mx-2 text-[color:var(--color-text-muted)]">·</span>
              {meRow.weekMissionsCompleted}
              <span className="text-sm text-[color:var(--color-text-muted)]">/
                {meRow.weekMissionsAttempted || meRow.weekMissionsCompleted} missions
              </span>
            </p>
          </div>
        ) : null}
      </header>

      <GridSection>
        <LeaderboardCard
          label="THIS WEEK · DAILY LIVING"
          title="Consistency"
          hint="Sum of check-ins across 8 pillars × 7 days. ▲/▼ shows rank vs last week."
          rows={weekDailyRows}
          emptyText="Log a check-in to get on the board."
        />
        <LeaderboardCard
          label="THIS WEEK · MISSIONS"
          title="Execution"
          hint="Completed / attempted. Tie-breaker: on-time %."
          rows={weekMissionsRows}
          emptyText="Set a mission to get on the board."
        />
        <LeaderboardCard
          label="LAST 4 WEEKS · DAILY LIVING"
          title="Endurance"
          hint="Running 28-day total. Shows who compounds."
          rows={fourDailyRows}
        />
        <LeaderboardCard
          label="LAST 4 WEEKS · MISSIONS"
          title="Volume"
          hint="Completed missions over the last month."
          rows={fourMissionsRows}
        />
        <LeaderboardCard
          label="MISSION QUALITY"
          title="Aim"
          hint="Avg quality score (0–10) across missions in the last 28 days. Min 3 to qualify."
          rows={qualityRows}
          emptyText="Set at least 3 scored missions to qualify."
        />
        <LeaderboardCard
          label="ENGAGEMENT STREAKS"
          title="Show up"
          hint="Consecutive days ending today with at least one log."
          rows={streakRows}
        />
      </GridSection>

      <section>
        <div className="mb-5">
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-primary)]">
            PILLAR KINGS · THIS WEEK
          </p>
          <p className="text-sm text-[color:var(--color-text-muted)] mt-2">
            Top man in each pillar this week. Everyone can lead something.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {PILLARS.map((p) => {
            const king = stats.pillarKings[p.code];
            const label = p.code === "A2" ? "Action" : p.label;
            return (
              <div
                key={p.code}
                className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
                style={{ borderLeft: `3px solid ${p.colorVar}` }}
              >
                <p
                  className="text-[10px] font-heading tracking-widest"
                  style={{ color: p.colorVar }}
                >
                  {label.toUpperCase()}
                </p>
                {king ? (
                  <>
                    <p className="text-sm font-heading mt-2 break-words">
                      {king.name}
                    </p>
                    <p className="text-[10px] text-[color:var(--color-text-muted)] mt-1">
                      {king.score}/7 this week
                    </p>
                  </>
                ) : (
                  <p className="text-[10px] text-[color:var(--color-text-muted)] mt-2">
                    Throne is open.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <p className="text-[11px] text-[color:var(--color-text-muted)] text-center pt-4">
        <Link href="/today" className="hover:text-[color:var(--color-primary)]">
          ← back to your day
        </Link>
      </p>
    </div>
  );
}

// ---- helpers ----

function sortDesc<T>(items: T[], key: (t: T) => number): T[] {
  return [...items].sort((a, b) => key(b) - key(a));
}

function topRows(
  ranked: MemberStats[],
  isSelf: (id: string) => boolean,
  map: (m: MemberStats) => Omit<LeaderboardRow, "userId" | "name" | "highlight">,
): LeaderboardRow[] {
  const top = ranked.slice(0, TOP_N);
  const selfIdx = ranked.findIndex((m) => isSelf(m.userId));
  const rows: LeaderboardRow[] = top.map((m) => ({
    userId: m.userId,
    name: m.name,
    highlight: isSelf(m.userId),
    ...map(m),
  }));
  // If self is outside the top N, append a divider row showing them.
  if (selfIdx >= TOP_N && ranked[selfIdx]) {
    const m = ranked[selfIdx];
    rows.push({
      userId: `self-${m.userId}`,
      name: `${m.name} (you · #${selfIdx + 1})`,
      highlight: true,
      ...map(m),
    });
  }
  return rows;
}

function todayMondayISO(tz: string): string {
  // Delegate to scoring/week helper via a lightweight inline calc — avoids the
  // date-fns-tz roundtrip when we already have the community timezone string.
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const weekdayIdx =
    ({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 } as Record<string, number>)[wd] ?? 0;
  const base = new Date(`${y}-${m}-${d}T00:00:00`);
  base.setDate(base.getDate() - weekdayIdx);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
