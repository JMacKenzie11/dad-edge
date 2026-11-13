import { test, expect } from "./fixtures";

/**
 * A new mission starts with no day picked, and a day he taps turns
 * solid blue (DECISIONS.md "Mission days: none picked for him").
 * Read-only: nothing is saved.
 */
test("a picked day is solid blue", async ({ asMember: page }) => {
  await page.goto("/missions");
  await page.getByRole("button", { name: /add a raise mission, slot 1/i }).click();
  const box = page.getByPlaceholder("Behavior + how you'll know it's done.");
  const day = page.getByRole("listitem").filter({ has: box }).getByRole("checkbox").first();
  const bg = () => day.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bg()).toBe("rgba(0, 0, 0, 0)");
  await day.click();
  expect(await bg()).toBe("rgb(0, 117, 201)");
});

test("a new mission starts with no day picked", async ({ asMember: page }) => {
  await page.goto("/missions");
  await page.getByRole("button", { name: /add a raise mission, slot 1/i }).click();
  const box = page.getByPlaceholder("Behavior + how you'll know it's done.");
  const days = page.getByRole("listitem").filter({ has: box }).getByRole("checkbox");
  await expect(days).toHaveCount(7);
  await expect(page.getByRole("listitem").filter({ has: box }).getByRole("checkbox", { checked: true })).toHaveCount(0);
  // He can pick one and take it back again.
  await days.first().click();
  await expect(days.first()).toBeChecked();
  await days.first().click();
  await expect(days.first()).not.toBeChecked();
});
