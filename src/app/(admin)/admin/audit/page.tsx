import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actor?: string }>;
}) {
  await requirePlatformAdmin();
  const { action, actor } = await searchParams;
  const svc = createSupabaseServiceClient();

  let query = svc
    .from("audit_log")
    .select("id, actor_user_id, action, target_type, target_id, metadata, created_at, users:actor_user_id(email)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (action) query = query.ilike("action", `${action}%`);
  if (actor) query = query.eq("actor_user_id", actor);

  const { data: rows } = await query;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-heading text-2xl">Audit log</h1>
      </header>

      <form method="get" className="flex gap-2 flex-wrap">
        <input
          name="action"
          defaultValue={action ?? ""}
          placeholder="action prefix (e.g. entitlement)"
          className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] flex-1 min-w-[200px]"
        />
        <button className="h-10 px-4 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest">
          FILTER
        </button>
      </form>

      <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden text-xs">
        {(rows ?? []).map((r) => {
          const row = r as {
            id: string;
            action: string;
            target_type: string | null;
            target_id: string | null;
            metadata: Record<string, unknown>;
            created_at: string;
            users: { email: string } | { email: string }[] | null;
          };
          const actorEmail = Array.isArray(row.users) ? row.users[0]?.email : row.users?.email;
          return (
            <li key={row.id} className="px-4 py-2 grid grid-cols-[110px_1fr_180px_1fr] gap-2">
              <span className="text-[color:var(--color-text-muted)]">
                {format(new Date(row.created_at), "MMM d HH:mm")}
              </span>
              <span className="font-heading tracking-wide">{row.action}</span>
              <span className="text-[color:var(--color-text-muted)] truncate">
                {actorEmail ?? row.action}
              </span>
              <span className="text-[color:var(--color-text-muted)] truncate">
                {row.target_type ? `${row.target_type}:${row.target_id ?? ""}` : ""}
                {Object.keys(row.metadata ?? {}).length > 0
                  ? ` · ${JSON.stringify(row.metadata)}`
                  : ""}
              </span>
            </li>
          );
        })}
        {(rows ?? []).length === 0 ? (
          <li className="px-4 py-8 text-center text-[color:var(--color-text-muted)]">Empty.</li>
        ) : null}
      </ul>
    </div>
  );
}
