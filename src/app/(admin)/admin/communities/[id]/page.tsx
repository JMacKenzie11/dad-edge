import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { joinSelf } from "../actions";
import { EditCommunityForm } from "./edit-form";
import { MemberRow } from "./member-row";

export const dynamic = "force-dynamic";

export default async function CommunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const admin = await requirePlatformAdmin();
  const { id } = await params;
  const { saved, error } = await searchParams;
  const svc = createSupabaseServiceClient();

  const { data: community } = await svc
    .from("communities")
    .select("id, name, slug, status, timezone, week_lock_days, leaderboard_enabled, missions_visible")
    .eq("id", id)
    .maybeSingle();
  if (!community) notFound();

  const { data: selfMembership } = await svc
    .from("memberships")
    .select("role, status")
    .eq("community_id", id)
    .eq("user_id", admin.id)
    .maybeSingle();
  const selfMemState = selfMembership as { role: string; status: string } | null;

  const { data: members } = await svc
    .from("memberships")
    .select("id, user_id, role, status, joined_at, users:user_id(email, first_name, last_name, subscription_status, last_seen_at)")
    .eq("community_id", id)
    .order("joined_at", { ascending: false });

  const { data: otherCommunities } = await svc
    .from("communities")
    .select("id, name")
    .neq("id", id)
    .eq("status", "active")
    .order("name");

  const c = community as {
    id: string;
    name: string;
    slug: string;
    status: "active" | "archived";
    timezone: string;
    week_lock_days: number;
    leaderboard_enabled: boolean;
    missions_visible: boolean;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-3">
        <Link href="/admin/communities" className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]">
          ← COMMUNITIES
        </Link>
      </div>
      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          {c.slug}
        </p>
        <h1 className="font-heading text-3xl">{c.name}</h1>
      </header>

      {saved ? (
        <p className="text-xs text-[color:var(--color-success)]">Saved.</p>
      ) : null}
      {error ? (
        <p className="text-xs text-[color:var(--color-danger)]">{error}</p>
      ) : null}

      {(!selfMemState || selfMemState.status !== "active") ? (
        <form
          action={joinSelf}
          className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-primary)] flex items-center justify-between gap-3"
        >
          <input type="hidden" name="community_id" value={c.id} />
          <input type="hidden" name="role" value="leader" />
          <div>
            <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-primary)]">
              YOU'RE NOT A MEMBER YET
            </p>
            <p className="text-sm mt-1">
              Add yourself as leader so you can use the member surface (missions, coach, today).
            </p>
          </div>
          <button
            type="submit"
            className="h-10 px-4 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest shrink-0"
          >
            JOIN AS LEADER
          </button>
        </form>
      ) : null}

      <EditCommunityForm community={c} />

      <section>
        <h2 className="font-heading text-lg text-[color:var(--color-accent)] mb-3">
          Members ({(members ?? []).length})
        </h2>
        <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden">
          {(members ?? []).map((m) => {
            const raw = m as {
              id: string;
              user_id: string;
              role: "member" | "leader";
              status: "active" | "inactive" | "removed";
              users:
                | {
                    email: string;
                    first_name: string | null;
                    last_name: string | null;
                    subscription_status: string;
                    last_seen_at: string | null;
                  }
                | {
                    email: string;
                    first_name: string | null;
                    last_name: string | null;
                    subscription_status: string;
                    last_seen_at: string | null;
                  }[]
                | null;
            };
            const u = Array.isArray(raw.users) ? raw.users[0] : raw.users;
            if (!u) return null;
            return (
              <MemberRow
                key={raw.id}
                communityId={c.id}
                membershipId={raw.id}
                userId={raw.user_id}
                email={u.email}
                name={[u.first_name, u.last_name].filter(Boolean).join(" ")}
                role={raw.role}
                status={raw.status}
                subscriptionStatus={u.subscription_status}
                lastSeenAt={u.last_seen_at}
                otherCommunities={(otherCommunities ?? []) as { id: string; name: string }[]}
              />
            );
          })}
          {(members ?? []).length === 0 ? (
            <li className="px-4 py-8 text-sm text-[color:var(--color-text-muted)] text-center">
              No members yet. Create an account from{" "}
              <Link href="/admin/users" className="text-[color:var(--color-accent)]">
                Users
              </Link>
              , then Send Invite.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
