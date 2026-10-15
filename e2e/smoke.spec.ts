import { expect, test } from "./fixtures";

/**
 * Smoke: each role lands where it should and its main surface renders.
 * Data comes from `npm run seed:e2e` (docs/e2e.md).
 */

test("member lands on Today and sees Resources in the menu", async ({ asMember: page }) => {
  await expect(page).toHaveURL(/\/today/);
  await expect(page.locator('aside a[href="/resources"]')).toBeVisible();
});

test("member's library lists the e2e course", async ({ asMember: page }) => {
  await page.goto("/resources");
  await expect(page.getByRole("heading", { name: "E2E Course" })).toBeVisible();
});

test("member with two Bond missions this week isn't offered a third", async ({ asMember: page }) => {
  await page.goto("/missions");
  await expect(page.getByRole("heading", { name: /this week by domain/i })).toBeVisible();
  // Control first: the Raise row's two empty slots prove the add buttons
  // are findable, so the Bond row's zero means something.
  await expect(page.getByText("+ ADD A RAISE MISSION", { exact: true })).toHaveCount(2);
  await expect(page.getByText("+ ADD A BOND MISSION", { exact: true })).toHaveCount(0);
});

test("leader can open the leader overview", async ({ asLeader: page }) => {
  await page.goto("/leader");
  await expect(page).toHaveURL(/\/leader/);
});

test("admin can open the course list", async ({ asAdmin: page }) => {
  await page.goto("/admin/courses");
  await expect(page.getByRole("heading", { name: "Courses" })).toBeVisible();
});

test("improvement-map coachee can open the map tool", async ({ asCoachee: page }) => {
  await page.goto("/itc");
  await expect(page).toHaveURL(/\/itc/);
  await expect(page.getByText(/start a new map/i)).toBeVisible();
});
