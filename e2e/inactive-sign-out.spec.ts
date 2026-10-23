import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { test, expect, credentialsFor } from "./fixtures";

/**
 * A man whose access has ended lands on /inactive. He has to be able to
 * sign out there and sign in as someone else: Jason tested a paid
 * sign-up, refunded it, and was stuck on /inactive as the test account
 * (2026-10-23). Makes a throwaway ended account on dev and deletes it.
 */
test("an ended account can sign out from /inactive and sign in as someone else", async ({ page }) => {
  test.setTimeout(120_000);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = `it+ended-${randomUUID().slice(0, 8)}@braveman.test`;
  const password = `Test-${randomUUID()}`;
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const id = data.user.id;
  try {
    await db.from("users").update({ subscription_status: "canceled", subscription_source: "stripe", canceled_at: new Date().toISOString(), onboarding_step: 6 }).eq("id", id);

    await page.goto("/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await Promise.all([page.waitForURL(/\/inactive/, { timeout: 60_000 }), page.keyboard.press("Enter")]);

    await Promise.all([page.waitForURL(/\/login/), page.getByRole("button", { name: "SIGN OUT" }).click()]);

    const member = credentialsFor("member");
    await page.fill('input[name="email"]', member.email);
    await page.fill('input[name="password"]', member.password);
    await Promise.all([page.waitForURL((u) => !/\/(login|inactive)/.test(u.pathname), { timeout: 60_000 }), page.keyboard.press("Enter")]);
  } finally {
    await db.auth.admin.deleteUser(id);
  }
});
