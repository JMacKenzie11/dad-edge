import { describe, expect, it } from "vitest";
import { canAccess } from "./entitlement";

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

describe("canAccess", () => {
  it("gives a hand-managed cancellation 30 days of read-only access", () => {
    expect(canAccess({ subscription_status: "canceled", deactivated_at: daysAgo(3), subscription_source: "manual" }))
      .toEqual({ access: "read_only", reason: "canceled_win_back" });
    expect(canAccess({ subscription_status: "canceled", deactivated_at: daysAgo(31), subscription_source: "manual" }))
      .toEqual({ access: "none", reason: "canceled_expired" });
  });

  it("cuts a Stripe cancellation off the day it ends, with no read-only window", () => {
    expect(canAccess({ subscription_status: "canceled", deactivated_at: daysAgo(0), subscription_source: "stripe" }))
      .toEqual({ access: "none", reason: "canceled_expired" });
  });

  it("keeps full access while a Stripe payment is being retried", () => {
    expect(canAccess({ subscription_status: "past_due", deactivated_at: null, subscription_source: "stripe" }))
      .toEqual({ access: "full" });
  });

  it("treats a missing source as hand-managed, as every row before Stripe was", () => {
    expect(canAccess({ subscription_status: "canceled", deactivated_at: daysAgo(3) }).access).toBe("read_only");
  });
});
