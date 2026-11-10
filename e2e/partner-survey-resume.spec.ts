import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * The Partner survey saves every answer as he goes, and he can come back
 * to finish it (DECISIONS.md "Partner survey saves every answer"). Before,
 * closing the tab lost every answer.
 */

async function discardAnyDraft(page: Page) {
  await page.goto("/me/survey/take");
  const discard = page.getByRole("button", { name: "Discard survey" });
  if (await discard.isVisible()) {
    page.once("dialog", (d) => d.accept());
    await discard.click();
    await page.waitForURL("**/me/survey");
  }
}

test("answers save as he goes and are there when he comes back", async ({ asMember: page }) => {
  await discardAnyDraft(page);
  await page.goto("/me/survey/take");
  // Control: the page has fifteen questions to fill.
  await expect(page.getByText(/^QUESTION \d+/)).toHaveCount(15);

  const first = page.locator("li").filter({ hasText: "QUESTION 1" }).first();
  await first.getByRole("button", { name: "4", exact: true }).click();
  await first.getByPlaceholder("Her words. Verbatim.").fill("More time on Sunday mornings");
  await first.getByPlaceholder("Her words. Verbatim.").blur();
  await expect(first.getByText("Saved")).toBeVisible();
  await expect(page.getByText("1 OF 15 ANSWERED")).toBeVisible();

  // Leave without finishing.
  await page.goto("/me/survey");
  const resume = page.getByRole("link", { name: /pick up where you left off/i });
  await expect(resume).toContainText("1 of 15 answered");
  await expect(page.getByRole("button", { name: "Start a survey" })).toHaveCount(0);

  await resume.click();
  const again = page.locator("li").filter({ hasText: "QUESTION 1" }).first();
  await expect(again.getByRole("button", { name: "4", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(again.getByPlaceholder("Her words. Verbatim.")).toHaveValue("More time on Sunday mornings");

  // Finishing early says what's missing and keeps it in progress.
  await page.getByRole("button", { name: "Finish survey" }).click();
  await expect(page.getByText("Score every question. Missing 14.")).toBeVisible();

  await discardAnyDraft(page);
  await expect(page.getByRole("button", { name: "Start a survey" })).toBeVisible();
});

test("a finished survey lands in the history with today's date", async ({ asMember: page }) => {
  await discardAnyDraft(page);
  await page.goto("/me/survey/take");
  const items = page.locator("ol > li");
  await expect(items).toHaveCount(15);
  for (let i = 0; i < 15; i++) {
    const q = items.nth(i);
    await q.getByRole("button", { name: "3", exact: true }).click();
    await q.getByPlaceholder("Her words. Verbatim.").fill(`Answer ${i + 1}`);
  }
  // Finish right away: anything still waiting to save goes first.
  await page.getByRole("button", { name: "Finish survey" }).click();
  await page.waitForURL(/\/me\/survey\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Composite 3.00" })).toBeVisible();
  await expect(page.getByText("Answer 15")).toBeVisible();

  await page.goto("/me/survey");
  await expect(page.getByRole("link", { name: /pick up where you left off/i })).toHaveCount(0);
});
