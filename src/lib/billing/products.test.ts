import { describe, expect, it } from "vitest";
import { priceLabel } from "./products";

describe("priceLabel", () => {
  it("formats a monthly price", () => {
    expect(priceLabel({ unit_amount: 4900, currency: "usd", recurring: { interval: "month", interval_count: 1 } as never })).toBe("$49.00 / month");
  });
  it("formats a price every few months", () => {
    expect(priceLabel({ unit_amount: 12000, currency: "usd", recurring: { interval: "month", interval_count: 3 } as never })).toBe("$120.00 every 3 months");
  });
  it("is null for a one-off price, which can't start a subscription", () => {
    expect(priceLabel({ unit_amount: 4900, currency: "usd", recurring: null })).toBeNull();
  });
});
