import { expect, test } from "./fixtures";

/**
 * On a phone the bottom bar has no Goals tab, and the only way to Goals
 * was a link far down the Missions page (Jason, 2026-11-03). The link
 * now sits at the top, in view without scrolling.
 */

test("Goals is one tap from the top of Missions on a phone", async ({ asMember: page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/missions");
  const link = page.getByRole("link", { name: /your goals|set a goal/i }).first();
  await expect(link).toBeInViewport();
  await link.click();
  // The dev server compiles /goals on first visit.
  await expect(page).toHaveURL(/\/goals$/, { timeout: 30_000 });
});
