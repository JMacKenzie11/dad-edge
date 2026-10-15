import { test, expect, credentialsFor } from "./fixtures";

/**
 * An admin changes an existing member's name on /admin/users/[id] and the
 * member sees it on their own profile. Puts the original name back at the
 * end. Runs on the dev database only (docs/e2e.md).
 */
test("admin edits a member's name and the member sees it", async ({ asAdmin, asMember }) => {
  test.setTimeout(120_000);
  const admin = asAdmin;
  const { email } = credentialsFor("member");

  await admin.goto("/admin/users");
  await admin.locator("li", { hasText: email }).getByRole("link").first().click();
  await admin.waitForURL(/\/admin\/users\/[0-9a-f-]{36}$/);
  const userUrl = admin.url();

  const first = admin.getByLabel("First name");
  const last = admin.getByLabel("Last name");
  const original = { first: await first.inputValue(), last: await last.inputValue() };
  const stamp = Date.now().toString().slice(-6);

  try {
    await first.fill(`Renamed${stamp}`);
    await last.fill("ByAdmin");
    await admin.getByRole("button", { name: "SAVE NAME" }).click();
    await admin.waitForURL(/saved=1/);
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(`Renamed${stamp} ByAdmin`);

    await asMember.goto("/me/profile");
    await expect(asMember.locator('input[name="first_name"]')).toHaveValue(`Renamed${stamp}`);
    await expect(asMember.locator('input[name="last_name"]')).toHaveValue("ByAdmin");
  } finally {
    await admin.goto(userUrl);
    await admin.getByLabel("First name").fill(original.first);
    await admin.getByLabel("Last name").fill(original.last);
    await admin.getByRole("button", { name: "SAVE NAME" }).click();
    await admin.waitForURL(/saved=1/);
  }
});
