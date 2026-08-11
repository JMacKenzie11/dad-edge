import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { createInvite } from "./actions";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function InvitesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requirePlatformAdmin();
  const { saved, error } = await searchParams;
  const svc = createSupabaseServiceClient();

  const [{ data: invites }, { data: communities }] = await Promise.all([
    svc
      .from("invites")
      .select("id, email, first_name, last_name, created_at, redeemed_at, communities:community_id(id, name)")
      .order("created_at", { ascending: false })
      .limit(100),
    svc.from("communities").select("id, name").eq("status", "active").order("name"),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="font-heading text-2xl">Invites</h1>
      </header>

      {saved ? <p className="text-xs text-[color:var(--color-success)]">Invite created.</p> : null}
      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}

      <form
        action={createInvite}
        className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] grid gap-3 md:grid-cols-[1.5fr_1fr_1fr_1.5fr_100px]"
      >
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">EMAIL</span>
          <input
            name="email"
            type="email"
            required
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">FIRST</span>
          <input
            name="first_name"
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">LAST</span>
          <input
            name="last_name"
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">COMMUNITY</span>
          <select
            name="community_id"
            required
            defaultValue=""
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
          >
            <option value="" disabled>
              Select…
            </option>
            {(communities ?? []).map((c) => {
              const row = c as { id: string; name: string };
              return (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              );
            })}
          </select>
        </label>
        <button
          type="submit"
          className="h-10 self-end px-4 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest"
        >
          INVITE
        </button>
      </form>

      <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden">
        {(invites ?? []).map((i) => {
          const row = i as {
            id: string;
            email: string;
            first_name: string | null;
            last_name: string | null;
            created_at: string;
            redeemed_at: string | null;
            communities: { id: string; name: string } | { id: string; name: string }[] | null;
          };
          const community = Array.isArray(row.communities) ? row.communities[0] : row.communities;
          const name = [row.first_name, row.last_name].filter(Boolean).join(" ");
          return (
            <li key={row.id} className="px-4 py-3 flex items-center justify-between text-sm">
              <div className="min-w-0">
                <p className="truncate">{name || row.email}</p>
                <p className="text-xs text-[color:var(--color-text-muted)] truncate">
                  {name ? row.email : ""} · {community?.name ?? "—"}
                </p>
              </div>
              <div className="text-xs">
                {row.redeemed_at ? (
                  <span className="font-heading tracking-widest text-[color:var(--color-success)]">
                    REDEEMED {format(new Date(row.redeemed_at), "MMM d")}
                  </span>
                ) : (
                  <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">
                    SENT {format(new Date(row.created_at), "MMM d")}
                  </span>
                )}
              </div>
            </li>
          );
        })}
        {(invites ?? []).length === 0 ? (
          <li className="px-4 py-8 text-sm text-[color:var(--color-text-muted)] text-center">
            No invites yet.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
