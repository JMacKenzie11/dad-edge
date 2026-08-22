import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { canAccess } from "@/lib/entitlement";
import { setSubscriptionStatus, setPlatformAdmin, sendInvite } from "../actions";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

const STATUSES = ["trialing", "active", "past_due", "canceled", "comped"] as const;

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; created?: string; invited?: string }>;
}) {
  await requirePlatformAdmin();
  const { id } = await params;
  const { saved, error, created, invited } = await searchParams;
  const svc = createSupabaseServiceClient();

  const { data: user } = await svc
    .from("users")
    .select("id, email, first_name, last_name, phone, timezone, is_platform_admin, subscription_status, subscription_source, canceled_at, created_at, last_seen_at, onboarding_step, invited_at")
    .eq("id", id)
    .maybeSingle();
  if (!user) notFound();

  const u = user as {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    timezone: string;
    is_platform_admin: boolean;
    subscription_status: "trialing" | "active" | "past_due" | "canceled" | "comped";
    subscription_source: string;
    canceled_at: string | null;
    created_at: string;
    last_seen_at: string | null;
    onboarding_step: number | null;
    invited_at: string | null;
  };

  const { data: memberships } = await svc
    .from("memberships")
    .select("id, role, status, communities:community_id(id, name, slug)")
    .eq("user_id", id);

  const { data: recentCheckins } = await svc
    .from("daily_checkins")
    .select("date, pillar_code, value, logged_at")
    .eq("user_id", id)
    .order("date", { ascending: false })
    .limit(24);

  const { data: recentMissions } = await svc
    .from("missions")
    .select("description, pillar_code, target_date, status, completed_late")
    .eq("user_id", id)
    .order("target_date", { ascending: false })
    .limit(8);

  const access = canAccess({
    subscription_status: u.subscription_status,
    deactivated_at: u.canceled_at,
  });

  return (
    <div className="space-y-6">
      <Link href="/admin/users" className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]">
        ← USERS
      </Link>

      <header className="flex items-baseline justify-between">
        <div>
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            USER
          </p>
          <h1 className="font-heading text-3xl">
            {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
          </h1>
          <p className="text-sm text-[color:var(--color-text-muted)]">{u.email}</p>
        </div>
        <span
          className="text-xs font-heading tracking-widest"
          style={{
            color:
              access.access === "full"
                ? "var(--color-success)"
                : access.access === "read_only"
                  ? "var(--color-warning)"
                  : "var(--color-danger)",
          }}
        >
          {access.access.toUpperCase()} ACCESS
        </span>
      </header>

      {saved ? <p className="text-xs text-[color:var(--color-success)]">Saved.</p> : null}
      {created ? (
        <p className="text-xs text-[color:var(--color-success)]">
          Account created. Send Invite is a separate action below.
        </p>
      ) : null}
      {invited ? (
        <p className="text-xs text-[color:var(--color-success)]">
          Invite sent. The activation link is short-lived.
        </p>
      ) : null}
      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}

      <section className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
              INVITE
            </p>
            <p className="text-sm">
              {u.invited_at
                ? `Invite sent ${format(new Date(u.invited_at), "yyyy-MM-dd HH:mm")}`
                : "Never invited"}
            </p>
          </div>
          <form action={sendInvite}>
            <input type="hidden" name="user_id" value={u.id} />
            <button
              className="h-9 px-3 rounded-md bg-[color:var(--color-warning)] text-black font-heading text-xs tracking-widest"
              type="submit"
            >
              {u.invited_at ? "RESEND INVITE" : "SEND INVITE"}
            </button>
          </form>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-xs space-y-1">
          <p><span className="text-[color:var(--color-text-muted)]">Phone:</span> {u.phone ?? "—"}</p>
          <p><span className="text-[color:var(--color-text-muted)]">Timezone:</span> {u.timezone}</p>
          <p><span className="text-[color:var(--color-text-muted)]">Onboarding:</span> step {u.onboarding_step ?? 0}/7</p>
          <p><span className="text-[color:var(--color-text-muted)]">Signed up:</span> {format(new Date(u.created_at), "yyyy-MM-dd")}</p>
          <p>
            <span className="text-[color:var(--color-text-muted)]">Last seen:</span>{" "}
            {u.last_seen_at ? format(new Date(u.last_seen_at), "yyyy-MM-dd HH:mm") : "never"}
          </p>
          <p>
            <span className="text-[color:var(--color-text-muted)]">Source:</span> {u.subscription_source}
          </p>
        </div>

        <div className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] space-y-3">
          <form action={setSubscriptionStatus} className="space-y-2">
            <input type="hidden" name="user_id" value={u.id} />
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">
                ENTITLEMENT
              </span>
              <select
                name="subscription_status"
                defaultValue={u.subscription_status}
                className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">
                REASON (LOGGED)
              </span>
              <input
                name="reason"
                maxLength={240}
                placeholder="Comped for launch cohort"
                className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
              />
            </label>
            <button className="h-10 px-4 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest">
              UPDATE STATUS
            </button>
          </form>

          <form action={setPlatformAdmin} className="flex items-center gap-2 text-xs">
            <input type="hidden" name="user_id" value={u.id} />
            <input
              type="checkbox"
              name="is_platform_admin"
              defaultChecked={u.is_platform_admin}
              id="platform_admin"
            />
            <label htmlFor="platform_admin">Platform admin</label>
            <button className="ml-auto h-8 px-3 rounded border border-[color:var(--color-border)] font-heading text-[10px] tracking-widest">
              SAVE
            </button>
          </form>
        </div>
      </section>

      <section>
        <h2 className="font-heading text-lg text-[color:var(--color-accent)] mb-2">Memberships</h2>
        <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden text-sm">
          {(memberships ?? []).map((m) => {
            const raw = m as {
              id: string;
              role: "member" | "leader";
              status: "active" | "inactive" | "removed";
              communities: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null;
            };
            const c = Array.isArray(raw.communities) ? raw.communities[0] : raw.communities;
            if (!c) return null;
            return (
              <li key={raw.id} className="px-4 py-2 flex items-center justify-between">
                <Link href={`/admin/communities/${c.id}`} className="hover:text-[color:var(--color-accent)]">
                  {c.name}
                </Link>
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">
                    {raw.role.toUpperCase()}
                  </span>
                  <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">
                    {raw.status.toUpperCase()}
                  </span>
                </div>
              </li>
            );
          })}
          {(memberships ?? []).length === 0 ? (
            <li className="px-4 py-4 text-xs text-[color:var(--color-text-muted)]">No memberships.</li>
          ) : null}
        </ul>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div>
          <h2 className="font-heading text-lg text-[color:var(--color-accent)] mb-2">Recent check-ins</h2>
          <ul className="text-xs border border-[color:var(--color-border)] rounded-[var(--radius-card)] divide-y divide-[color:var(--color-border)] overflow-hidden">
            {(recentCheckins ?? []).map((c, i) => {
              const row = c as { date: string; pillar_code: string; value: number };
              return (
                <li key={i} className="px-3 py-2 flex justify-between">
                  <span>{row.date}</span>
                  <span className="text-[color:var(--color-text-muted)]">
                    {row.pillar_code} · {row.value}
                  </span>
                </li>
              );
            })}
            {(recentCheckins ?? []).length === 0 ? (
              <li className="px-3 py-3 text-[color:var(--color-text-muted)]">No check-ins yet.</li>
            ) : null}
          </ul>
        </div>
        <div>
          <h2 className="font-heading text-lg text-[color:var(--color-accent)] mb-2">Recent missions</h2>
          <ul className="text-xs border border-[color:var(--color-border)] rounded-[var(--radius-card)] divide-y divide-[color:var(--color-border)] overflow-hidden">
            {(recentMissions ?? []).map((m, i) => {
              const row = m as {
                description: string;
                pillar_code: string;
                target_date: string;
                status: string;
                completed_late: boolean;
              };
              return (
                <li key={i} className="px-3 py-2">
                  <p className="truncate">{row.description}</p>
                  <p className="text-[color:var(--color-text-muted)]">
                    {row.target_date} · {row.pillar_code} · {row.status}
                    {row.completed_late ? " (late)" : ""}
                  </p>
                </li>
              );
            })}
            {(recentMissions ?? []).length === 0 ? (
              <li className="px-3 py-3 text-[color:var(--color-text-muted)]">No missions.</li>
            ) : null}
          </ul>
        </div>
      </section>
    </div>
  );
}
