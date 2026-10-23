import { openBillingPortal } from "@/lib/billing/portal";

/** Shown while Stripe is retrying a failed card. Stripe sends the
 *  emails; this is the in-app reminder (DECISIONS.md "Stripe billing"). */
export function PaymentBanner() {
  return (
    <form
      action={openBillingPortal}
      className="px-4 py-2 bg-[color:var(--color-danger)] text-white text-sm flex flex-wrap items-center justify-center gap-x-3 gap-y-1"
    >
      <span>Your last payment didn&apos;t go through.</span>
      <button type="submit" className="underline font-heading text-xs tracking-widest">
        UPDATE YOUR CARD
      </button>
    </form>
  );
}
