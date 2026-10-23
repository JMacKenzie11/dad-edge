import type { SubscriptionStatus } from "@/lib/entitlement";

/**
 * Pure rules for turning a Stripe subscription into membership state
 * (DECISIONS.md "Stripe billing"). No I/O, so they're tested directly.
 */

/** Past due keeps access: Stripe is still retrying the card. */
const ACCESS = ["active", "trialing", "past_due"] as const;

export function grantsAccess(stripeStatus: string): boolean {
  return (ACCESS as readonly string[]).includes(stripeStatus);
}

/** The user-level status for a Stripe-billed man: the best of his
 *  Stripe memberships, or canceled when none grants access. */
export function userStatusFrom(stripeStatuses: string[]): SubscriptionStatus {
  for (const s of ["active", "trialing", "past_due"] as const) {
    if (stripeStatuses.includes(s)) return s;
  }
  return "canceled";
}

export type SubscriptionLike = {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  ended_at: number | null;
  items: { data: Array<{ current_period_end?: number | null }> };
};

export type BillingSnapshot = {
  stripe_subscription_id: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  ended_at: string | null;
};

const iso = (secs: number | null | undefined) => (secs ? new Date(secs * 1000).toISOString() : null);

/** Since Stripe API 2025-03-31 the period end lives on the item. */
export function snapshot(sub: SubscriptionLike): BillingSnapshot {
  return {
    stripe_subscription_id: sub.id,
    status: sub.status,
    cancel_at_period_end: sub.cancel_at_period_end,
    current_period_end: iso(sub.items.data[0]?.current_period_end),
    ended_at: iso(sub.ended_at),
  };
}
