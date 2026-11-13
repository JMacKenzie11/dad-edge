import { test, expect } from "./fixtures";

/**
 * A picked day on a regular mission is outlined, not filled. Filled
 * means "done" on a challenge row, and a mission set for every day read
 * as already done, and a new mission starts with no day picked
 * (DECISIONS.md "Mission days: none picked for him, picked is
 * outlined"). Read-only: nothing is saved.
 */
test("picked days are outlined, not filled", async ({ asMember: page }) => {
  await page.goto("/missions");
  const picked = page.getByRole("group", { name: "Days of week" }).getByRole("checkbox", { checked: true }).first();
  await expect(picked).toBeVisible();
  const look = await picked.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, border: cs.borderTopWidth };
  });
  expect(look.bg).toBe("rgba(0, 0, 0, 0)");
  expect(look.border).toBe("1px");
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
