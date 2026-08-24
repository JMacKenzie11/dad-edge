import Link from "next/link";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { format } from "date-fns";
import { SubmitButton } from "@/components/ui/submit-button";
import { createAccount, sendInvitesBatch } from "./actions";
import { BulkDeleteButton } from "./bulk-delete-button";

export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    error?: string;
    created?: string;
    batch_sent?: string;
    batch_failed?: string;
  }>;
}) {
  await requirePlatformAdmin();
  const { q, status, error, created, batch_sent, batch_failed } =
    await searchParams;
  const svc = createSupabaseServiceClient();

  const [{ data: users }, { data: communities }] = await Promise.all([
    (() => {
      let query = svc
        .from("users")
        .select(
          "id, email, first_name, last_name, subscription_status, subscription_source, created_at, last_seen_at, canceled_at, invited_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (q) {
        query = query.or(
          `email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`,
        );
      }
      if (status) query = query.eq("subscription_status", status);
      return query;
    })(),
    svc
      .from("communities")
      .select("id, name, slug")
      .eq("status", "active")
      .order("name", { ascending: true }),
  ]);

  const communityList = (communities ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
  }>;

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="font-heading text-2xl">Users</h1>
      </header>

      {error ? (
        <p className="text-xs text-[color:var(--color-danger)]">{error}</p>
      ) : null}
      {created ? (
        <p className="text-xs text-[color:var(--color-primary)]">
          Account created. No invite email sent yet. Use Send Invite on
          the user's page, or batch send from the list below.
        </p>
      ) : null}
      {batch_sent ? (
        <p className="text-xs text-[color:var(--color-primary)]">
          Batch sent: {batch_sent} invite{batch_sent === "1" ? "" : "s"}.
          {batch_failed && batch_failed !== "0"
            ? ` ${batch_failed} failed (check logs).`
            : ""}
        </p>
      ) : null}

      <section className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] space-y-3">
        <h2 className="font-heading text-sm text-[color:var(--color-accent)]">
          New account
        </h2>
        <p className="text-xs text-[color:var(--color-text-muted)]">
          Creates the account only. Send Invite is a separate action.
        </p>
        <form
          action={createAccount}
          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
        >
          <input
            name="email"
            type="email"
            required
            placeholder="email@example.com"
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm sm:col-span-2"
          />
          <input
            name="first_name"
            placeholder="First name"
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
          />
          <input
            name="last_name"
            placeholder="Last name"
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
          />
          <select
            name="community_id"
            required
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
          >
            <option value="">Community…</option>
            {communityList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            name="subscription_status"
            defaultValue="comped"
            className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm"
          >
            <option value="comped">Comped (default)</option>
            <option value="trialing">Trialing</option>
            <option value="active">Active</option>
            <option value="past_due">Past due</option>
          </select>
          <label className="flex items-center gap-2 text-xs text-[color:var(--color-text-muted)] sm:col-span-2">
            <input
              type="checkbox"
              name="is_platform_admin"
              className="h-4 w-4"
            />
            Platform admin (bypasses RLS, full access to /admin/*)
          </label>
          <div className="sm:col-span-2">
            <SubmitButton
              label="CREATE ACCOUNT"
              pendingLabel="CREATING…"
              className="w-full"
            />
          </div>
        </form>
      </section>

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

      <form action={sendInvitesBatch} className="space-y-2" data-users-form>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs text-[color:var(--color-text-muted)]">
            Tick rows below. SEND INVITES (re-sends for already-invited).
            DELETE SELECTED asks for typed confirmation.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <BulkDeleteButton formSelector="form[data-users-form]" />
            <SubmitButton
              variant="warning"
              label="SEND INVITES (BATCH)"
              pendingLabel="SENDING…"
              className="h-9 px-3 text-xs"
            />
          </div>
        </div>

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
              invited_at: string | null;
            };
            const name =
              [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
            return (
              <li
                key={row.id}
                className="px-4 py-3 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <input
                    type="checkbox"
                    name="user_ids"
                    value={row.id}
                    className="h-4 w-4"
                    aria-label={`Select ${row.email}`}
                  />
                  <div className="min-w-0">
                    <Link
                      href={`/admin/users/${row.id}`}
                      className="text-sm hover:text-[color:var(--color-accent)] block truncate"
                    >
                      {name}
                    </Link>
                    <p className="text-xs text-[color:var(--color-text-muted)] truncate">
                      {row.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs shrink-0">
                  <InviteStatus invitedAt={row.invited_at} />
                  <span
                    className="font-heading tracking-widest"
                    style={{
                      color:
                        row.subscription_status === "active" ||
                        row.subscription_status === "comped"
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
      </form>

      {/* Single-user Send Invite lives on the /admin/users/[id] page. */}
    </div>
  );
}

function InviteStatus({ invitedAt }: { invitedAt: string | null }) {
  if (invitedAt === null) {
    return (
      <span className="font-heading tracking-widest text-[color:var(--color-warning)]">
        NOT INVITED
      </span>
    );
  }
  return (
    <span className="text-[color:var(--color-text-muted)]">
      invited {format(new Date(invitedAt), "MMM d")}
    </span>
  );
}

