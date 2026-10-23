import { createClient } from "@supabase/supabase-js";
import { test, expect, credentialsFor } from "./fixtures";

/**
 * A member whose card is failing sees the banner and the billing link,
 * and admins see him on /admin/billing. Plants a past-due billing row on
 * the member's membership (no Stripe call needed) and removes it at the
 * end. A member with no Stripe billing sees neither. Dev database only
 * (docs/e2e.md).
 */
const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

test("a failing card shows the member a banner and the admins a list", async ({ asMember, asAdmin }) => {
  test.setTimeout(120_000);
  const db = svc();
  const { email } = credentialsFor("member");
  const { data: user } = await db.from("users").select("id").ilike("email", email).single();
  const { data: m } = await db.from("memberships").select("id, community_id").eq("user_id", user!.id).eq("status", "active").limit(1).single();
  const subId = `sub_e2e_${Date.now()}`;

  // Control: no billing row, no banner.
  await asMember.goto("/today");
  await expect(asMember.getByText("Your last payment didn't go through.")).toHaveCount(0);
  await asMember.goto("/me/profile");
  await expect(asMember.getByRole("button", { name: "MANAGE BILLING" })).toHaveCount(0);

  await db.from("membership_billing").insert({
    membership_id: m!.id,
    user_id: user!.id,
    community_id: m!.community_id,
    stripe_customer_id: "cus_e2e",
    stripe_subscription_id: subId,
    status: "past_due",
    payment_failed_at: new Date(Date.now() - 3 * 86400_000).toISOString(),
  });
  try {
    await asMember.goto("/today");
    await expect(asMember.getByText("Your last payment didn't go through.")).toBeVisible();
    await expect(asMember.getByRole("button", { name: "UPDATE YOUR CARD" })).toBeVisible();
    await asMember.goto("/me/profile");
    await expect(asMember.getByRole("button", { name: "MANAGE BILLING" })).toBeVisible();

    await asAdmin.goto("/admin/billing");
    const row = asAdmin.locator("li", { hasText: email });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Failing for 3 days");
  } finally {
    await db.from("membership_billing").delete().eq("stripe_subscription_id", subId);
  }
});

test("a community with no Stripe product shows sign-up as closed", async ({ page }) => {
  const { data: c } = await svc().from("communities").select("slug").is("stripe_product_id", null).eq("status", "active").limit(1).single();
  await page.goto(`/join/${c!.slug}`);
  await expect(page.getByRole("heading", { name: "Sign-up is closed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "CONTINUE TO PAYMENT" })).toHaveCount(0);
});
