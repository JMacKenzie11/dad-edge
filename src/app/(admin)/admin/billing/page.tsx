import Link from "next/link";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

type Row = {
  user_id: string;
  status: string;
  payment_failed_at: string | null;
  current_period_end: string | null;
  users: { email: string; first_name: string | null; last_name: string | null } | null;
  communities: { name: string } | null;
};

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Everyone whose card is failing while Stripe retries it (DECISIONS.md
 * "Stripe billing"). Stripe emails him; this is the admins' view.
 */
export default async function BillingPage() {
  await requirePlatformAdmin();
  const svc = createSupabaseServiceClient();

  const { data } = await svc
    .from("membership_billing")
    .select("user_id, status, payment_failed_at, current_period_end, users:user_id(email, first_name, last_name), communities:community_id(name)")
    .not("payment_failed_at", "is", null)
    .in("status", ["past_due", "active", "trialing"])
    .order("payment_failed_at", { ascending: true });
  const failing = ((data ?? []) as unknown as Row[]).map((r) => ({ ...r, users: one(r.users), communities: one(r.communities) }));

  const { count: billed } = await svc
    .from("membership_billing")
    .select("membership_id", { count: "exact", head: true })
    .in("status", ["active", "trialing", "past_due"]);

  const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-3xl">Billing</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
          {billed ?? 0} paying through Stripe. Stripe retries a failed card and emails him each time; when the last try fails, his membership ends.
        </p>
      </header>

      <section>
        <h2 className="font-heading text-lg text-[color:var(--color-accent)] mb-3">Failed payments ({failing.length})</h2>
        {failing.length === 0 ? (
          <p className="text-sm text-[color:var(--color-text-muted)]">No one&apos;s card is failing right now.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden">
            {failing.map((r) => {
              const name = [r.users?.first_name, r.users?.last_name].filter(Boolean).join(" ") || r.users?.email;
              const days = daysSince(r.payment_failed_at!);
              return (
                <li key={`${r.user_id}-${r.communities?.name}`} className="p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div>
                    <Link href={`/admin/users/${r.user_id}`} className="hover:text-[color:var(--color-primary)]">
                      {name}
                    </Link>
                    <p className="text-xs text-[color:var(--color-text-muted)]">
                      {r.users?.email} · {r.communities?.name}
                    </p>
                  </div>
                  <p className="text-xs text-[color:var(--color-danger)]">
                    Failing {days === 0 ? "since today" : `for ${days} day${days === 1 ? "" : "s"}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
