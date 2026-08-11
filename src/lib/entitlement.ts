/**
 * The one entitlement gate. Section 5.
 * Every protected route calls canAccess(user). Phase 3 (Stripe) writes the same
 * subscription_status field via webhooks; this function does not change.
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

export function canAccess(user: {
  subscription_status: SubscriptionStatus;
  deactivated_at?: string | null;
} | null): AccessDecision {
  if (!user) return { access: "none", reason: "no_user" };

  switch (user.subscription_status) {
    case "active":
    case "trialing":
    case "comped":
    case "past_due":
      return { access: "full" };
    case "canceled": {
      if (!user.deactivated_at) return { access: "none", reason: "canceled_expired" };
      const cutoff = new Date(user.deactivated_at).getTime() + WIN_BACK_DAYS * 86400_000;
      return Date.now() < cutoff
        ? { access: "read_only", reason: "canceled_win_back" }
        : { access: "none", reason: "canceled_expired" };
    }
  }
}
