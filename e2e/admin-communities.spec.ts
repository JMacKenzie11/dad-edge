import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";

/**
 * Admin > Communities lists active communities only; archived ones are
 * left off. Plants one of each on dev and removes them at the end.
 */
const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

test("the communities list leaves out archived communities", async ({ asAdmin }) => {
  const db = svc();
  const tag = Date.now().toString(36);
  const active = `E2E Active ${tag}`;
  const archived = `E2E Archived ${tag}`;
  const { data: rows, error } = await db
    .from("communities")
    .insert([
      { name: active, slug: `e2e-active-${tag}`, status: "active" },
      { name: archived, slug: `e2e-archived-${tag}`, status: "archived" },
    ])
    .select("id");
  expect(error).toBeNull();
  try {
    await asAdmin.goto("/admin/communities");
    // Control: the active one is listed, so the list itself rendered.
    await expect(asAdmin.getByRole("link", { name: active })).toBeVisible();
    await expect(asAdmin.getByRole("link", { name: archived })).toHaveCount(0);
    await expect(asAdmin.getByText("ARCHIVED", { exact: true })).toHaveCount(0);
  } finally {
    await db.from("communities").delete().in("id", (rows ?? []).map((r) => r.id));
  }
});
