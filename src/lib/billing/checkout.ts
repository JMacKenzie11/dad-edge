import type Stripe from "stripe";

/**
 * The Checkout Session for a paid sign-up (DECISIONS.md "Stripe
 * billing"). Embedded: Stripe's payment form renders inside /join/<slug>
 * and returns to the welcome page. Without the browser key
 * (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) it falls back to Stripe's own
 * checkout page, so sign-up keeps working while the key is being set up.
 */
export function checkoutSessionParams(input: {
  embedded: boolean;
  priceId: string;
  communityId: string;
  slug: string;
  origin: string;
  person: { email: string; first_name: string; last_name: string };
  customerId: string | null;
}): Stripe.Checkout.SessionCreateParams {
  const metadata = { community_id: input.communityId, ...input.person };
  const welcome = `${input.origin}/join/${input.slug}/welcome`;
  return {
    mode: "subscription",
    line_items: [{ price: input.priceId, quantity: 1 }],
    ...(input.customerId ? { customer: input.customerId } : { customer_email: input.person.email }),
    allow_promotion_codes: true,
    subscription_data: { metadata },
    metadata,
    ...(input.embedded
      ? { ui_mode: "embedded_page" as const, return_url: welcome }
      : { success_url: welcome, cancel_url: `${input.origin}/join/${input.slug}` }),
  };
}
