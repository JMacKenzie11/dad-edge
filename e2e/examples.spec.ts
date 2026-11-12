import { createClient } from "@supabase/supabase-js";
import { test, expect, credentialsFor } from "./fixtures";

/**
 * Start from an example (DECISIONS.md): picking a prewritten mission or
 * goal fills the box with its first [blank] selected, he types over it,
 * and nothing saves while a blank is left. Removes what it saves. Dev
 * database only (docs/e2e.md).
 */
const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

async function memberId() {
  const { data } = await svc().from("users").select("id").ilike("email", credentialsFor("member").email).single();
  return data!.id as string;
}

test("a mission from an example: type over the blank, then it saves", async ({ asMember: page }) => {
  const id = await memberId();
  try {
    await page.goto("/missions");
    await page.getByRole("button", { name: /add a raise mission, slot 1/i }).click();
    await page.getByRole("button", { name: /^Take \[kid's name\] to breakfast/ }).click();
    const box = page.getByPlaceholder("Behavior + how you'll know it's done.");
    await expect(box).toHaveValue("Take [kid's name] to breakfast, just the two of us, phone in the car.");
    await expect(page.getByText("Fill in [kid's name] first.")).toBeVisible();

    // Enter with the blank still in it doesn't save.
    await box.press("Enter");
    await expect(box).toBeVisible();

    // The blank is selected: typing replaces it.
    await page.keyboard.type("Lawson");
    await expect(box).toHaveValue("Take Lawson to breakfast, just the two of us, phone in the car.");
    await box.press("Enter");
    // Saved once, and only once.
    await expect
      .poll(async () => (await svc().from("missions").select("id").eq("user_id", id).like("description", "Take Lawson to breakfast%")).data?.length)
      .toBe(1);
    await page.reload();
    await expect(page.locator("textarea").filter({ hasText: "Take Lawson to breakfast" })).toHaveCount(1);
  } finally {
    await svc().from("missions").delete().eq("user_id", id).like("description", "Take Lawson to breakfast%");
  }
});

test("a goal from an example, edited before it's set", async ({ asMember: page }) => {
  const id = await memberId();
  try {
    await page.goto("/goals");
    await page.getByRole("button", { name: "RAISE", exact: true }).click();
    await page.getByRole("button", { name: /put \[kid's name\] to bed four nights a week/ }).click();
    // The finish-line box takes focus with the blank selected.
    await expect(page.getByLabel(/where you want to be/i)).toBeFocused();
    await page.keyboard.type("Harper");
    await page.getByLabel(/where you are now/i).fill("I'm home for bedtime once a week at best.");
    await page.getByRole("button", { name: "Set the goal" }).click();
    await expect
      .poll(async () => (await svc().from("quarterly_goals").select("desired_end_state").eq("user_id", id).like("desired_end_state", "%put Harper to bed%")).data?.map((g) => g.desired_end_state))
      .toEqual(["By the end of the quarter, I've put Harper to bed four nights a week, with a story and one question about their day."]);
    await expect(page.getByText("put Harper to bed four nights a week").first()).toBeVisible();
  } finally {
    await svc().from("quarterly_goals").delete().eq("user_id", id).like("desired_end_state", "%put Harper to bed%");
  }
});
