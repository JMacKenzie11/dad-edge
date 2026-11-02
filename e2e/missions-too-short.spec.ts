import { expect, test } from "./fixtures";

/**
 * A mission under eight characters can't save. Enter used to do nothing
 * and say nothing, so "Weights" under a goal looked like a broken save
 * (Larry, 2026-11-02). Now he's told why.
 */

test("a too-short new goal mission says why it didn't save", async ({ asMember: page }) => {
  await page.goto("/missions");
  await page.getByRole("button", { name: /add a goal mission/i }).first().click();
  const box = page.getByPlaceholder("Behavior + how you'll know it's done.");
  await box.fill("Weights");
  await box.press("Enter");
  await expect(page.getByText(/too short/i)).toBeVisible();
  // Still open with his words in it, so he can add to them.
  await expect(box).toHaveValue("Weights");
});

test("shortening a saved mission too far says why it didn't save", async ({ asMember: page }) => {
  await page.goto("/missions");
  // The seed's Bond mission (scripts/seed-e2e.ts).
  await page.getByText("Call her at lunch on Tuesday", { exact: true }).click();
  // Clicking the wording opens it for editing, focused.
  const box = page.locator("textarea:focus");
  await expect(box).toHaveValue("Call her at lunch on Tuesday");
  await box.fill("Call");
  await box.press("Enter");
  await expect(page.getByText(/too short/i)).toBeVisible();
  // Nothing changed underneath.
  await page.reload();
  await expect(page.getByText("Call her at lunch on Tuesday", { exact: true })).toBeVisible();
});
