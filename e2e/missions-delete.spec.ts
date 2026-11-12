import { createClient } from "@supabase/supabase-js";
import { test, expect, credentialsFor } from "./fixtures";

/**
 * A mission entered by mistake comes off the week, even one already
 * marked COMPLETE, after a confirm (Jason, 2026-11-12). The delete button
 * is always shown, so it works on a phone, where nothing hovers.
 * Plants one completed Enjoyment mission this week and removes it if the
 * test doesn't. Dev database only (docs/e2e.md).
 */
const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const WORDING = "Movie night with the kids on Friday, entered twice";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("a completed mission entered by mistake can be deleted, after a confirm", async ({ asMember: page }) => {
  const db = svc();
  const { data: member } = await db.from("users").select("id").ilike("email", credentialsFor("member").email).single();
  const { data: membership } = await db.from("memberships").select("community_id").eq("user_id", member!.id).eq("status", "active").limit(1).single();
  const today = new Date().toISOString().slice(0, 10);
  const { data: planted, error } = await db
    .from("missions")
    .insert({ user_id: member!.id, community_id: membership!.community_id, description: WORDING, pillar_code: "E", target_date: today, target_dates: [today], created_by: "user", status: "completed", completed_at: new Date().toISOString() })
    .select("id")
    .single();
  expect(error).toBeNull();

  try {
    await page.goto("/missions");
    const row = page.locator("li", { hasText: WORDING });
    const del = row.getByRole("button", { name: "Delete mission" });
    await expect(del).toBeVisible();

    // Keep it: nothing changes.
    await del.tap();
    await expect(page.getByText("Delete this mission?")).toBeVisible();
    await page.getByRole("button", { name: "Keep it" }).tap();
    await expect(row).toBeVisible();

    await del.tap();
    await page.getByRole("button", { name: "DELETE", exact: true }).tap();
    await expect(page.locator("li", { hasText: WORDING })).toHaveCount(0);
    const { data: left } = await db.from("missions").select("id").eq("id", planted!.id);
    expect(left).toEqual([]);
  } finally {
    await db.from("missions").delete().eq("id", planted!.id);
  }
});
