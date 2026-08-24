import { resolveLeaderCommunity } from "@/lib/leader-context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { deactivateMember, reactivateMember } from "../actions";
import { classifyDisengagement, isoDateNDaysAgo } from "@/lib/scoring/disengagement";

export const dynamic = "force-dynamic";

export default async function LeaderMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; saved?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { communityId, communityName } = await resolveLeaderCommunity(sp);
  const svc = createSupabaseServiceClient();

  const { data: memberships } = await svc
    .from("memberships")
    .select("id, user_id, role, status, joined_at, users:user_id(email, first_name, last_name, subscription_status, last_seen_at)")
    .eq("community_id", communityId)
    .order("joined_at", { ascending: false });

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

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="font-heading text-2xl">Members</h1>
        <span className="text-xs text-[color:var(--color-text-muted)]">{communityName}</span>
      </header>

      {sp.saved ? <p className="text-xs text-[color:var(--color-success)]">Saved.</p> : null}
      {sp.error ? <p className="text-xs text-[color:var(--color-danger)]">{sp.error}</p> : null}

      <p className="text-xs text-[color:var(--color-text-muted)]">
        To add a new member, ask an admin to create their account and
        send an invite. You can deactivate / reactivate existing
        members below.
      </p>

      <section>
        <h2 className="font-heading text-lg text-[color:var(--color-accent)] mb-2">
          Members ({(memberships ?? []).length})
        </h2>
        <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden">
          {(memberships ?? []).map((m) => {
            const raw = m as {
              id: string;
              user_id: string;
              role: "member" | "leader";
              status: "active" | "inactive" | "removed";
              users:
                | { email: string; first_name: string | null; last_name: string | null; subscription_status: string; last_seen_at: string | null }
                | { email: string; first_name: string | null; last_name: string | null; subscription_status: string; last_seen_at: string | null }[]
                | null;
            };
            const u = Array.isArray(raw.users) ? raw.users[0] : raw.users;
            if (!u) return null;
            const last = lastByUser.get(raw.user_id) ?? null;
            const { daysSince } = classifyDisengagement(last);
            return (
              <li key={raw.id} className="px-4 py-3 flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <p className="truncate">
                    {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
                  </p>
                  <p className="text-xs text-[color:var(--color-text-muted)] truncate">
                    {u.email} · last {last ? `${daysSince}d ago` : "never"}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs">
                  <span
                    className="font-heading tracking-widest"
                    style={{
                      color: raw.role === "leader" ? "var(--color-accent)" : "var(--color-text-muted)",
                    }}
                  >
                    {raw.role.toUpperCase()}
                  </span>
                  <span
                    className="font-heading tracking-widest"
                    style={{
                      color:
                        raw.status === "active"
                          ? "var(--color-success)"
                          : raw.status === "inactive"
                            ? "var(--color-warning)"
                            : "var(--color-danger)",
                    }}
                  >
                    {raw.status.toUpperCase()}
                  </span>
                  {raw.status === "active" && raw.role !== "leader" ? (
                    <form action={deactivateMember}>
                      <input type="hidden" name="community_id" value={communityId} />
                      <input type="hidden" name="user_id" value={raw.user_id} />
                      <button className="font-heading text-[10px] tracking-widest px-2 h-7 rounded border border-[color:var(--color-border)] hover:border-[color:var(--color-danger)]">
                        DEACTIVATE
                      </button>
                    </form>
                  ) : null}
                  {raw.status === "inactive" ? (
                    <form action={reactivateMember}>
                      <input type="hidden" name="community_id" value={communityId} />
                      <input type="hidden" name="user_id" value={raw.user_id} />
                      <button className="font-heading text-[10px] tracking-widest px-2 h-7 rounded border border-[color:var(--color-border)] hover:border-[color:var(--color-accent)]">
                        REACTIVATE
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

    </div>
  );
}
