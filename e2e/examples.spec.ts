import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
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

/** Top of an element on the page, whatever the scroll. */
const pageY = (l: import("@playwright/test").Locator) => l.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);

/** Examples come five at a time in random order: page through to one. */
async function pickExample(page: Page, name: RegExp) {
  const target = page.getByRole("button", { name });
  for (let i = 0; i < 3 && !(await target.isVisible()); i++) {
    await page.getByRole("button", { name: "SHOW OTHER EXAMPLES" }).click();
  }
  await target.click();
}

test("five examples at a time, floating over the page", async ({ asMember: page }) => {
  await page.goto("/missions");
  await page.getByRole("button", { name: /add a raise mission, slot 1/i }).click();
  const list = page.getByRole("group", { name: "Start from an example" });
  await expect(list.getByRole("listitem")).toHaveCount(5);
  const first = await list.getByRole("listitem").allTextContents();
  await page.getByRole("button", { name: "SHOW OTHER EXAMPLES" }).click();
  const next = await list.getByRole("listitem").allTextContents();
  expect(next).toHaveLength(5);
  expect(next.filter((t) => first.includes(t))).toEqual([]);

  // It floats: the list hangs over the add-mission row beneath it
  // instead of pushing that row down below it. Under the top bar.
  const below = page.getByRole("button", { name: /add a raise mission/i }).last();
  const listBox = (await list.boundingBox())!;
  expect((await below.boundingBox())!.y).toBeLessThan(listBox.y + listBox.height);
  // Nothing in the row below can sit on top of it.
  const topAt = await list.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + 20, r.bottom - 10);
    return el.contains(hit);
  });
  expect(topAt).toBe(true);
  await page.screenshot({ path: "test-results/examples-floating.png" });

  // Same on the goal form: opening the list leaves the form where it is.
  await page.goto("/goals");
  const field = page.getByLabel(/where you are now/i);
  const g1 = await pageY(field);
  await page.getByRole("button", { name: /START FROM AN EXAMPLE/ }).click();
  await expect(page.getByRole("group", { name: "Start from an example" }).getByRole("listitem")).toHaveCount(5);
  expect(await pageY(field)).toBe(g1);
  await page.screenshot({ path: "test-results/examples-floating-goal.png" });
});

test("a mission from an example: type over the blank, then it saves", async ({ asMember: page }) => {
  const id = await memberId();
  try {
    await page.goto("/missions");
    await page.getByRole("button", { name: /add a raise mission, slot 1/i }).click();
    await pickExample(page, /^Take \[kid's name\] to breakfast/);
    const box = page.getByPlaceholder("Behavior + how you'll know it's done.");
    await expect(box).toHaveValue("Take [kid's name] to breakfast, just the two of us, phone in the car.");
    await expect(page.getByText("Fill in [kid's name] first.")).toBeVisible();

    // Enter with the blank still in it doesn't save.
    await box.press("Enter");
    await expect(box).toBeVisible();

    // The blank is selected: typing replaces it.
    await page.keyboard.type("Lawson");
    await expect(box).toHaveValue("Take Lawson to breakfast, just the two of us, phone in the car.");
    // No day is picked for him: Enter asks for one.
    await box.press("Enter");
    await expect(page.getByText("Tap the day or days you'll do it.")).toBeVisible();
    await page.getByRole("listitem").filter({ has: box }).getByRole("checkbox").last().click();
    await expect(page.getByText("Tap the day or days you'll do it.")).toHaveCount(0);
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
    await page.getByRole("button", { name: /START FROM AN EXAMPLE/ }).click();
    await pickExample(page, /put \[kid's name\] to bed four nights a week/);
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
