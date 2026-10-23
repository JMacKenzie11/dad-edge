import { SubmitButton } from "@/components/ui/submit-button";
import type { ProductOption } from "@/lib/billing/products";
import { setStripeProduct } from "../actions";

/**
 * Links a Stripe product to the community. Paying for that product on
 * the sign-up page adds him here (DECISIONS.md "Stripe billing").
 */
export function SignupPanel({
  communityId,
  slug,
  current,
  products,
  stripeError,
  appUrl,
}: {
  communityId: string;
  slug: string;
  current: string | null;
  products: ProductOption[] | null;
  stripeError: string | null;
  appUrl: string;
}) {
  const link = `${appUrl}/join/${slug}`;
  const linked = current ? products?.find((p) => p.id === current) : null;
  return (
    <section className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] space-y-3">
      <div>
        <h2 className="font-heading text-lg text-[color:var(--color-accent)]">Paid sign-up</h2>
        <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
          Link the Stripe product that buys a place in this community. Paying for it adds him here and sends his invite.
        </p>
      </div>
      {stripeError ? (
        <p className="text-xs text-[color:var(--color-danger)]">{stripeError}</p>
      ) : (
        <form action={setStripeProduct} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={communityId} />
          <label className="flex flex-col gap-1 text-xs grow">
            <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">STRIPE PRODUCT</span>
            <select
              name="stripe_product_id"
              defaultValue={current ?? ""}
              className="h-10 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
            >
              <option value="">No paid sign-up</option>
              {(products ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.price ? ` (${p.price})` : " (no recurring price)"}
                </option>
              ))}
              {current && !linked ? <option value={current}>{current} (not found in Stripe)</option> : null}
            </select>
          </label>
          <SubmitButton label="SAVE PRODUCT" pendingLabel="SAVING…" className="text-xs" />
        </form>
      )}
      {current ? (
        <p className="text-xs">
          <span className="font-heading tracking-widest text-[color:var(--color-text-muted)]">SIGN-UP LINK </span>
          <a href={link} className="underline text-[color:var(--color-accent)] break-all">
            {link}
          </a>
        </p>
      ) : null}
    </section>
  );
}
