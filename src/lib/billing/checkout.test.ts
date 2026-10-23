import { describe, expect, it } from "vitest";
import { checkoutSessionParams } from "./checkout";

const base = {
  priceId: "price_1",
  communityId: "c-1",
  slug: "the-basecamp",
  origin: "https://app.example",
  person: { email: "a@b.com", first_name: "Jo", last_name: "Doe" },
  customerId: null,
};

describe("checkoutSessionParams", () => {
  it("embeds the payment form in our page and comes back to the welcome page", () => {
    const p = checkoutSessionParams({ ...base, embedded: true });
    expect(p.ui_mode).toBe("embedded_page");
    expect(p.return_url).toBe("https://app.example/join/the-basecamp/welcome");
    expect(p).not.toHaveProperty("success_url");
    expect(p).not.toHaveProperty("cancel_url");
  });

  it("falls back to Stripe's own page when the browser key isn't set", () => {
    const p = checkoutSessionParams({ ...base, embedded: false });
    expect(p.ui_mode).toBeUndefined();
    expect(p.success_url).toBe("https://app.example/join/the-basecamp/welcome");
    expect(p.cancel_url).toBe("https://app.example/join/the-basecamp");
  });

  it("carries the community and his details on the subscription for the webhook", () => {
    const p = checkoutSessionParams({ ...base, embedded: true });
    expect(p.subscription_data?.metadata).toEqual({ community_id: "c-1", email: "a@b.com", first_name: "Jo", last_name: "Doe" });
    expect(p.allow_promotion_codes).toBe(true);
    expect(p.customer_email).toBe("a@b.com");
  });

  it("reuses his Stripe customer when he already has one", () => {
    const p = checkoutSessionParams({ ...base, embedded: true, customerId: "cus_9" });
    expect(p.customer).toBe("cus_9");
    expect(p).not.toHaveProperty("customer_email");
  });
});
