import Link from "next/link";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requirePlatformAdmin();
  const { q, status } = await searchParams;
  const svc = createSupabaseServiceClient();

  let query = svc
    .from("users")
    .select("id, email, first_name, last_name, subscription_status, subscription_source, created_at, last_seen_at, canceled_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (q) {
    query = query.or(`email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
  }
  if (status) query = query.eq("subscription_status", status);

  const { data: users } = await query;

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="font-heading text-2xl">Users</h1>
      </header>
      <form className="flex gap-2 flex-wrap" method="get">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name or email"
          className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] flex-1 min-w-[200px]"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
        >
          <option value="">All statuses</option>
          <option value="trialing">Trialing</option>
          <option value="active">Active</option>
          <option value="past_due">Past due</option>
          <option value="canceled">Canceled</option>
          <option value="comped">Comped</option>
        </select>
        <button className="h-10 px-4 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest">
          FILTER
        </button>
      </form>

      <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden">
        {(users ?? []).map((u) => {
          const row = u as {
            id: string;
            email: string;
            first_name: string | null;
            last_name: string | null;
            subscription_status: string;
            subscription_source: string;
            created_at: string;
            last_seen_at: string | null;
            canceled_at: string | null;
          };
          const name = [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
          return (
            <li key={row.id} className="px-4 py-3 flex items-center justify-between">
              <div className="min-w-0">
                <Link
                  href={`/admin/users/${row.id}`}
                  className="text-sm hover:text-[color:var(--color-accent)] block truncate"
                >
                  {name}
                </Link>
                <p className="text-xs text-[color:var(--color-text-muted)] truncate">{row.email}</p>
              </div>
              <div className="flex items-center gap-3 text-xs shrink-0">
                <span
                  className="font-heading tracking-widest"
                  style={{
                    color:
                      row.subscription_status === "active" || row.subscription_status === "comped"
                        ? "var(--color-success)"
                        : row.subscription_status === "past_due"
                          ? "var(--color-warning)"
                          : row.subscription_status === "canceled"
                            ? "var(--color-danger)"
                            : "var(--color-text-muted)",
                  }}
                >
                  {row.subscription_status.toUpperCase()}
                </span>
                <span className="text-[color:var(--color-text-muted)]">{row.subscription_source}</span>
                <span className="text-[color:var(--color-text-muted)]">
                  {row.last_seen_at
                    ? `seen ${format(new Date(row.last_seen_at), "MMM d")}`
                    : "never seen"}
                </span>
              </div>
            </li>
          );
        })}
        {(users ?? []).length === 0 ? (
          <li className="px-4 py-8 text-sm text-[color:var(--color-text-muted)] text-center">
            No users match.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
