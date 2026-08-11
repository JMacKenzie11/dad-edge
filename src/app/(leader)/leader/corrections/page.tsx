import { resolveLeaderCommunity } from "@/lib/leader-context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { submitCorrection } from "../actions";
import { CHOOSABLE_PILLARS } from "@/lib/pillars";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function LeaderCorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; saved?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { communityId, communityName } = await resolveLeaderCommunity(sp);
  const svc = createSupabaseServiceClient();

  const { data: memberships } = await svc
    .from("memberships")
    .select("user_id, users:user_id(first_name, last_name, email)")
    .eq("community_id", communityId)
    .eq("status", "active")
    .order("joined_at");

  const memberIds = (memberships ?? []).map((m) => (m as { user_id: string }).user_id);
  const { data: recent } = memberIds.length
    ? await svc
        .from("score_corrections")
        .select("id, admin_user_id, target_user_id, date, pillar_code, old_value, new_value, reason, created_at, target:target_user_id(first_name, last_name), admin:admin_user_id(first_name, last_name, email)")
        .in("target_user_id", memberIds)
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: [] };

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-heading text-2xl">Score corrections</h1>
          <p className="text-sm text-[color:var(--color-text-muted)]">
            Post-lock edits go through here. Every change is logged with a reason.
          </p>
        </div>
        <span className="text-xs text-[color:var(--color-text-muted)]">{communityName}</span>
      </header>

      {sp.saved ? <p className="text-xs text-[color:var(--color-success)]">Correction recorded.</p> : null}
      {sp.error ? <p className="text-xs text-[color:var(--color-danger)]">{sp.error}</p> : null}

      <form
        action={submitCorrection}
        className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] grid gap-3 md:grid-cols-6"
      >
        <input type="hidden" name="community_id" value={communityId} />
        <label className="flex flex-col gap-1 text-xs md:col-span-2">
          <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">MEMBER</span>
          <select
            name="target_user_id"
            required
            defaultValue=""
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
          >
            <option value="" disabled>
              Select…
            </option>
            {(memberships ?? []).map((m) => {
              const raw = m as {
                user_id: string;
                users: { first_name: string | null; last_name: string | null; email: string } | { first_name: string | null; last_name: string | null; email: string }[] | null;
              };
              const u = Array.isArray(raw.users) ? raw.users[0] : raw.users;
              const name = u ? [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email : raw.user_id;
              return (
                <option key={raw.user_id} value={raw.user_id}>
                  {name}
                </option>
              );
            })}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">DATE</span>
          <input
            type="date"
            name="date"
            required
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">PILLAR</span>
          <select
            name="pillar_code"
            required
            defaultValue=""
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
          >
            <option value="" disabled>
              …
            </option>
            {CHOOSABLE_PILLARS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} · {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">VALUE</span>
          <select
            name="new_value"
            required
            defaultValue="1"
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
          >
            <option value="1">Done (1)</option>
            <option value="0">Missed (0)</option>
            <option value="clear">Clear</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs md:col-span-6">
          <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">REASON</span>
          <input
            name="reason"
            required
            minLength={4}
            maxLength={400}
            placeholder="Missed logging on the road; confirmed by member on call."
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
          />
        </label>
        <div className="md:col-span-6 flex justify-end">
          <button className="h-10 px-4 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest">
            SUBMIT CORRECTION
          </button>
        </div>
      </form>

      <section>
        <h2 className="font-heading text-lg text-[color:var(--color-accent)] mb-2">Recent corrections</h2>
        <ul className="text-xs divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden">
          {(recent ?? []).map((r) => {
            const row = r as {
              id: string;
              date: string;
              pillar_code: string;
              old_value: number | null;
              new_value: number | null;
              reason: string;
              created_at: string;
              target: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null;
              admin: { first_name: string | null; last_name: string | null; email: string } | { first_name: string | null; last_name: string | null; email: string }[] | null;
            };
            const t = Array.isArray(row.target) ? row.target[0] : row.target;
            const a = Array.isArray(row.admin) ? row.admin[0] : row.admin;
            const targetName = t ? [t.first_name, t.last_name].filter(Boolean).join(" ") : "—";
            const adminName = a ? [a.first_name, a.last_name].filter(Boolean).join(" ") || a.email : "—";
            return (
              <li key={row.id} className="px-3 py-2 grid md:grid-cols-[80px_1fr_1fr_2fr] gap-2">
                <span className="text-[color:var(--color-text-muted)]">
                  {format(new Date(row.created_at), "MMM d")}
                </span>
                <span>
                  {targetName} · {row.date} · {row.pillar_code}
                </span>
                <span className="text-[color:var(--color-text-muted)]">
                  {row.old_value ?? "—"} → {row.new_value ?? "—"} (by {adminName})
                </span>
                <span className="text-[color:var(--color-text-muted)] truncate">{row.reason}</span>
              </li>
            );
          })}
          {(recent ?? []).length === 0 ? (
            <li className="px-3 py-4 text-[color:var(--color-text-muted)] text-center">
              No corrections yet.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
