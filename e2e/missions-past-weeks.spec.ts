import { createClient } from "@supabase/supabase-js";
import { test, expect, credentialsFor } from "./fixtures";

/**
 * A man pages back to a locked week on Missions and sees what he set and
 * how it went, with nothing he can change (DECISIONS.md "Past mission
 * weeks"). Plants one mission three weeks back, always past any lock,
 * and removes it at the end. Dev database only (docs/e2e.md).
 */
const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

/** Monday of the current UTC week, shifted by whole weeks. */
function mondayPlus(weeks: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + weeks * 7);
  return d.toISOString().slice(0, 10);
}

const WORDING = "Take the boys fishing Wednesday after school";

test("a locked week can be looked at, not changed", async ({ asMember: page }) => {
  const db = svc();
  const { data: member } = await db.from("users").select("id").ilike("email", credentialsFor("member").email).single();
  const { data: membership } = await db.from("memberships").select("community_id").eq("user_id", member!.id).eq("status", "active").limit(1).single();
  const monday = mondayPlus(-3);
  // Wednesday, so a timezone a day either side still lands in that week.
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 2);
  const day = d.toISOString().slice(0, 10);
  const { data: planted, error } = await db
    .from("missions")
    .insert({ user_id: member!.id, community_id: membership!.community_id, description: WORDING, pillar_code: "R", target_date: day, target_dates: [day], created_by: "user", status: "missed" })
    .select("id")
    .single();
  expect(error).toBeNull();

  try {
    // Back three weeks with the arrows.
    await page.goto("/missions");
    for (let i = 0; i < 3; i++) {
      const before = page.url();
      await page.getByRole("link", { name: "Previous week" }).click();
      await page.waitForURL((u) => u.toString() !== before);
    }
    expect(new URL(page.url()).searchParams.get("week")).toBe(monday);

    await expect(page.getByText("LOCKED · VIEW ONLY")).toBeVisible();
    await expect(page.getByText("This week is locked, so nothing in it can change.")).toBeVisible();
    const row = page.locator("li", { hasText: WORDING });
    await expect(row).toBeVisible();
    await expect(row).toContainText("MISSED");
    // Nothing to edit, complete, carry or delete, and nothing to add.
    await expect(page.locator("textarea")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "COMPLETE" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /NEXT WEEK|THIS WEEK/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete mission" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^\+ ADD/ })).toHaveCount(0);

    // Back to this week, where the seed's missions are editable as before.
    await page.getByRole("link", { name: "Back to this week" }).click();
    await page.waitForURL((u) => !u.searchParams.has("week"));
    await expect(page.getByText("Call her at lunch on Tuesday", { exact: true })).toBeVisible();
  } finally {
    await db.from("missions").delete().eq("id", planted!.id);
  }
});
