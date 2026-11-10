import { expect, test } from "./fixtures";

/**
 * The Coaching pages (DECISIONS.md "Coaching view"): a leader sees his
 * community's men with their goals and missions, opens one, and logs a
 * reach-out. A member can't open them.
 */

test("a leader sees his men, opens one, and logs a reach-out", async ({ asLeader: page }) => {
  await page.goto("/leader/coaching");
  await expect(page.getByRole("heading", { name: "Coaching" })).toBeVisible();
  // Control: the seeded member, with his seeded goal and missions.
  const row = page.getByRole("link", { name: /E2E Member/ }).filter({ hasText: "Lift four times a week" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Call her at lunch on Tuesday");
  // The leader isn't in his own list.
  await expect(page.getByRole("link", { name: /E2E Leader/ })).toHaveCount(0);

  await row.click();
  await expect(page.getByRole("heading", { name: "E2E Member" })).toBeVisible();
  await expect(page.getByText("WHAT TO ASK")).toBeVisible();
  await expect(page.getByText("Starting point: Lifting twice a week.")).toBeVisible();
  await expect(page.getByRole("link", { name: "MESSAGE HIM" })).toBeVisible();

  const note = `Talked after the call ${Date.now()}`;
  await page.getByPlaceholder(/What you talked about/).fill(note);
  await page.getByRole("button", { name: "Log reach-out" }).click();
  const logged = page.locator("li").filter({ hasText: note });
  await expect(logged).toBeVisible();

  await page.getByRole("link", { name: /E2E Basecamp/ }).click();
  await expect(page.getByText(/Reached out this week: .*E2E Member/)).toBeVisible();

  // Clean up so the next run starts from the same place.
  await page.getByRole("link", { name: /E2E Member/ }).filter({ hasText: "Lift four times a week" }).click();
  await logged.getByRole("button", { name: "Remove" }).click();
  await expect(page.locator("li").filter({ hasText: note })).toHaveCount(0);
});

test("an admin can pick the community", async ({ asAdmin: page }) => {
  await page.goto("/admin/coaching");
  await expect(page.getByRole("heading", { name: "Coaching" })).toBeVisible();
  const picker = page.locator("select");
  if (await picker.count()) {
    await picker.selectOption({ label: "E2E BASECAMP" });
    await page.waitForURL(/[?&]c=/);
  }
  await expect(page.getByText("EVERY MAN IN E2E BASECAMP")).toBeVisible();
  await expect(page.getByRole("link", { name: /E2E Member/ }).first()).toBeVisible();
});

test("a member can't open the Coaching pages", async ({ asMember: page }) => {
  await page.goto("/leader/coaching");
  await page.waitForURL(/\/today/);
  await page.goto("/admin/coaching");
  await page.waitForURL(/\/today/);
});
