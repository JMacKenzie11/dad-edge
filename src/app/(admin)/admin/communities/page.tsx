import Link from "next/link";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { CreateCommunityForm } from "./create-community-form";

export const dynamic = "force-dynamic";

export default async function CommunitiesPage() {
  await requirePlatformAdmin();
  const svc = createSupabaseServiceClient();

  const { data: communities } = await svc
    .from("communities")
    .select("id, name, slug, status, timezone, week_lock_days, created_at")
    .order("created_at", { ascending: false });

  const ids = (communities ?? []).map((c) => (c as { id: string }).id);
  const { data: counts } = ids.length
    ? await svc
        .from("memberships")
        .select("community_id, status")
        .in("community_id", ids)
    : { data: [] };
  const activeByCommunity = new Map<string, number>();
  for (const r of (counts ?? []) as { community_id: string; status: string }[]) {
    if (r.status === "active") {
      activeByCommunity.set(r.community_id, (activeByCommunity.get(r.community_id) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="font-heading text-2xl">Communities</h1>
      </header>

      <CreateCommunityForm />

      <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden">
        {(communities ?? []).map((c) => {
          const row = c as {
            id: string;
            name: string;
            slug: string;
            status: "active" | "archived";
            timezone: string;
            week_lock_days: number;
          };
          return (
            <li key={row.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <Link
                  href={`/admin/communities/${row.id}`}
                  className="font-heading text-sm hover:text-[color:var(--color-accent)]"
                >
                  {row.name}
                </Link>
                <p className="text-xs text-[color:var(--color-text-muted)]">
                  {row.slug} · {row.timezone} · lock {row.week_lock_days}d
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="text-[color:var(--color-text-muted)]">
                  {activeByCommunity.get(row.id) ?? 0} active
                </span>
                <span
                  className="font-heading tracking-widest"
                  style={{
                    color:
                      row.status === "active"
                        ? "var(--color-success)"
                        : "var(--color-text-muted)",
                  }}
                >
                  {row.status.toUpperCase()}
                </span>
              </div>
            </li>
          );
        })}
        {(communities ?? []).length === 0 ? (
          <li className="px-4 py-8 text-sm text-[color:var(--color-text-muted)] text-center">
            No communities yet.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
