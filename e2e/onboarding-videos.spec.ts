import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

/**
 * A new man's wizard opens with the welcome video and closes with the
 * app tour (DECISIONS.md "Onboarding videos"). The button stays locked
 * until he has watched the video; one he finished before is unlocked
 * straight away. Makes a throwaway account on dev and deletes it.
 *
 * Playing 90% of a real Vimeo video is too slow and flaky for a browser
 * test, so "watched before" (a lesson_completions row) stands in for the
 * unlock; the playback rule itself is covered by watch-progress.test.ts.
 */
test("the wizard opens with the welcome video and ends with the app tour", async ({ page }) => {
  test.setTimeout(120_000);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = `it+onboard-${randomUUID().slice(0, 8)}@braveman.test`;
  const password = `Test-${randomUUID()}`;
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const id = data.user.id;
  const step = async () => (await db.from("users").select("onboarding_step").eq("id", id).single()).data?.onboarding_step;
  try {
    const { data: community } = await db.from("communities").select("id").eq("slug", "e2e-basecamp").single();
    await db.from("users").update({ subscription_status: "comped", first_name: "Newbie" }).eq("id", id);
    const m = await db.from("memberships").insert({ user_id: id, community_id: community!.id, role: "member", status: "active" });
    if (m.error) throw m.error;
    const { data: course } = await db.from("courses").select("id").eq("slug", "welcome").single();
    const { data: lessons } = await db.from("lessons").select("id, title").eq("course_id", course!.id).order("sort_order");
    const [welcome, tour] = lessons!;

    await signInFresh(page, email, password);
    await page.waitForURL(/\/onboarding\/welcome$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Start here." })).toBeVisible();
    await expect(page.getByText("STEP 1 OF 8")).toBeVisible();
    await expect(page.locator(`iframe[title="${welcome.title}"]`)).toBeVisible();
    const watched = page.getByRole("button", { name: "I've watched it" });
    // Locked until he's watched it.
    await expect(watched).toBeDisabled();
    await expect(page.getByText(/The button unlocks near the end/)).toBeVisible();

    // Finished in the library before: unlocked.
    await db.from("lesson_completions").insert({ user_id: id, lesson_id: welcome.id });
    await page.reload();
    await expect(page.getByText("You've watched this one before.")).toBeVisible();
    await Promise.all([page.waitForURL(/\/onboarding$/), watched.click()]);
    await expect(page.getByText("STEP 2 OF 8")).toBeVisible();
    expect(await step()).toBe(1);

    // Jump to the end of the wizard: the tour comes after the first check-in.
    await db.from("users").update({ onboarding_step: 7 }).eq("id", id);
    await page.goto("/today");
    await page.waitForURL(/\/onboarding\/tour$/);
    await expect(page.getByRole("heading", { name: "One last thing." })).toBeVisible();
    await expect(page.getByText("STEP 8 OF 8")).toBeVisible();
    const done = page.getByRole("button", { name: "Take me to the app" });
    await expect(done).toBeDisabled();

    await db.from("lesson_completions").insert({ user_id: id, lesson_id: tour.id });
    await page.reload();
    await Promise.all([page.waitForURL(/\/today$/, { timeout: 60_000 }), done.click()]);
    expect(await step()).toBe(8);
  } finally {
    await db.auth.admin.deleteUser(id);
  }
});

async function signInFresh(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.keyboard.press("Enter");
}
