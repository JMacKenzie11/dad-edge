import Link from "next/link";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { classifyDisengagement, isoDateNDaysAgo } from "@/lib/scoring/disengagement";

export const dynamic = "force-dynamic";

export default async function DisengagementPage() {
  await requirePlatformAdmin();
  const svc = createSupabaseServiceClient();

  const { data: activeMembers } = await svc
    .from("memberships")
    .select("user_id, community_id, users:user_id(email, first_name, last_name, subscription_status), communities:community_id(name)")
    .eq("status", "active");

  const memberIds = (activeMembers ?? []).map((m) => (m as { user_id: string }).user_id);
  const since = isoDateNDaysAgo(30);

  const { data: checkins } = memberIds.length
    ? await svc
        .from("daily_checkins")
        .select("user_id, date")
        .in("user_id", memberIds)
        .gte("date", since)
    : { data: [] };

  const lastByUser = new Map<string, string>();
  for (const r of (checkins ?? []) as { user_id: string; date: string }[]) {
    const cur = lastByUser.get(r.user_id);
    if (!cur || r.date > cur) lastByUser.set(r.user_id, r.date);
  }

  type Row = {
    userId: string;
    communityId: string;
    communityName: string;
    email: string;
    name: string;
    subscriptionStatus: string;
    lastCheckin: string | null;
    daysSince: number;
    bucket: "day3" | "day7" | "day14" | "day14plus" | null;
  };

  const rows: Row[] = (activeMembers ?? []).map((m) => {
    const raw = m as {
      user_id: string;
      community_id: string;
      users:
        | { email: string; first_name: string | null; last_name: string | null; subscription_status: string }
        | { email: string; first_name: string | null; last_name: string | null; subscription_status: string }[]
        | null;
      communities: { name: string } | { name: string }[] | null;
    };
    const u = Array.isArray(raw.users) ? raw.users[0] : raw.users;
    const c = Array.isArray(raw.communities) ? raw.communities[0] : raw.communities;
    const last = lastByUser.get(raw.user_id) ?? null;
    const { daysSince, bucket } = classifyDisengagement(last);
    return {
      userId: raw.user_id,
      communityId: raw.community_id,
      communityName: c?.name ?? "—",
      email: u?.email ?? "—",
      name: [u?.first_name, u?.last_name].filter(Boolean).join(" ") || (u?.email ?? "—"),
      subscriptionStatus: u?.subscription_status ?? "—",
      lastCheckin: last,
      daysSince: Number.isFinite(daysSince) ? daysSince : 999,
      bucket,
    };
  });

  const byBucket = {
    day14plus: rows.filter((r) => r.bucket === "day14plus"),
    day14: rows.filter((r) => r.bucket === "day14"),
    day7: rows.filter((r) => r.bucket === "day7"),
    day3: rows.filter((r) => r.bucket === "day3"),
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-2xl">Disengagement</h1>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Ladder: day 3 gentle, day 7 direct, day 14 leader outreach.
        </p>
      </header>

      <Section title="14+ days silent" color="var(--color-danger)" rows={byBucket.day14plus} />
      <Section title="14 days" color="var(--color-danger)" rows={byBucket.day14} />
      <Section title="7 days" color="var(--color-warning)" rows={byBucket.day7} />
      <Section title="3 days" color="var(--color-accent)" rows={byBucket.day3} />
    </div>
  );
}

function Section({
  title,
  color,
  rows,
}: {
  title: string;
  color: string;
  rows: {
    userId: string;
    communityId: string;
    communityName: string;
    name: string;
    email: string;
    subscriptionStatus: string;
    daysSince: number;
    lastCheckin: string | null;
  }[];
}) {
  return (
    <section>
      <h2 className="font-heading text-lg" style={{ color }}>
        {title} ({rows.length})
      </h2>
      {rows.length === 0 ? (
        <p className="text-xs text-[color:var(--color-text-muted)] mt-1">All clear.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden">
          {rows.map((r) => (
            <li key={r.userId + r.communityId} className="px-4 py-2 flex items-center justify-between text-sm">
              <div className="min-w-0">
                <Link href={`/admin/users/${r.userId}`} className="truncate hover:text-[color:var(--color-accent)]">
                  {r.name}
                </Link>
                <p className="text-xs text-[color:var(--color-text-muted)] truncate">
                  {r.email} · {r.communityName}
                </p>
              </div>
              <div className="text-xs text-right shrink-0">
                <p className="font-heading tracking-widest">
                  {Number.isFinite(r.daysSince) ? `${r.daysSince}d` : "never"}
                </p>
                <p className="text-[color:var(--color-text-muted)]">
                  {r.lastCheckin ?? "no check-in"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
