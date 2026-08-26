import Link from "next/link";
import { format } from "date-fns";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { PILLARS, type PillarCode } from "@/lib/pillars";
import {
  computeCommunityStats,
  rankDeltas,
  type RawCheckin,
  type RawMission,
  type Member,
  type MemberStats,
} from "@/lib/scoring/community-stats";
import { loadPeopleDirectory } from "@/lib/community/people-directory";
import { PeopleTab } from "./people-tab";
import { CommunityTabs } from "./community-tabs";
import { UserAvatar } from "@/components/ui/user-avatar";

export const dynamic = "force-dynamic";

type Tab = "leaderboard" | "people";

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: Tab }>;
}) {
  const { user } = await requireAccess();
  const params = await searchParams;
  const tab: Tab = params.tab === "people" ? "people" : "leaderboard";

  // People tab renders on top of the same /community route via
  // ?tab=people. Keeps a single nav item, single route, one shared
  // header — matches how the existing /community/leaderboard sub-page
  // uses ?tab= to switch weekly/monthly/streaks.
  if (tab === "people") {
    const dir = await loadPeopleDirectory(user.id);
    return (
      <div className="max-w-3xl mx-auto space-y-6 py-2">
        <PeopleHeader communityNames={dir?.communityNames ?? []} count={dir?.members.length ?? 0} />
        <CommunityTabs active="people" />
        {dir === null ? (
          <EmptyState
            title="People directory unavailable."
            body="Refresh in a minute. Server hiccup."
          />
        ) : dir.members.length === 0 ? (
          <EmptyState
            title="No brothers to show yet."
            body="Once other men in your community are active, they'll appear here."
          />
        ) : (
          <PeopleTab members={dir.members} viewerId={user.id} />
        )}
      </div>
    );
  }

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

  // Roster. Also pulls avatar_url + email so the leaderboard rows
  // can render <UserAvatar> and the message-button deep link.
  const { data: roster } = await supabase
    .from("memberships")
    .select(
      "user_id, status, role, users:user_id(first_name, last_name, email, avatar_url)",
    )
    .eq("community_id", communityId)
    .eq("status", "active");

  // Enrichment map for the leaderboard render — avatar + email
  // aren't part of the community-stats Member type, so we build a
  // parallel lookup keyed by user_id.
  const enrichmentByUser = new Map<
    string,
    {
      avatar_url: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string;
    }
  >();
  for (const r of (roster ?? []) as Array<{
    user_id: string;
    users:
      | {
          first_name: string | null;
          last_name: string | null;
          email: string;
          avatar_url: string | null;
        }
      | {
          first_name: string | null;
          last_name: string | null;
          email: string;
          avatar_url: string | null;
        }[]
      | null;
  }>) {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    if (!u) continue;
    enrichmentByUser.set(r.user_id, {
      avatar_url: u.avatar_url ?? null,
      first_name: u.first_name ?? null,
      last_name: u.last_name ?? null,
      email: u.email,
    });
  }

  // Threads the viewer already has with any member — so the MESSAGE
  // button deep-links straight into the existing thread instead of
  // going through the resolver.
  const [{ data: threadsA }, { data: threadsB }] = await Promise.all([
    supabase
      .from("message_threads")
      .select("id, participant_b")
      .eq("participant_a", user.id),
    supabase
      .from("message_threads")
      .select("id, participant_a")
      .eq("participant_b", user.id),
  ]);
  const threadByOtherUser = new Map<string, string>();
  for (const r of (threadsA ?? []) as Array<{ id: string; participant_b: string }>) {
    threadByOtherUser.set(r.participant_b, r.id);
  }
  for (const r of (threadsB ?? []) as Array<{ id: string; participant_a: string }>) {
    threadByOtherUser.set(r.participant_a, r.id);
  }

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

  // ---- Tier 1: combined weekly ranking (Daily + Missions) ----
  // Ranking rule: combined_total (daily + completed missions) desc,
  // tiebreaker on daily. Matches the leaderboard.ts sort used on
  // /community/leaderboard so both surfaces read the same.
  const combinedWeek = [...stats.members].sort((a, b) => {
    const aCombined = a.weekTotal + a.weekMissionsCompleted;
    const bCombined = b.weekTotal + b.weekMissionsCompleted;
    if (bCombined !== aCombined) return bCombined - aCombined;
    return b.weekTotal - a.weekTotal;
  });
  const meRank = meRow
    ? combinedWeek.findIndex((m) => m.userId === user.id) + 1
    : 0;

  // Prior-week combined for delta.
  const combinedWeekPrev = [...stats.members].sort(
    (a, b) => b.weekTotalPrev - a.weekTotalPrev,
  );
  const priorDeltas = rankDeltas(combinedWeek, combinedWeekPrev);

  // ---- Tier 2 (collapsed): 4-week, quality, streaks, pillar kings ----
  const combinedFour = [...stats.members].sort((a, b) => {
    const aCombined = a.fourWeekTotal + a.fourWeekMissionsCompleted;
    const bCombined = b.fourWeekTotal + b.fourWeekMissionsCompleted;
    return bCombined - aCombined;
  });
  const qualityRanked = stats.members
    .filter((m) => m.avgQualityScore !== null && m.qualityScoredCount >= 3)
    .sort((a, b) => (b.avgQualityScore ?? 0) - (a.avgQualityScore ?? 0));
  const engagementStreakRanked = sortDesc(
    stats.members,
    (m) => m.engagementStreak,
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-2">
      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          WEEK OF {format(new Date(`${stats.weekMonday}T00:00:00`), "MMM d")} ·{" "}
          {members.length} BROTHERS
        </p>
        <h1 className="font-heading text-3xl">{communityName}</h1>
      </header>

      <CommunityTabs active="leaderboard" />

      {/* Tier 1a — You this week: big prominent card */}
      {meRow ? (
        <section className="p-5 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border-2 border-[color:var(--color-primary)]/40">
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-primary)]">
            YOU THIS WEEK
          </p>
          <p className="font-heading text-3xl mt-1">
            {meRank > 0 ? ordinal(meRank) : "—"}
            <span className="text-base text-[color:var(--color-text-muted)]">
              {" "}
              of {members.length}
            </span>
          </p>
          <div className="mt-3 grid grid-cols-3 gap-4">
            <MeStat
              label="DAILY"
              value={meRow.weekTotal}
              max={49}
            />
            <MeStat
              label="MISSIONS"
              value={meRow.weekMissionsCompleted}
              max={meRow.weekMissionsPlanned || meRow.weekMissionsCompleted}
            />
            <MeStat
              label="TOTAL"
              value={meRow.weekTotal + meRow.weekMissionsCompleted}
              max={49 + meRow.weekMissionsPlanned}
              accent
            />
          </div>
        </section>
      ) : null}

      {/* Tier 1b — Combined weekly leaderboard, one card, one list */}
      <section className="rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[color:var(--color-border)]">
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-primary)]">
            THIS WEEK · LEADERBOARD
          </p>
          <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
            Ranked by combined total (daily + completed missions).
          </p>
        </div>
        <ol className="divide-y divide-[color:var(--color-border)]">
          {combinedWeek.map((m, i) => {
            const combined = m.weekTotal + m.weekMissionsCompleted;
            const combinedMax = 49 + m.weekMissionsPlanned;
            const delta = priorDeltas[m.userId] ?? 0;
            const isMe = m.userId === user.id;
            const e = enrichmentByUser.get(m.userId);
            const messageHref = threadByOtherUser.get(m.userId)
              ? `/messages/${threadByOtherUser.get(m.userId)}`
              : `/messages/with/${m.userId}`;
            return (
              <li
                key={m.userId}
                className={
                  "px-4 sm:px-5 py-3 grid grid-cols-[24px_32px_1fr_auto_auto] items-center gap-3 " +
                  (isMe
                    ? "bg-[color:var(--color-primary)]/[0.08]"
                    : "")
                }
              >
                <span
                  className={
                    "text-sm font-heading " +
                    (i === 0
                      ? "text-[color:var(--color-accent)]"
                      : "text-[color:var(--color-text-muted)]")
                  }
                >
                  {i + 1}
                </span>
                <UserAvatar
                  url={e?.avatar_url ?? null}
                  firstName={e?.first_name ?? null}
                  lastName={e?.last_name ?? null}
                  email={e?.email ?? ""}
                  size="sm"
                />
                <div className="min-w-0">
                  <p className="font-heading text-sm truncate">
                    {m.name}
                    {isMe ? (
                      <span className="ml-1.5 text-[10px] tracking-widest text-[color:var(--color-primary)]">
                        (YOU)
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[11px] text-[color:var(--color-text-muted)]">
                    Daily {m.weekTotal}/49 · Missions{" "}
                    {m.weekMissionsCompleted}/
                    {m.weekMissionsPlanned || m.weekMissionsCompleted}
                    {delta !== 0 ? (
                      <>
                        {" · "}
                        <span
                          className="font-heading"
                          title={`${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} vs last week`}
                          style={{
                            color:
                              delta > 0
                                ? "var(--color-success)"
                                : "var(--color-danger)",
                          }}
                        >
                          {delta > 0 ? "▲" : "▼"}
                          {Math.abs(delta)}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-heading text-lg text-[color:var(--color-accent)]">
                    {combined}
                    <span className="text-[10px] text-[color:var(--color-text-muted)]">
                      /{combinedMax}
                    </span>
                  </p>
                </div>
                {/* Message action — hidden for the viewer's own row
                    (can't message yourself). Icon-only to keep the
                    row compact; hover reveals the tooltip. */}
                {isMe ? (
                  <span aria-hidden className="w-8" />
                ) : (
                  <Link
                    href={messageHref}
                    aria-label="Message this brother"
                    title={`Message ${m.name}`}
                    className="h-8 w-8 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:border-[color:var(--color-primary)] hover:bg-[color:var(--color-primary)]/10 flex items-center justify-center text-[color:var(--color-text-muted)] hover:text-white transition-colors cursor-pointer"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                      aria-hidden
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* Tier 2 — collapsed by default. Native <details> for a
          server-friendly expand with zero client code. */}
      <details className="group rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] overflow-hidden">
        <summary className="px-5 py-3 cursor-pointer list-none flex items-center justify-between font-heading text-xs tracking-widest text-[color:var(--color-text-muted)] hover:text-white">
          <span>MORE METRICS</span>
          <span className="transition-transform group-open:rotate-180">▼</span>
        </summary>
        <div className="border-t border-[color:var(--color-border)] px-5 py-5 space-y-6">
          <MetricList
            title="Last 4 weeks · Combined"
            hint="Running 28-day total. Shows who compounds."
            rows={combinedFour.map((m, i) => ({
              rank: i + 1,
              name: m.name,
              isMe: m.userId === user.id,
              primary: `${m.fourWeekTotal + m.fourWeekMissionsCompleted}`,
              secondary: `Daily ${m.fourWeekTotal} · Missions ${m.fourWeekMissionsCompleted}`,
            }))}
          />
          <MetricList
            title="Mission quality · last 28 days"
            hint="Avg quality score (0-10). Min 3 scored missions to qualify."
            emptyText="Set at least 3 scored missions to qualify."
            rows={qualityRanked.map((m, i) => ({
              rank: i + 1,
              name: m.name,
              isMe: m.userId === user.id,
              primary: (m.avgQualityScore ?? 0).toFixed(1),
              secondary: `${m.qualityScoredCount} missions scored`,
            }))}
          />
          <MetricList
            title="Engagement streaks"
            hint="Consecutive days ending today with at least one log."
            rows={engagementStreakRanked.map((m, i) => ({
              rank: i + 1,
              name: m.name,
              isMe: m.userId === user.id,
              primary: `${m.engagementStreak}d`,
              secondary:
                m.engagementStreak > 0 ? "consecutive days" : "none",
            }))}
          />
          <PillarKings pillarKings={stats.pillarKings} />
        </div>
      </details>
    </div>
  );
}

function PeopleHeader({
  communityNames,
  count,
}: {
  communityNames: string[];
  count: number;
}) {
  const title = communityNames.length === 0
    ? "Community"
    : communityNames.join(", ");
  return (
    <header>
      <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
        {count} {count === 1 ? "BROTHER" : "BROTHERS"}
      </p>
      <h1 className="font-heading text-3xl">{title}</h1>
    </header>
  );
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function MeStat({
  label,
  value,
  max,
  accent = false,
}: {
  label: string;
  value: number;
  max: number;
  accent?: boolean;
}) {
  return (
    <div>
      <p
        className={
          "font-heading text-2xl leading-none " +
          (accent ? "text-[color:var(--color-accent)]" : "")
        }
      >
        {value}
        <span className="text-sm text-[color:var(--color-text-muted)]">
          /{max}
        </span>
      </p>
      <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mt-1">
        {label}
      </p>
    </div>
  );
}

function MetricList({
  title,
  hint,
  rows,
  emptyText,
}: {
  title: string;
  hint: string;
  rows: Array<{
    rank: number;
    name: string;
    isMe: boolean;
    primary: string;
    secondary: string;
  }>;
  emptyText?: string;
}) {
  return (
    <div>
      <div className="mb-3">
        <p className="font-heading text-sm">{title}</p>
        <p className="text-[11px] text-[color:var(--color-text-muted)] mt-0.5">
          {hint}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-[color:var(--color-text-muted)] italic">
          {emptyText ?? "No data yet."}
        </p>
      ) : (
        <ol className="space-y-1.5">
          {rows.slice(0, 5).map((r) => (
            <li
              key={r.rank}
              className={
                "grid grid-cols-[28px_1fr_auto] items-center gap-2 text-sm px-2 py-1 rounded " +
                (r.isMe ? "bg-[color:var(--color-primary)]/[0.08]" : "")
              }
            >
              <span className="text-xs text-[color:var(--color-text-muted)]">
                {r.rank}
              </span>
              <span className="truncate">
                {r.name}
                {r.isMe ? (
                  <span className="ml-1.5 text-[10px] tracking-widest text-[color:var(--color-primary)]">
                    (YOU)
                  </span>
                ) : null}
              </span>
              <span className="text-right">
                <span className="font-heading">{r.primary}</span>
                <span className="block text-[10px] text-[color:var(--color-text-muted)]">
                  {r.secondary}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function PillarKings({
  pillarKings,
}: {
  pillarKings: Record<PillarCode, { userId: string; name: string; score: number } | null>;
}) {
  return (
    <div>
      <div className="mb-3">
        <p className="font-heading text-sm">Pillar Kings · this week</p>
        <p className="text-[11px] text-[color:var(--color-text-muted)] mt-0.5">
          Top man in each pillar. Everyone can lead something.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {PILLARS.map((p) => {
          const king = pillarKings[p.code];
          const label = p.code === "A2" ? "Action" : p.label;
          return (
            <div
              key={p.code}
              className="p-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
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
                  <p className="text-xs font-heading mt-1.5 break-words">
                    {king.name}
                  </p>
                  <p className="text-[10px] text-[color:var(--color-text-muted)] mt-0.5">
                    {king.score}/7 this week
                  </p>
                </>
              ) : (
                <p className="text-[10px] text-[color:var(--color-text-muted)] mt-1.5">
                  Throne is open.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- helpers ----

function sortDesc<T>(items: T[], key: (t: T) => number): T[] {
  return [...items].sort((a, b) => key(b) - key(a));
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
