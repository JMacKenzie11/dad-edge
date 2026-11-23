import { createClient } from "@supabase/supabase-js";
import { test, expect, credentialsFor } from "./fixtures";

/**
 * A new message makes the unread count beside Messages pulse, in the
 * header and the side menu, so he can't miss it (Jason, 2026-11-23).
 * Sends the member one message from the leader and removes it after.
 * Dev database only (docs/e2e.md).
 */
const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const idOf = async (role: "member" | "leader") =>
  (await svc().from("users").select("id").ilike("email", credentialsFor(role).email).single()).data!.id as string;

/** The ring behind a badge is animating. */
const pulsing = (badge: import("@playwright/test").Locator) =>
  badge.evaluate((el) => getComputedStyle(el, "::after").animationName);

test("an unread message pulses the badge beside Messages", async ({ asMember: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const [me, leader] = await Promise.all([idOf("member"), idOf("leader")]);
  const [a, b] = [me, leader].sort();
  let thread = (await svc().from("message_threads").select("id").eq("participant_a", a).eq("participant_b", b).maybeSingle()).data;
  const made = !thread;
  if (!thread) thread = (await svc().from("message_threads").insert({ participant_a: a, participant_b: b }).select("id").single()).data!;
  const { data: msg } = await svc()
    .from("messages")
    .insert({ thread_id: thread.id, sender_id: leader, body: "e2e unread pulse" })
    .select("id")
    .single();
  try {
    await page.goto("/today");
    const header = page.getByRole("link", { name: /^Messages, \d+ unread/ }).locator("span");
    const side = page.getByRole("navigation").getByRole("link", { name: /MESSAGES/ }).getByLabel(/unread/);
    await expect(header).toBeVisible();
    await expect(side).toBeVisible();
    expect(await pulsing(header)).toBe("unread-pulse-ring");
    expect(await pulsing(side)).toBe("unread-pulse-ring");
    await page.screenshot({ path: "test-results/unread-pulse.png", clip: { x: 0, y: 0, width: 1280, height: 520 } });
  } finally {
    await svc().from("messages").delete().eq("id", msg!.id);
    if (made) await svc().from("message_threads").delete().eq("id", thread.id);
  }
});
