import Link from "next/link";
import { resolveLeaderCommunity } from "@/lib/leader-context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { classifyDisengagement, isoDateNDaysAgo } from "@/lib/scoring/disengagement";
import { localMonday, weekDates, dailyLivingWeekTotal } from "@/lib/scoring/week";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function LeaderOverview({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const sp = await searchParams;
  const { user, communityId, communityName } = await resolveLeaderCommunity(sp);
  const svc = createSupabaseServiceClient();

  const monday = localMonday(new Date(), user.timezone);
  const week = weekDates(monday);

  const { data: memberships } = await svc
    .from("memberships")
    .select("user_id, status, users:user_id(first_name, last_name, email)")
    .eq("community_id", communityId)
    .eq("status", "active");

  const memberIds = (memberships ?? []).map((m) => (m as { user_id: string }).user_id);
  const [{ data: checkins }, { data: missions }] = await Promise.all([
    memberIds.length
      ? svc.from("daily_checkins").select("user_id, date, value").in("user_id", memberIds).gte("date", isoDateNDaysAgo(30))
      : Promise.resolve({ data: [] }),
    memberIds.length
      ? svc
          .from("missions")
          .select("user_id, status, target_date")
          .in("user_id", memberIds)
          .gte("target_date", monday)
          .lte("target_date", week[6])
      : Promise.resolve({ data: [] }),
  ]);

  const lastByUser = new Map<string, string>();
  const weekTotalByUser = new Map<string, number>();
  for (const c of (checkins ?? []) as { user_id: string; date: string; value: number }[]) {
    const prev = lastByUser.get(c.user_id);
    if (!prev || c.date > prev) lastByUser.set(c.user_id, c.date);
    if (week.includes(c.date) && c.value === 1) {
      weekTotalByUser.set(c.user_id, (weekTotalByUser.get(c.user_id) ?? 0) + 1);
    }
  }

  let disengagedCount = 0;
  for (const id of memberIds) {
    const { bucket } = classifyDisengagement(lastByUser.get(id) ?? null);
    if (bucket === "day7" || bucket === "day14" || bucket === "day14plus") disengagedCount += 1;
  }

  const totalMissions = (missions ?? []).length;
  const completedMissions = ((missions ?? []) as { status: string }[]).filter(
    (m) => m.status === "completed",
  ).length;
  const avgDailyLiving =
    memberIds.length === 0
      ? 0
      : Math.round(
          memberIds.reduce((s, id) => s + (weekTotalByUser.get(id) ?? 0), 0) / memberIds.length,
        );

  const stats = [
    { label: "ACTIVE MEMBERS", value: memberIds.length, href: "/leader/members" },
    { label: "DISENGAGED", value: disengagedCount, href: "/leader/disengagement" },
    { label: "AVG WEEK TOTAL", value: `${avgDailyLiving}/49`, href: "/leader/members" },
    {
      label: "MISSIONS THIS WEEK",
      value: `${completedMissions}/${totalMissions}`,
      href: "/leader/members",
    },
  ];

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          COMMUNITY LEADER
        </p>
        <h1 className="font-heading text-3xl">{communityName}</h1>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="block p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] hover:border-[color:var(--color-accent)]"
          >
            <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
              {s.label}
            </p>
            <p className="font-heading text-2xl mt-1">{s.value}</p>
          </Link>
        ))}
      </section>

      <section>
        <h2 className="font-heading text-lg text-[color:var(--color-accent)] mb-3">Roster</h2>
        <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden text-sm">
          {(memberships ?? []).map((m) => {
            const raw = m as {
              user_id: string;
              users: { first_name: string | null; last_name: string | null; email: string } | { first_name: string | null; last_name: string | null; email: string }[] | null;
            };
            const u = Array.isArray(raw.users) ? raw.users[0] : raw.users;
            const last = lastByUser.get(raw.user_id) ?? null;
            const { daysSince } = classifyDisengagement(last);
            const total = weekTotalByUser.get(raw.user_id) ?? 0;
            return (
              <li key={raw.user_id} className="px-4 py-2 flex items-center justify-between">
                <span>
                  {u ? [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email : "—"}
                </span>
                <span className="text-xs text-[color:var(--color-text-muted)]">
                  {total}/49 · {last ? `${daysSince}d ago` : "no check-ins"}
                </span>
              </li>
            );
          })}
          {(memberships ?? []).length === 0 ? (
            <li className="px-4 py-8 text-sm text-[color:var(--color-text-muted)] text-center">
              No active members. Invite from{" "}
              <Link href="/leader/members" className="text-[color:var(--color-accent)]">
                Members
              </Link>
              .
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
