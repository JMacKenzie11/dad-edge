import { test, expect } from "./fixtures";

/**
 * Course sections end to end: an admin builds a sectioned course, a member
 * sees it as titled groups in section order, and the course is deleted
 * again at the end. Runs on the dev database only (docs/e2e.md).
 */
test("admin builds a sectioned course and a member sees the sections", async ({ asAdmin, asMember }) => {
  test.setTimeout(180_000);
  const title = `zz e2e sections ${Date.now()}`;
  const admin = asAdmin;

  await admin.goto("/admin/courses");
  await admin.getByLabel("New course title").fill(title);
  await admin.getByLabel("Organize lessons into sections").check();
  await admin.getByRole("button", { name: "CREATE COURSE" }).click();
  await admin.waitForURL(/\/admin\/courses\/[0-9a-f-]{36}$/);
  const courseUrl = admin.url();
  await expect(admin.getByText("No sections yet.")).toBeVisible();

  for (const section of ["Course Introduction", "Part 1: Become a Master Communicator"]) {
    await admin.getByLabel("New section title").fill(section);
    await admin.getByRole("button", { name: "ADD SECTION" }).click();
    await expect(admin.getByRole("heading", { name: section })).toBeVisible();
  }

  const addLesson = async (section: string, lesson: string) => {
    await admin.goto(courseUrl);
    await admin.getByLabel(`New lesson title for ${section}`).fill(lesson);
    await admin.getByLabel(`New lesson title for ${section}`).press("Enter");
    await admin.waitForURL(/\/lessons\/[0-9a-f-]{36}$/);
  };
  // Added out of order on purpose: Part 1 first, then the introduction.
  await addLesson("Part 1: Become a Master Communicator", "Mastering Your Voice Tone");
  await addLesson("Course Introduction", "Welcome to the Course");
  await addLesson("Course Introduction", "Outline and Objectives");

  await admin.goto(courseUrl);
  await admin.getByRole("button", { name: "PUBLISH" }).click();
  await expect(admin.getByText("PUBLISHED", { exact: true })).toBeVisible();
  const slug = await admin.getByRole("link", { name: /PREVIEW AS MEMBER/ }).getAttribute("href");

  try {
    const member = asMember;
    await member.goto(slug!.replace("?preview=1", ""));
    await expect(member.getByText("2 sections · 3 lessons")).toBeVisible();
    const cards = member.locator("section", { has: member.locator("button[aria-expanded]") });
    await expect(cards.nth(0)).toContainText("Course Introduction");
    await expect(cards.nth(0)).toContainText("2 lessons");
    await expect(cards.nth(1)).toContainText("Part 1: Become a Master Communicator");
    // Next up follows section order, not the order lessons were added.
    await expect(member.locator("aside", { hasText: "NEXT UP" })).toContainText("Welcome to the Course");
    await member.screenshot({ path: "test-results/course-sections-member.png", fullPage: true });

    await member.getByRole("link", { name: /Outline and Objectives/ }).click();
    await expect(member.getByText("COURSE INTRODUCTION · LESSON 2 OF 3")).toBeVisible();
    await expect(member.getByRole("link", { name: /NEXT →/ })).toContainText("Mastering Your Voice Tone");

    await admin.goto(courseUrl);
    await admin.screenshot({ path: "test-results/course-sections-admin.png", fullPage: true });
    // A section with lessons can't be deleted.
    await admin.getByRole("button", { name: "Delete section Course Introduction" }).click();
    await expect(admin.getByText("Only an empty section can be deleted.")).toBeVisible();
  } finally {
    await admin.goto("/admin/courses");
    await admin.locator("li", { hasText: title }).getByRole("button", { name: "DELETE" }).click();
    await admin.getByRole("alertdialog").getByRole("button", { name: "Delete course" }).click();
    await expect(admin.getByText(title)).toHaveCount(0);
  }
});

test("an existing flat course switches into sections and back without losing lessons", async ({ asAdmin }) => {
  test.setTimeout(180_000);
  const title = `zz e2e flat ${Date.now()}`;
  const admin = asAdmin;

  await admin.goto("/admin/courses");
  await admin.getByLabel("New course title").fill(title);
  await admin.getByRole("button", { name: "CREATE COURSE" }).click();
  await admin.waitForURL(/\/admin\/courses\/[0-9a-f-]{36}$/);
  const courseUrl = admin.url();

  try {
    for (const lesson of ["First lesson", "Second lesson"]) {
      await admin.goto(courseUrl);
      await admin.getByLabel("New lesson title").fill(lesson);
      await admin.getByRole("button", { name: "ADD LESSON" }).click();
      await admin.waitForURL(/\/lessons\/[0-9a-f-]{36}$/);
    }
    await admin.goto(courseUrl);

    await admin.getByRole("button", { name: "ORGANIZE INTO SECTIONS" }).click();
    await admin.getByRole("alertdialog").getByRole("button", { name: "Organize into sections" }).click();
    await expect(admin.getByRole("heading", { name: "Lessons", exact: true }).nth(1)).toBeVisible();
    await expect(admin.getByText("1 section · 2 lessons")).toBeVisible();

    // The lesson editor offers the section picker now.
    await admin.getByRole("link", { name: "Second lesson" }).first().click();
    await admin.waitForURL(/\/lessons\/[0-9a-f-]{36}$/);
    await expect(admin.getByRole("combobox", { name: "SECTION" })).toHaveValue(/[0-9a-f-]{36}/);
    await admin.goto(courseUrl);

    await admin.getByRole("button", { name: "REMOVE SECTIONS" }).click();
    await admin.getByRole("alertdialog").getByRole("button", { name: "Remove sections" }).click();
    await expect(admin.getByRole("button", { name: "ORGANIZE INTO SECTIONS" })).toBeVisible();
    await expect(admin.getByText("2 lessons", { exact: true })).toBeVisible();
    const rows = admin.locator("li", { has: admin.getByRole("link", { name: "EDIT" }) });
    await expect(rows.nth(0)).toContainText("First lesson");
    await expect(rows.nth(1)).toContainText("Second lesson");
  } finally {
    await admin.goto("/admin/courses");
    await admin.locator("li", { hasText: title }).getByRole("button", { name: "DELETE" }).click();
    await admin.getByRole("alertdialog").getByRole("button", { name: "Delete course" }).click();
    await expect(admin.getByText(title)).toHaveCount(0);
  }
});
