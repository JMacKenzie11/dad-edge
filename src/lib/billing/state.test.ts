import { describe, expect, it } from "vitest";
import { grantsAccess, snapshot, userStatusFrom } from "./state";

describe("grantsAccess", () => {
  it("lets in active, trialing and past-due (Stripe still retrying)", () => {
    for (const s of ["active", "trialing", "past_due"]) expect(grantsAccess(s)).toBe(true);
  });
  it("shuts out everything else, including a first payment still pending", () => {
    for (const s of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) expect(grantsAccess(s)).toBe(false);
  });
});

describe("userStatusFrom", () => {
  it("takes the best of his Stripe memberships", () => {
    expect(userStatusFrom(["canceled", "active"])).toBe("active");
    expect(userStatusFrom(["past_due", "trialing"])).toBe("trialing");
    expect(userStatusFrom(["past_due", "canceled"])).toBe("past_due");
  });
  it("is canceled when nothing grants access", () => {
    expect(userStatusFrom(["canceled", "unpaid"])).toBe("canceled");
    expect(userStatusFrom([])).toBe("canceled");
  });
});

describe("snapshot", () => {
  it("reads the period end from the subscription item (Stripe moved it there)", () => {
    const s = snapshot({
      id: "sub_1", status: "active", cancel_at_period_end: true, ended_at: null,
      items: { data: [{ current_period_end: 1_793_000_000 }] },
    });
    expect(s).toEqual({
      stripe_subscription_id: "sub_1",
      status: "active",
      cancel_at_period_end: true,
      current_period_end: new Date(1_793_000_000 * 1000).toISOString(),
      ended_at: null,
    });
  });
});
