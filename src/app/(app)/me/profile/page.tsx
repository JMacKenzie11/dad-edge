import Link from "next/link";
import { requireAccess } from "@/lib/session";
import { EditProfileForm } from "./edit-form";
import { myBilling } from "@/lib/billing/member";
import { openBillingPortal } from "@/lib/billing/portal";

export const dynamic = "force-dynamic";

export default async function EditProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { user } = await requireAccess();
  const params = await searchParams;
  const billing = await myBilling();

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <Link
        href="/me"
        className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
      >
        ← ME
      </Link>

      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          EDIT PROFILE
        </p>
        <h1 className="font-heading text-3xl mt-1">Your details</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
          Your photo, name, and where you&apos;re based. Cell phone is
          leader/admin visible only.
        </p>
      </header>

      {params.error ? (
        <p className="text-xs text-[color:var(--color-danger)]">{params.error}</p>
      ) : null}

      <EditProfileForm
        defaultFirstName={user.first_name ?? ""}
        defaultLastName={user.last_name ?? ""}
        defaultCity={user.city ?? ""}
        defaultPhone={user.phone ?? ""}
        existingAvatarUrl={user.avatar_url ?? ""}
      />

      {billing.hasStripe ? (
        <form
          action={openBillingPortal}
          className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] flex items-center justify-between gap-3"
        >
          <div>
            <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">BILLING</p>
            <p className="text-sm mt-1">Change your card, see receipts, or cancel on Stripe&apos;s billing page.</p>
          </div>
          <button
            type="submit"
            className="h-10 px-4 rounded-md border border-[color:var(--color-border)] font-heading text-xs tracking-widest shrink-0 hover:bg-[color:var(--color-bg)]"
          >
            MANAGE BILLING
          </button>
        </form>
      ) : null}
    </div>
  );
}
