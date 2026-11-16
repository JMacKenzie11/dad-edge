import { createClient } from "@supabase/supabase-js";
import { test, expect, credentialsFor } from "./fixtures";

/**
 * Leaving /missions with a mission that didn't save stops him with a
 * popup: which missions, why, and a way back (Jason, 2026-11-16, after
 * Scott Zemens lost missions with no day picked and with [kid's name]
 * left in an example). Phone-sized, tapping the bottom nav like he did.
 * Removes what it saves. Dev database only (docs/e2e.md).
 */
const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const TEXT = "Read two chapters of a book with my son before bed, phones away.";

test("leaving with unsaved missions shows each one and why", async ({ asMember: page }) => {
  const { data: me } = await svc().from("users").select("id").ilike("email", credentialsFor("member").email).single();
  try {
    await page.goto("/missions");
    const box = page.getByPlaceholder("Behavior + how you'll know it's done.");

    // One with no day picked.
    await page.getByRole("button", { name: /add a raise mission, slot 1/i }).tap();
    await box.fill(TEXT);
    await page.getByText(/by domain/i).first().tap();

    // One from an example with the blank left in.
    await page.getByRole("button", { name: /add a bond mission, slot 1/i }).tap();
    await page.getByRole("group", { name: "Start from an example" }).getByRole("button").first().tap();
    await page.getByText(/by domain/i).first().tap();

    // Tap COMMUNITY in the bottom nav: held, with both missions and reasons.
    await page.getByRole("link", { name: /COMMUNITY$/ }).tap();
    const popup = page.getByRole("alertdialog");
    await expect(popup).toBeVisible();
    await expect(popup.getByRole("heading")).toHaveText("These 2 missions aren't saved");
    await expect(popup.getByText("Not saved: Tap the day or days you'll do it.")).toBeVisible();
    await expect(popup.getByText(/^Not saved: Fill in \[.+\] first\.$/)).toBeVisible();
    await expect(page).toHaveURL(/\/missions/);
    await page.screenshot({ path: "test-results/unsaved-missions-popup.png" });

    // Back to them: the first one has the cursor, text intact.
    await popup.getByRole("button", { name: "Go back and fix them" }).tap();
    await expect(popup).toHaveCount(0);
    const raiseBox = page.getByRole("listitem").filter({ has: page.locator(`textarea`).filter({ hasText: TEXT }) });
    await expect(raiseBox.locator("textarea")).toHaveValue(TEXT);

    // Fix the Raise one: pick a day, tap away, it saves.
    await raiseBox.getByRole("checkbox").nth(3).tap();
    await page.getByText(/by domain/i).first().tap();
    await expect
      .poll(async () => (await svc().from("missions").select("id").eq("user_id", me!.id).eq("description", TEXT)).data?.length)
      .toBe(1);

    // Still one unsaved (the blank): held again, now just that one.
    await page.getByRole("link", { name: /COMMUNITY$/ }).tap();
    await expect(popup.getByRole("heading")).toHaveText("This mission isn't saved");

    // Leave without saving goes where he tapped.
    await popup.getByRole("button", { name: "Leave without saving" }).tap();
    await expect(page).toHaveURL(/\/community/);
  } finally {
    await svc().from("missions").delete().eq("user_id", me!.id).eq("description", TEXT);
  }
});

test("nothing unsaved: links go straight through", async ({ asMember: page }) => {
  await page.goto("/missions");
  await page.getByRole("link", { name: /COMMUNITY$/ }).tap();
  await expect(page).toHaveURL(/\/community/);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});
