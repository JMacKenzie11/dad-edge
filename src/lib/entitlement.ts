/**
 * The one entitlement gate. Section 5.
 * Every protected route calls canAccess(user). The Stripe webhook writes the
 * same subscription_status field (src/lib/billing/webhook.ts).
 */
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "comped";

export type AccessDecision =
  | { access: "full" }
  | { access: "read_only"; reason: "canceled_win_back" }
  | { access: "none"; reason: "canceled_expired" | "no_user" };

const WIN_BACK_DAYS = 30; // DECISION #4

export type SubscriptionSource = "manual" | "stripe";

export function canAccess(user: {
  subscription_status: SubscriptionStatus;
  deactivated_at?: string | null;
  /** Missing means manual: every row before Stripe billing was. */
  subscription_source?: SubscriptionSource | null;
} | null): AccessDecision {
  if (!user) return { access: "none", reason: "no_user" };

  switch (user.subscription_status) {
    case "active":
    case "trialing":
    case "comped":
    case "past_due":
      return { access: "full" };
    case "canceled": {
      // A Stripe cancellation ends access the day the paid period ends,
      // with no read-only window (DECISIONS.md "Stripe billing").
      if (user.subscription_source === "stripe") return { access: "none", reason: "canceled_expired" };
      if (!user.deactivated_at) return { access: "none", reason: "canceled_expired" };
      const cutoff = new Date(user.deactivated_at).getTime() + WIN_BACK_DAYS * 86400_000;
      return Date.now() < cutoff
        ? { access: "read_only", reason: "canceled_win_back" }
        : { access: "none", reason: "canceled_expired" };
    }
  }
}
