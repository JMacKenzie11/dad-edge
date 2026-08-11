import Link from "next/link";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { auditLog } from "@/lib/audit";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const admin = await requirePlatformAdmin();
  const svc = createSupabaseServiceClient();

  const [
    { count: communityCount },
    { count: memberCount },
    { count: activeMemberships },
    { count: openFlags },
    { count: unreviewedCorrections },
    { count: pendingInvites },
    { data: recentSignups },
  ] = await Promise.all([
    svc.from("communities").select("id", { count: "exact", head: true }).eq("status", "active"),
    svc.from("users").select("id", { count: "exact", head: true }),
    svc.from("memberships").select("id", { count: "exact", head: true }).eq("status", "active"),
    svc.from("coach_flags_queue").select("id", { count: "exact", head: true }).eq("status", "open"),
    svc.from("score_corrections").select("id", { count: "exact", head: true }),
    svc.from("invites").select("id", { count: "exact", head: true }).is("redeemed_at", null),
    svc
      .from("users")
      .select("id, email, first_name, last_name, created_at")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  await auditLog({
    actor_user_id: admin.id,
    action: "admin.overview.view",
  });

  const stats = [
    { label: "COMMUNITIES", value: communityCount ?? 0, href: "/admin/communities" },
    { label: "USERS", value: memberCount ?? 0, href: "/admin/users" },
    { label: "ACTIVE MEMBERSHIPS", value: activeMemberships ?? 0, href: "/admin/users" },
    { label: "PENDING INVITES", value: pendingInvites ?? 0, href: "/admin/invites" },
    { label: "OPEN COACH FLAGS", value: openFlags ?? 0, href: "/admin/coach-flags" },
    { label: "SCORE CORRECTIONS", value: unreviewedCorrections ?? 0, href: "/admin/audit" },
  ];

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          COMMAND CENTER
        </p>
        <h1 className="font-heading text-3xl">Overview</h1>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="block p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] hover:border-[color:var(--color-accent)]"
          >
            <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
              {s.label}
            </p>
            <p className="font-heading text-3xl mt-1">{s.value}</p>
          </Link>
        ))}
      </section>

      <section>
        <h2 className="font-heading text-lg text-[color:var(--color-accent)] mb-3">Recent signups</h2>
        <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden">
          {(recentSignups ?? []).map((u) => {
            const row = u as {
              id: string;
              email: string;
              first_name: string | null;
              last_name: string | null;
              created_at: string;
            };
            const name = [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
            return (
              <li key={row.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p>{name}</p>
                  <p className="text-xs text-[color:var(--color-text-muted)]">{row.email}</p>
                </div>
                <p className="text-xs text-[color:var(--color-text-muted)]">
                  {format(new Date(row.created_at), "MMM d")}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
