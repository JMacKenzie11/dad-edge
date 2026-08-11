import { resolveLeaderCommunity } from "@/lib/leader-context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { classifyDisengagement, isoDateNDaysAgo } from "@/lib/scoring/disengagement";

export const dynamic = "force-dynamic";

export default async function LeaderDisengagementPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const sp = await searchParams;
  const { communityId, communityName } = await resolveLeaderCommunity(sp);
  const svc = createSupabaseServiceClient();

  const { data: memberships } = await svc
    .from("memberships")
    .select("user_id, users:user_id(first_name, last_name, email, phone)")
    .eq("community_id", communityId)
    .eq("status", "active");

  const memberIds = (memberships ?? []).map((m) => (m as { user_id: string }).user_id);
  const { data: checkins } = memberIds.length
    ? await svc
        .from("daily_checkins")
        .select("user_id, date")
        .in("user_id", memberIds)
        .gte("date", isoDateNDaysAgo(30))
    : { data: [] };
  const lastByUser = new Map<string, string>();
  for (const c of (checkins ?? []) as { user_id: string; date: string }[]) {
    const prev = lastByUser.get(c.user_id);
    if (!prev || c.date > prev) lastByUser.set(c.user_id, c.date);
  }

  const rows = (memberships ?? []).map((m) => {
    const raw = m as {
      user_id: string;
      users:
        | { first_name: string | null; last_name: string | null; email: string; phone: string | null }
        | { first_name: string | null; last_name: string | null; email: string; phone: string | null }[]
        | null;
    };
    const u = Array.isArray(raw.users) ? raw.users[0] : raw.users;
    const last = lastByUser.get(raw.user_id) ?? null;
    const { daysSince, bucket } = classifyDisengagement(last);
    return {
      userId: raw.user_id,
      name: [u?.first_name, u?.last_name].filter(Boolean).join(" ") || (u?.email ?? "—"),
      email: u?.email ?? "",
      phone: u?.phone ?? null,
      last,
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
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-heading text-2xl">Disengagement</h1>
          <p className="text-sm text-[color:var(--color-text-muted)]">
            Reach out personally at 14 days. The leaderboard is retention; you are the save.
          </p>
        </div>
        <span className="text-xs text-[color:var(--color-text-muted)]">{communityName}</span>
      </header>

      <Section title="14+ days silent — call them" color="var(--color-danger)" rows={byBucket.day14plus} showContact />
      <Section title="14 days — leader outreach" color="var(--color-danger)" rows={byBucket.day14} showContact />
      <Section title="7 days — direct nudge" color="var(--color-warning)" rows={byBucket.day7} />
      <Section title="3 days — gentle nudge" color="var(--color-accent)" rows={byBucket.day3} />
    </div>
  );
}

function Section({
  title,
  color,
  rows,
  showContact = false,
}: {
  title: string;
  color: string;
  showContact?: boolean;
  rows: {
    userId: string;
    name: string;
    email: string;
    phone: string | null;
    daysSince: number;
    last: string | null;
  }[];
}) {
  return (
    <section>
      <h2 className="font-heading text-lg" style={{ color }}>
        {title} ({rows.length})
      </h2>
      {rows.length === 0 ? (
        <p className="text-xs text-[color:var(--color-text-muted)] mt-1">None.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden">
          {rows.map((r) => (
            <li key={r.userId} className="px-4 py-3 flex items-center justify-between text-sm">
              <div>
                <p>{r.name}</p>
                {showContact ? (
                  <p className="text-xs text-[color:var(--color-text-muted)]">
                    <a href={`mailto:${r.email}`} className="hover:text-[color:var(--color-accent)]">
                      {r.email}
                    </a>
                    {r.phone ? (
                      <>
                        {" · "}
                        <a href={`tel:${r.phone}`} className="hover:text-[color:var(--color-accent)]">
                          {r.phone}
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-xs text-[color:var(--color-text-muted)]">{r.email}</p>
                )}
              </div>
              <div className="text-xs text-right">
                <p className="font-heading tracking-widest">
                  {Number.isFinite(r.daysSince) ? `${r.daysSince}d` : "never"}
                </p>
                <p className="text-[color:var(--color-text-muted)]">{r.last ?? "no check-in"}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
